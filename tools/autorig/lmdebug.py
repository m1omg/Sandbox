import os, sys, numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbio import GLB
import landmarks
def draw(L, joints=None, ref=None, out='lm.png', scale=2):
    sil = L['sil']
    img = Image.fromarray(((~sil.occ[::-1]) * 200 + 40).astype(np.uint8)).convert('RGB')
    img = img.resize((sil.W * scale, sil.H * scale), Image.NEAREST); d = ImageDraw.Draw(img)
    def px(x, y): return ((x - sil.x0) / landmarks.CELL * scale, (sil.H - y / landmarks.CELL) * scale)
    def dot(x, y, c, r=3): X, Y = px(x, y); d.ellipse([X - r, Y - r, X + r, Y + r], fill=c)
    for s in 'LR':
        for p in L['arms'][s]['pts']: dot(p[1], p[0], (0, 160, 255), 1)
        for p in L['legs'][s]: dot(p[1], p[0], (0, 200, 0), 1)
        ap = L['arms'][s]['armpit']
        if ap: dot(ap[1], ap[0], (255, 0, 255), 5)
    X0, Y = px(sil.x0, L['crotch']); d.line([0, Y, img.width, Y], fill=(255, 128, 0))
    if L['neck']: X0, Y = px(0, L['neck'][0]); d.line([0, Y, img.width, Y], fill=(255, 0, 0))
    if ref:
        for n, p in ref.items(): dot(p[0], p[1], (255, 200, 0), 4)
    if joints:
        for n, p in joints.items(): dot(p[0], p[1], (255, 0, 0), 3)
    img.save(out)
if __name__ == '__main__':
    g = GLB(sys.argv[1]); pr = g.js['meshes'][0]['primitives'][0]
    P = g.acc(pr['attributes']['POSITION']).astype(float); I = g.acc(pr['indices']).reshape(-1, 3)
    L = landmarks.detect(P, I)
    ref = None
    if len(sys.argv) > 3:
        from rigref import RefRig
        r = RefRig(sys.argv[3]); ref = r.P
    draw(L, ref=ref, out=sys.argv[2])
