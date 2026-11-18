"""Assemble the VR showcase video (VR_VIDEO_SCRIPT.md): intro + /village + /simulation + outro, voice, captions, music.

Usage: build-vr.py [--size 2560x1440] [--preview]   (run from `make video-build-vr`)
Inputs (local, gitignored): frames/vr-intro/*.png, frames/vr-outro/*.png (render-canvas.cjs),
captures/raw/vr-village and vr-sim (capture-vr.mjs: frames + timeline.json with markers),
audio/voice/vr/cue-NN.wav + cues.json (tts-srt.py), audio/sfx/*.wav (sfx.sh), audio/music/.
Clips are cut between named markers and played at the speed that fits their slot; a slot played faster than
2.5× shows a small « ×N » badge (honest time-lapse). Variable-rate capture frames are blended to 30 fps.
Output: output/mitsinjo-grid-vr-<h>p.mp4 and subtitles/vr-en.srt (the cues at their final times).
"""

import argparse
import json
import subprocess
from pathlib import Path

VIDEO = Path(__file__).resolve().parent.parent
WORK = VIDEO / "output" / "vr-work"
FONT = VIDEO / "canvas" / "fonts" / "Inter-Medium.ttf"
FPS = 30

# (capture, from marker, to marker, seconds on screen, section label shown at the clip start or None)
# (capture, from marker, to marker, seconds on screen, section label or None, clip id for CUES)
CAP = "vr-v4"
VILLAGE = [
    (CAP, "village-page", "village-vr-entered", 4.5, "Village · VR immersion", "v0"),
    (CAP, "village-vr-entered", "village-scan", 3.0, None, "v1"),
    (CAP, "village-scan", "village-detected", 4.0, "Scan · AI detection", "v2"),
    (CAP, "village-detected", "fridge-shoot", 3.0, None, "v3"),
    (CAP, "fridge-shoot", "fridge-studio", 5.0, "Shoot · Extract in 3D", "v4"),
    (CAP, "fridge-studio", "fridge-chat", 5.0, "3D studio · 2D views", "v5"),
    (CAP, "fridge-chat", "fridge-build", 4.5, "AI chat · redraw a view", "v6"),
    (CAP, "fridge-build", "fridge-3d", 6.0, "Validate · build the 3D", "v7"),
    (CAP, "fridge-3d", "walk-hall", 3.0, None, "v8"),
    (CAP, "walk-hall", "car-scan", 10.0, "Walk outside", "v9"),
    (CAP, "car-scan", "car-detected", 4.0, "Scan the street", "v10"),
    (CAP, "car-detected", "car-studio", 5.0, "The car · Extract in 3D", "v11"),
    (CAP, "car-studio", "car-build", 4.0, None, "v12"),
    (CAP, "car-build", "car-3d", 5.5, "Car · built in 3D", "v13"),
    (CAP, "village-table", "village-inserted", 7.0, "Insert into the simulation", "v14"),
    (CAP, "village-inserted", "handoff", 2.5, None, "v15"),
]
# The holo shell is real footage (VS-T49: same VR session), so it opens the simulation part.
SIM = [
    (CAP, "handoff", "sim-arrive", 4.0, "Same session · to the simulation", "s0"),
    (CAP, "sim-arrive", "sim-walk", 3.0, None, "s1"),
    (CAP, "sim-walk", "sim-labels", 6.0, "A walk through the village", "s2"),
    (CAP, "sim-labels", "sim-panel", 5.0, "Labels · live map", "s3"),
    (CAP, "sim-panel", "sim-restore", 9.0, "Evening · limit a house", "s4"),
    (CAP, "sim-restore", "sim-enter", 3.0, None, "s5"),
    (CAP, "sim-enter", "sim-mixer", 5.5, "Step inside", "s6"),
    (CAP, "sim-mixer", "sim-clinic", 5.0, "Dispatcher · mixing desk", "s7"),
    (CAP, "sim-clinic", "sim-end", 4.0, "Clinic protected", "s8"),
    (CAP, "back-to-lab", "lab-again", 3.0, "Back to the lab", "s9"),
]
# Voice cue n → (clip id or "intro" / "outro", seconds after its start). Pushed later if the line before still speaks.
CUES = {
    1: ("intro", 0.4), 2: ("intro", 3.8), 3: ("intro", 7.4), 4: ("intro", 11.8), 5: ("intro", 16.4),
    6: ("intro", 21.0), 7: ("intro", 25.8), 8: ("intro", 30.4), 9: ("intro", 34.6),
    10: ("v0", 0.3), 11: ("v1", 1.0), 12: ("v2", 0.6), 13: ("v3", 0.2), 14: ("v4", 0.5),
    15: ("v5", 0.6), 16: ("v6", 0.4), 17: ("v7", 0.5), 18: ("v8", 0.3), 19: ("v9", 1.5),
    20: ("v10", 0.5), 21: ("v11", 0.5), 22: ("v13", 0.5), 23: ("v14", 0.5),
    24: ("s0", 0.3), 25: ("s1", 0.3), 26: ("s2", 0.8), 27: ("s3", 0.6), 28: ("s4", 0.4),
    29: ("s4", 3.4), 30: ("s5", 0.2), 31: ("s6", 1.0), 32: ("s7", 0.3), 33: ("s8", 0.2),
    34: ("s9", 0.3), 35: ("outro", 0.6), 36: ("outro", 5.6),
}
# Short, spoken voice-over (subtitles/vr-short-script.srt): few lines, the demo talks.
CUES_SHORT = {
    1: ("intro", 0.6), 2: ("intro", 16.6), 3: ("intro", 32.4),
    4: ("v0", 0.4), 5: ("v2", 0.4), 6: ("v4", 0.4), 7: ("v5", 0.8), 8: ("v7", 2.5),
    9: ("v9", 0.8), 10: ("v10", 0.4), 11: ("v11", 0.5), 12: ("v13", 1.5), 13: ("v14", 0.6),
    14: ("s0", 0.6), 15: ("s1", 0.4), 16: ("s2", 0.8), 17: ("s4", 0.5), 18: ("s4", 4.5),
    19: ("s5", 0.3), 20: ("s7", 0.4), 21: ("s8", 0.3), 22: ("s9", 0.3), 23: ("outro", 1.0),
}
INTRO_S = 38.0
OUTRO_S = 13.0
XF = 0.8  # cross-fade between sections
REUSE = bool(__import__('os').environ.get('REUSE'))  # keep encoded clips (caption or audio-only changes)


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def ff(*args: str) -> None:
    run(["ffmpeg", "-loglevel", "error", "-y", *args])


def enc(size: str) -> list[str]:
    return ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(FPS), "-s", size]


def esc(t: str) -> str:
    return t.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace(",", "\\,")


def clip(i: int, cap: str, a: str, b: str, dur: float, label: str | None, _id: str, size: str) -> Path:
    """Cuts frames between two markers into a `dur` s clip (frame times kept, sped up), blended to 30 fps."""
    tl = json.loads((VIDEO / "captures" / "raw" / cap / "timeline.json").read_text())
    marks = {m["name"]: m["t"] for m in tl["markers"]}
    if a not in marks or b not in marks:
        raise SystemExit(f"missing marker {a} or {b} in {cap}")
    t0, t1 = marks[a], marks[b]
    frames = [f for f in tl["frames"] if t0 <= f["t"] <= t1]
    if not frames:
        raise SystemExit(f"no frames between {a} and {b}")
    speed = (t1 - t0) / dur
    lst = WORK / f"clip-{i:02d}.txt"
    lines = ["ffconcat version 1.0"]
    for j, f in enumerate(frames):
        nxt = frames[j + 1]["t"] if j + 1 < len(frames) else t1
        d = max(1 / FPS, (nxt - f["t"]) / speed)
        lines += [f"file '{VIDEO / 'captures' / 'raw' / cap / 'frames' / f['f']}'", f"duration {d:.4f}"]
    lines.append(f"file '{VIDEO / 'captures' / 'raw' / cap / 'frames' / frames[-1]['f']}'")
    lst.write_text("\n".join(lines) + "\n")
    w, h = size.split("x")
    vf = [f"scale={w}:{h}:flags=lanczos", f"framerate=fps={FPS}:interp_start=0:interp_end=255:scene=100"]
    s = int(h) / 1080
    if speed > 2.5:
        vf.append(
            f"drawtext=fontfile={FONT}:text='TIME-LAPSE ×{round(speed)}':x=w-tw-{int(48 * s)}:y={int(44 * s)}:"
            f"fontsize={int(30 * s)}:fontcolor=white@0.9:box=1:boxcolor=0x080d1a@0.6:boxborderw={int(14 * s)}"
        )
    if label:
        a_in = f"if(lt(t,0.35),t/0.35,if(lt(t,3.2),1,max(0,1-(t-3.2)/0.5)))"
        vf.append(
            f"drawbox=x={int(56 * s)}:y={int(56 * s)}:w={int(6 * s)}:h={int(46 * s)}:color=0x4dd8e8@1:t=fill:"
            f"enable='lt(t,3.7)'"
        )
        vf.append(
            f"drawtext=fontfile={FONT}:text='{esc(label.upper())}':x={int(76 * s)}+(1-min(1\\,t/0.35))*{int(-30 * s)}:"
            f"y={int(62 * s)}:fontsize={int(32 * s)}:fontcolor=white:alpha='{a_in}':"
            f"shadowcolor=black@0.7:shadowx=2:shadowy=2:box=1:boxcolor=0x080d1a@0.55:boxborderw={int(14 * s)}"
        )
    out = WORK / f"clip-{i:02d}.mp4"
    if REUSE and out.exists():
        return out
    ff("-f", "concat", "-safe", "0", "-i", str(lst), "-vf", ",".join(vf), "-t", f"{dur:.3f}", *enc(size), "-an", str(out))
    print(f"clip {i:02d} {a} → {b}: {t1 - t0:.1f}s → {dur}s (×{speed:.1f})")
    return out


def frames_clip(name: str, dur: float, size: str) -> Path:
    out = WORK / f"{name}.mp4"
    if REUSE and out.exists():
        return out
    w, h = size.split("x")
    ff("-framerate", str(FPS), "-i", str(VIDEO / "frames" / name / "%05d.png"), "-t", f"{dur}",
       "-vf", f"scale={w}:{h}:flags=lanczos", *enc(size), "-an", str(out))
    return out


def concat(parts: list[Path], name: str) -> Path:
    lst = WORK / f"{name}.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in parts))
    out = WORK / f"{name}.mp4"
    ff("-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(out))
    return out


def ts(s: float) -> str:
    ms = int(round(s * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", default="2560x1440")
    ap.add_argument("--voice-dir", default=str(VIDEO / "audio" / "voice" / "vr"))
    ap.add_argument("--short", action="store_true", help="short spoken voice-over (CUES_SHORT)")
    ap.add_argument("--name", default="mitsinjo-grid-vr")
    args = ap.parse_args()
    voice_dir = Path(args.voice_dir)
    # Skip clips whose markers the take does not have (e.g. a step that failed in the emulator).
    global VILLAGE, SIM
    def has(c):
        names = {m["name"] for m in json.loads((VIDEO / "captures" / "raw" / c[0] / "timeline.json").read_text())["markers"]}
        ok = c[1] in names and c[2] in names
        if not ok:
            print(f"skip clip {c[5]}: marker {c[1]} or {c[2]} missing")
        return ok
    VILLAGE = [c for c in VILLAGE if has(c)]
    SIM = [c for c in SIM if has(c)]
    cue_map = CUES_SHORT if args.short else CUES
    WORK.mkdir(parents=True, exist_ok=True)
    size = args.size

    intro = frames_clip("vr-intro", INTRO_S, size)
    village = concat([clip(i, *c, size) for i, c in enumerate(VILLAGE)], "village")
    sim = concat([clip(20 + i, *c, size) for i, c in enumerate(SIM)], "sim")
    outro = frames_clip("vr-outro", OUTRO_S, size)
    v_dur = sum(c[3] for c in VILLAGE)
    s_dur = sum(c[3] for c in SIM)
    # Section starts on the final timeline (each cross-fade overlaps XF s).
    o1 = INTRO_S - XF
    o2 = o1 + v_dur - XF
    o3 = o2 + s_dur - XF
    total = o3 + OUTRO_S
    print(f"village starts {o1:.1f}s, simulation {o2:.1f}s, outro {o3:.1f}s, total {total:.1f}s")
    # Chapters (YouTube description, the review page): intro, each labelled clip, outro.
    chapters = [{"t": 0.0, "part": "Intro", "title": "What if everything could be 3D?"}]
    for part, start, clips in (("Village", o1, VILLAGE), ("Simulation", o2, SIM)):
        at = start
        for c in clips:
            if c[4]:
                chapters.append({"t": round(at, 1), "part": part, "title": c[4]})
            at += c[3]
    chapters.append({"t": round(o3, 1), "part": "Outro", "title": "Point at the world. Build it. Power it."})
    (VIDEO / "output" / "vr-chapters.json").write_text(json.dumps(chapters, indent=1))

    # Voice: each cue at its clip's start + offset (CUES), pushed later if the previous one still speaks.
    starts = {"intro": 0.0, "outro": o3}
    for base, clips in ((o1, VILLAGE), (o2, SIM)):
        at = base
        for c in clips:
            starts[c[5]] = at
            at += c[3]
    cues = json.loads((voice_dir / "cues.json").read_text())
    dropped = [c["n"] for c in cues if cue_map[c["n"]][0] not in starts]
    if dropped:
        print(f"voice lines dropped (their clip is skipped): {dropped}")
    cues = [c for c in cues if cue_map[c["n"]][0] in starts]
    t = 0.0
    srt = []
    for c in cues:
        ref, off = cue_map[c["n"]]
        start = max(starts[ref] + off, t + 0.12)
        c["at"] = start
        t = start + c["dur"]
        end = t + 0.6
        text = c["text"]
        words = text.split()
        if len(text) > 42:  # two balanced lines
            half = len(text) / 2
            k = min(range(1, len(words)), key=lambda n: abs(len(" ".join(words[:n])) - half))
            text = " ".join(words[:k]) + "\n" + " ".join(words[k:])
        srt.append(f"{c['n']}\n{ts(start)} --> {ts(end)}\n{text}\n")
    if t > total - 0.3:
        print(f"WARNING: the voice ends at {t:.1f}s, after the video ({total:.1f}s)")
    srt_path = VIDEO / "subtitles" / ("vr-short-en.srt" if args.short else "vr-en.srt")
    srt_path.write_text("\n".join(srt))

    # Audio graph: voice cues, section whooshes, music bed ducked under the voice, end chime.
    inputs = ["-i", str(intro), "-i", str(village), "-i", str(sim), "-i", str(outro)]
    a_parts = []
    n = 4
    for c in cues:
        inputs += ["-i", str(voice_dir / f"cue-{c['n']:02d}.wav")]
        d = int(c["at"] * 1000)
        a_parts.append(f"[{n}:a]aformat=channel_layouts=stereo,adelay={d}|{d},volume=1.6[v{n}]")
        n += 1
    voice_labels = "".join(f"[v{k}]" for k in range(4, n))
    sfx = VIDEO / "audio" / "sfx"
    for name, at in (("rise", 9.6), ("whoosh", o1 - 0.3), ("whoosh", o2 - 0.3), ("whoosh", 29.8), ("chime", o3 + 0.3)):
        inputs += ["-i", str(sfx / f"{name}.wav")]
        d = int(at * 1000)
        a_parts.append(f"[{n}:a]adelay={d}|{d},volume=0.55[s{n}]")
        n += 1
    sfx_labels = "".join(f"[s{k}]" for k in range(n - 5, n))
    music = VIDEO / "audio" / "music" / "adventure-theme.mp3"
    inputs += ["-i", str(music), "-i", str(music)]
    m1, m2 = n, n + 1
    tail = total - 160.0
    a_parts.append(f"[{m1}:a]atrim=0:160,afade=t=out:st=157:d=3,volume=0.32[m1]")
    a_parts.append(
        f"[{m2}:a]atrim=0:{tail + 3:.2f},afade=t=in:d=3,afade=t=out:st={tail - 1.5:.2f}:d=1.5,"
        f"adelay=157000|157000,volume=0.32[m2]"
    )
    a_parts.append(f"{voice_labels}amix=inputs={len(cues)}:normalize=0[voice]")
    a_parts.append("[voice]asplit[vo][vk]")
    a_parts.append("[m1][m2]amix=inputs=2:normalize=0[music]")
    a_parts.append("[music][vk]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=500[duck]")
    a_parts.append(f"[vo][duck]{sfx_labels}amix=inputs=7:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,atrim=0:{total:.2f}[aout]")

    w, h = size.split("x")
    s = int(h) / 1080
    sub_style = (
        f"FontName=Inter Medium,FontSize={int(15)},PrimaryColour=&H00FFFFFF,OutlineColour=&H00101820,"
        f"BackColour=&H40080D1A,BorderStyle=4,Outline=6,Shadow=0,MarginV=30,Alignment=2"
    )
    v_graph = (
        f"[0:v][1:v]xfade=transition=fade:duration={XF}:offset={o1:.3f}[a];"
        f"[a][2:v]xfade=transition=fade:duration={XF}:offset={o2:.3f}[b];"
        f"[b][3:v]xfade=transition=fadeblack:duration={XF}:offset={o3:.3f}[c];"
        f"[c]subtitles={srt_path}:fontsdir={FONT.parent}:force_style='{sub_style}'[vout]"
    )
    out = VIDEO / "output" / f"{args.name}-{h}p.mp4"
    ff(*inputs, "-filter_complex", v_graph + ";" + ";".join(a_parts), "-map", "[vout]", "-map", "[aout]",
       "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", str(FPS),
       "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{total:.2f}", str(out))
    print(out, f"{total:.1f}s", f"scale {s:.2f}")


if __name__ == "__main__":
    main()
