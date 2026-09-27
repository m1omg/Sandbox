# Paint the concept art's backpack onto the generated model's texture.
# Rasterises the mesh in UV space to get a 3D point + normal per texel, finds texels that face
# backwards and are visible from behind, and copies colours from the back view of the concept
# sheet, aligned by the backpack's bounding box in both images.
import os, sys, io
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbio import GLB

src, concept_back, out_glb = sys.argv[1], sys.argv[2], sys.argv[3]
debug = len(sys.argv) > 4
g = GLB(src)
prim = next(p for m in g.js['meshes'] for p in m['primitives'])
P = g.acc(prim['attributes']['POSITION']).astype(np.float64)
N = g.acc(prim['attributes']['NORMAL']).astype(np.float64)
UV = g.acc(prim['attributes']['TEXCOORD_0']).astype(np.float64)
I = g.acc(prim['indices']).reshape(-1, 3)
mat = g.js['materials'][prim.get('material', 0)]
img_index = g.js['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
tex = np.asarray(Image.open(io.BytesIO(g.image_bytes(img_index))).convert('RGB')).astype(np.float64)
TH, TW = tex.shape[:2]
print('verts', len(P), 'tris', len(I), 'tex', TW, TH, 'bounds', P.min(0).round(3), P.max(0).round(3))

def raster(tri2d, attrs, H, W, depth=None):
    """Rasterise triangles (T,3,2 pixel coords). attrs: list of (T,3,C) arrays interpolated.
    If depth (T,3) is given, keep the nearest (smallest) sample per pixel."""
    outs = [np.zeros((H, W, a.shape[2])) for a in attrs]
    cover = np.zeros((H, W), bool)
    zbuf = np.full((H, W), np.inf)
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
        yy, xx = np.nonzero(inside)
        yy += y0; xx += x0
        W0, W1, W2 = w0[inside], w1[inside], w2[inside]
        if depth is not None:
            z = W0 * depth[t, 0] + W1 * depth[t, 1] + W2 * depth[t, 2]
            closer = z < zbuf[yy, xx]
            yy, xx, W0, W1, W2, z = yy[closer], xx[closer], W0[closer], W1[closer], W2[closer], z[closer]
            zbuf[yy, xx] = z
        for o, at in zip(outs, attrs):
            o[yy, xx] = W0[:, None] * at[t, 0] + W1[:, None] * at[t, 1] + W2[:, None] * at[t, 2]
        cover[yy, xx] = True
    return outs, cover, zbuf

# ---- per-texel position/normal (UV space; glTF v=0 is the top row) ----
uvpix = np.stack([UV[:, 0] * TW, UV[:, 1] * TH], 1)
(pos_map, nrm_map), tmask, _ = raster(uvpix[I], [P[I], N[I]], TH, TW)
nrm_map /= np.maximum(np.linalg.norm(nrm_map, axis=2, keepdims=True), 1e-9)
print('texels covered', tmask.sum())

# ---- back view (camera behind the character looking toward +z): screen x = -X, screen y = -Y ----
PX = 600  # pixels per metre
x_min, x_max = -P[:, 0].max(), -P[:, 0].min()
BW = int((x_max - x_min) * PX) + 4; BH = int((P[:, 1].max() - P[:, 1].min()) * PX) + 4
ytop = P[:, 1].max()
def to_back(p):
    return np.stack([(-p[..., 0] - x_min) * PX + 2, (ytop - p[..., 1]) * PX + 2], -1)
scr = to_back(P)
(uv_back,), bcover, zbuf = raster(scr[I], [UV[I]], BH, BW, depth=P[I][:, :, 2])
# colour of the model seen from behind (nearest texel lookup)
tx = np.clip((uv_back[..., 0] * TW).astype(int), 0, TW - 1); ty = np.clip((uv_back[..., 1] * TH).astype(int), 0, TH - 1)
back_rgb = np.where(bcover[..., None], tex[ty, tx], 255)
if debug: Image.fromarray(back_rgb.astype(np.uint8)).save('dbg_model_back.png')

def orange(rgb):
    r, g_, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return (r > 195) & (g_ > 70) & (g_ < 150) & (b < 90) & (r - b > 140)

def largest_component(mask):
    from collections import deque
    H, W = mask.shape
    lab = np.zeros(mask.shape, np.int32); best, best_n, cur = 0, 0, 0
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0]: continue
        cur += 1; n = 0; q = deque([(y0, x0)]); lab[y0, x0] = cur
        while q:
            y, x = q.popleft(); n += 1
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = cur; q.append((yy, xx))
        if n > best_n: best, best_n = cur, n
    return lab == best

# backpack region on the model: orange pixels in the torso area of the back render
ys, xs = np.nonzero(bcover)
yy, xx = np.mgrid[0:BH, 0:BW]
Yw = ytop - (yy - 2) / PX; Xw = -((xx - 2) / PX + x_min)
torso = (Yw > 0.75) & (Yw < 1.3) & (np.abs(Xw) < 0.25)
mo = largest_component(orange(back_rgb) & bcover & torso)
my, mx = np.nonzero(mo)
mb = [mx.min(), mx.max(), my.min(), my.max()]
print('model backpack bbox px', mb, 'size m', ((mb[1] - mb[0]) / PX, (mb[3] - mb[2]) / PX))

# backpack region in the concept back view
cb = np.asarray(Image.open(concept_back).convert('RGB')).astype(np.float64)
small = np.asarray(Image.open(concept_back).convert('RGB').resize((cb.shape[1] // 3, cb.shape[0] // 3))).astype(np.float64)
cos = largest_component(orange(small))
# fill holes (the white splat, the zipper) so they count as part of the backpack
outside = largest_component(~cos)
cos = ~outside
co = np.asarray(Image.fromarray(cos.astype(np.uint8) * 255).resize((cb.shape[1], cb.shape[0]))) > 127
cH, cW = co.shape
cy, cx = np.nonzero(co)
cbb = [cx.min(), cx.max(), cy.min(), cy.max()]
print('concept backpack bbox px', cbb)

# colour transfer: match the concept's orange to the model's orange
m_or = back_rgb[mo].mean(0); c_or = cb[co].mean(0)
print('orange model', m_or.round(1), 'concept', c_or.round(1))
gain = np.ones(3)  # colours already match closely; a per-channel gain tints the white splat

# ---- paint texels ----
tm = tmask.copy()
p = pos_map[tm]; n = nrm_map[tm]
s = to_back(p)
sx = np.clip(s[:, 0].astype(int), 0, BW - 1); sy = np.clip(s[:, 1].astype(int), 0, BH - 1)
visible = p[:, 2] <= zbuf[sy, sx] + 0.01
facing = -n[:, 2]
# normalised position inside the model's backpack bbox
u = (s[:, 0] - mb[0]) / (mb[1] - mb[0]); v = (s[:, 1] - mb[2]) / (mb[3] - mb[2])
inbox = (u > -0.02) & (u < 1.02) & (v > -0.02) & (v < 1.02)
cxp = cbb[0] + u * (cbb[1] - cbb[0]); cyp = cbb[2] + v * (cbb[3] - cbb[2])
cxi = np.clip(cxp.astype(int), 0, cW - 1); cyi = np.clip(cyp.astype(int), 0, cH - 1)
csample = cb[cyi, cxi]
c_bg = ~co[cyi, cxi]  # outside the concept's backpack: leave the model's texture alone
def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)
edge = np.minimum.reduce([u, 1 - u, v, 1 - v])
w = smooth(0.35, 0.7, facing) * smooth(-0.02, 0.06, edge) * visible * inbox * (~c_bg)
new = np.clip(csample * gain, 0, 255)
cur = tex[tm]
tex2 = tex.copy()
tex2[tm] = cur * (1 - w[:, None]) + new * w[:, None]
print('painted texels', int((w > 0.01).sum()))
# bleed painted colours into the padding around UV islands so filtering doesn't pull in old colours
changed = np.zeros((TH, TW), bool); changed[tm] = w > 0.01
for _ in range(6):
    grow = np.zeros_like(changed); src = np.zeros_like(tex2)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sh = np.roll(np.roll(changed, dy, 0), dx, 1)
        take = sh & ~changed & ~tmask & ~grow
        src[take] = np.roll(np.roll(tex2, dy, 0), dx, 1)[take]
        grow |= take
    tex2[grow] = src[grow]; changed |= grow

out = Image.fromarray(tex2.round().astype(np.uint8))
buf = io.BytesIO(); out.save(buf, 'JPEG', quality=92)
g.set_image(img_index, buf.getvalue(), 'image/jpeg')
g.save(out_glb)
if debug:
    back2 = np.where(bcover[..., None], tex2[ty, tx], 255)
    Image.fromarray(back2.astype(np.uint8)).save('dbg_model_back_after.png')
print('wrote', out_glb)
