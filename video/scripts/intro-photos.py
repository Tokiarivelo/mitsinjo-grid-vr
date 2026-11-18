"""Photo intro of the VR showcase (VR_VIDEO_SCRIPT.md § 4, v6): Quest headset → dive into a lens → the
street with the Ferrari (laser, AI outline, label, scan) → its four views as hologram cards, validated →
the laptop, closed (logo removed) then open on the app, the camera flying into its screen.

Usage: intro-photos.py [--screen <app screenshot>] [--out frames/vr-intro]   (38 s, 30 fps, 1920 × 1080 PNG)
Inputs in video/images/intro/ (local, not committed: the owner's photos): quest.png, quest-lenses.jpg,
ferrari-street.png, ferrari-views.png, mac-closed.jpg, mac-open.jpg.
"""

import argparse
import shutil
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

VIDEO = Path(__file__).resolve().parent.parent
IMG = VIDEO / "images" / "intro"
FONT = str(VIDEO / "canvas" / "fonts" / "Inter-Medium.ttf")
W, H, FPS, DUR = 1920, 1080, 30, 38.0
CYAN = (232, 216, 77)  # BGR of #4dd8e8
VIOLET = (255, 160, 182)
GREEN = (160, 214, 83)
# Screen glass of mac-open.jpg (TL, TR, BR, BL), measured on the photo.
SCREEN = np.float32([[664, 64], [2056, 156], [1996, 1000], [656, 940]])
LENS = (890, 906)  # left lens centre in quest-lenses.jpg


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def seg(t, a, b):
    return clamp((t - a) / (b - a))


def eio(x):
    return 4 * x * x * x if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def eout(x):
    return 1 - (1 - x) ** 3


def place(img, scale, cx, cy, bg):
    """Draws `img` scaled by `scale` with its point (cx, cy) at the frame centre, over `bg`."""
    m = np.float32([[scale, 0, W / 2 - cx * scale], [0, scale, H / 2 - cy * scale]])
    return cv2.warpAffine(img, m, (W, H), dst=bg.copy(), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_TRANSPARENT)


def soft_stage(img, scale, cx, cy):
    """The photo at `scale`, its edges feathered into a blurred, enlarged copy of itself (no hard frame)."""
    # Backdrop: the photo's own left/right border colours, row by row (its studio gradient, extended).
    edge = np.concatenate([img[:, :6], img[:, -6:]], axis=1).mean(axis=1).astype(np.float32)
    rows = cv2.resize(edge[None], (H, 1), interpolation=cv2.INTER_LINEAR)[0]
    y0 = int(H / 2 - cy * scale)
    rows = np.roll(rows, 0)
    col = np.empty((H, 3), np.float32)
    for yy in range(H):
        src = int(clamp((yy - y0) / scale, 0, img.shape[0] - 1))
        col[yy] = edge[src]
    bg = np.repeat(col[:, None, :], W, axis=1).astype(np.uint8)
    bg = cv2.GaussianBlur(bg, (0, 0), 15)
    fg = place(img, scale, cx, cy, bg)
    m = np.zeros(img.shape[:2], np.float32)
    pad = int(min(img.shape[:2]) * 0.12)
    m[pad:-pad, pad:-pad] = 1
    m = cv2.GaussianBlur(m, (0, 0), pad / 2)
    mm = np.float32([[scale, 0, W / 2 - cx * scale], [0, scale, H / 2 - cy * scale]])
    m = cv2.warpAffine(m, mm, (W, H))[..., None]
    return (fg * m + bg * (1 - m)).astype(np.uint8)


def radial_bg(c_in, c_out):
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt(((x - W / 2) / W) ** 2 + ((y - H / 2) / H) ** 2) / 0.75
    d = np.clip(d, 0, 1)[..., None]
    return (np.array(c_in, np.float32) * (1 - d) + np.array(c_out, np.float32) * d).astype(np.uint8)


def glow_line(frame, pts, color, width=4, closed=False):
    over = np.zeros_like(frame)
    cv2.polylines(over, [pts.astype(np.int32)], closed, color, width * 4, cv2.LINE_AA)
    over = cv2.GaussianBlur(over, (0, 0), 9)
    frame = cv2.add(frame, over)
    cv2.polylines(frame, [pts.astype(np.int32)], closed, color, width, cv2.LINE_AA)
    cv2.polylines(frame, [pts.astype(np.int32)], closed, (255, 255, 255), max(1, width // 3), cv2.LINE_AA)
    return frame


def text(frame, s, xy, size, color=(255, 255, 255), box=None, anchor="la", alpha=1.0):
    if alpha <= 0:
        return frame
    im = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).convert("RGBA")
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    f = ImageFont.truetype(FONT, size)
    l, t, r, b = d.textbbox(xy, s, font=f, anchor=anchor)
    if box:
        pad = size // 2
        d.rounded_rectangle((l - pad, t - pad // 2 - 4, r + pad, b + pad // 2 + 4), radius=pad,
                            fill=(8, 13, 26, int(210 * alpha)), outline=box + (int(255 * alpha),), width=3)
    d.text(xy, s, font=f, fill=color + (int(255 * alpha),), anchor=anchor)
    im = Image.alpha_composite(im, layer)
    return cv2.cvtColor(np.array(im.convert("RGB")), cv2.COLOR_RGB2BGR)


def fade(a, b, x):
    return cv2.addWeighted(a, 1 - x, b, x, 0) if 0 < x < 1 else (b if x >= 1 else a)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--screen", default=str(VIDEO / "captures" / "raw" / "vr-v6" / "frames" / "000000.jpg"))
    ap.add_argument("--out", default=str(VIDEO / "frames" / "vr-intro"))
    args = ap.parse_args()
    out = Path(args.out)
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)

    quest = cv2.imread(str(IMG / "quest.png"))
    lenses = cv2.imread(str(IMG / "quest-lenses.jpg"))
    street = cv2.imread(str(IMG / "ferrari-street.png"))
    views = cv2.imread(str(IMG / "ferrari-views.png"))
    closed = cv2.imread(str(IMG / "mac-closed.jpg"))
    opened = cv2.imread(str(IMG / "mac-open.jpg"))
    screen = cv2.imread(args.screen)

    # Closed lid without its logo (inpainted, then softened so no trace stays).
    g = cv2.cvtColor(closed, cv2.COLOR_BGR2GRAY)
    mask = np.zeros(g.shape, np.uint8)
    roi = g[220:320, 280:380]
    mask[220:320, 280:380] = (roi < np.median(roi) - 12).astype(np.uint8) * 255
    mask = cv2.dilate(mask, np.ones((9, 9), np.uint8))
    closed = cv2.inpaint(closed, mask, 11, cv2.INPAINT_TELEA)
    soft = cv2.GaussianBlur(closed, (0, 0), 6)
    m3 = cv2.GaussianBlur(cv2.dilate(mask, np.ones((25, 25), np.uint8)), (0, 0), 8)[..., None] / 255.0
    closed = (closed * (1 - m3) + soft * m3).astype(np.uint8)

    # The app on the open laptop's screen.
    sh, sw = screen.shape[:2]
    hs = cv2.getPerspectiveTransform(np.float32([[0, 0], [sw, 0], [sw, sh], [0, sh]]), SCREEN)
    warped = cv2.warpPerspective(screen, hs, (opened.shape[1], opened.shape[0]))
    smask = cv2.warpPerspective(np.full((sh, sw), 255, np.uint8), hs, (opened.shape[1], opened.shape[0]))
    opened_app = opened.copy()
    opened_app[smask > 128] = warped[smask > 128]

    # The car's outline: red paint hull plus the tyres down to the road.
    hsv = cv2.cvtColor(street, cv2.COLOR_BGR2HSV)
    red = (((hsv[..., 0] < 10) | (hsv[..., 0] > 170)) & (hsv[..., 1] > 120) & (hsv[..., 2] > 60)).astype(np.uint8) * 255
    red = cv2.morphologyEx(red, cv2.MORPH_CLOSE, np.ones((31, 31), np.uint8))
    cs, _ = cv2.findContours(red, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea).reshape(-1, 2)
    body = np.zeros(red.shape, np.uint8)
    cv2.drawContours(body, [c.reshape(-1, 1, 2)], -1, 255, -1)
    for (wx, wy, wr) in ((1010, 650, 150), (1572, 596, 122)):  # the tyres, down to the road
        cv2.circle(body, (wx, wy), wr, 255, -1)
    body = cv2.morphologyEx(body, cv2.MORPH_CLOSE, np.ones((61, 61), np.uint8))
    cs2, _ = cv2.findContours(body, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c2 = max(cs2, key=cv2.contourArea)
    x, y, bw, bh = cv2.boundingRect(c2)
    hull = cv2.approxPolyDP(c2, 2.5, True).reshape(-1, 2).astype(np.float32)
    # Resample the hull evenly so the trace draws at a steady pace.
    seglen = np.linalg.norm(np.diff(np.vstack([hull, hull[:1]]), axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seglen)])
    s = np.linspace(0, cum[-1], 600)
    closed_hull = np.vstack([hull, hull[:1]])
    outline = np.stack([np.interp(s, cum, closed_hull[:, 0]), np.interp(s, cum, closed_hull[:, 1])], 1)
    edges = cv2.Canny(cv2.GaussianBlur(street, (5, 5), 0), 60, 160)
    carmask = np.zeros(edges.shape, np.uint8)
    cv2.fillPoly(carmask, [hull.astype(np.int32)], 255)
    edges[carmask == 0] = 0
    hit = (820.0, 560.0)

    # Four views, labels cropped, as cards.
    qh, qw = views.shape[0] // 2, views.shape[1] // 2
    cards = [views[r * qh + 62 : r * qh + qh - 8, cc * qw + 8 : cc * qw + qw - 8] for r in (0, 1) for cc in (0, 1)]
    names = ["FRONT", "BACK", "TOP", "BOTTOM"]

    bg_light = radial_bg((252, 250, 248), (214, 208, 204))
    bg_dark = radial_bg((40, 26, 16), (14, 9, 6))
    black = np.zeros((H, W, 3), np.uint8)
    bg_grey = radial_bg((120, 118, 116), (40, 38, 37))

    # Laptop framing: the whole open laptop, then the screen flies to the full frame.
    oh, ow = opened.shape[:2]
    s0 = min(W / 1700, H / 1450)
    c0 = (1330, 760)
    a0 = np.float32([[s0, 0, W / 2 - c0[0] * s0], [0, s0, H / 2 - c0[1] * s0]])
    q0 = cv2.transform(SCREEN[None], a0)[0]
    q1 = np.float32([[0, 0], [W, 0], [W, H], [0, H]])

    n = int(DUR * FPS)
    import os
    only = [int(float(x) * FPS) for x in os.environ.get('SAMPLE', '').split(',') if x]
    for i in (only or range(n)):
        t = i / FPS
        # --- A: the headset -------------------------------------------------------------
        if t < 7.6:
            sc = (560 / quest.shape[0]) * (1 + 0.12 * eio(seg(t, 0, 7.6)))
            fa = soft_stage(quest, sc, quest.shape[1] / 2, quest.shape[0] / 2 + 6 * np.sin(t * 0.9))
            frame = fa
        # --- B: dive into the left lens ------------------------------------------------
        if 6.8 <= t < 11.4:
            cover = max(W / lenses.shape[1], H / lenses.shape[0])
            z = 1 + 7 * eio(seg(t, 7.4, 10.9)) ** 1.6
            cx = lenses.shape[1] / 2 + (LENS[0] - lenses.shape[1] / 2) * eio(seg(t, 7.0, 9.5))
            cy = lenses.shape[0] / 2 + (LENS[1] - lenses.shape[0] / 2) * eio(seg(t, 7.0, 9.5))
            fb = place(lenses, cover * z, cx, cy, black)
            fb = fade(fb, np.full_like(fb, 255), seg(t, 10.2, 11.0) ** 2)
            frame = fade(fa, fb, seg(t, 6.8, 7.6)) if t < 7.6 else fb
        # --- C: the street, the AI sees the car ----------------------------------------
        if 11.0 <= t < 24.2:
            cover = max(W / street.shape[1], H / street.shape[0])
            z = 1 + 0.07 * eio(seg(t, 11, 24))
            fc = place(street, cover * z, 860, 470, black)
            to_frame = lambda p: np.stack([(p[:, 0] - 860) * cover * z + W / 2, (p[:, 1] - 470) * cover * z + H / 2], 1)
            # Scan: the car turns into its edges, bottom to top.
            sweep = seg(t, 20.6, 22.8)
            if sweep > 0:
                ytop = y + bh + 60 - (bh + 120) * sweep
                e = edges.copy()
                e[: int(max(0, ytop))] = 0
                ef = cv2.warpAffine(cv2.cvtColor(e, cv2.COLOR_GRAY2BGR), np.float32([[cover * z, 0, W / 2 - 860 * cover * z], [0, cover * z, H / 2 - 470 * cover * z]]), (W, H))
                ef = (ef > 0).astype(np.uint8) * np.array(CYAN, np.uint8)
                fc = cv2.add(fc, cv2.GaussianBlur(ef, (0, 0), 2))
                fc = cv2.add(fc, ef)
                if 0 < sweep < 1:
                    pts = to_frame(np.array([[x - 40, ytop], [x + bw + 40, ytop]], np.float32))
                    fc = glow_line(fc, pts, CYAN, 3)
            # Laser from the right hand.
            lon = seg(t, 15.6, 16.2) * (1 - seg(t, 21.2, 21.8))
            if lon > 0:
                hp = to_frame(np.array([hit], np.float32))[0]
                start = np.array([W * 0.92, H * 1.05])
                end = start + (hp - start) * eout(seg(t, 15.6, 16.4))
                over = fc.copy()
                over = glow_line(over, np.array([start, end]), CYAN, 3)
                if t > 16.4:
                    cv2.circle(over, tuple(hp.astype(int)), 10, (255, 255, 255), -1, cv2.LINE_AA)
                fc = cv2.addWeighted(fc, 1 - lon, over, lon, 0)
            # Outline traced, then held.
            tr = eout(seg(t, 16.6, 18.4))
            oo = seg(t, 16.6, 16.9) * (1 - seg(t, 23.0, 23.8))
            if tr > 0 and oo > 0:
                k = max(2, int(len(outline) * tr))
                over = glow_line(fc.copy(), to_frame(outline[:k]), CYAN, 4, closed=tr >= 1)
                fc = cv2.addWeighted(fc, 1 - oo, over, oo, 0)
            la = seg(t, 18.3, 18.9) * (1 - seg(t, 23.0, 23.6))
            if la > 0:
                p = to_frame(np.array([[x + bw * 0.42, y - 30]], np.float32))[0]
                fc = text(fc, "car  ·  AI perception", (int(p[0]), int(p[1] - 14 * eout(seg(t, 18.3, 18.9)))), 38, (182, 160, 255), box=(182, 160, 255), anchor="ms", alpha=la)
            irisr = eout(seg(t, 11.0, 12.6)) * 1.3 * np.hypot(W, H) / 2
            if t < 12.6:
                m = np.zeros((H, W), np.uint8)
                cv2.circle(m, (W // 2, H // 2), int(irisr), 255, -1, cv2.LINE_AA)
                m = cv2.GaussianBlur(m, (0, 0), 30)[..., None] / 255.0
                fc = (fc * m + np.full_like(fc, 255) * (1 - m) * (1 - seg(t, 11.0, 11.8)) + 0).astype(np.uint8)
            frame = fc
        # --- D: the four views, validated, then fused -------------------------------------
        if 23.4 <= t < 30.8:
            fd = bg_dark.copy()
            for gy in range(0, H, 60):  # holo floor grid
                cv2.line(fd, (0, gy), (W, gy), (60, 45, 20), 1)
            cw, ch = 640, 372
            fuse = eio(seg(t, 28.2, 29.6))
            for k, card in enumerate(cards):
                r, cc = divmod(k, 2)
                appear = eout(seg(t, 23.8 + 0.35 * k, 24.8 + 0.35 * k))
                if appear <= 0:
                    continue
                gx = W / 2 + (cc - 0.5) * (cw + 60)
                gy2 = H / 2 + (r - 0.5) * (ch + 70) + 20
                gx = gx + (W / 2 - gx) * fuse
                gy2 = gy2 + (H / 2 - gy2) * fuse
                scl = (0.85 + 0.15 * appear) * (1 - 0.75 * fuse)
                cimg = cv2.resize(card, (int(cw * scl), int(ch * scl)), interpolation=cv2.INTER_AREA)
                hh, ww = cimg.shape[:2]
                x0, y0 = int(gx - ww / 2), int(gy2 - hh / 2)
                if x0 < 0 or y0 < 0 or x0 + ww > W or y0 + hh > H:
                    continue
                region = fd[y0 : y0 + hh, x0 : x0 + ww]
                fd[y0 : y0 + hh, x0 : x0 + ww] = cv2.addWeighted(region, 1 - appear, cimg, appear, 0)
                rect = np.array([[x0, y0], [x0 + ww, y0], [x0 + ww, y0 + hh], [x0, y0 + hh]], np.float32)
                fd = glow_line(fd, rect, CYAN, 2, closed=True)
                if fuse < 0.3:
                    ok = seg(t, 26.0 + 0.3 * k, 26.4 + 0.3 * k)
                    lab = names[k] + ("   ✓ validated" if ok > 0 else "")
                    fd = text(fd, lab, (x0 + 18, y0 + 44), 26, (77, 216, 232) if ok <= 0 else (83, 214, 160), alpha=appear * (1 - fuse / 0.3))
            fd = text(fd, "2D views  ·  AI drawn, human validated", (W // 2, 70), 34, (238, 243, 250), anchor="ms", alpha=seg(t, 24.0, 24.8) * (1 - fuse))
            core = fuse * (1 - seg(t, 29.9, 30.6))
            if core > 0:
                glow = np.zeros_like(fd)
                cv2.circle(glow, (W // 2, H // 2), int(60 + 500 * seg(t, 29.2, 30.4)), (255, 255, 255), -1)
                fd = cv2.add(fd, (cv2.GaussianBlur(glow, (0, 0), 60) * core).astype(np.uint8))
            fd = fade(fd, np.full_like(fd, 255), seg(t, 29.8, 30.5) ** 2)
            frame = fade(frame, fd, seg(t, 23.4, 24.2)) if t < 24.2 else fd
        # --- E: the closed laptop (no logo) ------------------------------------------------
        if 30.4 <= t < 34.4:
            sc = (1150 / closed.shape[1]) * (1 + 0.06 * eio(seg(t, 30.4, 34.4)))
            fe = soft_stage(closed, sc, closed.shape[1] / 2, closed.shape[0] / 2)
            fe = fade(np.full_like(fe, 255), fe, eout(seg(t, 30.4, 31.2)))
            frame = fe
        # --- F: open on the app, fly into the screen ------------------------------------------
        if t >= 33.6:
            fly = eio(seg(t, 34.6, 37.4))
            q = q0 + (q1 - q0) * fly
            hm = cv2.getPerspectiveTransform(SCREEN, q)
            ff = cv2.warpPerspective(opened_app, hm, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
            if fly >= 0.999:
                ff = cv2.resize(screen, (W, H), interpolation=cv2.INTER_AREA)
            ta = seg(t, 34.0, 34.7) * (1 - seg(t, 36.2, 36.9))
            if ta > 0:
                ff = text(ff, "Mitsinjo Grid VR", (W // 2, 150), 92, (255, 255, 255), anchor="ms", alpha=ta)
                ff = text(ff, "SOLAR VILLAGE TWIN  ·  WEBXR", (W // 2, 205), 26, (200, 210, 225), anchor="ms", alpha=ta)
            frame = fade(frame, ff, seg(t, 33.6, 34.4)) if t < 34.4 else ff
        cv2.imwrite(str(out / f"{i:05d}.png"), frame, [cv2.IMWRITE_PNG_COMPRESSION, 1])
    print(out, n, "frames")


if __name__ == "__main__":
    main()
