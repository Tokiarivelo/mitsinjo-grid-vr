"""Assemble the 4-object VR showcase (v8): 3D intro, fridge / sofa / house / car to 3D, mosaic, short simulation.

Usage: build-v8.py [--size 2560x1440] [--name mitsinjo-grid-vr-v8]
Inputs (local): frames/intro3d-{headset,car,laptop} and frames/vr-intro (render-canvas / intro-photos),
captures/raw/vr-v8day + vr-v8night (capture-vr, PART=all / night), audio/voice/vr-v8 (young voice, cues.json),
audio/music/{passion,aurora,feel-alive,machine}.mp3, frames/vr-outro.
Every shot joins the next with a short cross-fade; no boxed titles; captions are plain outlined text; a
time-lapse shows a small « ×N » in the corner. Music changes by place: intro / outro, inside, outside, simulation.
"""

import argparse
import json
import subprocess
from pathlib import Path

VIDEO = Path(__file__).resolve().parent.parent
WORK = VIDEO / "output" / "v8-work"
FONT = VIDEO / "canvas" / "fonts" / "Inter-Medium.ttf"
FPS = 30
XF = 0.45  # cross-fade between consecutive shots
DAY, SIMDAY, NIGHT = "vr-v9day", "vr-v8simday", "vr-v8simnight"

# (kind, a, b, seconds, id, section)  kind: frames dir range "F", capture take name, or "FF" / "MOSAIC"
SHOTS = [
    ("F", "intro3d-headset", (0, 11.0), 11.0, "i1", "intro"),
    ("F", "vr-intro", (11.0, 29.6), 18.6, "i2", "intro"),
    ("F", "intro3d-car", (0, 9.0), 9.0, "i3", "intro"),
    ("F", "intro3d-laptop", (0, 10.0), 10.0, "i4", "intro"),
    # Fridge (kitchen): the whole pipeline.
    (DAY, "village-page", "village-vr-entered", 4.0, "f0", "inside"),
    (DAY, "village-vr-entered", "village-scan", 3.5, "f1", "inside"),
    (DAY, "village-scan", "village-detected", 3.5, "f2", "inside"),
    (DAY, "village-detected", "fridge-shoot", 3.0, "f3", "inside"),
    (DAY, "fridge-shoot", "fridge-studio", 4.5, "f4", "inside"),
    (DAY, "fridge-studio", "fridge-chat", 4.5, "f5", "inside"),
    (DAY, "fridge-chat", "fridge-build", 4.0, "f6", "inside"),
    (DAY, "fridge-build", "fridge-lab", 3.5, "f7", "inside"),
    (DAY, "fridge-lab", "fridge-3d", 5.5, "f8", "inside"),
    # Sofa (hall): the lab tools.
    (DAY, "walk-hall", "sofa-scan", 5.0, "s0", "inside"),
    (DAY, "sofa-scan", "sofa-detected", 3.0, "s1", "inside"),
    (DAY, "sofa-detected", "sofa-studio", 3.5, "s2", "inside"),
    (DAY, "sofa-studio", "sofa-build", 3.5, "s3", "inside"),
    (DAY, "sofa-build", "sofa-3d", 5.0, "s4", "inside"),
    (DAY, "sofa-tools", "sofa-lib", 6.0, "s5", "inside"),
    (DAY, "sofa-lib", "sofa-lib-done", 6.0, "s6", "inside"),
    # House (terrace) and car (street).
    (DAY, "walk-terrace", "house-scan", 4.5, "h0", "outside"),
    (DAY, "house-scan", "house-detected", 3.0, "h1", "outside"),
    (DAY, "house-detected", "house-studio", 3.0, "h2", "outside"),
    (DAY, "house-studio", "house-build", 3.5, "h3", "outside"),
    (DAY, "house-build", "house-3d", 5.0, "h4", "outside"),
    (DAY, "walk-street", "car-scan", 5.0, "c0", "outside"),
    (DAY, "car-scan", "car-detected", 3.0, "c1", "outside"),
    (DAY, "car-detected", "car-studio", 3.0, "c2", "outside"),
    (DAY, "car-studio", "car-build", 3.5, "c3", "outside"),
    (DAY, "car-build", "car-3d", 5.0, "c4", "outside"),
    (DAY, "car-lib", "car-lib-done", 6.0, "c5", "outside"),
    ("MOSAIC", None, None, 6.0, "m0", "outside"),
    # Simulation.
    (DAY, "village-table", "village-inserted", 6.0, "v0", "sim"),
    (DAY, "village-inserted", "sim-arrive", 6.0, "v1", "sim"),
    (DAY, "sim-arrive", "sim-walk", 4.0, "v2", "sim"),
    (SIMDAY, "sim-walk", "sim-labels", 8.0, "v3", "sim"),
    (SIMDAY, "sim-map", "sim-night", 6.0, "v4", "sim"),
    ("FF", f"{SIMDAY}:sim-night", f"{NIGHT}:sim-night-done", 3.0, "v5", "sim"),
    (NIGHT, "sim-night-done", "sim-panel", 3.0, "n0", "sim"),
    (NIGHT, "sim-panel", "sim-restore", 8.0, "n1", "sim"),
    (NIGHT, "sim-restore", "sim-enter", 3.5, "n2", "sim"),
    (NIGHT, "sim-clinic", "sim-end", 4.5, "n3", "sim"),
    (DAY, "back-to-lab", "lab-again", 3.5, "n4", "sim"),
    ("F", "vr-outro", (0, 13.0), 13.0, "o0", "outro"),
]
# Voice line n → (shot id, seconds into it).
CUES = {
    1: ("i1", 0.6), 2: ("i1", 6.2), 3: ("i2", 5.0), 4: ("i2", 13.0), 5: ("i3", 4.2), 6: ("i4", 1.0),
    7: ("f1", 0.5), 8: ("f3", 0.4), 9: ("f5", 0.4), 10: ("f6", 0.6), 11: ("f7", 0.4),
    12: ("s0", 0.8), 13: ("s5", 0.5), 14: ("s6", 0.6), 15: ("h0", 1.0), 16: ("h3", 0.3), 17: ("c0", 1.0),
    18: ("c5", 0.5), 19: ("m0", 0.8), 20: ("v0", 0.4), 21: ("v3", 1.0), 22: ("v5", 0.2), 23: ("n1", 0.5),
    24: ("n2", 0.2), 25: ("n3", 0.4), 26: ("o0", 1.0),
}
MUSIC = {"intro": "adventure-theme.mp3", "inside": "aurora.mp3", "outside": "feel-alive.mp3", "sim": "machine.mp3", "outro": "adventure-theme.mp3"}


def ff(*args: str) -> None:
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *args], check=True)


def enc(size: str) -> list[str]:
    return ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(FPS), "-s", size]


def timeline(take: str) -> dict:
    return json.loads((VIDEO / "captures" / "raw" / take / "timeline.json").read_text())


def frame_at(spec: str) -> Path:
    take, marker = spec.split(":")
    tl = timeline(take)
    t = next(m["t"] for m in tl["markers"] if m["name"] == marker)
    f = min(tl["frames"], key=lambda x: abs(x["t"] - t))
    return VIDEO / "captures" / "raw" / take / "frames" / f["f"]


def capture_clip(out: Path, take: str, a: str, b: str, dur: float, size: str) -> None:
    tl = timeline(take)
    marks = {m["name"]: m["t"] for m in tl["markers"]}
    t0, t1 = marks[a], marks[b]
    frames = [f for f in tl["frames"] if t0 <= f["t"] <= t1] or [min(tl["frames"], key=lambda x: abs(x["t"] - t0))]
    speed = max(t1 - t0, 0.01) / dur
    lst = out.with_suffix(".txt")
    lines = ["ffconcat version 1.0"]
    for j, f in enumerate(frames):
        nxt = frames[j + 1]["t"] if j + 1 < len(frames) else t1
        lines += [f"file '{VIDEO / 'captures' / 'raw' / take / 'frames' / f['f']}'", f"duration {max(1 / FPS, (nxt - f['t']) / speed):.4f}"]
    lines.append(f"file '{VIDEO / 'captures' / 'raw' / take / 'frames' / frames[-1]['f']}'")
    lst.write_text("\n".join(lines) + "\n")
    w, h = size.split("x")
    s = int(h) / 1080
    vf = [f"scale={w}:{h}:flags=lanczos", f"framerate=fps={FPS}:interp_start=0:interp_end=255:scene=100"]
    if speed > 2.5:  # discreet time-lapse mark, no box
        vf.append(f"drawtext=fontfile={FONT}:text='×{round(speed)}':x=w-tw-{int(40 * s)}:y={int(34 * s)}:fontsize={int(26 * s)}:fontcolor=white@0.75:shadowcolor=black@0.6:shadowx=2:shadowy=2")
    ff("-f", "concat", "-safe", "0", "-i", str(lst), "-vf", ",".join(vf), "-t", f"{dur:.3f}", *enc(size), "-an", str(out))


def frames_clip(out: Path, name: str, rng: tuple[float, float], dur: float, size: str) -> None:
    w, h = size.split("x")
    ff("-framerate", str(FPS), "-start_number", str(int(rng[0] * FPS)), "-i", str(VIDEO / "frames" / name / "%05d.png"),
       "-t", f"{dur}", "-vf", f"scale={w}:{h}:flags=lanczos", *enc(size), "-an", str(out))


def ff_clip(out: Path, a: str, b: str, dur: float, size: str) -> None:
    w, h = size.split("x")
    s = int(h) / 1080
    clock = (
        f"drawtext=fontfile={FONT}:text='%{{eif\\\\:12+min(7\\\\,floor(t*7/{dur * 0.85:.2f}))\\\\:d}}\\\\:00':"
        f"x=(w-tw)/2:y=h*0.42:fontsize={int(150 * s)}:fontcolor=white:shadowcolor=black@0.6:shadowx=4:shadowy=4"
    )
    ff("-loop", "1", "-t", f"{dur}", "-i", str(frame_at(a)), "-loop", "1", "-t", f"{dur}", "-i", str(frame_at(b)),
       "-filter_complex", f"[0]scale={w}:{h},fps={FPS}[a];[1]scale={w}:{h},fps={FPS}[b];"
       f"[a][b]xfade=transition=fade:duration={dur * 0.7:.2f}:offset={dur * 0.15:.2f},{clock}",
       "-t", f"{dur}", *enc(size), "-an", str(out))


def mosaic_clip(out: Path, dur: float, size: str) -> None:
    """The four built models side by side, each its lab moment (the model spinning on the plate)."""
    w, h = (int(x) for x in size.split("x"))
    tiles = []
    for k, tag in enumerate(["fridge", "sofa", "house", "car"]):
        t = WORK / f"tile-{tag}.mp4"
        capture_clip(t, DAY, f"{tag}-lab", f"{tag}-3d", dur, f"{w // 2}x{h // 2}")
        tiles.append(t)
    inputs = sum([["-i", str(t)] for t in tiles], [])
    ff(*inputs, "-filter_complex", "[0][1]hstack[t];[2][3]hstack[b];[t][b]vstack,format=yuv420p", "-t", f"{dur}", *enc(size), "-an", str(out))


def xfade_join(parts: list[tuple[Path, float]], out: Path) -> list[float]:
    """Joins shots with a cross-fade; returns each shot's start time on the joined timeline."""
    inputs = sum([["-i", str(p)] for p, _ in parts], [])
    starts = [0.0]
    graph = []
    prev = "[0:v]"
    t = parts[0][1]
    for i in range(1, len(parts)):
        off = t - XF
        starts.append(off)
        lab = f"[x{i}]"
        graph.append(f"{prev}[{i}:v]xfade=transition=fade:duration={XF}:offset={off:.3f}{lab}")
        prev = lab
        t = off + parts[i][1]
    ff(*inputs, "-filter_complex", ";".join(graph), "-map", prev, "-c:v", "libx264", "-preset", "medium", "-crf", "16",
       "-pix_fmt", "yuv420p", "-r", str(FPS), str(out))
    return starts + [t]


def ts(s: float) -> str:
    ms = int(round(s * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", default="2560x1440")
    ap.add_argument("--name", default="mitsinjo-grid-vr-v8")
    ap.add_argument("--voice-dir", default=str(VIDEO / "audio" / "voice" / "vr-v8"))
    args = ap.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    size = args.size

    parts = []
    for i, (kind, a, b, dur, sid, _sec) in enumerate(SHOTS):
        out = WORK / f"{i:02d}-{sid}.mp4"
        if not out.exists():
            if kind == "F":
                frames_clip(out, a, b, dur, size)
            elif kind == "FF":
                ff_clip(out, a, b, dur, size)
            elif kind == "MOSAIC":
                mosaic_clip(out, dur, size)
            else:
                capture_clip(out, kind, a, b, dur, size)
            print("shot", sid, kind, a, "→", b, dur)
        parts.append((out, dur))
    video = WORK / "joined.mp4"
    starts = xfade_join(parts, video)
    total = starts[-1]
    at = {SHOTS[i][4]: starts[i] for i in range(len(SHOTS))}
    print(f"total {total:.1f}s")

    # Voice + captions.
    vdir = Path(args.voice_dir)
    cues = json.loads((vdir / "cues.json").read_text())
    t = 0.0
    srt = []
    for c in cues:
        ref, off = CUES[c["n"]]
        start = max(at[ref] + off, t + 0.15)
        c["at"] = start
        t = start + c["dur"]
        srt.append(f"{c['n']}\n{ts(start)} --> {ts(t + 0.5)}\n{c['text']}\n")
    srt_path = VIDEO / "subtitles" / "vr-v8-en.srt"
    srt_path.write_text("\n".join(srt))

    # Music by place: each section's track from its start, cross-faded 1.5 s at the borders.
    sections = []
    for i, shot in enumerate(SHOTS):
        sec = shot[5]
        if not sections or sections[-1][0] != sec:
            sections.append([sec, starts[i], starts[i + 1] if i + 1 < len(SHOTS) else total])
        else:
            sections[-1][2] = starts[i + 1] if i + 1 < len(SHOTS) else total
    inputs = ["-i", str(video)]
    graph = []
    n = 1
    for c in cues:
        inputs += ["-i", str(vdir / f"cue-{c['n']:02d}.wav")]
        d = int(c["at"] * 1000)
        graph.append(f"[{n}:a]aformat=channel_layouts=stereo,adelay={d}|{d},volume=1.7[v{n}]")
        n += 1
    vlabels = "".join(f"[v{k}]" for k in range(1, n))
    mlabels = []
    for k, (sec, s0, s1) in enumerate(sections):
        inputs += ["-i", str(VIDEO / "audio" / "music" / MUSIC[sec])]
        a0 = max(0.0, s0 - 0.75)
        length = (s1 + 0.75) - a0
        offset = 45.0 if (sec == "outro") else 0.0  # the outro takes the theme's later swell
        graph.append(
            f"[{n}:a]atrim={offset}:{offset + length:.2f},asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo,"
            f"afade=t=in:d=1.5,afade=t=out:st={max(0.1, length - 1.5):.2f}:d=1.5,adelay={int(a0 * 1000)}|{int(a0 * 1000)},volume=0.34[m{k}]"
        )
        mlabels.append(f"[m{k}]")
        n += 1
    graph.append(f"{vlabels}amix=inputs={len(cues)}:normalize=0[voice]")
    graph.append("[voice]asplit[vo][vk]")
    graph.append(f"{''.join(mlabels)}amix=inputs={len(mlabels)}:normalize=0[music]")
    graph.append("[music][vk]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=500[duck]")
    graph.append(f"[vo][duck]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,atrim=0:{total:.2f}[aout]")
    w, h = size.split("x")
    style = "FontName=Inter Medium,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101820,BorderStyle=1,Outline=1.6,Shadow=0.8,MarginV=40,Alignment=2"
    graph.append(f"[0:v]subtitles={srt_path}:fontsdir={FONT.parent}:force_style='{style}'[vout]")
    out = VIDEO / "output" / f"{args.name}-{h}p.mp4"
    ff(*inputs, "-filter_complex", ";".join(graph), "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "slow",
       "-crf", "17", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "aac", "-b:a", "320k", "-ar", "48000",
       "-movflags", "+faststart", "-t", f"{total:.2f}", str(out))
    chapters = []
    names = {"i1": "What if everything could be 3D?", "f0": "The fridge", "s0": "The sofa", "h0": "The house", "c0": "The car",
             "m0": "Any object, one pipeline", "v0": "Into the village simulation", "v5": "Evening", "o0": "Point at the world"}
    for sid, title in names.items():
        chapters.append({"t": round(at[sid], 1), "title": title})
    (VIDEO / "output" / "vr-v8-chapters.json").write_text(json.dumps(chapters, indent=1))
    print(out, f"{total:.1f}s")


if __name__ == "__main__":
    main()
