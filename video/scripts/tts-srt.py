"""Render one voice clip per subtitle cue of the VR showcase (VR_VIDEO_SCRIPT.md § 3) with Kokoro, locally.

Usage: tts-srt.py [--voice am_puck] [--speed 1.0] [--out audio/voice/vr]
Reads the ```srt block of VR_VIDEO_SCRIPT.md (single source for captions and voice), writes
<out>/cue-NN.wav (48 kHz mono, no padding) and <out>/cues.json [{n, start, end, text, dur}].
Run from `make video-voice-vr`.
"""

import argparse
import json
import re
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

VIDEO = Path(__file__).resolve().parent.parent


def to_s(ts: str) -> float:
    h, m, rest = ts.split(":")
    s, ms = rest.split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def read_cues() -> list[dict]:
    doc = (VIDEO / "VR_VIDEO_SCRIPT.md").read_text()
    block = doc.split("```srt")[1].split("```")[0]
    cues = []
    for chunk in re.split(r"\n\s*\n", block.strip()):
        lines = chunk.strip().splitlines()
        a, b = lines[1].split(" --> ")
        cues.append({"n": int(lines[0]), "start": to_s(a), "end": to_s(b), "text": " ".join(lines[2:])})
    return cues


def resample(audio: np.ndarray, src: int, dst: int) -> np.ndarray:
    n = int(len(audio) * dst / src)
    return np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="am_puck")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--out", default=str(VIDEO / "audio" / "voice" / "vr"))
    args = ap.parse_args()
    tts = Kokoro(str(VIDEO / "tts" / "kokoro-v1.0.onnx"), str(VIDEO / "tts" / "voices-v1.0.bin"))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cues = read_cues()
    for c in cues:
        text = c["text"].replace("…", ", ").replace("Mitsinjo", "Mitsinn-dzou")
        audio, sr = tts.create(text, voice=args.voice, speed=args.speed, lang="en-us")
        audio = resample(audio, sr, 48000)
        # Trim leading / trailing silence.
        idx = np.where(np.abs(audio) > 0.01)[0]
        if len(idx):
            audio = audio[max(0, idx[0] - 960) : idx[-1] + 2400]
        sf.write(out / f"cue-{c['n']:02d}.wav", audio, 48000, subtype="PCM_16")
        c["dur"] = round(len(audio) / 48000, 3)
        print(f"{c['n']:02d}\t{c['dur']:.2f}s / slot {c['end'] - c['start']:.2f}s\t{c['text']}")
    (out / "cues.json").write_text(json.dumps(cues, indent=1))


if __name__ == "__main__":
    main()
