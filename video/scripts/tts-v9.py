#!/usr/bin/env python3
"""Narration of the v9 cut: Kokoro voice `am_puck` (the earlier cuts' voice), livelier delivery.

Each line is split into phrases (on « … », « . », « ! », « ? ») rendered one by one with their own pace
(a question or an exclamation a touch quicker), then joined with short breaths, so the voice rises and
pauses like someone showing something, instead of one flat read. Output: cue-NN.wav + cues.json
({n, text, dur}) in --out. Run with video/.venv-tts/bin/python.
"""

import argparse
import json
import re
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

VIDEO = Path(__file__).resolve().parent.parent
SR = 48000

# n: (text, base speed)
LINES = {
    1: ("What if everything around you could become 3D?", 1.0),
    2: ("Put on the headset… and look!", 1.02),
    3: ("A car. I point at it, and the AI outlines it…", 1.05),
    4: ("…draws it from every side…", 1.05),
    5: ("…and here it is, in 3D!", 1.06),
    6: ("This is Mitsinjo Grid VR.", 1.0),
    7: ("Let's start in the kitchen. I scan the room…", 1.06),
    8: ("Let's take the fridge, for example.", 1.06),
    9: ("First, the AI draws it in 2D, from every side.", 1.06),
    10: ("One view is off? I just ask for a change.", 1.08),
    11: ("Now I validate… and the 3D model is built, piece by piece.", 1.06),
    12: ("Next, the sofa in the hall. Same thing: the 2D views…", 1.08),
    13: ("…then the 3D. Look at that tufted velvet!", 1.06),
    14: ("Out on the terrace… why not the whole house?", 1.06),
    15: ("Its facade in 2D… and the house in 3D.", 1.06),
    16: ("And down the street, this white car.", 1.06),
    17: ("From its profile… to a full 3D model.", 1.06),
    18: ("Under the hood: SAM 3.1 outlines it, Muse Image draws it, and Muse Spark, "
         "with skill cards and specialist agents, builds it.", 1.08),
    19: ("But it's not just 3D generation. I can drop it into a village… and walk around it, freely.", 1.06),
    20: ("There's my car, parked in the village!", 1.06),
    21: ("Here's the village. And here's a map, to find my way.", 1.06),
    22: ("Now, let's fast-forward a little, to seven p.m. Meanwhile, we stroll through the village… in fast motion!", 1.1),
    23: ("Here we are, at the dispatch controller.", 1.04),
    24: ("Let's control the power of the village homes. I cut it… and look, the lights fade.", 1.06),
    25: ("And back on!", 1.04),
    26: ("Now the health center. I try to cut it… refused! The clinic always keeps its power.", 1.06),
    27: ("Mitsinjo Grid VR. Point at the world. Build it. Power it.", 0.98),
}


def phrases(text: str) -> list[tuple[str, float]]:
    """Phrases and the pause after each (s): longer after a sentence, short after « … »."""
    parts = re.split(r"(?<=[.!?…:])\s+", text.strip())
    out = []
    for p in parts:
        if not p:
            continue
        pause = 0.32 if p.endswith((".", "!", "?")) else 0.22 if p.endswith(("…", ":")) else 0.12
        out.append((p, pause))
    if out:
        out[-1] = (out[-1][0], 0.0)
    return out


def trim(a: np.ndarray) -> np.ndarray:
    idx = np.where(np.abs(a) > 0.01)[0]
    return a[max(0, idx[0] - 480): idx[-1] + 1440] if len(idx) else a


def resample(a: np.ndarray, src: int, dst: int) -> np.ndarray:
    n = int(len(a) * dst / src)
    return np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a).astype(np.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="am_puck")
    ap.add_argument("--out", default=str(VIDEO / "audio" / "voice" / "vr-v9"))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tts = Kokoro(str(VIDEO / "tts" / "kokoro-v1.0.onnx"), str(VIDEO / "tts" / "voices-v1.0.bin"))
    cues = []
    for n, (text, speed) in LINES.items():
        chunks = []
        for p, pause in phrases(text):
            s = speed + (0.04 if p.endswith(("!", "?")) else 0.0)
            audio, sr = tts.create(p, voice=args.voice, speed=s, lang="en-us")
            chunks.append(trim(resample(np.asarray(audio, dtype=np.float32), sr, SR)))
            if pause:
                chunks.append(np.zeros(int(pause * SR), dtype=np.float32))
        a = np.concatenate(chunks)
        sf.write(out / f"cue-{n:02d}.wav", a, SR, subtype="PCM_16")
        cues.append({"n": n, "text": text, "dur": round(len(a) / SR, 3)})
        print(f"{n:02d}\t{len(a) / SR:.2f}s\t{text}", flush=True)
    (out / "cues.json").write_text(json.dumps(cues, indent=1))


if __name__ == "__main__":
    main()
