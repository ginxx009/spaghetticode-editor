"""Local speech-to-text with word timestamps.

Apple Silicon uses mlx-whisper (fast, on the GPU). Everything else uses faster-whisper on the CPU.
Both return [{"word": str, "start": float, "end": float}, ...] in segment order.
"""


def transcribe(path, prompt=""):
    try:
        import mlx_whisper
    except ImportError:
        mlx_whisper = None
    if mlx_whisper:
        r = mlx_whisper.transcribe(str(path), path_or_hf_repo="mlx-community/whisper-large-v3-turbo", word_timestamps=True,
                                   initial_prompt=prompt or None, condition_on_previous_text=False)
        return [{"word": w["word"], "start": w["start"], "end": w["end"]} for s in r["segments"] for w in s.get("words", [])]
    import subprocess
    import numpy as np
    from faster_whisper import WhisperModel
    # Decode with FFmpeg ourselves: faster-whisper's own decoder breaks with newer PyAV releases.
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    path = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768
    try:
        model = WhisperModel("large-v3-turbo", device="cuda", compute_type="int8_float16")
        segments, _ = model.transcribe(path, word_timestamps=True, initial_prompt=prompt or None,
                                       condition_on_previous_text=False, vad_filter=True)
        return [{"word": w.word, "start": w.start, "end": w.end} for s in segments for w in (s.words or [])]
    except Exception:  # no NVIDIA GPU or CUDA libraries: use the CPU
        pass
    model = WhisperModel("large-v3-turbo", device="cpu", compute_type="int8")
    segments, _ = model.transcribe(path, word_timestamps=True, initial_prompt=prompt or None,
                                   condition_on_previous_text=False, vad_filter=True)
    return [{"word": w.word, "start": w.start, "end": w.end} for s in segments for w in (s.words or [])]
