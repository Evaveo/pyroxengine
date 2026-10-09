bl_info = {
    "name": "EVAVEO Blender Bridge",
    "author": "EVAVEO",
    "version": (1, 5, 1),
    "blender": (4, 5, 0),
    "location": "View3D > Sidebar > EVAVEO",
    "description": "Relie Blender à l'éditeur EVAVEO : modélisation, matériaux, rig, atlas et export GLB pilotés depuis le moteur ou une IA (MCP)",
    "category": "Import-Export",
}

# Ce qui a changé depuis « EVAVEO Asset Pipeline » 0.2 : plus besoin du Studio Python ni de
# blender-mcp. L'addon tient lui-même un petit serveur HTTP local (server.py) que l'éditeur
# appelle directement. Le pipeline (pipeline.py, production.py) est repris tel quel.

import secrets
from pathlib import Path

import bpy
from bpy.app.handlers import persistent

from . import guards, pipeline, server


def _prefs():
    return bpy.context.preferences.addons[__package__].preferences


def _start_from_prefs():
    p = _prefs()
    if not p.token:
        p.token = secrets.token_urlsafe(24)
    server.start(p.port, p.token, guards.parse_origins(p.origins), bpy.path.abspath(p.project_dir))


class EVAVEO_Preferences(bpy.types.AddonPreferences):
    bl_idname = __package__

    port: bpy.props.IntProperty(name="Port", default=9877, min=1024, max=65535)
    token: bpy.props.StringProperty(name="Jeton", default="", subtype="PASSWORD")
    origins: bpy.props.StringProperty(
        name="Origines autorisées", default=guards.DEFAULT_ORIGINS,
        description="Pages qui peuvent appeler Blender, séparées par des virgules. L'éditeur en ligne "
                    "s'ajoute avec « Autoriser l'éditeur en ligne » (son origine copiée depuis l'Atelier)")
    project_dir: bpy.props.StringProperty(
        name="Dossier de travail", subtype="DIR_PATH",
        default=str(Path.home() / "EVAVEO_Blender"))
    autostart: bpy.props.BoolProperty(name="Démarrer avec Blender", default=True)

    def draw(self, context):
        col = self.layout.column()
        col.prop(self, "port")
        col.prop(self, "project_dir")
        col.prop(self, "origins")
        col.prop(self, "autostart")


class EVAVEO_OT_start(bpy.types.Operator):
    bl_idname = "evaveo.bridge_start"
    bl_label = "Démarrer la liaison"

    def execute(self, context):
        try:
            _start_from_prefs()
        except OSError as exc:
            self.report({"ERROR"}, "Port occupé ? " + str(exc))
            return {"CANCELLED"}
        self.report({"INFO"}, "Liaison EVAVEO à l'écoute sur 127.0.0.1:" + str(_prefs().port))
        return {"FINISHED"}


class EVAVEO_OT_stop(bpy.types.Operator):
    bl_idname = "evaveo.bridge_stop"
    bl_label = "Arrêter"

    def execute(self, context):
        server.stop()
        return {"FINISHED"}


class EVAVEO_OT_copy_token(bpy.types.Operator):
    bl_idname = "evaveo.bridge_copy_token"
    bl_label = "Copier le jeton"

    def execute(self, context):
        p = _prefs()
        if not p.token:
            p.token = secrets.token_urlsafe(24)
        context.window_manager.clipboard = p.token
        self.report({"INFO"}, "Jeton copié : collez-le dans l'Atelier Blender de l'éditeur")
        return {"FINISHED"}


class EVAVEO_OT_paste_origin(bpy.types.Operator):
    bl_idname = "evaveo.bridge_paste_origin"
    bl_label = "Autoriser l'éditeur en ligne"
    bl_description = "Colle l'origine copiée depuis l'Atelier Blender de l'éditeur (https://…) et l'autorise"

    def execute(self, context):
        p = _prefs()
        try:
            p.origins = guards.add_origin(p.origins, context.window_manager.clipboard)
        except ValueError as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}
        if server.running():
            _start_from_prefs()
        self.report({"INFO"}, "Origine autorisée")
        return {"FINISHED"}


class EVAVEO_OT_new_token(bpy.types.Operator):
    bl_idname = "evaveo.bridge_new_token"
    bl_label = "Nouveau jeton"
    bl_description = "Révoque l'ancien jeton : l'éditeur devra coller le nouveau"

    def execute(self, context):
        _prefs().token = secrets.token_urlsafe(24)
        if server.running():
            _start_from_prefs()
        return {"FINISHED"}


class EVAVEO_PT_bridge(bpy.types.Panel):
    bl_label = "EVAVEO — Liaison éditeur"
    bl_idname = "EVAVEO_PT_bridge"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "EVAVEO"

    def draw(self, context):
        p = _prefs()
        col = self.layout.column()
        if server.running():
            col.label(text="● À l'écoute sur 127.0.0.1:" + str(p.port), icon="LINKED")
            col.operator("evaveo.bridge_stop")
        else:
            col.label(text="○ Arrêtée", icon="UNLINKED")
            col.operator("evaveo.bridge_start")
        row = col.row(align=True)
        row.operator("evaveo.bridge_copy_token", icon="COPYDOWN")
        row.operator("evaveo.bridge_new_token", text="", icon="FILE_REFRESH")
        col.operator("evaveo.bridge_paste_origin", icon="WORLD")
        col.prop(p, "project_dir", text="Dossier")
        col.separator()
        col.label(text=(pipeline.STATUS or "Prêt")[:48])
        for entry in list(server.LOG)[-3:]:
            col.label(text="· " + entry.get("op", "") + " " + entry.get("action", ""))


CLASSES = (EVAVEO_Preferences, EVAVEO_OT_start, EVAVEO_OT_stop, EVAVEO_OT_copy_token,
           EVAVEO_OT_paste_origin, EVAVEO_OT_new_token, EVAVEO_PT_bridge)


@persistent
def _stop_before_load(_):
    # Ouvrir un autre .blend ne doit pas laisser un serveur pointer sur des données libérées :
    # on l'arrête, et on le relance après chargement si le démarrage auto est actif.
    server.stop()


@persistent
def _restart_after_load(_):
    _autostart()


def _autostart():
    try:
        if _prefs().autostart:
            _start_from_prefs()
    except Exception as exc:
        print("EVAVEO Blender Bridge : démarrage impossible —", exc)
    return None


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    # Le pipeline (pipeline.py, production.py) note sur la scène le dossier du projet : la propriété
    # était déclarée par l'ancien addon. Sans elle, `project_action new` levait AttributeError.
    bpy.types.Scene.evaveo_project = bpy.props.StringProperty(name="Projet", subtype="DIR_PATH", default="")
    bpy.app.handlers.load_pre.append(_stop_before_load)
    bpy.app.handlers.load_post.append(_restart_after_load)
    # Les préférences ne sont pas toujours lisibles pendant `register` : on attend un tick.
    bpy.app.timers.register(_autostart, first_interval=0.5)


def unregister():
    server.stop()
    for h, fn in ((bpy.app.handlers.load_pre, _stop_before_load),
                  (bpy.app.handlers.load_post, _restart_after_load)):
        if fn in h:
            h.remove(fn)
    if hasattr(bpy.types.Scene, "evaveo_project"):
        del bpy.types.Scene.evaveo_project
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
