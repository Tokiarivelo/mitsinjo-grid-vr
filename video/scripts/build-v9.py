"""Assemble the VR showcase (v9): 3D intro, fridge / sofa / house / car to 3D, the Meta models card, the car in
the village, a tape fast-forward to the evening, the dispatch controller (homes, then the clinic).

Usage: build-v9.py [--size 2560x1440] [--name mitsinjo-grid-vr-v9]
Inputs (local): frames/intro3d-{headset,car,laptop} and frames/vr-intro (render-canvas / intro-photos),
captures/raw/vr-v10day + vr-v10night (capture-vr-v9, PART=all / simnight), audio/voice/vr-v9 (tts-v9.py, cues.json),
audio/music/{passion,aurora,feel-alive,machine}.mp3, frames/vr-outro.
Every shot joins the next with a short cross-fade; no boxed titles; captions are plain outlined text; a
time-lapse shows a small « ×N » in the corner. Music changes by place: intro / outro, inside, outside, simulation.
"""

import argparse
import os
import json
import subprocess
from pathlib import Path

VIDEO = Path(__file__).resolve().parent.parent
WORK = VIDEO / "output" / "v9-work"  # per day take, see main()
FONT = VIDEO / "canvas" / "fonts" / "Inter-Medium.ttf"
FPS = 30
XF = 0.45  # cross-fade between consecutive shots
DAY = os.environ.get("V9_DAY", "vr-v10day")
NIGHT = os.environ.get("V9_NIGHT", "vr-v10night")

# (kind, a, b, seconds, id, section)  kind: frames dir "F", a capture take, "VHS" (fast forward), "CARD"
SHOTS = [
    ("F", "intro3d-headset", (0, 11.0), 11.0, "i1", "intro"),
    ("F", "vr-intro", (11.0, 29.6), 18.6, "i2", "intro"),
    ("F", "intro3d-car", (0, 9.0), 9.0, "i3", "intro"),
    ("F", "intro3d-laptop", (0, 10.0), 10.0, "i4", "intro"),
    # Fridge (kitchen): the whole pipeline, with the AI chat.
    (DAY, "village-page", "village-vr-entered", 4.0, "f0", "inside"),
    (DAY, "village-vr-entered", "village-scan", 3.5, "f1", "inside"),
    (DAY, "village-scan", "village-detected", 3.5, "f2", "inside"),
    (DAY, "village-detected", "fridge-shoot", 3.0, "f3", "inside"),
    (DAY, "fridge-shoot", "fridge-studio", 4.0, "f4", "inside"),
    (DAY, "fridge-studio", "fridge-chat", 4.5, "f5", "inside"),
    (DAY, "fridge-chat", "fridge-build", 4.0, "f6", "inside"),
    (DAY, "fridge-build", "fridge-lab", 3.5, "f7", "inside"),
    (DAY, "fridge-lab", "fridge-3d", 5.0, "f8", "inside"),
    # Sofa (hall): its 2D views, then its 3D turning on the plate.
    (DAY, "walk-hall", "sofa-scan", 4.0, "s0", "inside"),
    (DAY, "sofa-scan", "sofa-detected", 2.5, "s1", "inside"),
    (DAY, "sofa-studio", "sofa-build", 5.0, "s2", "inside"),
    (DAY, "sofa-build", "sofa-3d", 4.0, "s3", "inside"),
    (DAY, "sofa-turn", "sofa-turn-done", 5.5, "s4", "inside"),
    # House (terrace) and car (street): same steps, the 3D held long enough to see it.
    (DAY, "walk-terrace", "house-scan", 4.0, "h0", "outside"),
    (DAY, "house-scan", "house-detected", 2.5, "h1", "outside"),
    (DAY, "house-studio", "house-build", 5.0, "h2", "outside"),
    (DAY, "house-build", "house-3d", 4.0, "h3", "outside"),
    (DAY, "house-turn", "house-turn-done", 5.5, "h4", "outside"),
    (DAY, "walk-street", "car-scan", 4.0, "c0", "outside"),
    (DAY, "car-scan", "car-detected", 2.5, "c1", "outside"),
    (DAY, "car-studio", "car-build", 5.0, "c2", "outside"),
    (DAY, "car-build", "car-3d", 4.0, "c3", "outside"),
    (DAY, "car-turn", "car-turn-done", 5.0, "c4", "outside"),
    ("CARD", None, None, 10.5, "mc", "outside"),
    # Into the village simulation, the car in it, the daytime tour.
    (DAY, "village-table", "village-inserted", 6.0, "v0", "sim"),
    (DAY, "village-inserted", "shell", 4.0, "v1", "sim"),
    (DAY, "sim-view", "sim-car-done", 8.0, "v2", "sim"),
    (DAY, "sim-walk", "sim-labels", 7.0, "v3", "sim"),
    (DAY, "sim-map", "sim-ff-walk", 5.0, "v4", "sim"),
    ("VHS", f"{DAY}:sim-ff-walk", f"{DAY}:sim-night", 7.5, "v5", "sim"),
    # Evening at the dispatch controller: the homes, then the clinic.
    (NIGHT, "sim-night-done", "sim-mixer", 5.0, "n0", "sim"),
    (NIGHT, "sim-houses-cut", "sim-houses-dark", 8.0, "n1", "sim"),
    (NIGHT, "sim-houses-dark", "sim-houses-on", 5.0, "n2", "sim"),
    (NIGHT, "sim-clinic", "sim-end", 8.0, "n3", "sim"),
    ("F", "vr-outro", (0, 13.0), 13.0, "o0", "outro"),
]
# Voice line n → (shot id, seconds into it).
CUES = {
    1: ("i1", 0.6), 2: ("i1", 6.2), 3: ("i2", 5.0), 4: ("i2", 13.0), 5: ("i3", 4.2), 6: ("i4", 1.0),
    7: ("f1", 0.5), 8: ("f3", 0.4), 9: ("f4", 0.6), 10: ("f5", 0.6), 11: ("f6", 0.6),
    12: ("s0", 0.8), 13: ("s3", 0.8), 14: ("h0", 0.8), 15: ("h2", 0.6), 16: ("c0", 0.8), 17: ("c2", 0.6),
    18: ("mc", 0.4), 19: ("v0", 0.3), 20: ("v2", 1.5), 21: ("v3", 0.5), 22: ("v5", 0.1),
    23: ("n0", 0.6), 24: ("n1", 0.3), 25: ("n2", 1.0), 26: ("n3", 0.3), 27: ("o0", 1.0),
}
# Which Meta model does this step in the live app (docs/vision-to-3d-methodology.md § stages), top-left, no box.
TAGS: dict[str, str] = {}  # no per-step model tags over the demo footage
# The models card (no colons: drawtext separators).
CARD = [
    ("Built with Meta AI models", 64, "white"),
    ("Detect — Muse Spark 1.3 names it, SAM 3.1 outlines it", 38, "0x4dd8e8"),
    ("2D views — Muse Image 1.0, with a facade specialist", 38, "0x4dd8e8"),
    ("3D — Muse Spark 1.3 guided by skill cards and a critic agent", 38, "0x4dd8e8"),
]
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


def capture_clip(out: Path, take: str, a: str, b: str, dur: float, size: str, tag: str = "") -> None:
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
    if tag:  # the Meta model behind this step, top-left, fades in
        vf.append(f"drawtext=fontfile={FONT}:text='{tag}':x={int(40 * s)}:y={int(34 * s)}:fontsize={int(28 * s)}:"
                  f"fontcolor=0x4dd8e8:alpha='min(1,t/0.5)':borderw={max(2, int(2 * s))}:bordercolor=black@0.7")
    ff("-f", "concat", "-safe", "0", "-i", str(lst), "-vf", ",".join(vf), "-t", f"{dur:.3f}", *enc(size), "-an", str(out))


# Fine print on the end card: some results on screen were prepared for the demo.
OUTRO_NOTE = ""


def frames_clip(out: Path, name: str, rng: tuple[float, float], dur: float, size: str) -> None:
    w, h = size.split("x")
    note = ""
    if name == "vr-outro" and OUTRO_NOTE:
        s = int(h) / 1080
        note = (f",drawtext=fontfile={FONT}:text='{OUTRO_NOTE}':x=(w-tw)/2:y=h-{int(42 * s)}:"
                f"fontsize={int(18 * s)}:fontcolor=white@0.55")
    ff("-framerate", str(FPS), "-start_number", str(int(rng[0] * FPS)), "-i", str(VIDEO / "frames" / name / "%05d.png"),
       "-t", f"{dur}", "-vf", f"scale={w}:{h}:flags=lanczos{note}", *enc(size), "-an", str(out))


def ff_clip(out: Path, a: str, b: str, dur: float, size: str) -> None:
    w, h = size.split("x")
    s = int(h) / 1080
    clock = (
        f"drawtext=fontfile={FONT}:text='%{{eif\\:12+min(7\\,floor(t*7/{dur * 0.85:.2f}))\\:d}}\\:00':"
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


MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def vhs_clip(out: Path, a: str, b: str, dur: float, size: str) -> None:
    """Tape fast-forward: the walk sped up, tracking noise, colour bleed, scanlines, ▶▶, the clock 12→19."""
    take, ma = a.split(":")
    _, mb = b.split(":")
    raw = out.with_name(out.stem + "-raw.mp4")
    capture_clip(raw, take, ma, mb, dur, size)
    w, h = (int(x) for x in size.split("x"))
    s = h / 1080
    vf = [
        "eq=saturation=1.25:contrast=1.08",
        "rgbashift=rh=%d:bh=-%d" % (int(5 * s), int(5 * s)),
        "noise=alls=22:allf=t",
        f"drawgrid=w=iw:h={max(3, int(4 * s))}:t=1:c=black@0.22",
        # a rolling tracking band
        f"drawbox=x=0:y='mod(t*{int(520 * s)},h)':w=iw:h={int(26 * s)}:color=white@0.18:t=fill",
        f"drawbox=x=0:y='mod(t*{int(520 * s)}+{int(30 * s)},h)':w=iw:h={int(6 * s)}:color=black@0.35:t=fill",
        f"drawtext=fontfile={MONO}:text='▶▶':x={int(60 * s)}:y={int(50 * s)}:fontsize={int(64 * s)}:"
        f"fontcolor=white:alpha='if(lt(mod(t,0.8),0.5),1,0.25)':borderw={int(3 * s)}:bordercolor=black@0.6",
        f"drawtext=fontfile={MONO}:text='FF':x={int(170 * s)}:y={int(58 * s)}:fontsize={int(50 * s)}:"
        f"fontcolor=white:borderw={int(3 * s)}:bordercolor=black@0.6",
        f"drawtext=fontfile={FONT}:text='%{{eif\\:12+min(7\\,floor(t*7/{dur * 0.9:.2f}))\\:d}}\\:00':"
        f"x=(w-tw)/2:y=h*0.40:fontsize={int(150 * s)}:fontcolor=white:borderw={int(4 * s)}:bordercolor=black@0.55",
        # the picture darkens toward the evening
        f"eq=brightness='-0.22*t/{dur:.2f}':eval=frame",
    ]
    ff("-i", str(raw), "-vf", ",".join(vf), "-t", f"{dur:.3f}", *enc(size), "-an", str(out))


def card_clip(out: Path, dur: float, size: str) -> None:
    """The models card: the four built models, blurred and dimmed, under centred lines that fade in one by one."""
    w, h = (int(x) for x in size.split("x"))
    s = h / 1080
    vf = [f"scale={w}:{h},boxblur=18:2,eq=brightness=-0.32,fps={FPS}"]
    y = h * 0.26
    for k, (text, size_px, col) in enumerate(CARD):
        fs = int(size_px * s)
        t0 = 0.3 + k * 0.6
        text = text.replace("'", "’")
        vf.append(f"drawtext=fontfile={FONT}:text='{text}':x=(w-tw)/2:y={int(y)}:fontsize={fs}:fontcolor={col}:"
                  f"alpha='min(1,max(0,(t-{t0})/0.5))':borderw={max(2, int(2 * s))}:bordercolor=black@0.5")
        y += fs * (1.9 if k == 0 else 1.6)
    bg = WORK / "mc-bg.png"  # the car model turning in the lab, behind the text
    ff("-i", str(frame_at(f"{DAY}:car-turn-done")), "-frames:v", "1", str(bg))
    ff("-loop", "1", "-t", f"{dur}", "-i", str(bg), "-vf", ",".join(vf),
       "-t", f"{dur}", *enc(size), "-an", str(out))


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


def usable_shots(shots: list) -> list:
    """Drop capture shots whose start marker this take lacks; a missing end marker falls back to the next one."""
    keep = []
    for shot in shots:
        kind, a, b = shot[0], shot[1], shot[2]
        if kind in ("F", "FF", "MOSAIC", "CARD", "VHS"):
            keep.append(shot)
            continue
        names = [m["name"] for m in timeline(kind)["markers"]]
        if a not in names:
            print("skip", shot[4], "(no", a, "in", kind + ")")
            continue
        if b not in names:
            b = names[min(names.index(a) + 1, len(names) - 1)]
        keep.append((kind, a, b, *shot[3:]))
    return keep


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", default="2560x1440")
    ap.add_argument("--name", default="mitsinjo-grid-vr-v9")
    ap.add_argument("--voice-dir", default=str(VIDEO / "audio" / "voice" / "vr-v9"))
    args = ap.parse_args()
    global WORK, SHOTS
    WORK = WORK.with_name(f"v10-work-{DAY}")
    WORK.mkdir(parents=True, exist_ok=True)
    SHOTS = usable_shots(SHOTS)
    size = args.size

    parts = []
    for i, (kind, a, b, dur, sid, _sec) in enumerate(SHOTS):
        out = WORK / f"{sid}.mp4"
        if not out.exists():
            if kind == "F":
                frames_clip(out, a, b, dur, size)
            elif kind == "FF":
                ff_clip(out, a, b, dur, size)
            elif kind == "MOSAIC":
                mosaic_clip(out, dur, size)
            elif kind == "VHS":
                vhs_clip(out, a, b, dur, size)
            elif kind == "CARD":
                card_clip(out, dur, size)
            else:
                capture_clip(out, kind, a, b, dur, size, TAGS.get(sid, ""))
            print("shot", sid, kind, a, "→", b, dur)
        # the real length: a sparse capture can end a few frames short of its nominal duration
        real = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                              "-of", "csv=p=0", str(out)]))
        parts.append((out, min(dur, real)))
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
        if ref not in at:  # its shot is missing from this take (e.g. no library toggle): skip the line
            continue
        start = max(at[ref] + off, t + 0.15)
        c["at"] = start
        t = start + c["dur"]
        srt.append(f"{len(srt) + 1}\n{ts(start)} --> {ts(t + 0.5)}\n{c['text']}\n")
    srt_path = VIDEO / "subtitles" / "vr-v9-en.srt"
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
    cues = [c for c in cues if "at" in c]
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
             "mc": "Built with Meta AI models", "v0": "Into the village simulation", "v5": "Fast forward to 19:00", "n0": "The dispatch controller", "o0": "Point at the world"}
    for sid, title in names.items():
        chapters.append({"t": round(at[sid], 1), "title": title})
    (VIDEO / "output" / "vr-v9-chapters.json").write_text(json.dumps(chapters, indent=1))
    print(out, f"{total:.1f}s")


if __name__ == "__main__":
    main()
