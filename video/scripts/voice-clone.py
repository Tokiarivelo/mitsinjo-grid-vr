"""Give the Kokoro voice-over the timbre of a reference recording, with kNN-VC (voice conversion).

Usage: voice-clone.py <reference audio> [--src audio/voice/vr] [--out audio/voice/vr-me] [--topk 4]
Needs `make video-vc-setup` (video/.venv-vc with torch/torchaudio, video/vc/knn-vc + its GitHub weights).
Each cue-NN.wav of --src (48 kHz) is converted at 16 kHz with the reference as matching set and written
back at 48 kHz in --out with the same name; cues.json is copied so build-vr.py can use --voice-dir.
Only use a recording of your own voice (or with its owner's consent).
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

VIDEO = Path(__file__).resolve().parent.parent
VC = VIDEO / "vc"


def to_wav16k(src: Path, dst: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-i", str(src), "-ac", "1", "-ar", "16000",
         "-af", "silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_threshold=-45dB:stop_duration=0.4,loudnorm",
         str(dst)],
        check=True,
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("reference")
    ap.add_argument("--src", default=str(VIDEO / "audio" / "voice" / "vr"))
    ap.add_argument("--out", default=str(VIDEO / "audio" / "voice" / "vr-me"))
    ap.add_argument("--topk", type=int, default=4)
    args = ap.parse_args()

    # Weights fetched by `make video-vc-setup`: put them where torch.hub looks.
    hub = Path(os.environ.get("TORCH_HOME", VC / "torch")) / "hub" / "checkpoints"
    hub.mkdir(parents=True, exist_ok=True)
    for f in ("prematch_g_02500000.pt", "WavLM-Large.pt"):
        if not (hub / f).exists():
            shutil.copy(VC / f, hub / f)
    os.environ["TORCH_HOME"] = str(hub.parent.parent)

    import torch
    import torchaudio

    sys.path.insert(0, str(VC / "knn-vc"))
    model = torch.hub.load(str(VC / "knn-vc"), "knn_vc", source="local", prematched=True, device="cpu", trust_repo=True)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        ref = Path(tmp) / "ref.wav"
        to_wav16k(Path(args.reference), ref)
        matching = model.get_matching_set([str(ref)])
        for cue in sorted(Path(args.src).glob("cue-*.wav")):
            src16 = Path(tmp) / cue.name
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(cue), "-ac", "1", "-ar", "16000", str(src16)], check=True)
            query = model.get_features(str(src16))
            wav = model.match(query, matching, topk=args.topk)
            tmp_out = Path(tmp) / f"o-{cue.name}"
            torchaudio.save(str(tmp_out), wav[None], 16000)
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(tmp_out), "-ar", "48000", "-ac", "1", str(out / cue.name)], check=True)
            print(cue.name)
    cues = json.loads((Path(args.src) / "cues.json").read_text())
    for c in cues:  # durations of the converted clips
        p = out / f"cue-{c['n']:02d}.wav"
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)], capture_output=True, text=True)
        c["dur"] = round(float(r.stdout.strip() or c["dur"]), 3)
    (out / "cues.json").write_text(json.dumps(cues, indent=1))


if __name__ == "__main__":
    main()
