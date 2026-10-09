"""Les bornes du serveur local, SANS dépendance à Blender.

Tout ce qui décide si une requête passe est ici, et seulement ici : c'est ce qui permet de le
tester avec un Python ordinaire (tests/test_guards.py), sans lancer Blender. Le serveur
(server.py) ne fait que câbler ces fonctions aux routes.

Trois portes, dans cet ordre :
  · le JETON — sans lui, rien d'autre que /hello ne répond ;
  · l'ORIGINE — écho CORS seulement pour une origine de la liste blanche. Jamais `*` : même avec
    un jeton, il laisserait n'importe quelle page tenter sa chance (docs/PLUGINS.md § 9). Par
    défaut, l'éditeur lancé en local ; l'éditeur en ligne s'ajoute en collant son origine ;
  · le CHEMIN — un fichier lu ou écrit reste dans le dossier de travail, jamais à côté.
"""
import hmac
import re
from pathlib import Path

PROTOCOL = 1
MAX_BODY = 256 * 1024 * 1024
UPLOAD_EXTENSIONS = ("png", "jpg", "jpeg", "webp", "glb", "gltf", "fbx", "obj", "stl")
CONTENT_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".fbx": "application/octet-stream",
    ".obj": "text/plain", ".stl": "model/stl", ".json": "application/json",
}
# Les opérations que le moteur peut demander. Rien d'autre n'atteint `pipeline.dispatch`, et
# aucune ne prend du code : seulement des paramètres JSON.
OPERATIONS = (
    "ping", "inspect", "validate", "list_materials", "build_atlas",
    "project_action", "model_geometry", "material_action", "uv_action", "rig_action",
    "animation_action", "inspect_mesh", "import_asset", "delivery_action",
)
DEFAULT_ORIGINS = "http://localhost:*, http://127.0.0.1:*"
_ORIGIN = re.compile(r"https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?")
_JOB_ID = re.compile(r"[0-9a-f]{32}")
_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}")


def token_ok(header, token):
    """`Authorization: Bearer <jeton>`, comparé en temps constant."""
    if not token or not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[7:].strip().encode("utf-8"), token.encode("utf-8"))


def parse_origins(text):
    """« a, b » → ['a', 'b']. Une liste vide n'autorise aucune page."""
    return [o.strip().rstrip("/") for o in (text or "").split(",") if o.strip()]


def allowed_origin(origin, origins):
    """L'origine à renvoyer dans Access-Control-Allow-Origin, ou None pour n'en renvoyer aucune."""
    if not origin or not origins:
        return None
    origin = origin.rstrip("/")
    for o in origins:
        if o == origin:
            return origin
        # `http://localhost:*` : tout port de cet hôte.
        if o.endswith(":*") and origin.startswith(o[:-1]) and origin[len(o) - 1:].isdigit():
            return origin
    return None


def cors_headers(origin, origins, private_network=False):
    allow = allowed_origin(origin, origins)
    if allow is None:
        return {}
    h = {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin",
    }
    # Chrome (Private / Local Network Access) : une page publique qui appelle 127.0.0.1 envoie
    # ce drapeau au préflight, et n'ira pas plus loin sans la réponse.
    if private_network:
        h["Access-Control-Allow-Private-Network"] = "true"
    return h


def origin_ok(value):
    """Une origine bien formée (schéma, hôte, port éventuel), sans chemin."""
    return bool(_ORIGIN.fullmatch((value or "").strip().rstrip("/")))


def add_origin(text, origin):
    """Ajoute `origin` à la liste « a, b » si elle n'y est pas. Rend la nouvelle liste en texte."""
    origin = (origin or "").strip().rstrip("/")
    if not origin_ok(origin):
        raise ValueError("Origine invalide : https://hôte[:port] attendu.")
    items = parse_origins(text)
    if origin not in items:
        items.append(origin)
    return ", ".join(items)


def job_id_ok(value):
    return bool(_JOB_ID.fullmatch(value or ""))


def operation_ok(op):
    return op in OPERATIONS


def scoped_file(root, path):
    """Un chemin rendu par l'addon (absolu ou relatif) → Path, s'il reste dans `root`."""
    root = Path(root).expanduser().resolve()
    p = Path(path)
    p = (p if p.is_absolute() else root / p).resolve()
    if not p.is_relative_to(root):
        raise PermissionError("Chemin hors du dossier de travail.")
    if not p.is_file():
        raise FileNotFoundError("Fichier introuvable.")
    return p


def upload_name(name):
    """Assainit le nom d'un fichier envoyé : un nom simple, une extension permise, aucun dossier."""
    base = re.split(r"[\\/]", name or "")[-1]
    if not _NAME.fullmatch(base) or ".." in base:
        raise ValueError("Nom de fichier refusé : lettres, chiffres, « _ », « - » et « . » seulement.")
    ext = base.rsplit(".", 1)[-1].lower() if "." in base else ""
    if ext not in UPLOAD_EXTENSIONS:
        raise ValueError("Extension refusée : " + ", ".join(UPLOAD_EXTENSIONS) + ".")
    return base


def content_type(path):
    return CONTENT_TYPES.get(Path(path).suffix.lower(), "application/octet-stream")
