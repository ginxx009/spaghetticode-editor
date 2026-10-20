"""Turn edit.json word strikes into a frame-exact cut.

    .venv/bin/python app/lib/cut.py <project-dir> [--plan-only]

Struck words become removal ranges whose edges snap to the quietest 20 ms near each boundary.
Pauses between kept phrases collapse to a short breath. Writes assets/cut-edl.json,
assets/words-out.json (kept words on the output timeline) and assets/clean.mp4.
"""
import json, subprocess, sys
from pathlib import Path

import numpy as np

proj = Path(sys.argv[1])
A = proj / "assets"
FPS = 30
TAIL, HEAD = 0.09, 0.06
MAXGAP, MAXGAP_SENT = 0.16, 0.24

edit = json.load(open(proj / "edit.json"))
words = edit["words"]
fixes = {int(k): v for k, v in edit.get("fixes", {}).items()}
struck = set(edit.get("strikes", []))
islands = json.load(open(A / "islands.json"))
env = np.load(A / "envelope.npy")
dur = edit["media"]["duration"]


def quietest(t0, t1):
    i0, i1 = max(0, int(t0 * 100)), min(len(env) - 2, int(t1 * 100))
    if i1 <= i0:
        return (t0 + t1) / 2
    w = env[i0:i1 + 2]
    sm = np.convolve(w, np.ones(2) / 2, mode="valid")
    return (i0 + int(np.argmin(sm)) + 1) / 100


kept = [w for w in words if w["i"] not in struck]
removals = []
if kept:
    removals.append((0.0, max(0.0, kept[0]["start"] - 0.25), "lead-in"))
    removals.append((kept[-1]["end"] + 0.3, dur + 1, "tail"))
run = []
for w in words + [None]:
    if w is not None and w["i"] in struck:
        run.append(w)
        continue
    if run:
        prev = next((k for k in reversed(kept) if k["end"] <= run[0]["start"] + 0.05), None)
        nxt = w
        a = quietest((prev["end"] - 0.12) if prev else run[0]["start"] - 0.2, run[0]["start"] + 0.2) if prev else 0.0
        b = quietest(run[-1]["end"] - 0.2, (nxt["start"] + 0.12)) if nxt else dur + 1
        if b > a:
            removals.append((a, b, " ".join(x["text"] for x in run)))
        run = []

pieces = []
for s, e in islands:
    ps = [[s, e, False, False]]
    for rs, re_, _ in removals:
        nxt = []
        for p in ps:
            if p[1] <= rs or p[0] >= re_:
                nxt.append(p)
                continue
            if p[0] < rs:
                nxt.append([p[0], rs, p[2], True])
            if p[1] > re_:
                nxt.append([re_, p[1], True, p[3]])
        ps = nxt
    pieces += [p for p in ps if p[1] - p[0] >= 0.06]


def sentence_end(t):
    ws = [w for w in words if abs(w["end"] - t) < 0.35]
    return bool(ws) and ws[-1]["text"][-1:] in ".?!,"


segs, cur = [], None
for s, e, hs, he in pieces:
    start = s if hs else max(0, s - HEAD)
    if cur is None:
        cur = [start, e, he]
        continue
    gap = s - cur[1]
    limit = MAXGAP_SENT if sentence_end(cur[1]) else MAXGAP
    if not cur[2] and not hs and gap <= limit:
        cur[1], cur[2] = e, he
    else:
        if not cur[2]:
            cur[1] = min(cur[1] + TAIL, s - (0 if hs else HEAD))
        segs.append(cur[:2])
        cur = [start, e, he]
if cur:
    if not cur[2]:
        cur[1] = min(cur[1] + 0.25, dur)
    segs.append(cur[:2])
snap = lambda t: round(t * FPS) / FPS
segs = [[snap(s), snap(e)] for s, e in segs if snap(e) > snap(s)]
merged = []
for s in segs:
    if merged and s[0] - merged[-1][1] < 1.5 / FPS:
        merged[-1][1] = s[1]
    else:
        merged.append(s)
segs = merged

maps, t = [], 0.0
for s, e in segs:
    maps.append({"src_start": s, "src_end": e, "out_start": round(t, 4)})
    t += e - s
total = round(t, 4)


def to_out(ts):
    for m in maps:
        if m["src_start"] - 0.02 <= ts <= m["src_end"] + 0.02:
            return m["out_start"] + min(max(ts, m["src_start"]), m["src_end"]) - m["src_start"]
    return None


out_words = []
for w in kept:
    s_, e_ = to_out(w["start"]), to_out(w["end"])
    mid = to_out((w["start"] + w["end"]) / 2)
    if mid is None and s_ is None and e_ is None:
        continue
    s_ = s_ if s_ is not None else (mid if mid is not None else e_)
    e_ = e_ if e_ is not None and e_ >= s_ else s_ + max(0.08, w["end"] - w["start"])
    out_words.append({"i": w["i"], "text": fixes.get(w["i"], w["text"]), "start": round(s_, 3), "end": round(e_, 3)})
for k in range(1, len(out_words)):
    if out_words[k]["start"] < out_words[k - 1]["start"]:
        out_words[k]["start"] = out_words[k - 1]["start"]

json.dump({"fps": FPS, "source_duration": dur, "output_duration": total, "segments": maps,
           "removed": [{"start": round(a, 3), "end": round(b, 3), "reason": r} for a, b, r in removals]},
          open(A / "cut-edl.json", "w"), indent=1)
json.dump({"duration": total, "words": out_words}, open(A / "words-out.json", "w"), indent=1)
print(f"STAGE: Cut {dur:.1f}s -> {total:.1f}s in {len(segs)} pieces", flush=True)
if "--plan-only" in sys.argv:
    sys.exit(0)

F, spf, lines = 0.012, 48000 // FPS, []
for i, (s, e) in enumerate(segs):
    fs, fe = round(s * FPS), round(e * FPS)
    lines.append(f"[0:v]trim=start_frame={fs}:end_frame={fe},setpts=PTS-STARTPTS[v{i}];")
    lines.append(f"[0:a]atrim=start_sample={fs * spf}:end_sample={fe * spf},asetpts=PTS-STARTPTS,"
                 f"afade=t=in:d={F},afade=t=out:st={e - s - F:.4f}:d={F}[a{i}];")
lines.append("".join(f"[v{i}][a{i}]" for i in range(len(segs))) + f"concat=n={len(segs)}:v=1:a=1[v][a]")
(A / "cut-filter.txt").write_text("\n".join(lines))
ver = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout
major = int((__import__("re").search(r"ffmpeg version n?(\d+)", ver) or [None, "7"])[1])
script_flag = ["-/filter_complex", str(A / "cut-filter.txt")] if major >= 7 else ["-filter_complex_script", str(A / "cut-filter.txt")]
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(A / "raw.mp4"), *script_flag,
                "-map", "[v]", "-map", "[a]", "-r", str(FPS), "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-g", "15",
                "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
                "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(A / "clean.mp4")], check=True)
print("STAGE: Clean cut rendered", flush=True)
