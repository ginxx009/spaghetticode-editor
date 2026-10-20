"""Build the outro assets from source/spaghetticode_logo.jpg.

Writes assets/brace-left.png, assets/fork.png, assets/brace-right.png, assets/logo.png (black keyed to
transparency) and assets/outro-sfx.wav (cues timed to sc-outro.html). Re-run after replacing the logo.

    ../../.venv/bin/python make-assets.py
"""
import json, subprocess, wave
from pathlib import Path
import numpy as np

HERE = Path(__file__).parent
OUT = HERE / "assets"
SRC = HERE / "source" / "spaghetticode_logo.jpg"
CFG = json.load(open(HERE / "outro.config.json"))
OUT.mkdir(exist_ok=True)

# ---------- logo layers ----------
w, h = map(int, subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=width,height",
                                         "-of", "csv=p=0", str(SRC)]).decode().strip().split(","))
rgb = np.frombuffer(subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(SRC), "-f", "rawvideo",
                                             "-pix_fmt", "rgb24", "-"]), dtype=np.uint8).reshape(h, w, 3).astype(np.float32)
peak = rgb.max(axis=2)
alpha = np.clip((peak - 22) / 150, 0, 1)
alpha = alpha * alpha * (3 - 2 * alpha)
color = np.clip(rgb * (255 / np.maximum(peak, 1))[..., None], 0, 255)
rgba = np.concatenate([color, alpha[..., None] * 255], axis=2).astype(np.uint8)

mask = peak > 40
cols = mask.any(axis=0)
runs, s = [], None
for x in range(w + 1):
    on = x < w and cols[x]
    if on and s is None:
        s = x
    elif not on and s is not None:
        if x - s > 20:
            runs.append((s, x - 1))
        s = None
assert len(runs) == 3, f"expected 3 logo parts (brace, fork, brace), found {runs}"
ys = np.where(mask.any(axis=1))[0]
box = {"x": int(runs[0][0]), "y": int(ys.min()), "w": int(runs[2][1] - runs[0][0] + 1), "h": int(ys.max() - ys.min() + 1)}


def save_png(name, arr):
    hh, ww = arr.shape[:2]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{ww}x{hh}", "-i", "-",
                    str(OUT / name)], input=np.ascontiguousarray(arr).tobytes(), check=True)


parts = {}
for name, (x0, x1) in zip(["brace-left", "fork", "brace-right"], runs):
    py = np.where(mask[:, x0:x1 + 1].any(axis=1))[0]
    y0, y1 = int(py.min()), int(py.max())
    pad = 6
    xa, xb, ya, yb = max(0, x0 - pad), min(w, x1 + pad + 1), max(0, y0 - pad), min(h, y1 + pad + 1)
    save_png(f"{name}.png", rgba[ya:yb, xa:xb])
    parts[name] = {"x": xa - box["x"], "y": ya - box["y"], "w": xb - xa, "h": yb - ya}
save_png("logo.png", rgba[box["y"]:box["y"] + box["h"], box["x"]:box["x"] + box["w"]])
json.dump({"box": box, "parts": parts}, open(OUT / "layout.json", "w"), indent=1)

# ---------- sfx ----------
SR = 48000
rng = np.random.default_rng(11)
T = lambda d: np.arange(int(d * SR)) / SR


def lp(x, a):
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x):
        acc += a * (v - acc); y[i] = acc
    return y


def noise(d, lo, hi):
    n = rng.standard_normal(int(d * SR)); return lp(n, hi) - lp(n, lo)


def fade_in(x, d=0.002):
    n = int(d * SR); x[:n] *= np.linspace(0, 1, n); return x


def whoosh(d=0.45):
    x = T(d); return noise(d, 0.01, 0.12) * np.sin(np.pi * x / d) ** 2 * 1.6


def pop(f=700):
    x = T(0.14); return fade_in(np.sin(2 * np.pi * f * x * (1 + 1.6 * x)) * np.exp(-x * 32))


def buzz():
    d = 0.32; x = T(d)
    saw = 2 * ((x * 120) % 1) - 1
    gate = np.ones_like(x)
    for a, b in [(0.05, 0.09), (0.13, 0.15), (0.2, 0.24)]:
        gate[int(a * SR):int(b * SR)] = 0.15
    return lp(saw, 0.08) * gate * np.exp(-x * 4) * 0.9


def sparkle():
    out = np.zeros(int(0.8 * SR))
    for k, f in enumerate([2093, 2637, 3136, 4186]):
        x = T(0.35); s = np.sin(2 * np.pi * f * x) * np.exp(-x * 14)
        o = int(k * 0.06 * SR); out[o:o + len(s)] += fade_in(s) * 0.5
    return out


def tap():
    x = T(0.05); return fade_in(np.sin(2 * np.pi * 1900 * x) * np.exp(-x * 140) + 0.4 * noise(0.05, 0.1, 0.6) * np.exp(-x * 200), 0.0005)


def heart():
    x = T(0.5)
    s = sum(a * np.sin(2 * np.pi * f * x) * np.exp(-x * 8) for a, f in [(0.6, 1568), (0.35, 2349), (0.15, 3136)])
    p = pop(900)
    return fade_in(s, 0.003) + np.pad(p, (0, len(x) - len(p)))


def chime():
    out = np.zeros(int(0.9 * SR))
    for k, f in enumerate([1047, 1319, 1568]):
        x = T(0.6); s = (np.sin(2 * np.pi * f * x) + 0.2 * np.sin(4 * np.pi * f * x)) * np.exp(-x * 7)
        o = int(k * 0.08 * SR); out[o:o + len(s)] += fade_in(s, 0.003) * 0.6
    return out


C = CFG["timing"]
cues = [
    (C["braces"], whoosh(), 0.45), (C["fork"] - 0.1, whoosh(0.3), 0.25), (C["forkLand"], pop(620), 0.5),
    (C["flicker"], buzz(), 0.22), (C["wordmark"], sparkle(), 0.28), (C["shrink"], whoosh(0.4), 0.22),
    (C["buttons"], pop(760), 0.3), (C["likeTap"], tap(), 0.45), (C["likeTap"] + 0.04, heart(), 0.45),
    (C["followTap"], tap(), 0.45), (C["followTap"] + 0.05, chime(), 0.4),
]
mix = np.zeros(int((CFG["duration"] + 1) * SR), dtype=np.float32)
for t0, s, g in cues:
    s = s / max(1e-6, np.abs(s).max()); o = int(t0 * SR)
    mix[o:o + len(s)] += (s * g)[: len(mix) - o]
mix = mix[: int(CFG["duration"] * SR)]
mix *= 10 ** (-6 / 20) / max(1e-6, np.abs(mix).max())
with wave.open(str(OUT / "outro-sfx.wav"), "wb") as f:
    f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR)
    f.writeframes((np.repeat(mix[:, None], 2, axis=1) * 32767).astype(np.int16).tobytes())
print("logo box", box, "parts", parts)
print("wrote", sorted(p.name for p in OUT.iterdir()))
