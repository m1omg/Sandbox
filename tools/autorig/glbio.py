import json, struct, numpy as np
CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8, 5122: np.int16, 5120: np.int8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
class GLB:
    def __init__(self, path):
        d = open(path, 'rb').read()
        cl = struct.unpack('<I', d[12:16])[0]
        self.js = json.loads(d[20:20 + cl])
        off = 20 + cl
        bl = struct.unpack('<I', d[off:off + 4])[0]
        self.bin = bytearray(d[off + 8:off + 8 + bl])
    def acc(self, i):
        a = self.js['accessors'][i]; bv = self.js['bufferViews'][a['bufferView']]
        dt = CT[a['componentType']]; n = NC[a['type']]
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 0); isz = np.dtype(dt).itemsize * n
        if stride and stride != isz:
            raw = np.frombuffer(bytes(self.bin), dtype=np.uint8)
            rows = np.stack([raw[start + k * stride:start + k * stride + isz] for k in range(a['count'])])
            return rows.view(dt).reshape(a['count'], n).copy()
        arr = np.frombuffer(bytes(self.bin[start:start + isz * a['count']]), dtype=dt).reshape(a['count'], n)
        return arr.copy()
    def set_acc(self, i, arr):
        a = self.js['accessors'][i]; bv = self.js['bufferViews'][a['bufferView']]
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        b = np.ascontiguousarray(arr.astype(CT[a['componentType']])).tobytes()
        assert not bv.get('byteStride') or bv['byteStride'] == len(b) // a['count']
        self.bin[start:start + len(b)] = b
        if 'min' in a: a['min'] = arr.min(axis=0).tolist(); a['max'] = arr.max(axis=0).tolist()
    def image_bytes(self, i):
        bv = self.js['bufferViews'][self.js['images'][i]['bufferView']]
        s = bv.get('byteOffset', 0); return bytes(self.bin[s:s + bv['byteLength']])
    def set_image(self, i, data, mime):
        # append new image data as a new bufferView at the end of the buffer
        while len(self.bin) % 4: self.bin.append(0)
        off = len(self.bin); self.bin += data
        self.js['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
        self.js['images'][i] = {'bufferView': len(self.js['bufferViews']) - 1, 'mimeType': mime}
    def save(self, path):
        while len(self.bin) % 4: self.bin.append(0)
        self.js['buffers'][0]['byteLength'] = len(self.bin)
        j = json.dumps(self.js, separators=(',', ':')).encode()
        while len(j) % 4: j += b' '
        out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(j) + 8 + len(self.bin))
        out += struct.pack('<I4s', len(j), b'JSON') + j + struct.pack('<I4s', len(self.bin), b'BIN\x00') + bytes(self.bin)
        open(path, 'wb').write(out)

def compact(g):
    """Rebuild the binary chunk from the bufferViews that are still referenced."""
    js = g.js
    used = set()
    for a in js.get('accessors', []):
        if 'bufferView' in a: used.add(a['bufferView'])
    for im in js.get('images', []):
        if 'bufferView' in im: used.add(im['bufferView'])
    remap = {}; views = []; out = bytearray()
    for i, bv in enumerate(js['bufferViews']):
        if i not in used: continue
        while len(out) % 4: out.append(0)
        s = bv.get('byteOffset', 0)
        data = g.bin[s:s + bv['byteLength']]
        nbv = dict(bv); nbv['byteOffset'] = len(out); out += data
        remap[i] = len(views); views.append(nbv)
    for a in js.get('accessors', []):
        if 'bufferView' in a: a['bufferView'] = remap[a['bufferView']]
    for im in js.get('images', []):
        if 'bufferView' in im: im['bufferView'] = remap[im['bufferView']]
    js['bufferViews'] = views
    g.bin = out
