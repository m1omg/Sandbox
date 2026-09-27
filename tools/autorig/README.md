# autorig

The auto-rigger used for Jim, Juno, Ozzy and Nia. It takes a textured, unrigged character mesh in
an A-pose and produces a GLB with the same skeleton, bone names and run cycle as the
Meshy-rigged characters, so the game's pose layers (jump, roll, hoverboard, jetpack, crash) work
on it unchanged.

```sh
pip install numpy pillow
python3 autorig.py character.glb ../../assets/models/remy.glb out.glb [--debug prefix]
```

The input should face +z. It is placed on the floor, centred and scaled to 1.6 m.

## How it works

1. **Landmarks** (`landmarks.py`): samples the surface and builds a front silhouette. Row by row
   it finds the crotch (where the legs meet), the leg and arm centre lines, the armpits (where
   each arm separates from the body) and the neck (the narrowest part between the shoulders and
   the head).
2. **Joints** (`joints.py`): places the 24 joints relative to those landmarks. The rules are
   calibrated on the Meshy-rigged Remy, Kit and warden (`rig_calib.json`; rerun `joints.py` to
   recalibrate). On those three the joints land within about 3 cm of Meshy's on average.
3. **Skeleton**: each bone of the reference skeleton is rotated to point at the detected child
   joint. The bones' local axes therefore match the reference, and its animation's rotations
   apply as they are. Only the hips' height track is rescaled.
4. **Skin weights**: every vertex goes to its nearest bone, with distance measured relative to
   each bone's thickness. Several rules correct that:
   - below the armpits, the arm silhouettes decide which vertices belong to the arms;
   - the torso bones are kept off the face and chin;
   - a bone's fragments that are cut off from its main patch go to the surface they are
     attached to;
   - hair hanging behind the neck blends from the head to the upper back.

   The weights are then smoothed over the mesh (welded across UV seams) and limited to four
   bones per vertex.

`project.py` paints a view from a concept sheet onto a model's texture (used for Remy's
backpack patch). `finalize.py` shrinks a GLB for the web (1024 px JPEG texture, plain material,
compacted buffer). `lmdebug.py` draws the silhouette with the detected landmarks and joints.
