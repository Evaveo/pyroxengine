# Essai COMPLET de l'addon dans un vrai Blender, en arrière-plan :
#   blender -b --factory-startup --python outils/blender-addon/tests/blender_smoke.py
# À lancer après TOUTE modification d’un .py de l’addon, AVANT de demander une réinstallation.
# 1. chaque action de chaque groupe, appelée par pipeline.dispatch comme le fait le serveur
#    (les minuteurs ne tournent pas en -b : on les exécute nous-mêmes) ;
# 2. le serveur HTTP réel (routes, jeton, job, fichier), avec la file du fil principal pompée ici.
import sys, os, json, tempfile, time, threading, traceback, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bpy

# Les minuteurs sont exécutés à la main : on capture ceux qu'enregistre l'addon.
_timers = []
def fake_register(fn, first_interval=0, persistent=False):
    _timers.append(fn)
bpy.app.timers.register = fake_register
bpy.app.timers.is_registered = lambda fn: fn in _timers
bpy.app.timers.unregister = lambda fn: _timers.remove(fn) if fn in _timers else None

def run_timers():
    for fn in list(_timers):
        r = fn()
        if r is None and fn in _timers:
            _timers.remove(fn)

import evaveo_blender_bridge as addon
addon.register()
from evaveo_blender_bridge import pipeline as p, server, guards

root = tempfile.mkdtemp(prefix="evaveo_full_")
results = []

def call(op, action=None, spec=None, expect_ok=True, **extra):
    args = dict(extra)
    if action is not None:
        args["action"] = action
        args["spec_json"] = spec or {}
    label = op + (" " + action if action else "")
    try:
        r = p.dispatch({"op": op, "args": args, "project": root})
        if r.get("job_id"):
            run_timers()
            st = json.load(open(os.path.join(root, "jobs", r["job_id"] + ".json"), encoding="utf-8"))
            if st["state"] != "succeeded":
                raise RuntimeError(st.get("error") or st.get("message"))
            r = st.get("result")
        elif not r.get("ok", True):
            raise RuntimeError(r.get("error"))
        results.append(("OK", label, ""))
        return r
    except Exception as exc:
        results.append(("FAIL" if expect_ok else "OK(refus)", label, type(exc).__name__ + ": " + str(exc)[:300]))
        if expect_ok:
            traceback.print_exc()
        return None

# ---------- projet ----------
call("ping")
call("project_action", "new", {"name": "full"})
call("project_action", "settings", {"fps": 30, "triangle_budget": 50000, "texture_size": 1024, "render_samples": 8, "render_device": "CPU"})
call("project_action", "save", {"label": "debut"})
lst = call("project_action", "list", {})

# ---------- matériaux ----------
call("material_action", "create", {"id": "bark", "basecolor": [0.2, 0.12, 0.07, 1], "roughness": 0.9})
call("material_action", "create", {"id": "leaf", "basecolor": [0.2, 0.4, 0.1, 1], "roughness": 0.7, "metallic": 0})
call("material_action", "create", {"id": "gold", "basecolor": [0.95, 0.68, 0.16, 1], "roughness": 0.3, "metallic": 0.9})
call("material_action", "procedural", {"id": "stone", "pattern": "stone", "colors": [[0.4, 0.4, 0.38], [0.25, 0.25, 0.23]], "scale": 5, "roughness": 0.85, "metallic": 0})
call("material_action", "list", {})
call("material_action", "inspect", {"id": "bark"})

# ---------- géométrie ----------
call("model_geometry", "sweep", {"name": "Trunk", "path": [[0, 0, -0.05], [0.05, 0, 0.6], [0.1, 0.05, 1.2]], "radii": [[0.15, 0.15], [0.1, 0.1], [0.07, 0.07]], "segments": 10, "caps": True, "material_id": "bark"})
call("model_geometry", "lathe", {"name": "Vase", "profile": [[0.001, 0], [0.2, 0], [0.25, 0.3], [0.1, 0.6], [0.001, 0.6]], "segments": 24, "material_id": "gold"})
call("model_geometry", "extrude", {"name": "Plaque", "polygon": [[0, 0], [0.5, 0], [0.5, 0.3], [0, 0.3]], "depth": 0.05, "material_id": "stone"})
call("model_geometry", "mesh", {"name": "Crown", "vertices": [[-.3, -.3, 1.2], [.3, -.3, 1.2], [.3, .3, 1.2], [-.3, .3, 1.2], [0, 0, 1.9]],
     "faces": [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [3, 2, 1, 0]], "material_id": "leaf", "smooth": True})
call("model_geometry", "modifier", {"object": "Crown", "type": "SUBSURF", "apply": True, "settings": {"levels": 1}})
call("model_geometry", "modifier", {"object": "Plaque", "type": "BEVEL", "apply": False, "settings": {"width": 0.01, "segments": 2}})
call("model_geometry", "transform", {"object": "Plaque", "location": [1, 0, 0], "rotation_deg": [0, 0, 30], "scale": [1, 1, 1]})
call("model_geometry", "duplicate", {"object": "Vase", "name": "Vase2", "offset": [0, 1, 0]})
call("model_geometry", "edit_vertices", {"object": "Crown", "changes": [{"index": 0, "position": [-0.35, -0.35, 1.2]}]})
call("model_geometry", "cleanup", {"objects": ["Crown"], "merge_distance": 0.00001, "smooth": True})
call("model_geometry", "cleanup", {"objects": ["Plaque"]})   # sans smooth : ombrage inchangé
call("model_geometry", "rename", {"object": "Plaque", "name": "Plaque2"})
call("model_geometry", "rename", {"object": "Plaque2", "name": "Plaque"})
call("model_geometry", "origin", {"object": "Vase2", "mode": "BOTTOM"})
call("model_geometry", "join", {"objects": ["Vase", "Vase2"], "name": "Vases"})
call("model_geometry", "delete", {"objects": ["Vases"]})

# ---------- UV ----------
call("uv_action", "unwrap", {"objects": ["Trunk", "Crown"], "method": "SMART", "margin": 0.02})
call("uv_action", "lightmap", {"objects": ["Trunk"], "margin": 0.03})
call("uv_action", "transform", {"objects": ["Trunk"], "scale": [1, 1], "offset": [0, 0], "rotation_deg": 0})

# ---------- inspection ----------
call("inspect_mesh", "audit", {"stage": "source", "triangle_budget": 50000})
call("inspect_mesh", "geometry", {"object": "Crown", "offset": 0, "limit": 10})
call("inspect_mesh", "object", {"object": "Trunk"})
call("inspect")
call("validate")

# ---------- rig et animation ----------
call("rig_action", "create", {"name": "Rig", "bones": [{"name": "root", "head": [0, 0, 0], "tail": [0, 0, 0.6]},
     {"name": "top", "head": [0, 0, 0.6], "tail": [0.1, 0.05, 1.2], "parent": "root"}]})
call("rig_action", "bind", {"rig": "Rig", "objects": ["Trunk"], "method": "AUTO"})
call("rig_action", "inspect", {"rig": "Rig"})
call("animation_action", "clip", {"object": "Rig", "name": "Sway", "fps": 30, "frames": 30,
     "keys": [{"frame": 1, "bone": "top", "rotation_deg": [0, 0, 0]}, {"frame": 15, "bone": "top", "rotation_deg": [8, 0, 0]}, {"frame": 30, "bone": "top", "rotation_deg": [0, 0, 0]}]})
call("animation_action", "list", {})
call("rig_action", "humanoid", {"name": "Hero", "height": 1.8, "center": [3, 0, 0]})
call("animation_action", "sample_cycle", {"rig": "Hero", "name": "Walk", "kind": "walk", "frames": 24, "amplitude": 20})

# ---------- import ----------
up = os.path.join(root, "uploads"); os.makedirs(up, exist_ok=True)
img = bpy.data.images.new("ref", 8, 8); img.filepath_raw = os.path.join(up, "ref.png"); img.file_format = "PNG"; img.save()
call("import_asset", "reference", {"file": "uploads/ref.png", "view": "front", "size": 2})

# ---------- livraison ----------
call("delivery_action", "preview", {"size": 128, "stage": "source"})
call("delivery_action", "iso", {"name": "full", "width": 260, "height": 300, "origin_px": [130, 230], "samples": 8})
call("delivery_action", "iso", {"name": "studio", "width": 128, "height": 128, "sun": None, "shadow": False, "flip_x": False, "samples": 4})
call("delivery_action", "iso", {"name": "cible", "width": 128, "height": 128, "target": "Plaque", "samples": 2})
call("delivery_action", "export", {"name": "Element", "stage": "source", "formats": ["GLB"], "objects": ["Plaque"], "origin": "bottom", "individual": False})
call("delivery_action", "turntable", {"size": 128, "frames": 4, "stage": "source"})
call("build_atlas", size=512)
call("delivery_action", "export", {"name": "Full", "stage": "source", "formats": ["GLB"], "animations": True, "lod_ratios": [], "collisions": True, "individual": False})

# ---------- direction et masque d'équipe ----------
call("material_action", "create", {"id": "teamcloth", "basecolor": [0.5, 0.5, 0.5, 1], "roughness": 0.8})
call("model_geometry", "lathe", {"name": "Tabard", "profile": [[0.001, 0.3], [0.25, 0.3], [0.25, 0.9], [0.001, 0.9]], "segments": 12, "material_id": "teamcloth"})
rt = call("delivery_action", "iso", {"name": "team", "width": 128, "height": 160, "origin_px": [64, 120], "samples": 4, "rotate_deg": 45, "team_materials": ["teamcloth"]})
if rt:
    mk = bpy.data.images.load(rt["mask"]); mp = mk.pixels[:]
    white = sum(1 for i in range(0, len(mp), 4) if mp[i + 3] > 0.5 and mp[i] > 0.9)
    results.append(("OK" if white > 50 else "FAIL", "masque d'équipe : pixels blancs", str(white)))

# ---------- un DEUXIÈME projet : le sol de studio y est renommé « EV_StudioFloor.001 » ----------
call("project_action", "new", {"name": "second"})
call("model_geometry", "lathe", {"name": "Pot", "profile": [[0.001, 0], [0.2, 0], [0.1, 0.4], [0.001, 0.4]], "segments": 12, "material_id": "gold"})
r2 = call("delivery_action", "iso", {"name": "second", "width": 64, "height": 64, "origin_px": [32, 48], "samples": 2})
if r2:
    im = bpy.data.images.load(r2["image"])
    results.append(("OK" if im.pixels[3] < 0.05 else "FAIL", "iso 2e projet : fond transparent", "alpha coin " + str(im.pixels[3])))

# ---------- refus attendus ----------
call("model_geometry", "transform", {"object": "N_EXISTE_PAS", "location": [0, 0, 0]}, expect_ok=False)
call("delivery_action", "iso", {"name": "../x"}, expect_ok=False)

# ---------- serveur HTTP réel ----------
def http():
    out = []
    server.start(19878, "tok-smoke-1234567890", guards.parse_origins(guards.DEFAULT_ORIGINS), root)
    def req(path, method="GET", body=None, tok=True, origin=None):
        h = {"Authorization": "Bearer tok-smoke-1234567890"} if tok else {}
        if origin: h["Origin"] = origin
        r = urllib.request.Request("http://127.0.0.1:19878" + path, data=body, method=method, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=60) as resp: return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as e: return e.code, dict(e.headers), e.read()
    box = {}
    def client():
        try:
            s, h, b = req("/hello", tok=False, origin="http://localhost:8080")
            out.append(("hello", s == 200 and json.loads(b)["protocol"] == 1 and h.get("Access-Control-Allow-Origin") == "http://localhost:8080"))
            out.append(("401 sans jeton", req("/log", tok=False)[0] == 401))
            s, h, b = req("/call", "POST", json.dumps({"op": "inspect", "args": {}}).encode()); out.append(("call inspect", s == 200 and bool(json.loads(b).get("ok"))))
            s, h, b = req("/call", "POST", json.dumps({"op": "delivery_action", "args": {"action": "iso", "spec_json": {"name": "http", "samples": 4}}}).encode())
            jid = json.loads(b).get("job_id"); out.append(("call iso → job", bool(jid) or b[:200]))
            st = None
            for _ in range(600):
                s, h, b = req("/job/" + jid); st = json.loads(b)
                if st.get("state") in ("succeeded", "failed"): break
                time.sleep(0.1)
            out.append(("job iso terminé", (st or {}).get("state") == "succeeded" or st))
            path = st["result"]["image"]
            s, h, b = req("/file?path=" + urllib.request.quote(path)); out.append(("file png", s == 200 and b[:4] == bytes([0x89, 0x50, 0x4E, 0x47])))
            out.append(("file hors dossier", req("/file?path=" + urllib.request.quote("C:/Windows/win.ini"))[0] == 403))
            s, h, b = req("/upload?name=concept.png", "POST", b"\x89PNG"); out.append(("upload", s == 200))
        except Exception as e:
            out.append(("client", "EXC " + repr(e)))
        box["done"] = True
    threading.Thread(target=client, daemon=True).start()
    t0 = time.time()
    while not box.get("done") and time.time() - t0 < 180:
        server._pump(); run_timers(); time.sleep(0.02)
    server.stop()
    return out

for name, ok in http():
    results.append(("OK" if ok is True else "FAIL", "http " + name, "" if ok is True else str(ok)[:300]))

print("\n=== RÉSULTATS ===")
for r in results:
    print(r[0].ljust(10), r[1].ljust(34), r[2])
fails = [r for r in results if r[0] == "FAIL"]
print("TOTAL", len(results), "ÉCHECS", len(fails))
sys.exit(1 if fails else 0)
