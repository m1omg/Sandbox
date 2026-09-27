# Derive the 24 joint positions of the Meshy humanoid skeleton from mesh landmarks.
# Rules are relative to landmarks and calibrated on a reference character (Remy).
import os, sys, json, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import landmarks
from landmarks import CELL

def leg_profile(L, side):
    """Per-row leg centre x, depth centre z and depth extent (shoe detection)."""
    S = L['S']; out = []
    for y, cx, x0, x1 in L['legs'][side]:
        m = (np.abs(S[:, 1] - y) < CELL) & (S[:, 0] >= x0 - CELL) & (S[:, 0] <= x1 + CELL)
        if m.sum() < 5: continue
        z = S[m, 2]
        out.append((y, cx, 0.5 * (np.percentile(z, 2) + np.percentile(z, 98)), np.percentile(z, 98) - np.percentile(z, 2), z.min(), z.max()))
    return np.array(out)

def feats(L):
    """Scalar features used by the rules."""
    F = {'top': L['top'], 'C': L['crotch'], 'N': L['neck'][0]}
    for s in 'LR':
        lp = leg_profile(L, s)
        # shoe top: highest row (below knee height) whose depth is much larger than the shin's
        shin = np.median(lp[(lp[:, 0] > 0.3 * F['C']) & (lp[:, 0] < 0.6 * F['C']), 3])
        low = lp[lp[:, 0] < 0.45 * F['C']]
        big = low[low[:, 3] > 1.45 * shin]
        F['shoe' + s] = big[:, 0].max() if len(big) else 0.12
        feet = lp[lp[:, 0] < 0.06]
        F['toe' + s] = feet[:, 5].max(); F['heel' + s] = feet[:, 4].min()
        F['lp' + s] = lp
        a = L['arms'][s]; F['armpit' + s] = a['armpit']
        pts = a['pts']
        F['armpts' + s] = pts[pts[:, 0] <= a['armpit'][0] + 1e-9]
    return F

def zc(L, x0, x1, y, band=0.012):
    return L['sil'].zc(x0, x1, y, band)

def torso_z(L, y):
    rs = L['sil'].runs(y); mid = landmarks.run_at(rs, 0.0)
    if mid is None: mid = (-0.1, 0.1)
    w = mid[1] - mid[0]
    return zc(L, -0.25 * w, 0.25 * w, y)

def arm_polyline(F, s, shoulder):
    pts = F['armpts' + s]            # rows sorted by y ascending: tip ... armpit
    cl = [(p[1], p[0]) for p in pts[::-1]]  # armpit -> tip, (x, y)
    poly = [shoulder[:2]] + [np.array(c) for c in cl]
    return [np.array(p, float) for p in poly]

def along(poly, d):
    for a, b in zip(poly[:-1], poly[1:]):
        l = np.linalg.norm(b - a)
        if d <= l: return a + (b - a) * (d / max(l, 1e-9))
        d -= l
    return poly[-1]

def plen(poly): return sum(np.linalg.norm(b - a) for a, b in zip(poly[:-1], poly[1:]))

RULE_KEYS = ['hips', 'sp02', 'sp01', 'sp', 'neck', 'head', 'upleg_y', 'upleg_x', 'knee', 'ankle', 'toe_y', 'toe_z',
             'sh_y', 'sh_x', 'clav_x', 'elbow', 'wrist']

def calibrate(L, J):
    F = feats(L); C, N = F['C'], F['N']; span = N - C; K = {}
    K['hips'] = (J['Hips'][1] - C) / span
    K['sp02'] = (J['Spine02'][1] - C) / span; K['sp01'] = (J['Spine01'][1] - C) / span; K['sp'] = (J['Spine'][1] - C) / span
    K['neck'] = (J['neck'][1] - C) / span; K['head'] = (J['Head'][1] - N) / (F['top'] - N)
    vals = {k: [] for k in ['upleg_y', 'upleg_x', 'knee', 'ankle', 'ankleC', 'toe_y', 'toe_z', 'sh_y', 'sh_x', 'clav_x', 'elbow', 'wrist']}
    for s, P in (('L', 'Left'), ('R', 'Right')):
        up, kn, an, to = J[P + 'UpLeg'], J[P + 'Leg'], J[P + 'Foot'], J[P + 'ToeBase']
        vals['upleg_y'].append((up[1] - C) / span)
        legx = np.interp(C - 0.05, F['lp' + s][:, 0], F['lp' + s][:, 1])
        vals['upleg_x'].append(up[0] / legx)
        vals['knee'].append((kn[1] - an[1]) / (up[1] - an[1]))
        vals['ankle'].append(an[1] / F['shoe' + s]); vals['ankleC'].append(an[1] / C)
        vals['toe_y'].append(to[1] / an[1])
        vals['toe_z'].append((to[2] - F['heel' + s]) / (F['toe' + s] - F['heel' + s]))
        ay, ax = F['armpit' + s]
        sh = J[P + 'Arm']
        vals['sh_y'].append((sh[1] - ay) / (N - ay)); vals['sh_x'].append(sh[0] / ax)
        vals['clav_x'].append(J[P + 'Shoulder'][0] / sh[0])
        poly = arm_polyline(F, s, sh); Lp = plen(poly)
        el, wr = J[P + 'ForeArm'], J[P + 'Hand']
        vals['elbow'].append(np.linalg.norm(el[:2] - sh[:2]) / Lp)
        vals['wrist'].append((np.linalg.norm(el[:2] - sh[:2]) + np.linalg.norm(wr[:2] - el[:2])) / Lp)
    for k, v in vals.items(): K[k] = float(np.mean(v))
    return K

def derive(L, K):
    F = feats(L); C, N, top = F['C'], F['N'], F['top']; span = N - C; J = {}
    zp = torso_z(L, C + 0.04)
    # neck centre from its front surface: hair hanging behind the neck must not pull it back
    S = L['S']; nw = L['neck'][1]
    m = (np.abs(S[:, 1] - N) < 0.012) & (np.abs(S[:, 0]) < 0.25 * nw)
    zn = (np.percentile(S[m, 2], 98) - 0.5 * nw) if m.sum() > 10 else torso_z(L, N)
    hipy = C + K['hips'] * span; necky = C + K['neck'] * span
    def spz(y): return float(np.interp(y, [hipy, necky], [zp, zn], left=zp, right=zn))
    def spine(k): y = C + K[k] * span; return np.array([0.0, y, spz(y)])
    J['Hips'] = spine('hips'); J['Spine02'] = spine('sp02'); J['Spine01'] = spine('sp01'); J['Spine'] = spine('sp')
    J['neck'] = spine('neck')
    hy = N + K['head'] * (top - N); J['Head'] = np.array([0.0, hy, zn])
    # head_end at the top of the head, headfront in front of the face
    # head_end straight above the head joint: hair (a ponytail, buns) must not tilt the head
    J['head_end'] = np.array([0.0, top, zn])
    face = S[(np.abs(S[:, 1] - hy - 0.04) < 0.02) & (np.abs(S[:, 0]) < 0.04)]
    J['headfront'] = np.array([0.0, hy, face[:, 2].max() if len(face) else J['Head'][2] + 0.14])
    for s, P, sg in (('L', 'Left', 1), ('R', 'Right', -1)):
        lp = F['lp' + s]
        def legpt(y):
            x = np.interp(y, lp[:, 0], lp[:, 1]); z = np.interp(y, lp[:, 0], lp[:, 2]); return np.array([x, y, z])
        uy = C + K['upleg_y'] * span
        legx = np.interp(C - 0.05, lp[:, 0], lp[:, 1])
        J[P + 'UpLeg'] = np.array([legx * K['upleg_x'], uy, zp])
        ay = K['ankleC'] * C  # shoe-top detection is unreliable on chunky high-tops
        an = legpt(ay + 0.03); an[1] = ay
        J[P + 'Foot'] = an
        ky = ay + K['knee'] * (uy - ay); J[P + 'Leg'] = legpt(ky)
        footx = float(np.mean(lp[lp[:, 0] < 0.05, 1]))
        J[P + 'ToeBase'] = np.array([footx, K['toe_y'] * ay, F['heel' + s] + K['toe_z'] * (F['toe' + s] - F['heel' + s])])
        apy, apx = F['armpit' + s]
        shy = apy + K['sh_y'] * (N - apy); shx = apx * K['sh_x']
        sh = np.array([shx, shy, spz(shy)]); J[P + 'Arm'] = sh
        J[P + 'Shoulder'] = np.array([shx * K['clav_x'], shy, sh[2]])
        poly = arm_polyline(F, s, sh); Lp = plen(poly)
        pts = F['armpts' + s]
        def armz(y, x):
            row = pts[np.argmin(np.abs(pts[:, 0] - y))]
            return zc(L, row[2], row[3], row[0])
        e = along(poly, K['elbow'] * Lp); w = along(poly, K['wrist'] * Lp)
        J[P + 'ForeArm'] = np.array([e[0], e[1], armz(e[1], e[0]) if e[1] <= apy else sh[2]])
        J[P + 'Hand'] = np.array([w[0], w[1], armz(w[1], w[0])])
        J[P + 'HandTip'] = np.array([poly[-1][0], poly[-1][1], armz(poly[-1][1], poly[-1][0])])
        J[P + 'ToeTip'] = np.array([footx, 0.03, F['toe' + s]])
    return J

def load_mesh(path):
    from glbio import GLB
    g = GLB(path); pr = g.js['meshes'][0]['primitives'][0]
    return g.acc(pr['attributes']['POSITION']).astype(float), g.acc(pr['indices']).reshape(-1, 3)

MODELS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models')
# Meshy-rigged characters used to calibrate the joint rules (Remy is closest to the new runners)
REFS = [(os.path.join(MODELS, 'remy.glb'), 0.5), (os.path.join(MODELS, 'kit.glb'), 0.25), (os.path.join(MODELS, 'warden.glb'), 0.25)]

def calibrate_multi():
    from rigref import RefRig
    Ks = []
    for path, w in REFS:
        P, I = load_mesh(path); Ks.append((calibrate(landmarks.detect(P, I), RefRig(path).P), w))
    return {k: float(sum(K[k] * w for K, w in Ks)) for k in Ks[0][0]}

if __name__ == '__main__':
    from rigref import RefRig
    K = calibrate_multi()
    print({k: round(v, 3) for k, v in K.items()})
    json.dump(K, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rig_calib.json'), 'w'), indent=1)
    for path, _ in REFS:
        P, I = load_mesh(path); L = landmarks.detect(P, I); J = derive(L, K); R = RefRig(path).P
        errs = {n: np.linalg.norm(J[n] - R[n]) * 100 for n in R}
        print(path.split('/')[-1], 'mean err cm', round(np.mean(list(errs.values())), 1), 'worst', sorted(((round(v, 1), n) for n, v in errs.items()), reverse=True)[:6])
