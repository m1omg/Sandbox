# Landmark detection for an A-pose humanoid mesh: facing +z, feet on y=0, centred on x=0.
import os, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

CELL = 0.005

def sample_surface(P, I, n=250000, seed=1):
    a, b, c = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    rng = np.random.default_rng(seed)
    tri = rng.choice(len(I), size=n, p=area / area.sum())
    u = rng.random(n); v = rng.random(n); flip = u + v > 1; u[flip] = 1 - u[flip]; v[flip] = 1 - v[flip]
    return a[tri] + (b[tri] - a[tri]) * u[:, None] + (c[tri] - a[tri]) * v[:, None]

class Silhouette:
    """Front (x-y) occupancy with per-cell depth range."""
    def __init__(self, S):
        self.S = S
        self.x0 = S[:, 0].min() - 0.02; self.y0 = 0.0
        self.W = int((S[:, 0].max() + 0.02 - self.x0) / CELL) + 1
        self.H = int((S[:, 1].max() + 0.02) / CELL) + 1
        ix = ((S[:, 0] - self.x0) / CELL).astype(int); iy = np.clip((S[:, 1] / CELL).astype(int), 0, self.H - 1)
        self.occ = np.zeros((self.H, self.W), bool); self.occ[iy, ix] = True
        self.zmin = np.full((self.H, self.W), np.inf); self.zmax = np.full((self.H, self.W), -np.inf)
        np.minimum.at(self.zmin, (iy, ix), S[:, 2]); np.maximum.at(self.zmax, (iy, ix), S[:, 2])
        # close 1-cell holes
        o = self.occ
        self.occ = o | (np.roll(o, 1, 1) & np.roll(o, -1, 1)) | (np.roll(o, 1, 0) & np.roll(o, -1, 0))
    def row(self, y): return self.occ[min(self.H - 1, max(0, int(y / CELL)))]
    def runs(self, y):
        r = self.row(y); out = []; s = None
        for i, v in enumerate(r):
            if v and s is None: s = i
            if not v and s is not None: out.append((self.xc(s), self.xc(i - 1))); s = None
        if s is not None: out.append((self.xc(s), self.xc(len(r) - 1)))
        return out
    def xc(self, i): return self.x0 + (i + 0.5) * CELL
    def zc(self, x0, x1, y, band=0.01):
        """Depth centre of the body between x0..x1 around height y."""
        m = (np.abs(self.S[:, 1] - y) < band) & (self.S[:, 0] >= x0) & (self.S[:, 0] <= x1)
        if m.sum() < 5: return 0.0
        z = self.S[m, 2]; return 0.5 * (np.percentile(z, 2) + np.percentile(z, 98))

def run_at(runs, x):
    for r in runs:
        if r[0] - CELL <= x <= r[1] + CELL: return r
    return None

def nearest_run(runs, x):
    return min(runs, key=lambda r: abs(0.5 * (r[0] + r[1]) - x)) if runs else None

def detect(P, I):
    S = sample_surface(P, I)
    sil = Silhouette(S)
    top = S[:, 1].max()
    L = {'top': top}
    # crotch: lowest height where the middle (x = 0) is filled, above the feet
    y = 0.08
    while y < 0.9 * top and run_at(sil.runs(y), 0.0) is None: y += CELL
    L['crotch'] = y
    # legs: track each leg's run upward from the ankles
    legs = {}
    for side, sgn in (('L', 1), ('R', -1)):
        rs = sil.runs(0.12)
        cands = [r for r in rs if sgn * (r[0] + r[1]) > 0]
        r = min(cands, key=lambda r: abs(r[0] + r[1]))  # innermost run on that side
        cx = 0.5 * (r[0] + r[1]); pts = []
        yy = 0.03
        while yy < L['crotch'] - 0.01:
            rr = nearest_run([q for q in sil.runs(yy) if sgn * (q[0] + q[1]) > 0 or run_at([q], 0) is None], cx)
            if rr is None: break
            # guard against jumping to a hand: keep the run nearest the previous centre
            ncx = 0.5 * (rr[0] + rr[1])
            if abs(ncx - cx) > 0.06 and yy > 0.2: pass
            else: cx = ncx
            pts.append((yy, cx, rr[0], rr[1]))
            yy += CELL
        legs[side] = np.array(pts)
    L['legs'] = legs
    # arms: find each armpit (the highest row where the arm is separate from the body), then
    # trace the arm down to the finger tips, always following the blob that continues it
    # (a spray can on the belt is a separate blob between arm and body)
    arms = {}
    for side, sgn in (('L', 1), ('R', -1)):
        def outer_runs(yy):
            rs = sil.runs(yy); mid = run_at(rs, 0.0)
            if mid is not None:
                return [q for q in rs if (sgn > 0 and q[0] > mid[1]) or (sgn < 0 and q[1] < mid[0])], mid
            return [q for q in rs if sgn * (q[0] + q[1]) > 0], None
        armpit = None
        yy = L['crotch'] + 0.02
        while yy < 0.9 * top:
            outer, mid = outer_runs(yy)
            if mid is not None and outer:
                armpit = (yy, mid[1] if sgn > 0 else mid[0])
            elif armpit is not None and yy - armpit[0] > 0.03:
                break
            yy += CELL
        pts = []; cx = None; yy = armpit[0]; last = armpit[0]
        leg = legs[side]
        while yy > 0.02 and last - yy < 0.05:  # tolerate short stretches where the arm touches the body
            outer, mid = outer_runs(yy)
            if mid is None and len(leg) and yy <= leg[-1, 0]:  # below the crotch: skip the leg
                legx = np.interp(yy, leg[:, 0], leg[:, 1])
                outer = [q for q in outer if abs(0.5 * (q[0] + q[1]) - legx) > 0.03]
            q = None
            if outer and cx is None:  # at the armpit: the run next to the body
                q = min(outer, key=lambda q: abs(q[0] - armpit[1]) if sgn > 0 else abs(q[1] - armpit[1]))
            elif outer:
                q = nearest_run(outer, cx)
                if abs(0.5 * (q[0] + q[1]) - cx) > 0.06: q = None
            if q is not None:
                cx = 0.5 * (q[0] + q[1]); last = yy
                pts.append((yy, cx, q[0], q[1], np.nan))
            yy -= CELL
        arms[side] = {'pts': np.array(sorted(pts)), 'armpit': armpit}
    L['arms'] = arms
    # neck: narrowest middle run between the armpits and the top of the head
    ap = max(arms['L']['armpit'][0], arms['R']['armpit'][0])
    best = None
    yy = ap + 0.03
    while yy < top - 0.15:
        mid = run_at(sil.runs(yy), 0.0)
        if mid is not None:
            w = mid[1] - mid[0]
            if best is None or w < best[1]: best = (yy, w)
        yy += CELL
    L['neck'] = best
    L['sil'] = sil; L['S'] = S
    return L

if __name__ == '__main__':
    from glbio import GLB
    g = GLB(sys.argv[1]); pr = g.js['meshes'][0]['primitives'][0]
    P = g.acc(pr['attributes']['POSITION']).astype(float); I = g.acc(pr['indices']).reshape(-1, 3)
    L = detect(P, I)
    print('top', round(L['top'], 3), 'crotch', round(L['crotch'], 3), 'neck', L['neck'])
    for s in 'LR':
        a = L['arms'][s]; print(s, 'armpit', a['armpit'], 'arm pts', len(a['pts']), 'tip', a['pts'][0][:2] if len(a['pts']) else None,
              'leg rows', len(L['legs'][s]), 'leg@0.15', np.round(np.interp(0.15, L['legs'][s][:, 0], L['legs'][s][:, 1]), 3))
