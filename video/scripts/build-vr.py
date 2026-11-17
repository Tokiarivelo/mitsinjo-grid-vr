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
VILLAGE = [
    ("vr-village", "village-page", "village-vr-entered", 5.5, "Village · VR immersion"),
    ("vr-village", "village-vr-entered", "village-scan", 6.0, None),
    ("vr-village", "village-scan", "village-detected", 4.5, "Scan · AI detection"),
    ("vr-village", "village-detected", "village-shoot", 4.5, None),
    ("vr-village", "village-shoot", "studio-enter", 6.5, "Shoot · Extract in 3D"),
    ("vr-village", "studio-enter", "studio-views", 6.0, "3D studio · 2D views"),
    ("vr-village", "studio-views", "studio-chat", 5.0, None),
    ("vr-village", "studio-chat", "studio-chat-sent", 5.5, "AI chat · redraw a view"),
    ("vr-village", "studio-chat-sent", "studio-chat-done", 4.5, None),
    ("vr-village", "studio-build", "lab-open", 7.0, "Validate · build the 3D"),
    ("vr-village", "lab-open", "village-table", 10.0, "3D lab"),
    ("vr-village", "village-table", "village-inserted", 11.0, "Insert into the simulation"),
    ("vr-village", "village-inserted", "handoff", 4.0, None),
]
SIM = [
    ("vr-sim", "sim-arrive", "sim-labels", 9.0, "Simulation · walk the grid"),
    ("vr-sim", "sim-labels", "sim-panel", 7.0, "Labels · live map"),
    ("vr-sim", "sim-panel", "sim-enter", 8.0, "Control a building"),
    ("vr-sim", "sim-enter", "sim-mixer", 8.0, "Step inside"),
    ("vr-sim", "sim-mixer", "sim-clinic", 9.0, "Dispatcher · mixing desk"),
    ("vr-sim", "sim-clinic", "sim-end", 5.0, "Clinic protected"),
]
INTRO_S = 38.0
OUTRO_S = 11.0
XF = 0.8  # cross-fade between sections


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def ff(*args: str) -> None:
    run(["ffmpeg", "-loglevel", "error", "-y", *args])


def enc(size: str) -> list[str]:
    return ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(FPS), "-s", size]


def esc(t: str) -> str:
    return t.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace(",", "\\,")


def clip(i: int, cap: str, a: str, b: str, dur: float, label: str | None, size: str) -> Path:
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
            f"drawtext=fontfile={FONT}:text='⏩ ×{round(speed)}':x=w-tw-{int(48 * s)}:y={int(44 * s)}:"
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
    ff("-f", "concat", "-safe", "0", "-i", str(lst), "-vf", ",".join(vf), "-t", f"{dur:.3f}", *enc(size), "-an", str(out))
    print(f"clip {i:02d} {a} → {b}: {t1 - t0:.1f}s → {dur}s (×{speed:.1f})")
    return out


def frames_clip(name: str, dur: float, size: str) -> Path:
    out = WORK / f"{name}.mp4"
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
    args = ap.parse_args()
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

    # Voice: each cue at its script time, pushed later if the previous one is still speaking.
    cues = json.loads((VIDEO / "audio" / "voice" / "vr" / "cues.json").read_text())
    t = 0.0
    srt = []
    for c in cues:
        start = max(c["start"], t + 0.12)
        c["at"] = start
        t = start + c["dur"]
        end = max(t + 0.25, min(start + c["end"] - c["start"], start + c["dur"] + 1.2))
        text = c["text"]
        words = text.split()
        if len(text) > 42:  # two balanced lines
            half = len(text) / 2
            k = min(range(1, len(words)), key=lambda n: abs(len(" ".join(words[:n])) - half))
            text = " ".join(words[:k]) + "\n" + " ".join(words[k:])
        srt.append(f"{c['n']}\n{ts(start)} --> {ts(end)}\n{text}\n")
    srt_path = VIDEO / "subtitles" / "vr-en.srt"
    srt_path.write_text("\n".join(srt))

    # Audio graph: voice cues, section whooshes, music bed ducked under the voice, end chime.
    inputs = ["-i", str(intro), "-i", str(village), "-i", str(sim), "-i", str(outro)]
    a_parts = []
    n = 4
    for c in cues:
        inputs += ["-i", str(VIDEO / "audio" / "voice" / "vr" / f"cue-{c['n']:02d}.wav")]
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
        f"BackColour=&H80080D1A,BorderStyle=1,Outline=1.4,Shadow=0.6,MarginV=34,Alignment=2"
    )
    v_graph = (
        f"[0:v][1:v]xfade=transition=fade:duration={XF}:offset={o1:.3f}[a];"
        f"[a][2:v]xfade=transition=circleopen:duration={XF}:offset={o2:.3f}[b];"
        f"[b][3:v]xfade=transition=fadeblack:duration={XF}:offset={o3:.3f}[c];"
        f"[c]subtitles={srt_path}:fontsdir={FONT.parent}:force_style='{sub_style}'[vout]"
    )
    out = VIDEO / "output" / f"mitsinjo-grid-vr-{h}p.mp4"
    ff(*inputs, "-filter_complex", v_graph + ";" + ";".join(a_parts), "-map", "[vout]", "-map", "[aout]",
       "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", str(FPS),
       "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{total:.2f}", str(out))
    print(out, f"{total:.1f}s", f"scale {s:.2f}")


if __name__ == "__main__":
    main()
