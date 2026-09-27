# Auto-rigger: fits the Meshy humanoid skeleton (taken from a reference rigged GLB) to an
# A-pose character mesh, computes skin weights, retargets the reference run cycle and writes
# a rigged GLB with the same bone names, so the game's pose rig works unchanged.
#
#   python3 autorig.py <in.glb> <reference-rigged.glb> <out.glb> [--height 1.6] [--debug prefix]
import os, sys, io, json, struct, argparse
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbio import GLB
from rigref import RefRig, qmul, qinv, qrot, q_between, qmat
import landmarks, joints

# which child a bone points at (for leaves: a landmark tip)
PRIMARY = {'Hips': 'Spine02', 'Spine02': 'Spine01', 'Spine01': 'Spine', 'Spine': 'neck', 'neck': 'Head', 'Head': 'head_end',
           'LeftShoulder': 'LeftArm', 'LeftArm': 'LeftForeArm', 'LeftForeArm': 'LeftHand', 'LeftHand': 'LeftHandTip',
           'RightShoulder': 'RightArm', 'RightArm': 'RightForeArm', 'RightForeArm': 'RightHand', 'RightHand': 'RightHandTip',
           'LeftUpLeg': 'LeftLeg', 'LeftLeg': 'LeftFoot', 'LeftFoot': 'LeftToeBase', 'LeftToeBase': 'LeftToeTip',
           'RightUpLeg': 'RightLeg', 'RightLeg': 'RightFoot', 'RightFoot': 'RightToeBase', 'RightToeBase': 'RightToeTip'}
NO_SKIN = {'head_end', 'headfront'}

def load_source(path, height):
    g = GLB(path)
    prim = next(p for m in g.js['meshes'] for p in m['primitives'])
    P = g.acc(prim['attributes']['POSITION']).astype(np.float64)
    N = g.acc(prim['attributes']['NORMAL']).astype(np.float64) if 'NORMAL' in prim['attributes'] else None
    UV = g.acc(prim['attributes']['TEXCOORD_0']).astype(np.float64)
    I = g.acc(prim['indices']).reshape(-1, 3).astype(np.int64)
    # apply the mesh node's own transform if it has one (rotation/scale only matter here)
    node = next(n for n in g.js['nodes'] if 'mesh' in n)
    if 'rotation' in node:
        R = qmat(np.array(node['rotation'])); P = P @ R.T; N = N @ R.T if N is not None else None
    if 'scale' in node: P = P * np.array(node['scale'])
    # feet on the floor, centred, scaled to the target height
    P[:, 1] -= P[:, 1].min(); s = height / P[:, 1].max(); P *= s
    P[:, 0] -= 0.5 * (P[:, 0].max() + P[:, 0].min()); P[:, 2] -= 0.5 * (P[:, 2].max() + P[:, 2].min())
    mat = g.js['materials'][prim.get('material', 0)]
    tex_i = mat['pbrMetallicRoughness']['baseColorTexture']['index']
    img = Image.open(io.BytesIO(g.image_bytes(g.js['textures'][tex_i]['source']))).convert('RGB')
    return P, N, UV, I, img

def vertex_normals(P, I):
    N = np.zeros_like(P)
    fn = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]])
    for k in range(3): np.add.at(N, I[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)

def weld(P, tol=1e-5):
    """Map every vertex to a representative of all vertices at the same position (UV seams)."""
    key = np.round(P / tol).astype(np.int64)
    _, rep, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return inv.reshape(-1), len(rep)

def seg_dist(X, a, b):
    ab = b - a; t = np.clip(((X - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(X - (a + t[:, None] * ab), axis=1), t

def fit_skeleton(ref, J):
    """New rest pose: same local translation directions as the reference (so its animation
    applies unchanged), bones rotated to point at the detected joints."""
    s = ref.scale; order = ref.order()
    W, q, t, D = {}, {}, {}, {}
    for nm in order:
        p = ref.pname[nm]
        c = PRIMARY.get(nm)
        if c is not None and c in J and (c in ref.P or c.endswith('Tip')):
            if c in ref.P: d_ref = ref.P[c] - ref.P[nm]
            else:  # leaf: the reference bone keeps pointing the way its parent points
                d_ref = None
            if d_ref is not None:
                D[nm] = q_between(d_ref, J[c] - J[nm])
            else:
                D[nm] = D[p]
        else:
            D[nm] = D[p] if p is not None else np.array([0, 0, 0, 1.0])
        W[nm] = qmul(D[nm], ref.W[nm])
        if p is None:
            q[nm] = W[nm]; t[nm] = J[nm] / s
        else:
            q[nm] = qmul(qinv(W[p]), W[nm]); t[nm] = qrot(qinv(W[p]), J[nm] - J[p]) / s
    return W, q, t

def bone_radii(L, J):
    sil = L['sil']
    def midw(y):
        r = landmarks.run_at(sil.runs(y), 0.0); return (r[1] - r[0]) if r else 0.3
    R = {}
    torso = 0.5 * midw(J['Spine01'][1]); R.update({k: torso for k in ('Hips', 'Spine02', 'Spine01', 'Spine')})
    R['neck'] = 0.5 * midw(L['neck'][0])
    head_rows = [midw(y) for y in np.arange(J['Head'][1], L['top'], 0.01)]
    R['Head'] = 0.5 * max(head_rows)
    for P in ('Left', 'Right'):
        s = P[0]
        lp = L['legs'][s]; kn = J[P + 'Leg'][1]
        row = lp[np.argmin(np.abs(lp[:, 0] - kn))]
        leg = 0.5 * (row[3] - row[2])
        R[P + 'UpLeg'] = leg * 1.1; R[P + 'Leg'] = leg; R[P + 'Foot'] = max(leg, 0.06); R[P + 'ToeBase'] = max(leg, 0.06)
        pts = L['arms'][s]['pts']; e = J[P + 'ForeArm']
        row = pts[np.argmin(np.abs(pts[:, 0] - e[1]))]
        d = J[P + 'Hand'] - J[P + 'Arm']; cosang = abs(d[1]) / np.linalg.norm(d[:2])
        arm = 0.5 * (row[3] - row[2]) * cosang
        R[P + 'Arm'] = arm * 1.1; R[P + 'ForeArm'] = arm; R[P + 'Hand'] = arm; R[P + 'Shoulder'] = arm * 1.2
    return R

def clean_islands(owner, e, n):
    """A bone's vertices should form one connected patch. Fragments cut off from the main
    patch (a braid lying against the back, finger tips near a thigh) take the owner of the
    surface they are attached to instead."""
    nb = [[] for _ in range(n)]
    for a, b in e: nb[a].append(b); nb[b].append(a)
    new = owner.copy()
    for b in np.unique(owner):
        seen = np.zeros(n, bool); comps = []
        for s0 in np.where(owner == b)[0]:
            if seen[s0]: continue
            comp = [s0]; seen[s0] = True; stack = [s0]
            while stack:
                u = stack.pop()
                for v in nb[u]:
                    if owner[v] == b and not seen[v]: seen[v] = True; stack.append(v); comp.append(v)
            comps.append(comp)
        comps.sort(key=len, reverse=True)
        for c in comps[1:]: new[c] = -1
    for _ in range(200):
        todo = np.where(new < 0)[0]
        if not len(todo): break
        upd = {}
        for u in todo:
            labels = [new[v] for v in nb[u] if new[v] >= 0]
            if labels: upd[u] = max(set(labels), key=labels.count)
        if not upd: break
        for u, l in upd.items(): new[u] = l
    new[new < 0] = owner[new < 0]
    return new

def skin_weights(P, I, J, L, names, R, smooth_iters=12):
    rep, nrep = weld(P)
    Pw = np.zeros((nrep, 3)); Pw[rep] = P  # representative positions
    bones = [n for n in names if n not in NO_SKIN]
    D = np.full((nrep, len(bones)), np.inf)
    for k, b in enumerate(bones):
        a = J[b]; e = J[PRIMARY[b]]
        d, _ = seg_dist(Pw, a, e)
        D[:, k] = d / R[b]
    x, y = Pw[:, 0], Pw[:, 1]
    for k, b in enumerate(bones):
        if b.startswith('Left'): D[x < -0.01, k] = np.inf
        if b.startswith('Right'): D[x > 0.01, k] = np.inf
        if b.endswith(('UpLeg', 'Leg', 'Foot', 'ToeBase')):
            D[y > J['LeftUpLeg'][1] + 0.08, k] = np.inf
        if b == 'Head': D[y < J['neck'][1], k] = np.inf
        # a bulky jacket gives the torso bones a long reach; keep them off the face
        if b in ('Hips', 'Spine02', 'Spine01', 'Spine'):
            chin = (y > J['neck'][1]) & (Pw[:, 2] > J['neck'][2] + 0.5 * L['neck'][1])
            D[(y > J['Head'][1]) | chin, k] = np.inf
    # Below the armpit the arms are separate from the body in the front view: vertices inside
    # an arm's silhouette may only follow arm bones, and everything else may not.
    for s_, P_ in (('L', 'Left'), ('R', 'Right')):
        pts = L['arms'][s_]['pts']; apy = L['arms'][s_]['armpit'][0]
        rows = np.clip(np.searchsorted(pts[:, 0], y), 0, len(pts) - 1)
        near = np.abs(pts[rows, 0] - y) < 2 * landmarks.CELL
        in_arm = near & (y < apy - 0.01) & (x >= pts[rows, 2] - landmarks.CELL) & (x <= pts[rows, 3] + landmarks.CELL)
        arm_b = [k for k, b in enumerate(bones) if b.startswith(P_) and b[len(P_):] in ('Shoulder', 'Arm', 'ForeArm', 'Hand')]
        other = [k for k in range(len(bones)) if k not in arm_b]
        D[np.ix_(in_arm, other)] = np.inf
        below = (y < apy - 0.01) & ~in_arm
        D[np.ix_(below & (np.sign(x) == (1 if s_ == 'L' else -1)), arm_b)] = np.inf
    owner = np.argmin(D, axis=1)
    # adjacency on welded vertices
    e = np.concatenate([I[:, [0, 1]], I[:, [1, 2]], I[:, [2, 0]]]); e = rep[e]
    e = e[e[:, 0] != e[:, 1]]; e = np.unique(np.sort(e, axis=1), axis=0)
    owner = clean_islands(owner, e, nrep)
    W = np.zeros((nrep, len(bones))); W[np.arange(nrep), owner] = 1.0
    deg = np.bincount(e[:, 0], minlength=nrep) + np.bincount(e[:, 1], minlength=nrep)
    for _ in range(smooth_iters):
        acc = np.zeros_like(W); np.add.at(acc, e[:, 0], W[e[:, 1]]); np.add.at(acc, e[:, 1], W[e[:, 0]])
        nb = acc / np.maximum(deg, 1)[:, None]
        W = 0.5 * W + 0.5 * np.where(deg[:, None] > 0, nb, W)
    # Long hair hanging behind the neck (braids, ponytails): follow the head at the roots and
    # blend to the upper back toward the tips, so it bends instead of swinging rigidly.
    hk, sk = bones.index('Head'), bones.index('Spine')
    hy, nz = J['Head'][1] - 0.05, J['neck'][2] - 0.04
    hair = (owner == hk) & (Pw[:, 1] < hy) & (Pw[:, 2] < nz)
    if hair.sum() > 20:
        t = np.clip((hy - Pw[hair, 1]) / max(hy - Pw[hair, 1].min(), 1e-6), 0, 1)
        wh = 1 - t * t * (3 - 2 * t)
        W[hair] = 0; W[hair, hk] = wh; W[hair, sk] = 1 - wh
    # keep the four strongest influences
    idx = np.argsort(-W, axis=1)[:, :4]; val = np.take_along_axis(W, idx, axis=1)
    val[val < 0.02] = 0; val /= val.sum(axis=1, keepdims=True)
    jidx = np.array([names.index(bones[k]) for k in range(len(bones))])
    return jidx[idx][rep], val[rep], bones, owner[rep]

def build_glb(out, ref, names, q, t, P, N, UV, I, JI, JW, img, hips_scale, tex_size=1024):
    js = {'asset': {'version': '2.0', 'generator': 'rail-rascals autorig'}, 'scene': 0, 'scenes': [{'nodes': [0]}]}
    bin_ = bytearray(); views = []; accs = []
    def add(arr, ctype, typ, target=None, minmax=False):
        nonlocal bin_
        while len(bin_) % 4: bin_.append(0)
        arr = np.ascontiguousarray(arr, dtype={5126: np.float32, 5123: np.uint16, 5125: np.uint32}[ctype])
        b = arr.tobytes(); v = {'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(b)}
        if target: v['target'] = target
        bin_ += b; views.append(v)
        a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if minmax: a['min'] = arr.min(axis=0).tolist(); a['max'] = arr.max(axis=0).tolist()
        accs.append(a); return len(accs) - 1
    FL, U16, U32 = 5126, 5123, 5125
    pos = add(P.astype(np.float32), FL, 'VEC3', 34962, True)
    nor = add(N.astype(np.float32), FL, 'VEC3', 34962)
    uv = add(UV.astype(np.float32), FL, 'VEC2', 34962)
    jo = add(JI.astype(np.uint16), U16, 'VEC4', 34962)
    we = add(JW.astype(np.float32), FL, 'VEC4', 34962)
    ind = add(I.astype(np.uint32).reshape(-1, 1), U32, 'SCALAR', 34963)
    accs[ind]['type'] = 'SCALAR'
    # nodes: 0 Armature, 1 mesh, 2.. joints
    nodes = [{'name': 'Armature', 'scale': [ref.scale] * 3, 'children': [1, 2 + names.index('Hips')]},
             {'name': 'char1', 'mesh': 0, 'skin': 0}]
    for nm in names:
        n = {'name': nm, 'translation': t[nm].tolist(), 'rotation': (q[nm] / np.linalg.norm(q[nm])).tolist()}
        ch = [2 + names.index(c) for c in ref.children[nm]]
        if ch: n['children'] = ch
        nodes.append(n)
    # inverse bind matrices from the new rest pose
    Wd = {}; Pd = {}
    for nm in ref.order():
        p = ref.pname[nm]
        if p is None: Wd[nm] = q[nm]; Pd[nm] = t[nm] * ref.scale
        else: Wd[nm] = qmul(Wd[p], q[nm]); Pd[nm] = Pd[p] + qrot(Wd[p], t[nm]) * ref.scale
    ibm = []
    for nm in names:
        m = np.eye(4); m[:3, :3] = qmat(Wd[nm]) * ref.scale; m[:3, 3] = Pd[nm]
        ibm.append(np.linalg.inv(m).T.reshape(-1))  # column-major
    ibm_a = add(np.array(ibm, np.float32), FL, 'MAT4')
    # animation: reference rotations for every joint, hips translation scaled to this character
    rg, ran = ref.g, ref.g.js['animations'][0]
    chans, samps = [], []
    time_acc = {}
    for c in ran['channels']:
        nm = rg.js['nodes'][c['target']['node']]['name']; path = c['target']['path']
        if nm not in names or path == 'scale' or (path == 'translation' and nm != 'Hips'): continue
        sm = ran['samplers'][c['sampler']]
        tin = rg.acc(sm['input']).astype(np.float32); vout = rg.acc(sm['output']).astype(np.float32)
        if path == 'translation': vout = vout * hips_scale
        key = tin.tobytes()
        if key not in time_acc:
            time_acc[key] = add(tin.reshape(-1, 1), FL, 'SCALAR', None, True); accs[time_acc[key]]['type'] = 'SCALAR'
        o = add(vout, FL, 'VEC4' if path == 'rotation' else 'VEC3')
        samps.append({'input': time_acc[key], 'output': o, 'interpolation': sm.get('interpolation', 'LINEAR')})
        chans.append({'sampler': len(samps) - 1, 'target': {'node': 2 + names.index(nm), 'path': path}})
    # texture
    buf = io.BytesIO(); img.resize((tex_size, tex_size), Image.LANCZOS).save(buf, 'JPEG', quality=86, optimize=True)
    data = buf.getvalue()
    while len(bin_) % 4: bin_.append(0)
    views.append({'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(data)}); bin_ += data
    js.update({
        'nodes': nodes,
        'meshes': [{'name': 'char1', 'primitives': [{'attributes': {'POSITION': pos, 'NORMAL': nor, 'TEXCOORD_0': uv, 'JOINTS_0': jo, 'WEIGHTS_0': we}, 'indices': ind, 'material': 0}]}],
        'skins': [{'name': 'Armature', 'joints': [2 + names.index(n) for n in names], 'inverseBindMatrices': ibm_a}],
        'animations': [{'name': ref.g.js['animations'][0].get('name', 'RunFast'), 'channels': chans, 'samplers': samps}],
        'materials': [{'name': 'Material_1', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 0.8}}],
        'textures': [{'sampler': 0, 'source': 0}], 'samplers': [{'magFilter': 9729, 'minFilter': 9987}],
        'images': [{'bufferView': len(views) - 1, 'mimeType': 'image/jpeg', 'name': 'texture_0'}],
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(bin_)}],
    })
    j = json.dumps(js, separators=(',', ':')).encode()
    while len(j) % 4: j += b' '
    while len(bin_) % 4: bin_.append(0)
    with open(out, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 28 + len(j) + len(bin_)))
        f.write(struct.pack('<I4s', len(j), b'JSON')); f.write(j)
        f.write(struct.pack('<I4s', len(bin_), b'BIN\x00')); f.write(bytes(bin_))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('ref'); ap.add_argument('out')
    ap.add_argument('--height', type=float, default=1.6); ap.add_argument('--debug')
    ap.add_argument('--texture', help='use this image instead of the source texture')
    a = ap.parse_args()
    ref = RefRig(a.ref)
    P, N, UV, I, img = load_source(a.src, a.height)
    if N is None: N = vertex_normals(P, I)
    if a.texture: img = Image.open(a.texture).convert('RGB')
    L = landmarks.detect(P, I)
    K = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rig_calib.json')))
    J = joints.derive(L, K)
    names = ref.joints
    W, q, t = fit_skeleton(ref, J)
    R = bone_radii(L, J)
    JI, JW, bones, owner = skin_weights(P, I, J, L, names, R)
    hips_scale = J['Hips'][1] / ref.P['Hips'][1]
    build_glb(a.out, ref, names, q, t, P, N, UV, I, JI, JW, img, hips_scale)
    print('rigged', a.out, 'verts', len(P), 'tris', len(I), 'hips scale', round(hips_scale, 3))
    if a.debug:
        json.dump({k: v.tolist() for k, v in J.items()}, open(a.debug + '_joints.json', 'w'))
        np.save(a.debug + '_owner.npy', owner)
        import lmdebug; lmdebug.draw(L, joints=J, out=a.debug + '_lm.png')

if __name__ == '__main__':
    main()
