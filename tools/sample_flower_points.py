import bpy, sys, numpy as np, json
bpy.ops.wm.open_mainfile(filepath=sys.argv[-2])
dg = bpy.context.evaluated_depsgraph_get()
rng = np.random.default_rng(7)
out = {}
for name, n in [('flower 2', 26000), ('flower 1', 11000)]:
    o = bpy.data.objects[name]
    oe = o.evaluated_get(dg)
    me = oe.to_mesh()
    me.calc_loop_triangles()
    M = np.array(o.matrix_world)
    V = np.array([ (M @ np.array([*v.co,1]))[:3] for v in me.vertices])
    T = np.array([t.vertices[:] for t in me.loop_triangles])
    a,b,c = V[T[:,0]],V[T[:,1]],V[T[:,2]]
    area = 0.5*np.linalg.norm(np.cross(b-a,c-a),axis=1)
    idx = rng.choice(len(T), n, p=area/area.sum())
    r1 = np.sqrt(rng.random(n)); r2 = rng.random(n)
    P = (1-r1)[:,None]*a[idx] + (r1*(1-r2))[:,None]*b[idx] + (r1*r2)[:,None]*c[idx]
    out[name] = P
    print(name, len(V), len(T), P.min(0).round(2), P.max(0).round(2))
    oe.to_mesh_clear()

def thin(P, cell):
    k = np.floor(P/cell).astype(np.int64)
    _, first = np.unique(k, axis=0, return_index=True)
    return P[np.sort(first)]
out = {k: thin(v, 0.15 if k=='flower 2' else 0.12) for k,v in out.items()}
for k,v in out.items(): print('thinned', k, len(v))
allP = np.vstack(list(out.values()))
ctr = np.array([ (allP[:,0].max()+allP[:,0].min())/2, (allP[:,1].max()+allP[:,1].min())/2, allP[:,2].min()])
R = np.max(np.linalg.norm((allP-ctr)[:,:2],axis=1))
res = []
for name,P in out.items():
    Q = (P-ctr)/R
    for q in Q: res.append([round(float(q[0]),3), round(float(q[1]),3), round(float(q[2]),3), 1 if name=='flower 1' else 0])
json.dump(res, open(sys.argv[-1],'w'))
print('n', len(res), 'zmax', max(r[2] for r in res))
