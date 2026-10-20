# spaghetticode-editor

**A free video editor that turns your raw talking-head recording into a finished Reel / TikTok / Short — on your own computer.**

Drop in a video and you get back: dead air and retakes cut, captions on every word, zoom-ins, animated checklist cards, sound effects, an animated spaghettiCode opening with your title, and a like + follow ending. Made for Taglish (Tagalog + English) dev content, works for English too.

![Studio](https://img.shields.io/badge/cost-100%25%20free-8CF27A) ![Local](https://img.shields.io/badge/runs-on%20your%20computer-03E9F7) ![License](https://img.shields.io/badge/license-MIT-FA0487)

---

## Is it really free?

**Yes.** No subscriptions, no API keys, no credit card, no per-video cost.

Everything runs on your computer with free, open-source tools:

| What | Used for | Cost |
| --- | --- | --- |
| [Ollama](https://ollama.com) + Qwen3 model | The "AI editor" that decides cuts, cards and titles | Free |
| Whisper (local) | Turns your speech into text with exact timings | Free |
| FFmpeg | Cuts and mixes video and audio | Free |
| HyperFrames + Herk Edit Kit | Draws captions and animations, renders the MP4 | Free |
| Node.js, Python, Git | Run the app | Free |

Your videos never leave your computer. You need internet only to install things (and the first time you render, so fonts can download).

---

## What you need

Works on **Mac and Windows**. The AI part runs best with a decent GPU or Apple Silicon and **16 GB of memory or more**.

| Your computer | How it runs |
| --- | --- |
| Mac with Apple Silicon (M1–M5), 16 GB+ | ✅ Best. Fast transcription on the GPU, full AI model (`qwen3:14b`) |
| Windows PC with an NVIDIA GPU (8 GB+ VRAM), 16 GB+ RAM | ✅ Great. Transcription and AI both use the GPU |
| Any computer with 16 GB+ RAM, no GPU | ⚠️ Works, but slow: transcription runs on the CPU (a few minutes per video) and Auto edit can take 20–40 minutes. Pick the smaller model in the AI tab to speed it up. |
| 8 GB of memory | ⚠️ Works with the smaller AI model (`qwen3:4b-instruct`, picked automatically). Less smart. |

**Free disk space:** about **15 GB** (the AI model is ~9 GB).

Pick your system below: [Mac](#install-on-mac) · [Windows](#install-on-windows)

> Linux isn't supported yet.

---

## Install on Mac

One time, about 20–30 minutes (mostly downloading). You will copy and paste a few commands into **Terminal** (press `⌘ + Space`, type `Terminal`, press Enter).

### Step 1 — Install Homebrew (skip if you already have it)

Homebrew installs developer tools for you. Paste this into Terminal and press Enter, then follow what it says on screen:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Step 2 — Install the tools

```bash
brew install node git ffmpeg python ollama
```

### Step 3 — Download this project

```bash
cd ~/Documents
git clone https://github.com/ginxx009/spaghetticode-editor.git
cd spaghetticode-editor
```

### Step 4 — Run setup

```bash
node setup.mjs
```

Setup does everything else for you:

- downloads the editing engine and renders a short test video into `outbox/setup-test.mp4`
- installs local Whisper (speech-to-text)
- starts Ollama and downloads the AI model (the biggest download, ~9 GB)

When you see **`SETUP COMPLETE`**, you're done. If a line says **NOT READY**, it tells you what to install — install it and run `node setup.mjs` again (it's safe to re-run).

**To open the Studio later:** double-click **`Start Studio.command`** in the folder.

---

## Install on Windows

One time, about 20–30 minutes. Use **PowerShell** (press the Windows key, type `PowerShell`, press Enter).

### Step 1 — Install the tools

```powershell
winget install OpenJS.NodeJS.LTS Git.Git Gyan.FFmpeg Python.Python.3.12 Ollama.Ollama
```

Then **close PowerShell and open it again** so it finds the new tools.

### Step 2 — Download this project

```powershell
cd $HOME\Documents
git clone https://github.com/ginxx009/spaghetticode-editor.git
cd spaghetticode-editor
```

### Step 3 — Run setup

```powershell
node setup.mjs
```

Wait for **`SETUP COMPLETE`** (same as Mac above: it downloads the editing engine, local Whisper and the AI model).

**To open the Studio:** double-click **`Start Studio.bat`** in the folder. If Windows shows "Windows protected your PC", click **More info → Run anyway** (first time only).

---


## Edit your first video

### 1. Open the Studio

| System | How |
| --- | --- |
| Mac | Double-click **`Start Studio.command`** |
| Windows | Double-click **`Start Studio.bat`** |

Your browser opens **http://localhost:5757**.

> **Mac, first time only:** macOS may say it "cannot be opened because it is from an unidentified developer". Right-click the file → **Open** → **Open**. After that, double-click works.
>
> On any system you can also start it from a terminal inside the folder with `node app/server.mjs`, then open http://localhost:5757.

### 2. Drop in your raw video

Drag your video onto **+ New video** (leave **Auto edit after upload** checked).

The Studio now works on its own (about **10 minutes** on a recent Mac):

1. fixes color and lighting
2. transcribes what you said
3. **Auto edit:** fixes misheard tech words, cuts retakes / rambles / "um"s, builds the checklist cards, a hook callout, zoom-ins, and title ideas

You can watch progress at the bottom right.

### 3. Review (2–5 minutes)

- **Transcript (middle):** struck-through words will be cut. Hover a struck word to see why. Click any word to jump the video there. The player skips the cuts so you can hear how it flows.
- **AI suggest tab:** every decision the AI made, with **Undo**.
- **Title tab:** pick one of the AI title ideas or write your own. `[word]` turns pink, `{word}` turns cyan.
  Example: `Vibe-coded app mo, [production-ready] na ba?` with kicker `{Check natin.}`
- **Cards tab:** check the checklist items. Add or move cards: click a word in the transcript, then **use selected word**.

### 4. Render

**Render tab → Standard → ▶ Render** (about 2–3 minutes).
The finished MP4 is saved in the **`outbox/`** folder and shown in the app, with a **QA check** (clipped words, card timing, loudness).

---

## Keyboard shortcuts (transcript)

| Key | Does |
| --- | --- |
| Click / Shift-click | Select a word / a range |
| `X` or `Delete` | Cut the selection |
| `K` | Restore (un-cut) |
| `E` | Zoom-in (punch-in) on this word |
| `1` `2` `3` | Caption color: teal / red / green |
| `0` | Remove caption color |
| `F` or double-click | Fix a misheard word |
| `Space` | Play / pause |

## Card types

| Card | Looks like | Good for |
| --- | --- | --- |
| **Checklist** | Phone notifications that stack, with a `3/12` counter | Lists: fixes, steps, tools |
| **Status** | `localhost ✓ Works` / `production ✗ 500 Error` rows that flip | Before/after, problem → fix |
| **Chips** | `✓ Code` vs `✗ Testing ✗ Security` | "AI knows this, not this" |
| **Tip** | A card whose steps tick ✓ as you say them | Bonus tips, tools |
| **Callout** | Big bold text | Hook question, key line |

---

## Tips for better results

- **Record a clear hook** in your first sentence ("Gumawa ka ng app gamit AI… pero saan mo siya ilalagay?").
- **Say list items clearly**, like "So, hosting. … So, database. …" — the AI turns each into a card.
- **Add words it mishears** to `app/vocab.json` (tool names, brand names). Whisper and the auto-fixer both use it.
- Auto edit is **careful on purpose**: it would rather leave a ramble than cut something important. Skim the transcript and strike anything else with `X`.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Browser says "can't connect" | The Studio isn't running. Start it again (launcher or `node app/server.mjs`). |
| "Ollama not reachable" | Open a terminal and run `ollama serve`, keep it open, try again. On Windows you can also start the **Ollama** app from the Start menu. |
| Auto edit is very slow | Normal without a GPU or with 8–16 GB of memory (the AI thinks hard). Close other apps, or pick a smaller model in the **AI suggest** tab. |
| Port 5757 already in use | Mac: `PORT=5858 node app/server.mjs` · Windows PowerShell: `$env:PORT=5858; node app/server.mjs` — then open http://localhost:5858 |
| Test render failed during setup | `cd kit/video-projects/demo && npx hyperframes doctor` shows what's wrong (usually the browser). |
| `node` / `winget` "not recognized" (Windows) | Close and reopen PowerShell after installing, so it picks up the new tools. |
| Something else | Run `node setup.mjs` again — it re-checks everything and tells you what's missing. |

---

## Optional: edit with an AI coding agent instead

The Studio is the free, no-agent way. If you use an AI coding agent (Cursor, Claude Code, Codex…), you can also open this folder in it, type **`start`**, then drop a video in `inbox/` and say **"edit this"**. The agent follows `.agents/skills/spaghetticode-editor/SKILL.md`, can design brand-new graphics for a specific video, and turns your notes into rules in `my-rules.md`. This uses your agent's AI credits.

---

## What's in the folder

| Path | What it is |
| --- | --- |
| `Start Studio.command` / `Start Studio.bat` | Open the Studio on Mac / Windows |
| `app/` | The Studio app: `server.mjs`, the web page, and the editing pipeline in `app/lib/` |
| `app/vocab.json` | Words the transcriber should know (add yours) |
| `templates/opening/`, `templates/outro/` | The animated spaghettiCode opening and like/follow ending |
| `outbox/` | Your finished videos |
| `kit/` | The editing engine, downloaded by setup (don't edit) |
| `setup.mjs` | One-time setup, safe to re-run |

## Credits and licenses

- Editing engine: [Herk Edit Kit](https://github.com/nateherkai/herk-edit-kit) by Nate Herk — free for personal and commercial videos (downloaded by setup, not included here).
- Rendering: [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache 2.0), animation with GSAP.
- Speech-to-text: OpenAI Whisper via mlx-whisper / faster-whisper (MIT). AI model: Qwen3 via Ollama (Apache 2.0 / MIT).
- This project: MIT. See [LICENSE](LICENSE).
