# Reference skeleton (Meshy's humanoid rig, taken from remy.glb): hierarchy, rest pose,
# world joint positions, and the RunFast clip.
import os, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbio import GLB

def qmul(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1*x2 + x1*w2 + y1*z2 - z1*y2, w1*y2 - x1*z2 + y1*w2 + z1*x2,
                     w1*z2 + x1*y2 - y1*x2 + z1*w2, w1*w2 - x1*x2 - y1*y2 - z1*z2])
def qinv(q): return np.array([-q[0], -q[1], -q[2], q[3]]) / np.dot(q, q)
def qrot(q, v):
    p = np.array([v[0], v[1], v[2], 0.0])
    return qmul(qmul(q, p), qinv(q))[:3]
def qnorm(q): return q / np.linalg.norm(q)
def q_between(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    c = np.cross(a, b); d = np.dot(a, b)
    if d < -0.999999:
        axis = np.cross(a, [1, 0, 0])
        if np.linalg.norm(axis) < 1e-6: axis = np.cross(a, [0, 1, 0])
        axis /= np.linalg.norm(axis); return np.array([*axis, 0.0])
    return qnorm(np.array([c[0], c[1], c[2], 1 + d]))
def qmat(q):
    x, y, z, w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                     [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])

class RefRig:
    def __init__(self, path):
        g = GLB(path); self.g = g; js = g.js
        nodes = js['nodes']; self.nodes = nodes
        self.skin = js['skins'][0]
        self.joints = [nodes[j]['name'] for j in self.skin['joints']]
        self.jnode = {nodes[j]['name']: j for j in self.skin['joints']}
        self.parent = {}
        for i, n in enumerate(nodes):
            for c in n.get('children', []): self.parent[c] = i
        arm = next(i for i, n in enumerate(nodes) if n.get('name') == 'Armature')
        self.scale = nodes[arm].get('scale', [1, 1, 1])[0]
        self.children = {nm: [nodes[c]['name'] for c in nodes[self.jnode[nm]].get('children', []) if nodes[c]['name'] in self.jnode] for nm in self.joints}
        self.pname = {nm: (nodes[self.parent[self.jnode[nm]]]['name'] if nodes[self.parent[self.jnode[nm]]]['name'] in self.jnode else None) for nm in self.joints}
        self.t = {nm: np.array(nodes[self.jnode[nm]].get('translation', [0, 0, 0]), float) for nm in self.joints}
        self.q = {nm: np.array(nodes[self.jnode[nm]].get('rotation', [0, 0, 0, 1]), float) for nm in self.joints}
        self.W = {}; self.P = {}
        for nm in self.order():
            p = self.pname[nm]
            if p is None:
                self.W[nm] = self.q[nm]; self.P[nm] = self.t[nm] * self.scale
            else:
                self.W[nm] = qmul(self.W[p], self.q[nm]); self.P[nm] = self.P[p] + qrot(self.W[p], self.t[nm]) * self.scale
    def order(self):
        out = []; todo = [n for n in self.joints if self.pname[n] is None]
        while todo:
            n = todo.pop(0); out.append(n); todo += self.children[n]
        return out

if __name__ == '__main__':
    r = RefRig(sys.argv[1])
    for nm in r.order():
        print(f'{nm:14s} parent={str(r.pname[nm]):14s} P={np.round(r.P[nm], 3)}')
