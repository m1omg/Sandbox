# Web-ready character GLB: one 1024 JPEG base-colour texture, plain material, compacted buffer.
import os, sys, io
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbio import GLB, compact
src, dst = sys.argv[1], sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
tex_src = sys.argv[4] if len(sys.argv) > 4 else None  # GLB with the same UV layout whose texture to use
g = GLB(src)
js = g.js
assert len(js['images']) == 1
im = Image.open(io.BytesIO((GLB(tex_src) if tex_src else g).image_bytes(0))).convert('RGB').resize((size, size), Image.LANCZOS)
buf = io.BytesIO(); im.save(buf, 'JPEG', quality=86, optimize=True)
g.set_image(0, buf.getvalue(), 'image/jpeg')
js['images'][0]['name'] = 'texture_0'
js['textures'] = [{'sampler': 0, 'source': 0}]
for m in js['materials']:
    m.pop('emissiveTexture', None); m.pop('emissiveFactor', None); m.pop('extensions', None)
    m['pbrMetallicRoughness'] = {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 0.8}
js.pop('extensionsUsed', None); js.pop('extensionsRequired', None)
compact(g)
g.save(dst)
print('wrote', dst)
