"""Check a render like an editor would: clipped words at cuts, card timing, loudness.

    .venv/bin/python app/lib/qa.py <project-dir> <rendered.mp4>

Writes assets/qa.json: {"checks": [{"level": "ok"|"warn", "text": ..., "t": seconds or null}]}.
"""
import difflib, json, re, subprocess, sys
from pathlib import Path

proj, out_file = Path(sys.argv[1]), Path(sys.argv[2])
A = proj / "assets"
checks = []
add = lambda level, text, t=None: checks.append({"level": level, "text": text, "t": t})
plain = lambda t: re.sub(r"[^a-z0-9]", "", t.lower())
print("STAGE: QA: listening to the cut", flush=True)

# 1. every kept word still audible, especially next to cuts
sys.path.insert(0, str(Path(__file__).parent))
from stt import transcribe  # noqa: E402

edl = json.load(open(A / "cut-edl.json"))
expected = [w for w in json.load(open(A / "words-out.json"))["words"] if w["text"].strip()]
wav = A / "qa-audio.wav"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(A / "clean.mp4"), "-vn", "-ac", "1", "-ar", "16000", str(wav)], check=True)
heard = [w["word"].strip() for w in transcribe(wav, "Taglish na video para sa developers.") if w["word"].strip()]
exp_tokens = [plain(w["text"]) for w in expected]
exp_chars, owner = [], []
for k, t in enumerate(exp_tokens):
    exp_chars.extend(t); owner.extend([k] * len(t))
heard_chars = list("".join(plain(h) for h in heard))
sm = difflib.SequenceMatcher(None, exp_chars, heard_chars, autojunk=False)
hit = [0] * len(expected)
for blk in sm.get_matching_blocks():
    for c in range(blk.a, blk.a + blk.size):
        hit[owner[c]] += 1
matched = {k for k, t in enumerate(exp_tokens) if not t or hit[k] / len(t) >= 0.6}
joins = [m["out_start"] for m in edl["segments"][1:]]
suspects = []
for k, w in enumerate(expected):
    if k in matched or len(exp_tokens[k]) < 3:
        continue
    near = [j for j in joins if abs(j - w["start"]) < 0.45 or abs(j - w["end"]) < 0.45]
    if near:
        suspects.append((w, near[0]))
ratio = len(matched) / max(1, len(expected))
if suspects:
    for w, j in suspects[:12]:
        add("warn", f'"{w["text"]}" may be clipped at the cut at {j:.1f}s (not heard in the re-listen)', round(w["start"], 2))
else:
    add("ok", "No clipped words found next to cuts")
add("ok" if ratio > 0.85 else "warn", f"Re-listen matched {ratio:.0%} of the kept words")

# 2. cards
cards = json.load(open(A / "cards.json")) if (A / "cards.json").exists() else []
bad = [c for c in cards if c["end"] - c["start"] < 0.8]
over = [(a, b) for a, b in zip(cards, cards[1:]) if b["start"] < a["end"] - 0.01]
for c in bad:
    add("warn", f'{c["type"]} card is too short to read ({c["end"] - c["start"]:.1f}s)', c["start"])
for a, b in over:
    add("warn", f'{a["type"]} and {b["type"]} cards overlap', b["start"])
if cards and not bad and not over:
    add("ok", f"{len(cards)} cards, no overlaps")

# 3. loudness and length of the delivered file
probe = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(out_file), "-af", "ebur128=peak=true", "-vn", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
i_m = re.findall(r"I:\s+(-?[\d.]+) LUFS", probe)
p_m = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", probe)
if i_m:
    lufs, peak = float(i_m[-1]), float(p_m[-1]) if p_m else 0
    add("ok" if -15.5 <= lufs <= -12.5 and peak <= -1 else "warn", f"Loudness {lufs:.1f} LUFS, peak {peak:.1f} dBFS (target -14, below -1)")
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out_file)],
                           capture_output=True, text=True).stdout or 0)
add("ok", f"Length {dur:.1f}s")
wav.unlink(missing_ok=True)
json.dump({"file": out_file.name, "checks": checks}, open(A / "qa.json", "w"), indent=1)
warns = sum(c["level"] == "warn" for c in checks)
print(f"STAGE: QA: {'all checks passed' if not warns else f'{warns} thing(s) to look at'}", flush=True)
