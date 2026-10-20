"""Prepare a raw video for editing: grade, transcribe, find speech islands, track the face, pre-mark fillers.

    .venv/bin/python app/lib/prepare.py <project-dir> <source-video>

Writes assets/raw.mp4, assets/raw.json, assets/islands.json, assets/face-track.json and edit.json.
Prints "STAGE: ..." lines for the app's progress log.
"""
import array, json, math, re, subprocess, sys
from pathlib import Path

import numpy as np

proj, src = Path(sys.argv[1]), Path(sys.argv[2])
A = proj / "assets"
A.mkdir(parents=True, exist_ok=True)
FILLERS = {"um", "uh", "uhm", "umm", "ah", "eh", "er", "erm", "hmm", "mm", "uhh"}


def stage(msg):
    print(f"STAGE: {msg}", flush=True)


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


# ---------- probe ----------
stage("Reading the video")
info = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(src)]).stdout)
vs = next(s for s in info["streams"] if s["codec_type"] == "video")
auds = [s for s in info["streams"] if s["codec_type"] == "audio" and s.get("codec_name") != "apac"]
rot = 0
for sd in vs.get("side_data_list", []):
    if "rotation" in sd:
        rot = int(sd["rotation"])
w, h = int(vs["width"]), int(vs["height"])
if abs(rot) % 180 == 90:
    w, h = h, w
transfer = vs.get("color_transfer", "")
duration = float(info["format"]["duration"])
if not auds:
    sys.exit("This video has no usable audio track.")
audio_idx = auds[0]["index"]

# ---------- grade ----------
stage("Fixing color and light")
if transfer in ("arib-std-b67", "smpte2084"):
    grade = "colorspace=all=bt709:iall=bt2020:itrc=bt2020-10:format=yuv420p,eq=contrast=1.06:saturation=1.08:gamma=0.97"
    look = "hdr"
else:
    yavg = []
    for t in np.linspace(duration * 0.1, duration * 0.9, 5):
        out = subprocess.run(["ffmpeg", "-v", "info", "-hide_banner", "-ss", f"{t:.2f}", "-i", str(src), "-frames:v", "1", "-vf",
                              "signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"],
                             capture_output=True, text=True).stderr
        m = re.search(r"YAVG=([\d.]+)", out)
        if m:
            yavg.append(float(m.group(1)))
    mean = sum(yavg) / max(1, len(yavg))
    if mean < 85:
        grade = ("hqdn3d=2:2:4:4,curves=master='0/0 0.25/0.36 0.6/0.72 1/1',eq=contrast=1.08:saturation=1.15,"
                 "colorbalance=rs=0.03:bs=-0.03,unsharp=5:5:0.6")
        look = f"dark (Y {mean:.0f}): lifted"
    else:
        grade = "eq=contrast=1.04:saturation=1.06"
        look = f"normal (Y {mean:.0f})"
scale = ""
if max(w, h) > 1920:
    k = 1920 / max(w, h)
    w, h = int(round(w * k / 2) * 2), int(round(h * k / 2) * 2)
    scale = f",scale={w}:{h}"
run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-map", "0:v:0", "-map", f"0:{audio_idx}",
     "-vf", f"{grade}{scale},fps=30", "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-g", "30", "-pix_fmt", "yuv420p",
     "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
     "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "1", "-movflags", "+faststart", str(A / "raw.mp4")])

# ---------- transcribe ----------
stage("Transcribing (local Whisper)")
sys.path.insert(0, str(Path(__file__).parent))
from stt import transcribe  # noqa: E402

wav = A / "raw-audio.wav"
run(["ffmpeg", "-v", "error", "-y", "-i", str(A / "raw.mp4"), "-vn", "-ac", "1", "-ar", "16000", str(wav)])
vocab = json.load(open(Path(__file__).parent.parent / "vocab.json"))["terms"]
prompt = ("Taglish na video para sa developers. Um, uh, so, ano. " + ", ".join(vocab))[:700]
words = []
for wd in transcribe(wav, prompt):
    t = wd["word"].strip()
    if not t:
        continue
    if words and re.match(r"^[-.']", t):
        words[-1]["text"] += t
        words[-1]["end"] = round(wd["end"], 3)
        continue
    words.append({"text": t, "start": round(wd["start"], 3), "end": round(wd["end"], 3)})
json.dump({"text": " ".join(x["text"] for x in words), "audio_duration_secs": duration, "words": words},
          open(A / "raw.json", "w"), indent=1)

# ---------- speech islands ----------
stage("Finding pauses")
pcm = run(["ffmpeg", "-v", "error", "-i", str(A / "raw.mp4"), "-vn", "-ac", "1", "-ar", "16000", "-af", "highpass=f=100",
           "-f", "s16le", "-"]).stdout
a = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768
W = 160
n = len(a) // W
env = 10 * np.log10((a[: n * W].reshape(n, W) ** 2).mean(axis=1) + 1e-12)
p10, p70 = np.percentile(env, 10), np.percentile(env, 70)
thr = float(p10 + 0.4 * (p70 - p10))
np.save(A / "envelope.npy", env.astype(np.float32))
loud = env >= thr
isl, st, quiet = [], None, 0
for i, l in enumerate(list(loud) + [False] * 50):
    if l:
        st = i if st is None else st
        quiet = 0
    elif st is not None:
        quiet += 1
        if quiet * 0.01 >= 0.12:
            end = i - quiet + 1
            if (end - st) * 0.01 >= 0.05:
                isl.append([round(st * 0.01, 2), round(end * 0.01, 2)])
            st, quiet = None, 0
json.dump(isl, open(A / "islands.json", "w"))

# ---------- face track ----------
stage("Tracking your face")
TW, TH, STEP = 320, int(round(320 * h / w)), 0.5
raw = run(["ffmpeg", "-v", "error", "-i", str(A / "raw.mp4"), "-vf", f"fps={1 / STEP},scale={TW}:{TH}",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]).stdout
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, TH, TW, 3).astype(np.int16)
track = []
for i, f in enumerate(frames):
    r_, g_, b_ = f[..., 0], f[..., 1], f[..., 2]
    skin = (r_ > 70) & (r_ > g_ + 8) & (g_ > b_) & (r_ - b_ > 25)
    skin[int(TH * 0.8):] = False
    cols = skin.sum(axis=0).astype(float)
    if cols.sum() < 0.002 * TW * TH:
        track.append(None)
        continue
    cx = int(np.argmax(np.convolve(cols, np.ones(max(3, TW // 13)) / max(3, TW // 13), mode="same")))
    band = skin[:, max(0, cx - TW // 12): cx + TW // 12]
    rows = np.where(band.sum(axis=1) > band.shape[1] * 0.25)[0]
    top = int(rows.min()) if len(rows) else None
    bot = int(rows.max()) if len(rows) else None
    track.append({"t": round(i * STEP, 2), "x": round(cx * w / TW, 1),
                  "top": None if top is None else round(top * h / TH, 1),
                  "bottom": None if bot is None else round(bot * h / TH, 1)})
good = [t for t in track if t]
med = lambda k: float(np.median([t[k] for t in good if t[k] is not None])) if good else None
face = {"x": med("x") or w / 2, "top": med("top") or h * 0.3, "bottom": med("bottom") or h * 0.7}
track = [t or {"t": round(i * STEP, 2), "x": face["x"], "top": face["top"], "bottom": face["bottom"]} for i, t in enumerate(track)]
json.dump({"median": face["x"], "face": face, "track": track}, open(A / "face-track.json", "w"), indent=1)

# ---------- pre-marked cuts ----------
stage("Marking fillers and repeats")
norm = lambda t: re.sub(r"[^\w-]", "", t.lower())
strikes, suggestions = [], []
for i, wd in enumerate(words):
    if norm(wd["text"]) in FILLERS:
        strikes.append(i)
for i in range(len(words) - 1):
    a_, b_ = norm(words[i]["text"]), norm(words[i + 1]["text"])
    if a_ and a_ == b_ and len(a_) > 2 and a_ not in FILLERS and not a_.endswith("agad"):
        suggestions.append({"words": [i], "reason": f"repeated '{words[i]['text']}'"})

edit_path = proj / "edit.json"
edit = json.load(open(edit_path)) if edit_path.exists() else {}
edit.update({
    "media": {"width": w, "height": h, "duration": duration, "orientation": "portrait" if h > w else "landscape",
              "look": look, "threshold": round(thr, 1), "face": face},
    "words": [{"i": i, **wd} for i, wd in enumerate(words)],
})
edit.setdefault("strikes", strikes)
edit.setdefault("suggestedCuts", suggestions)
edit.setdefault("fixes", {})
edit.setdefault("emphasis", [])
edit.setdefault("highlights", {})
edit.setdefault("title", {"title": "", "kicker": ""})
edit.setdefault("cards", [])
json.dump(edit, open(edit_path, "w"), indent=1)
stage(f"Ready: {len(words)} words, {len(strikes)} fillers marked, {len(suggestions)} repeats suggested")
