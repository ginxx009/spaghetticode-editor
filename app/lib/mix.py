"""Voice clean-up + synthesized SFX from assets/sfx-events.json -> assets/mix.wav (-14 LUFS, <= -1.5 dBTP).

    .venv/bin/python app/lib/mix.py <project-dir>
"""
import json, subprocess, sys, wave
from pathlib import Path
import numpy as np

A = Path(sys.argv[1]) / "assets"
SR = 48000
rng = np.random.default_rng(7)


def t(d):
    return np.arange(int(d * SR)) / SR


def env(x, attack=0.002):
    n = int(attack * SR)
    if n:
        x[:n] *= np.linspace(0, 1, n)
    return x


def lp(x, a):
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x):
        acc += a * (v - acc); y[i] = acc
    return y


def bp_noise(d, lo, hi):
    n = rng.standard_normal(int(d * SR))
    return lp(n, hi) - lp(n, lo)


def pop(v):
    f = [620, 760, 900][v]; x = t(0.12)
    return env(np.sin(2 * np.pi * f * x * (1 + 1.8 * x)) * np.exp(-x * 38))


def ding(v):
    f = [1175, 1319, 1480][v]; x = t(0.45)
    s = 0.7 * np.sin(2 * np.pi * f * x) + 0.25 * np.sin(2 * np.pi * f * 1.5 * x) + 0.1 * np.sin(2 * np.pi * f * 2 * x)
    return env(s * np.exp(-x * 9), 0.003)


def key(_=0):
    x = t(0.03)
    return bp_noise(0.03, 0.05, 0.6) * np.exp(-x * 220) * 1.4


def click(v):
    f = [2400, 2000, 2800][v]; x = t(0.04)
    return env(np.sin(2 * np.pi * f * x) * np.exp(-x * 160), 0.0005)


def whoosh(_=0):
    d = 0.42; x = t(d)
    n = bp_noise(d, 0.01, 0.12)
    return n * np.sin(np.pi * x / d) ** 2 * 1.6


def thump(_=0):
    x = t(0.3)
    s = np.sin(2 * np.pi * (85 - 40 * x) * x) * np.exp(-x * 14)
    return env(s + 0.15 * bp_noise(0.3, 0.02, 0.2) * np.exp(-x * 40), 0.001)


def deny(_=0):
    x = t(0.16)
    a = np.sin(2 * np.pi * 330 * x) * np.exp(-x * 30)
    b = np.sin(2 * np.pi * 247 * x) * np.exp(-x * 25)
    return env(np.concatenate([a, b]) * 0.8)


def flip(_=0):
    x = t(0.14)
    return bp_noise(0.14, 0.08, 0.5) * np.exp(-x * 30) * 1.3


def tick(_=0):
    x = t(0.18)
    return env(np.sin(2 * np.pi * 1760 * x) * np.exp(-x * 22) + 0.4 * np.sin(2 * np.pi * 2640 * x) * np.exp(-x * 30))


def chime(_=0):
    out = np.zeros(int(0.9 * SR))
    for k, f in enumerate([1047, 1319, 1568]):
        x = t(0.6); s = (np.sin(2 * np.pi * f * x) + 0.2 * np.sin(4 * np.pi * f * x)) * np.exp(-x * 7)
        o = int(k * 0.09 * SR); out[o:o + len(s)] += env(s, 0.003) * 0.6
    return out


def send(_=0):
    d = 0.3; x = t(d)
    w = bp_noise(d, 0.03, 0.25) * np.sin(np.pi * x / d) ** 2
    c = click(0); o = int(0.22 * SR)
    w[o:o + len(c)] += c * 0.8
    return w


KINDS = dict(pop=pop, ding=ding, key=key, click=click, whoosh=whoosh, thump=thump, deny=deny, flip=flip, tick=tick, chime=chime, send=send)


def read_wav(p):
    with wave.open(str(p)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768, w.getnchannels()


def write_wav(p, x):
    x = np.clip(x, -1, 1)
    with wave.open(str(p), "wb") as w:
        w.setnchannels(2 if x.ndim == 2 else 1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


# 1) voice clean-up
voice_path = A / "voice.wav"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(A / "clean.mp4"), "-vn", "-ac", "1", "-ar", str(SR), "-af",
                "highpass=f=80,afftdn=nr=10:nf=-42:tn=1,equalizer=f=220:t=q:w=1:g=-1.5,equalizer=f=3200:t=q:w=1.2:g=2,"
                "acompressor=threshold=-22dB:ratio=3:attack=6:release=90:makeup=2,"
                "loudnorm=I=-16:TP=-2:LRA=9", str(voice_path)], check=True)
voice, _ = read_wav(voice_path)

# 2) SFX bed
events = json.load(open(A / "sfx-events.json"))
sfx = np.zeros(len(voice) + SR, dtype=np.float32)
for e in events:
    s = KINDS[e["kind"]](e.get("v", 0)).astype(np.float32)
    s /= max(1e-6, np.abs(s).max())
    o = int(e["t"] * SR)
    if o < 0 or o >= len(sfx):
        continue
    seg = s[: len(sfx) - o] * e["gain"] * 0.5
    sfx[o:o + len(seg)] += seg
sfx = sfx[: len(voice)]
write_wav(A / "sfx.wav", sfx)

# 3) mix, master
pre = A / "mix.pre.wav"
write_wav(pre, np.stack([voice + sfx, voice + sfx], axis=1))
probe = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(pre), "-af", "loudnorm=I=-14:TP=-1.5:LRA=9:print_format=json",
                        "-f", "null", "-"], capture_output=True, text=True).stderr
m = json.loads(probe[probe.rindex("{"):probe.rindex("}") + 1])
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(pre), "-af",
                f"loudnorm=I=-14:TP=-1.5:LRA=9:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
                f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true",
                "-ar", str(SR), str(A / "mix.wav")], check=True)
pre.unlink()
print(f"STAGE: Mixed {len(events)} sfx, voice {len(voice) / SR:.2f}s, pre-master {m['input_i']} LUFS -> mix.wav")
