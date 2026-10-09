"""Blender-side production operations. All writes stay under the chosen project."""
import json
import math
import time
import traceback
import uuid
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
from .common import VERSION, atomic_json, checked_parts, grid_cells, scoped, slug

STATUS = "Prêt"
BUSY = False


def manifest(root):
    p = scoped(root, "project.json")
    if not p.exists():
        raise ValueError("Créer d'abord la démonstration avec create_demo.")
    return json.loads(p.read_text(encoding="utf-8"))


def put_manifest(root, value):
    atomic_json(scoped(root, "project.json"), value)


def activate(scene):
    if bpy.context.window:
        bpy.context.window.scene = scene
    else:
        raise RuntimeError("Aucune fenêtre Blender. Lancer Blender normalement pour ce prototype.")


def scene_for(root):
    m = manifest(root)
    scene = bpy.data.scenes.get(m["scene"])
    if not scene or scene.get("ev_run") != m["run_id"]:
        raise RuntimeError("Scène du projet absente. Ouvrir son .blend ou recréer la démo.")
    activate(scene)
    return scene, m


def objects(scene, role):
    return sorted([o for o in scene.objects if o.type == "MESH" and
                   o.get("ev_run") == scene.get("ev_run") and o.get("ev_role") == role],
                  key=lambda o: o.name)


def select_only(items):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in items:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    if items:
        bpy.context.view_layer.objects.active = items[0]


def job_status(job, text, fraction=None):
    global STATUS
    STATUS = text
    job["message"] = text
    if fraction is not None:
        job["progress"] = fraction
    job["updated_at"] = time.time()
    atomic_json(job["status_path"], {k: v for k, v in job.items() if k != "root"})
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                area.tag_redraw()


def save_image(image, file):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    image.filepath_raw = str(file)
    image.file_format = "PNG"
    image.save()
    return str(file)


def array_image(name, array, file, color=False):
    h, w, _ = array.shape
    image = bpy.data.images.new(name, width=w, height=h, alpha=True, float_buffer=False)
    image.colorspace_settings.name = "sRGB" if color else "Non-Color"
    image.pixels.foreach_set(np.asarray(array, dtype=np.float32).ravel())
    image.update()
    save_image(image, file)
    return image


def catalog(root):
    p = scoped(root, "materials/catalog.json")
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def wood_material(root):
    identifier = "wood_oak_demo_v1"
    cat = catalog(root)
    if identifier not in cat:
        n = 512
        y, x = np.meshgrid(np.linspace(0, 1, n), np.linspace(0, 1, n), indexing="ij")
        phase = 2 * np.pi * (9*x + .28*np.sin(2*np.pi*y) + .11*np.sin(6*np.pi*y))
        grain = .5 + .5*np.sin(phase)
        fine = .5 + .5*np.sin(phase*5 + .20*np.sin(8*np.pi*y))
        tone = .35 + .45*grain + .20*fine
        rgba = np.ones((n, n, 4), dtype=np.float32)
        for k, c in enumerate((.38, .18, .065)):
            rgba[:, :, k] = c * (.65 + .55*tone)
        rough = np.ones_like(rgba)
        rough[:, :, :3] = (.48 + .22*(1-tone))[:, :, None]
        dy, dx = np.gradient(tone)
        normals = np.stack((-dx*2.2, -dy*2.2, np.ones_like(dx)), axis=-1)
        normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
        normal = np.ones_like(rgba)
        normal[:, :, :3] = normals*.5 + .5
        for a in (rgba, rough, normal):
            a[-1] = a[0]
            a[:, -1] = a[:, 0]
        paths = {}
        for key, ar, srgb in [("basecolor", rgba, True), ("roughness", rough, False),
                              ("normal", normal, False)]:
            relative = f"materials/{identifier}/{key}.png"
            array_image("EV_"+identifier+"_"+key, ar, scoped(root, relative), srgb)
            paths[key] = relative
        cat[identifier] = {"id": identifier, "maps": paths, "tile_size_m": 1.0,
                           "roughness": .6, "metallic": 0.0,
                           "origin": "Periodic procedural wood; normal derived from the grain height",
                           "seam_test": {"opposite_edges_max_error": 0.0}}
        atomic_json(scoped(root, "materials/catalog.json"), cat)
    return material_from_entry(root, cat[identifier]), identifier


def material_from_entry(root, entry):
    mat = bpy.data.materials.new("EV_MAT_" + entry["id"])
    mat.use_nodes = True
    mat["ev_material_id"] = entry["id"]
    tree = mat.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = entry.get("roughness", .6)
    bsdf.inputs["Metallic"].default_value = entry.get("metallic", 0.0)
    uv = tree.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "EV_Tile"
    for key, relative in entry["maps"].items():
        image = bpy.data.images.load(str(scoped(root, relative)), check_existing=True)
        image.colorspace_settings.name = "sRGB" if key == "basecolor" else "Non-Color"
        tex = tree.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.extension = "REPEAT"
        tree.links.new(uv.outputs["UV"], tex.inputs["Vector"])
        if key == "normal":
            normal = tree.nodes.new("ShaderNodeNormalMap")
            normal.uv_map = "EV_Tile"
            tree.links.new(tex.outputs["Color"], normal.inputs["Color"])
            tree.links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
        elif key in ("basecolor", "roughness", "metallic"):
            target = {"basecolor": "Base Color", "roughness": "Roughness", "metallic": "Metallic"}[key]
            tree.links.new(tex.outputs["Color"], bsdf.inputs[target])
    return mat


def tile_uv(obj, tile_size=1.0):
    tile_size = float(tile_size)
    if not .01 <= tile_size <= 100:
        raise ValueError("Taille de répétition attendue : 0,01 à 100 mètres.")
    uv = obj.data.uv_layers.get("EV_Tile") or obj.data.uv_layers.new(name="EV_Tile")
    matrix = obj.matrix_world
    normal_matrix = matrix.to_3x3().inverted().transposed()
    for face in obj.data.polygons:
        normal = normal_matrix @ face.normal
        major = max(range(3), key=lambda k: abs(normal[k]))
        axes = ((1, 2), (0, 2), (0, 1))[major]
        for li in face.loop_indices:
            coord = matrix @ obj.data.vertices[obj.data.loops[li].vertex_index].co
            uv.data[li].uv = (coord[axes[0]] / tile_size, coord[axes[1]] / tile_size)
    obj.data.uv_layers.active = uv
    uv.active_render = True
    obj["ev_tile_size_m"] = tile_size


def collection(scene, name):
    col = bpy.data.collections.new(name)
    scene.collection.children.link(col)
    return col


def move_to(obj, col):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    col.objects.link(obj)


def build_parts(scene, col, name, parts, mat):
    made = []
    for part in checked_parts(parts):
        kind = part["kind"]
        if kind == "cube":
            bpy.ops.mesh.primitive_cube_add(size=1)
        elif kind == "cylinder":
            bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=.5, depth=1)
        elif kind == "cone":
            bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=.5, radius2=.10, depth=1)
        else:
            bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=.5)
        obj = bpy.context.object
        move_to(obj, col)
        obj.dimensions = part["dimensions"]
        select_only([obj])
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        if part["bevel"] > 0 and kind in ("cube", "cylinder", "cone"):
            mod = obj.modifiers.new("EV_Edge", "BEVEL")
            mod.width = min(part["bevel"], min(part["dimensions"])*.15)
            mod.segments = 2
            bpy.ops.object.modifier_apply(modifier=mod.name)
        obj.location = part["location"]
        obj.rotation_euler = [math.radians(a) for a in part["rotation_deg"]]
        if kind == "sphere":
            for p in obj.data.polygons:
                p.use_smooth = True
        made.append(obj)
    select_only(made)
    bpy.ops.object.join()
    result = bpy.context.object
    result.name = "EV_" + slug(name)
    result["ev_run"] = scene["ev_run"]
    result["ev_role"] = "source"
    result.data.materials.clear()
    result.data.materials.append(mat)
    tile_uv(result)
    return result


def add_stage(scene, col):
    bpy.ops.mesh.primitive_plane_add(size=200)
    floor = bpy.context.object
    floor.name = "EV_StudioFloor"
    floor.location.z = -.012
    move_to(floor, col)
    mat = bpy.data.materials.new("EV_StudioGrey")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (.24, .28, .32, 1)
    bsdf.inputs["Roughness"].default_value = .8
    floor.data.materials.append(mat)
    for name, pos, energy, size in [("Key", (2, -4, 6), 1100, 5),
                                     ("Fill", (-4, -1, 3), 700, 4),
                                     ("Rim", (1, 4, 5), 1000, 4)]:
        data = bpy.data.lights.new("EV_"+name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new("EV_"+name, data)
        col.objects.link(obj)
        obj.location = pos
        obj.rotation_euler = (Vector((0, 0, .5))-obj.location).to_track_quat('-Z', 'Y').to_euler()
    world = bpy.data.worlds.new("EV_StudioWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.35, .4, .5, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = .4
    scene.world = world
    camera = bpy.data.objects.new("EV_Camera", bpy.data.cameras.new("EV_Camera"))
    col.objects.link(camera)
    camera.data.type = "ORTHO"
    scene.camera = camera
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.cycles.seed = 41
    scene.render.resolution_x = 800
    scene.render.resolution_y = 600
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def checkpoint(root, scene, run_dir, name):
    file = scoped(root, run_dir + "/" + name + ".blend")
    file.parent.mkdir(parents=True, exist_ok=True)
    for obj in scene.objects:
        for slot in obj.material_slots:
            if slot.material and slot.material.use_nodes:
                for node in slot.material.node_tree.nodes:
                    if node.type == "TEX_IMAGE" and node.image and node.image.has_data:
                        node.image.pack()
    bpy.data.libraries.write(str(file), {scene}, path_remap="RELATIVE", fake_user=True, compress=True)
    return str(file)


def create_demo(root, args, job):
    run_id = uuid.uuid4().hex[:10]
    run_dir = "runs/"+run_id
    scoped(root, run_dir).mkdir(parents=True)
    scene = bpy.data.scenes.new("EVAVEO_Test_"+run_id)
    scene["ev_run"] = run_id
    activate(scene)
    scene.evaveo_project = str(root)
    src = collection(scene, "EV_Source_"+run_id)
    stage = collection(scene, "EV_Studio_"+run_id)
    job_status(job, "Création du bois répétable", .1)
    mat, material_id = wood_material(root)
    def cube(x, y, z, a, b, c):
        return {"kind": "cube", "location": [x, y, z], "dimensions": [a, b, c], "bevel": .008}
    table = [cube(-1.4, 0, .76, 1.3, .80, .08)]
    for x in [-1.94, -.86]:
        for y in [-.29, .29]:
            table.append(cube(x, y, .355, .09, .09, .71))
    table += [cube(-1.4, -.29, .62, 1.08, .06, .10), cube(-1.4, .29, .62, 1.08, .06, .10)]
    crate = [cube(0, 0, .035, .65, .58, .07)]
    for z in [.14, .30, .46]:
        for y in [-.275, .275]:
            crate.append(cube(0, y, z, .65, .055, .135))
        for x in [-.295, .295]:
            crate.append(cube(x, 0, z, .055, .53, .135))
    for x in [-.265, .265]:
        for y in [-.23, .23]:
            crate.append(cube(x, y, .27, .06, .06, .50))
    stool = [{"kind": "cylinder", "location": [1.25, 0, .50], "dimensions": [.60, .60, .075], "bevel": .009}]
    for a in [0, 120, 240]:
        angle = math.radians(a)
        stool.append(cube(1.25+.20*math.cos(angle), .20*math.sin(angle), .23, .065, .065, .46))
    names = []
    for name, spec in [("Table", table), ("Caisse", crate), ("Tabouret", stool)]:
        names.append(build_parts(scene, src, name, spec, mat).name)
    add_stage(scene, stage)
    m = {"version": VERSION, "run_id": run_id, "run_dir": run_dir, "scene": scene.name,
         "source_collection": src.name, "source_objects": names, "material_id": material_id,
         "atlas": None, "created_at": time.time()}
    put_manifest(root, m)
    job_status(job, "Sauvegarde de la scène source", .8)
    file = checkpoint(root, scene, run_dir, "01_source")
    return {"objects": names, "material_id": material_id, "blend": file,
            "next": "render_views(source), build_atlas(1024), render_views(atlas), export_assets"}


def create_asset(root, args, job):
    scene, m = scene_for(root)
    name = slug(args["name"])
    spec = checked_parts(args["parts"])
    entry = catalog(root)[args.get("material_id", m["material_id"])]
    col = bpy.data.collections[m["source_collection"]]
    mat = material_from_entry(root, entry)
    obj = build_parts(scene, col, name, spec, mat)
    tile_uv(obj, entry["tile_size_m"])
    m["source_objects"].append(obj.name)
    m["atlas"] = None
    put_manifest(root, m)
    return {"object": obj.name, "atlas_invalidated": True}


def register_texture(root, args, job):
    identifier = slug(args["material_id"])
    file = scoped(root, args["basecolor_file"])
    if not file.is_file() or file.suffix.lower() not in (".png", ".jpg", ".jpeg"):
        raise ValueError("Image couleur PNG/JPEG attendue dans le projet.")
    size = float(args.get("tile_size_m", 1.0))
    if not .01 <= size <= 100:
        raise ValueError("tile_size_m doit être compris entre 0,01 et 100.")
    cat = catalog(root)
    if identifier in cat:
        raise ValueError("Identifiant déjà utilisé ; créer un nouvel identifiant de matériau.")
    image = bpy.data.images.load(str(file), check_existing=False)
    pixels = np.empty(len(image.pixels), np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(image.size[1], image.size[0], 4)
    error = max(float(np.max(np.abs(pixels[0, :, :3]-pixels[-1, :, :3]))),
                float(np.max(np.abs(pixels[:, 0, :3]-pixels[:, -1, :3]))))
    relative = "materials/"+identifier+"/basecolor.png"
    save_image(image, scoped(root, relative))
    cat[identifier] = {"id": identifier, "maps": {"basecolor": relative}, "tile_size_m": size,
                       "roughness": .6, "metallic": 0.0, "origin": "Imported color image",
                       "seam_test": {"opposite_edges_max_error": error,
                                     "note": "Edge test only; visual repetition must also be inspected"}}
    atomic_json(scoped(root, "materials/catalog.json"), cat)
    return cat[identifier]


def apply_material(root, args, job):
    scene, m = scene_for(root)
    entry = catalog(root)[args["material_id"]]
    names = args.get("objects") or m["source_objects"]
    valid = {o.name: o for o in objects(scene, "source")}
    if any(name not in valid for name in names):
        raise ValueError("Seuls les objets sources du projet peuvent être modifiés.")
    size = float(args.get("tile_size_m", entry["tile_size_m"]))
    if not .01 <= size <= 100:
        raise ValueError("Taille de répétition attendue : 0,01 à 100 mètres.")
    mat = material_from_entry(root, entry)
    for name in names:
        obj = valid[name]
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        for p in obj.data.polygons:
            p.material_index = 0
        tile_uv(obj, size)
    m["atlas"] = None
    put_manifest(root, m)
    return {"objects": names, "material": entry["id"], "atlas_invalidated": True}


def bake_nodes(obj, image, channel):
    restores = []
    # Validate every slot before changing any shader connections.
    checked = []
    for mat in obj.data.materials:
        if not mat or not mat.use_nodes:
            raise ValueError("Matériaux Principled avec nodes requis.")
        tree = mat.node_tree
        out = next((n for n in tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None)
        if not out or not out.inputs["Surface"].is_linked:
            raise ValueError("Sortie de matériau invalide.")
        source = out.inputs["Surface"].links[0].from_socket
        bsdf = source.node
        if bsdf.type != "BSDF_PRINCIPLED":
            raise ValueError("V1 : seule une sortie Principled directe est prise en charge.")
        checked.append((tree, out, source, bsdf))
    for tree, out, source, bsdf in checked:
        target = tree.nodes.new("ShaderNodeTexImage")
        target.name = "EV_BakeTarget"
        target.image = image
        for n in tree.nodes:
            n.select = False
        target.select = True
        tree.nodes.active = target
        emission = None
        if channel != "normal":
            emission = tree.nodes.new("ShaderNodeEmission")
            inp = bsdf.inputs[{"basecolor": "Base Color", "roughness": "Roughness", "metallic": "Metallic"}[channel]]
            if inp.is_linked:
                tree.links.new(inp.links[0].from_socket, emission.inputs["Color"])
            else:
                val = inp.default_value
                emission.inputs["Color"].default_value = tuple(val) if channel == "basecolor" else (val, val, val, 1)
            tree.links.new(emission.outputs[0], out.inputs["Surface"])
        restores.append((tree, out, source, target, emission))
    return restores


def restore_bake(restores):
    for tree, out, source, target, emission in restores:
        tree.links.new(source, out.inputs["Surface"])
        if emission:
            tree.nodes.remove(emission)
        tree.nodes.remove(target)


def atlas_material(images):
    mat = bpy.data.materials.new("EV_Atlas_PBR")
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    uv = tree.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "EV_Atlas"
    for channel, image in images.items():
        tex = tree.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.extension = "EXTEND"
        tree.links.new(uv.outputs[0], tex.inputs["Vector"])
        if channel == "normal":
            normal = tree.nodes.new("ShaderNodeNormalMap")
            normal.uv_map = "EV_Atlas"
            tree.links.new(tex.outputs["Color"], normal.inputs["Color"])
            tree.links.new(normal.outputs[0], bsdf.inputs["Normal"])
        else:
            tree.links.new(tex.outputs["Color"], bsdf.inputs[{"basecolor": "Base Color", "roughness": "Roughness", "metallic": "Metallic"}[channel]])
    return mat


def build_atlas(root, args, job):
    scene, m = scene_for(root)
    source = objects(scene, "source")
    size = int(args.get("size", 1024))
    cells = grid_cells(len(source), size, 16)
    m["atlas_previous"] = m.get("atlas")
    m["atlas"] = None
    put_manifest(root, m)
    # Earlier atlas copies stay in the scene, hidden, for comparison/recovery.
    for obj in objects(scene, "atlas"):
        obj["ev_role"] = "atlas_old"
        obj.hide_render = True
        obj.hide_set(True)
    col = collection(scene, "EV_Atlas_" + job["job_id"][:8])
    copies = []
    for i, (orig, bounds) in enumerate(zip(source, cells)):
        job_status(job, "UV atlas : " + orig.name, .05 + .15*i/max(1, len(source)))
        obj = orig.copy()
        obj.data = orig.data.copy()
        obj.name = orig.name + "_Atlas"
        obj["ev_role"] = "atlas"
        col.objects.link(obj)
        obj.hide_render = False
        for slot in obj.material_slots:
            slot.material = slot.material.copy()
        select_only([obj])
        # Preserve source UVs explicitly for all source image/normal nodes.
        source_uv = obj.data.uv_layers.active.name if obj.data.uv_layers.active else "EV_Tile"
        if not obj.data.uv_layers:
            tile_uv(obj)
        for mat in obj.data.materials:
            for node in list(mat.node_tree.nodes):
                if node.type == "TEX_IMAGE" and not node.inputs["Vector"].is_linked:
                    uvnode = mat.node_tree.nodes.new("ShaderNodeUVMap")
                    uvnode.uv_map = source_uv
                    mat.node_tree.links.new(uvnode.outputs["UV"], node.inputs["Vector"])
                if node.type == "NORMAL_MAP" and not node.uv_map:
                    node.uv_map = source_uv
        uv = obj.data.uv_layers.get("EV_Atlas") or obj.data.uv_layers.new(name="EV_Atlas")
        obj.data.uv_layers.active = uv
        uv.active_render = True
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=.035)
        bpy.ops.object.mode_set(mode="OBJECT")
        # Mode changes rebuild mesh custom data; the old RNA layer handle is stale.
        uv = obj.data.uv_layers["EV_Atlas"]
        u0, v0, u1, v1 = bounds
        for loop in uv.data:
            u, v = loop.uv
            loop.uv = (u0 + u*(u1-u0), v0 + v*(v1-v0))
        obj["ev_atlas_cell"] = list(bounds)
        copies.append(obj)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.use_clear = False
    scene.render.bake.margin = 8
    scene.render.bake.normal_space = "TANGENT"
    images = {}
    path = m["run_dir"] + "/atlas_" + job["job_id"][:8]
    scoped(root, path).mkdir(parents=True)
    for ci, channel in enumerate(["basecolor", "roughness", "metallic", "normal"]):
        image = bpy.data.images.new("EV_Atlas_"+channel, width=size, height=size, alpha=True)
        image.colorspace_settings.name = "sRGB" if channel == "basecolor" else "Non-Color"
        image.generated_color = (.5, .5, 1, 1) if channel == "normal" else (0, 0, 0, 1)
        for oi, obj in enumerate(copies):
            job_status(job, f"Baking {channel} : {obj.name}", .20 + .65*(ci*len(copies)+oi)/(4*len(copies)))
            select_only([obj])
            restores = []
            try:
                restores = bake_nodes(obj, image, channel)
                bpy.ops.object.bake(type="NORMAL" if channel == "normal" else "EMIT",
                                    use_clear=False, margin=8, uv_layer="EV_Atlas")
            finally:
                restore_bake(restores)
        save_image(image, scoped(root, path + "/" + channel + ".png"))
        images[channel] = image
    mat = atlas_material(images)
    for obj in copies:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        for face in obj.data.polygons:
            face.material_index = 0
        # Unity's FBX shaders normally read UV0. Keep the baked UV set in that slot.
        lightmap = obj.data.uv_layers.get("EV_Lightmap")
        lightmap_coords = [loop.uv[:] for loop in lightmap.data] if lightmap else None
        for layer_name in [layer.name for layer in obj.data.uv_layers]:
            if layer_name != "EV_Atlas":
                obj.data.uv_layers.remove(obj.data.uv_layers[layer_name])
        if lightmap_coords:
            lightmap = obj.data.uv_layers.new(name="EV_Lightmap")
            for loop, coord in zip(lightmap.data, lightmap_coords):loop.uv = coord
        obj.data.uv_layers.active_index = 0
        obj.data.uv_layers[0].active_render = True
    # Unity Standard/URP map: R=metallic, A=smoothness. Linear data, not sRGB.
    rough = np.empty(size*size*4, np.float32)
    metal = np.empty_like(rough)
    images["roughness"].pixels.foreach_get(rough)
    images["metallic"].pixels.foreach_get(metal)
    packed = np.ones((size, size, 4), np.float32)
    packed[:, :, 0] = metal.reshape(size, size, 4)[:, :, 0]
    packed[:, :, 3] = 1-rough.reshape(size, size, 4)[:, :, 0]
    array_image("EV_UnityMetallicSmoothness", packed,
                scoped(root, path + "/metallic_smoothness_unity.png"))
    m["atlas"] = {"path": path, "size": size, "objects": [o.name for o in copies],
                  "material": mat.name, "padding_px": 16, "bake_margin_px": 8,
                  "packing": "disjoint object grid; smart UV islands per object"}
    put_manifest(root, m)
    show_stage(scene, "atlas")
    report = validate(root)
    if not report["passed"]:
        raise RuntimeError("Contrôle UV/atlas en échec : " + json.dumps(report["errors"]))
    file = checkpoint(root, scene, m["run_dir"], "02_atlas_"+job["job_id"][:8])
    return {"atlas": m["atlas"], "blend": file, "validation": report}


def show_stage(scene, stage):
    for obj in scene.objects:
        role = obj.get("ev_role")
        if role in ("source", "atlas", "atlas_old", "lod"):
            hidden = role != stage
            obj.hide_render = hidden
            obj.hide_set(hidden)


def render_views(root, args, job):
    scene, m = scene_for(root)
    stage = args.get("stage", "atlas" if m.get("atlas") else "source")
    if stage not in ("source", "atlas"):
        raise ValueError("stage doit être source ou atlas.")
    items = objects(scene, stage)
    if not items:
        raise ValueError("Aucun objet pour cette étape.")
    show_stage(scene, stage)
    vertices = [o.matrix_world @ Vector(c) for o in items for c in o.bound_box]
    lo = Vector(tuple(min(v[i] for v in vertices) for i in range(3)))
    hi = Vector(tuple(max(v[i] for v in vertices) for i in range(3)))
    target = (lo+hi)/2
    width = max((hi-lo).x, (hi-lo).y, (hi-lo).z*1.5) * 1.32
    scene.camera.data.ortho_scale = width
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    folder = m["run_dir"] + "/previews/" + stage + "_" + job["job_id"][:8]
    paths = []
    for i, (label, direction) in enumerate([("front", (0, -6, 2.5)), ("side", (6, 0, 2.5)),
                                           ("back", (0, 6, 2.5)), ("hero", (5, -7, 5))]):
        job_status(job, f"Rendu {stage} / {label}", .1 + .2*i)
        scene.camera.location = target + Vector(direction)
        scene.camera.rotation_euler = (target-scene.camera.location).to_track_quat('-Z', 'Y').to_euler()
        file = scoped(root, folder + "/" + label + ".png")
        file.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(file)
        bpy.ops.render.render(write_still=True)
        paths.append(str(file))
    m["preview_"+stage] = paths
    put_manifest(root, m)
    return {"stage": stage, "images": paths}


def validate(root):
    scene, m = scene_for(root)
    report = {"passed": True, "errors": [], "objects": [], "atlas": m.get("atlas")}
    atlas = m.get("atlas")
    if not atlas:
        report["passed"] = False
        report["errors"].append("Aucun atlas courant.")
        return report
    for name in atlas["objects"]:
        obj = scene.objects.get(name)
        if not obj:
            report["errors"].append("Objet absent : " + name)
            continue
        uv = obj.data.uv_layers.get("EV_Atlas")
        if not uv:
            report["errors"].append("UV absent : " + name)
            continue
        cell = list(obj["ev_atlas_cell"])
        coords = np.array([loop.uv[:] for loop in uv.data])
        inside = bool(np.isfinite(coords).all() and
                      np.all(coords[:, 0] >= cell[0]-1e-5) and np.all(coords[:, 0] <= cell[2]+1e-5) and
                      np.all(coords[:, 1] >= cell[1]-1e-5) and np.all(coords[:, 1] <= cell[3]+1e-5))
        if not inside:
            report["errors"].append("UV hors cellule : " + name)
        if len(obj.data.materials) != 1 or obj.data.materials[0].name != atlas["material"]:
            report["errors"].append("Matériau d'atlas incorrect : " + name)
        obj.data.calc_loop_triangles()
        report["objects"].append({"name": name, "triangles": len(obj.data.loop_triangles),
                                  "uv_in_cell": inside, "cell": cell})
    for channel in ("basecolor", "roughness", "metallic", "normal", "metallic_smoothness_unity"):
        p = scoped(root, atlas["path"] + "/" + channel + ".png")
        if not p.exists() or p.stat().st_size == 0:
            report["errors"].append("Carte absente : " + str(p.name))
    report["passed"] = not report["errors"]
    report["scope"] = "UV bounds/cells, material sharing and output files; visual QA still required"
    atomic_json(scoped(root, atlas["path"] + "/validation.json"), report)
    return report


def export_assets(root, args, job):
    scene, m = scene_for(root)
    if not m.get("atlas"):
        raise ValueError("Construire un atlas avant l'export.")
    report = validate(root)
    if not report["passed"]:
        raise ValueError("Validation atlas en échec.")
    items = [scene.objects[name] for name in m["atlas"]["objects"]]
    show_stage(scene, "atlas")
    folder = scoped(root, m["run_dir"] + "/exports/" + job["job_id"][:8])
    folder.mkdir(parents=True)
    select_only(items)
    job_status(job, "Export GLB et FBX", .25)
    glb = folder / "EVAVEO_Test_Atlas.glb"
    fbx = folder / "EVAVEO_Test_Atlas.fbx"
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB", use_selection=True, use_active_scene=True,
                              export_yup=True, export_texcoords=True, export_normals=True)
    bpy.ops.export_scene.fbx(filepath=str(fbx), use_selection=True, object_types={"MESH"},
                             axis_forward="-Z", axis_up="Y", bake_anim=False,
                             path_mode="COPY", embed_textures=True, add_leaf_bones=False)
    outputs = [str(glb), str(fbx)]
    # Per-object GLBs, one shared atlas image per GLB. Collection GLB is the sharing test.
    for obj in items:
        select_only([obj])
        file = folder / (obj.name + ".glb")
        bpy.ops.export_scene.gltf(filepath=str(file), export_format="GLB", use_selection=True, use_active_scene=True)
        outputs.append(str(file))
    if args.get("lod", False):
        job_status(job, "Création du LOD de démonstration à 50 %", .7)
        col = collection(scene, "EV_LOD_"+job["job_id"][:8])
        lods = []
        for orig in items:
            obj = orig.copy()
            obj.data = orig.data.copy()
            obj.name = orig.name+"_LOD1"
            obj["ev_role"] = "lod"
            col.objects.link(obj)
            select_only([obj])
            mod = obj.modifiers.new("EV_LOD", "DECIMATE")
            mod.ratio = .5
            bpy.ops.object.modifier_apply(modifier=mod.name)
            lods.append(obj)
        select_only(lods)
        file = folder / "EVAVEO_Test_LOD1.glb"
        bpy.ops.export_scene.gltf(filepath=str(file), export_format="GLB", use_selection=True, use_active_scene=True)
        outputs.append(str(file))
        show_stage(scene, "atlas")
    file = checkpoint(root, scene, m["run_dir"], "03_export_"+job["job_id"][:8])
    outputs.append(file)
    m["exports"] = outputs
    put_manifest(root, m)
    return {"files": outputs, "textures": str(scoped(root, m["atlas"]["path"])),
            "note": "FBX PBR maps may need reassignment in Unity; see guide"}


def inspect(root):
    scene, m = scene_for(root)
    return {"blender": bpy.app.version_string, "pipeline": VERSION, "scene": scene.name,
            "source_objects": [o.name for o in objects(scene, "source")],
            "atlas": m.get("atlas"), "exports": m.get("exports", []),
            "materials": list(catalog(root)), "busy": BUSY, "status": STATUS}


OPERATIONS = {"create_demo": create_demo, "create_asset": create_asset,
              "register_texture": register_texture, "apply_material": apply_material,
              "build_atlas": build_atlas, "render_views": render_views,
              "export_assets": export_assets}


def dispatch(req):
    global BUSY
    if not isinstance(req, dict):
        raise ValueError("Requête JSON objet attendue.")
    op = req.get("op")
    root_value = req.get("project", "")
    if not root_value or not Path(root_value).is_absolute():
        raise ValueError("Choisir un chemin absolu de projet.")
    root = Path(root_value).resolve()
    root.mkdir(parents=True, exist_ok=True)
    if op == "ping":
        return {"ok": True, "version": VERSION, "blender": bpy.app.version_string,
                "project": str(root), "busy": BUSY}
    if BUSY:
        raise RuntimeError("Une tâche est déjà en cours. Consulter son fichier de progression.")
    if op == "inspect":
        return {"ok": True, "result": inspect(root)}
    if op == "list_materials":
        return {"ok": True, "result": catalog(root)}
    if op == "validate":
        return {"ok": True, "result": validate(root)}
    if op not in OPERATIONS:
        raise ValueError("Opération inconnue : " + str(op))
    args = req.get("args", {})
    if not isinstance(args, dict):
        raise ValueError("args doit être un objet.")
    job_id = uuid.uuid4().hex
    status_path = scoped(root, "jobs/"+job_id+".json")
    job = {"job_id": job_id, "op": op, "state": "queued", "progress": 0,
           "root": str(root), "status_path": str(status_path), "created_at": time.time()}
    BUSY = True
    job_status(job, "Tâche en attente")
    def run():
        global BUSY
        try:
            job["state"] = "running"
            job_status(job, "Démarrage : " + op, .01)
            job["result"] = OPERATIONS[op](root, args, job)
            job["state"] = "succeeded"
            job_status(job, "Terminé : " + op, 1)
        except Exception as exc:
            job["state"] = "failed"
            job["error"] = type(exc).__name__ + ": " + str(exc)
            job["traceback"] = traceback.format_exc()
            job_status(job, "Échec : " + str(exc))
        finally:
            BUSY = False
        return None
    # Return through MCP before rendering/baking occupies Blender's main thread.
    bpy.app.timers.register(run, first_interval=1.0)
    return {"ok": True, "job_id": job_id, "status_path": str(status_path)}

# Studio operations are installed after the V1 engine has finished importing.
from . import production
production.install()
