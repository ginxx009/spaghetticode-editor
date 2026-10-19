# spaghetticode-editor

A free, open-source personal AI video editor that runs inside your AI coding agent (Claude Code, Cursor, Codex, Windsurf, etc.).

**Built for content creation.** Drop a raw video, say **"edit this"**, and get a cut, captioned, short-form edit optimized for TikTok, Reels, Shorts, and Facebook — with hooks, motion graphics, zoom-ins, and sound. Give notes in plain words (English, Tagalog, or Taglish). Lasting preferences become rules so it learns your style.

Ideal for spaghettiCode content: talking-head, tutorials, code demos, storytelling, and product explainers.

## Quick start

1. Clone this repo and open the folder in your agent.
2. Type `start`. The agent sets everything up (Node, FFmpeg, transcription, test render).
3. Drop a raw video in `inbox/` (or drag it into the chat) and say **"edit this"**.
4. Review the draft in `outbox/`, give notes, repeat until you say "final".

## What it does

| Feature | Details |
| --- | --- |
| Cuts | Removes dead air, breaths, false starts, and retakes |
| Captions | Word-by-word with bold keywords or pills — always on for social |
| Hook | Strong first 3 seconds (big text + zoom) by default for TikTok/Reels |
| Motion graphics | Animated cards, overlays, and pop-ups (HyperFrames + GSAP) |
| Camera | Zoom-ins and reframing that keep your face clear |
| Color | Natural, warm, cool, black & white, or orange & teal |
| Sound | Voice + light SFX or quiet music bed from `my-sounds/` |
| Learning | Notes become permanent rules in `my-rules.md` |

Vertical 9:16 is the default. Ask for a horizontal YouTube version and it gets proper framing.

## Requirements

- AI coding agent with terminal access
- Node.js 22+, Git, FFmpeg, Chrome
- Free transcription: Groq API key (recommended for Taglish) or local faster-whisper

All your footage, renders, style, and keys stay on your machine.

## Credits

The editing engine is [Herk Edit Kit](https://github.com/nateherkai/herk-edit-kit) by Nate Herk (MIT). It is downloaded by setup; it is not vendored here.

## License

MIT. See [LICENSE](LICENSE).
