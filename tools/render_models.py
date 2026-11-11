"""Clay renders on black for the portfolio.
usage: python render.py <mode> <out.png> [files...]
  mode = blend : render all visible meshes of a .blend
  mode = stl   : import STLs and lay them out in a row/grid
"""
import bpy, sys, math, mathutils

mode, out, files = sys.argv[1], sys.argv[2], sys.argv[3:]
import os
W, H = int(os.environ.get("RW", 1600)), int(os.environ.get("RH", 1600))

def clay(col=(0.06, 0.06, 0.065), rough=0.45):
    m = bpy.data.materials.new('clay'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = rough
    return m

if mode == 'blend':
    bpy.ops.wm.open_mainfile(filepath=files[0])
    for o in list(bpy.data.objects):
        if o.type in ('CAMERA', 'LIGHT'):
            bpy.data.objects.remove(o)
    objs = [o for o in bpy.data.objects if o.type == 'MESH' and not o.hide_render]
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = []
    for f in files:
        before = set(bpy.data.objects)
        bpy.ops.wm.stl_import(filepath=f)
        o = [x for x in bpy.data.objects if x not in before][0]
        o.location = (0, 0, 0); o.rotation_euler = (0, 0, 0); o.scale = (1, 1, 1)
        me = o.data
        xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]
        if os.environ.get('LONGX') and (max(ys) - min(ys)) > (max(xs) - min(xs)):
            me.transform(mathutils.Matrix.Rotation(math.pi / 2, 4, 'Z'))
        xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
        me.transform(mathutils.Matrix.Translation((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -min(zs))))
        objs.append((o, max(xs) - min(xs), max(ys) - min(ys)))
    gap = float(os.environ.get('GAP', 10))
    if os.environ.get('STACK'):           # one column, long parts side by side
        y = 0
        for o, w, h in objs:
            o.location = (0, -(y + h / 2), 0); y += h + gap
    else:                                  # shelf packing, rows about RATIO wide
        total = sum((w + gap) * (h + gap) for _, w, h in objs)
        rowW = math.sqrt(total * float(os.environ.get('RATIO', 1.0))); x = y = rowH = 0
        for o, w, h in sorted(objs, key=lambda t: -t[2]):
            if x > 0 and x + w > rowW: x = 0; y += rowH + gap; rowH = 0
            o.location = (x + w / 2, -(y + h / 2), 0); x += w + gap; rowH = max(rowH, h)
    objs = [t[0] for t in objs]

scene = bpy.context.scene
mat = clay()
for o in objs:
    o.data.materials.clear(); o.data.materials.append(mat)
    for p in o.data.polygons: p.use_smooth = False

# bounds
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); pts = []
for o in objs:
    oe = o.evaluated_get(dg); me = oe.to_mesh()
    pts += [o.matrix_world @ v.co for v in me.vertices[::max(1, len(me.vertices) // 4000)]]
    oe.to_mesh_clear()
mn = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
mx = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
ctr = (mn + mx) / 2; size = (mx - mn).length
print("BOUNDS", mn, mx, [tuple(round(c,1) for c in o.location) for o in objs])

# camera: 3/4 view from the front-left, above
cam_data = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam); scene.camera = cam
el = math.radians(float(os.environ.get('EL', 32 if mode == 'blend' else 48))); az = math.radians(float(os.environ.get('AZ', -35)))
d = size * float(os.environ.get('DIST', 1.05))
cam.location = ctr + mathutils.Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * d
cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam_data.lens = 50; cam_data.clip_end = size * 20; cam_data.clip_start = size * 0.001
scene.render.resolution_x, scene.render.resolution_y = W, H
bpy.context.view_layer.update()
flat = [c for p_ in pts for c in p_]
loc, _ = cam.camera_fit_coords(bpy.context.evaluated_depsgraph_get(), flat)
loc = mathutils.Vector(loc)
pad = float(os.environ.get('PAD', 1.12))
cam.location = ctr + (loc - ctr) * pad if False else loc
fwd = cam.matrix_world.to_quaternion() @ mathutils.Vector((0, 0, -1))
cam.location = loc - fwd * ((loc - ctr).length * (pad - 1))
print('CAM', tuple(round(c,1) for c in cam.location))

def area(name, loc, energy, s, col=(1, 1, 1)):
    l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.size = s; l.color = col
    o = bpy.data.objects.new(name, l); scene.collection.objects.link(o)
    o.location = loc; o.rotation_euler = (ctr - o.location).to_track_quat('-Z', 'Y').to_euler()

k = size ** 2
area('key', ctr + mathutils.Vector((-size, -size, size * 1.2)), 90 * k, size * 0.8)
area('rim', ctr + mathutils.Vector((size * 1.1, size * 0.9, size * 0.6)), 160 * k, size * 0.5, (0.9, 0.95, 1))
area('fill', ctr + mathutils.Vector((size * 1.2, -size, size * 0.2)), 18 * k, size)

world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'; scene.cycles.samples = 48
try: scene.cycles.use_denoising = True
except Exception: pass
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in scene.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
scene.view_settings.look = 'None'
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('wrote', out, len(objs), 'objects, size', round(size, 2))
