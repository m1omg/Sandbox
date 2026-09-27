# Repaint a generated model's texture from a character sheet: the front view is projected onto
# texels facing forward and the back view onto texels facing backward (each only where visible
# from that side). The rest of the texture keeps its own detail but is colour-matched to the
# projected parts. Useful when a cheap mesh generator gets the shape right but the colours or
# the face wrong.
#
#   python3 paint.py <in.glb> <front.png> <back.png> <out.glb>
import os, sys, io
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbio import GLB, compact
from autorig import vertex_normals

def raster(tri2d, attrs, H, W, depth=None):
    """Rasterise triangles (T,3,2 pixel coords), interpolating attrs (list of (T,3,C)).
    With depth (T,3), keep the smallest value per pixel."""
    outs = [np.zeros((H, W, a.shape[2])) for a in attrs]
    cover = np.zeros((H, W), bool); zbuf = np.full((H, W), np.inf)
    for t in range(len(tri2d)):
        a, b, c = tri2d[t]
        x0 = max(int(np.floor(min(a[0], b[0], c[0]))), 0); x1 = min(int(np.ceil(max(a[0], b[0], c[0]))), W - 1)
        y0 = max(int(np.floor(min(a[1], b[1], c[1]))), 0); y1 = min(int(np.ceil(max(a[1], b[1], c[1]))), H - 1)
        if x1 < x0 or y1 < y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12: continue
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
        if not inside.any(): continue
        yy, xx = np.nonzero(inside); yy += y0; xx += x0
        W0, W1, W2 = w0[inside], w1[inside], w2[inside]
        if depth is not None:
            z = W0 * depth[t, 0] + W1 * depth[t, 1] + W2 * depth[t, 2]
            k = z < zbuf[yy, xx]; yy, xx, W0, W1, W2, z = yy[k], xx[k], W0[k], W1[k], W2[k], z[k]
            zbuf[yy, xx] = z
        for o, at in zip(outs, attrs):
            o[yy, xx] = W0[:, None] * at[t, 0] + W1[:, None] * at[t, 1] + W2[:, None] * at[t, 2]
        cover[yy, xx] = True
    return outs, cover, zbuf

def figure(path):
    """Concept view as RGB array plus the figure mask (background = white connected to the border)."""
    im = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    white = im.min(axis=2) > 235
    H, W = white.shape
    bg = np.zeros_like(white); stack = [(0, 0), (0, W - 1), (H - 1, 0), (H - 1, W - 1)]
    while stack:
        y, x = stack.pop()
        if 0 <= y < H and 0 <= x < W and white[y, x] and not bg[y, x]:
            bg[y, x] = True; stack += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
    return im, ~bg

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def main(src, front_png, back_png, out):
    g = GLB(src)
    prim = next(p for m in g.js['meshes'] for p in m['primitives'])
    P = g.acc(prim['attributes']['POSITION']).astype(np.float64)
    UV = g.acc(prim['attributes']['TEXCOORD_0']).astype(np.float64)
    I = g.acc(prim['indices']).reshape(-1, 3).astype(np.int64)
    N = vertex_normals(P, I)
    P = P - P.min(axis=0); P /= P[:, 1].max()  # height 1, feet at 0
    mat = g.js['materials'][prim.get('material', 0)]
    img_i = g.js['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
    tex = np.asarray(Image.open(io.BytesIO(g.image_bytes(img_i))).convert('RGB')).astype(np.float64)
    TH, TW = tex.shape[:2]
    (pos, nrm), tmask, _ = raster(np.stack([UV[:, 0] * TW, UV[:, 1] * TH], 1)[I], [P[I], N[I]], TH, TW)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=2, keepdims=True), 1e-9)
    p = pos[tmask]; n = nrm[tmask]
    S = 900  # view raster size (pixels per unit height)
    acc = np.zeros((len(p), 3)); wsum = np.zeros(len(p))
    for view, png, sgn in (('front', front_png, 1), ('back', back_png, -1)):
        cim, cmask = figure(png)
        # orthographic view: screen x = sgn * X, screen y = -Y, depth = -sgn * Z (smaller = nearer)
        xs = sgn * P[:, 0]; x0 = xs.min()
        scr = np.stack([(xs - x0) * S + 2, (1 - P[:, 1]) * S + 2], 1)
        Wd = int((xs.max() - x0) * S) + 4; Hd = S + 4
        _, cover, zb = raster(scr[I], [], Hd, Wd, depth=(-sgn * P[:, 2])[I])
        ys_, xs_ = np.nonzero(cover); mb = [xs_.min(), xs_.max(), ys_.min(), ys_.max()]
        cy, cx = np.nonzero(cmask); cb = [cx.min(), cx.max(), cy.min(), cy.max()]
        s = np.stack([(sgn * p[:, 0] - x0) * S + 2, (1 - p[:, 1]) * S + 2], 1)
        sx = np.clip(s[:, 0].astype(int), 0, Wd - 1); sy = np.clip(s[:, 1].astype(int), 0, Hd - 1)
        visible = (-sgn * p[:, 2]) <= zb[sy, sx] + 0.01
        u = (s[:, 0] - mb[0]) / (mb[1] - mb[0]); v = (s[:, 1] - mb[2]) / (mb[3] - mb[2])
        ix = np.clip((cb[0] + u * (cb[1] - cb[0])).astype(int), 0, cim.shape[1] - 1)
        iy = np.clip((cb[2] + v * (cb[3] - cb[2])).astype(int), 0, cim.shape[0] - 1)
        w = smooth(0.2, 0.55, sgn * n[:, 2]) * visible * cmask[iy, ix]
        acc += w[:, None] * cim[iy, ix]; wsum += w
        print(view, 'texels painted', int((w > 0.5).sum()))
    proj = acc / np.maximum(wsum, 1e-9)[:, None]; w = np.clip(wsum, 0, 1)
    # colour-match the generator's own texture to the painted colours, per channel
    cur = tex[tmask]; sure = w > 0.9
    for c in range(3):
        A = np.stack([cur[sure, c], np.ones(sure.sum())], 1)
        a, b = np.linalg.lstsq(A, proj[sure, c], rcond=None)[0]
        cur[:, c] = np.clip(a * cur[:, c] + b, 0, 255)
        print('channel', c, 'gain', round(a, 2), 'offset', round(b, 1))
    out_tex = tex.copy(); out_tex[tmask] = cur * (1 - w[:, None]) + proj * w[:, None]
    # bleed into the padding around UV islands
    done = tmask.copy()
    for _ in range(6):
        grow = np.zeros_like(done); src_ = np.zeros_like(out_tex)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(np.roll(done, dy, 0), dx, 1); take = sh & ~done & ~grow
            src_[take] = np.roll(np.roll(out_tex, dy, 0), dx, 1)[take]; grow |= take
        out_tex[grow] = src_[grow]; done |= grow
    buf = io.BytesIO(); Image.fromarray(out_tex.round().astype(np.uint8)).save(buf, 'JPEG', quality=92)
    g.set_image(img_i, buf.getvalue(), 'image/jpeg'); compact(g); g.save(out)
    print('wrote', out)

if __name__ == '__main__':
    main(*sys.argv[1:5])
