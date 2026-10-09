"""Pure helpers shared by Blender and the local client. No Blender dependency."""
import json
import math
import re
import time
from pathlib import Path

VERSION = "0.2.0"


def slug(value):
    value = str(value)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", value):
        raise ValueError("Identifiant attendu : 1 à 64 lettres/chiffres, tirets ou underscores.")
    return value


def scoped(root, relative):
    root = Path(root).expanduser().resolve()
    p = (root / relative).resolve()
    if not p.is_relative_to(root):
        raise ValueError("Le chemin doit rester dans le dossier du projet.")
    return p


def atomic_json(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    # Windows refuse de remplacer un fichier ouvert : le serveur lit justement l'état d'un job
    # (/job/<id>) pendant que le pipeline le réécrit. On réessaie quelques millisecondes.
    for attempt in range(40):
        try:
            temp.replace(path)
            return
        except PermissionError:
            if attempt == 39:
                raise
            time.sleep(0.005)


def grid_cells(count, size, padding=16):
    """Disjoint object cells. Deliberately predictable, not optimal bin-packing."""
    if not 1 <= count <= 64:
        raise ValueError("L'atlas accepte entre 1 et 64 objets.")
    if size not in (512, 1024, 2048, 4096):
        raise ValueError("Résolution attendue : 512, 1024, 2048 ou 4096.")
    cols = math.ceil(math.sqrt(count))
    rows = math.ceil(count / cols)
    if padding < 1 or min(size / cols, size / rows) <= 2 * padding + 8:
        raise ValueError("Résolution insuffisante pour les marges demandées.")
    return [((i % cols) / cols + padding / size,
             (i // cols) / rows + padding / size,
             (i % cols + 1) / cols - padding / size,
             (i // cols + 1) / rows - padding / size)
            for i in range(count)]


def checked_parts(parts):
    if not isinstance(parts, list) or not 1 <= len(parts) <= 100:
        raise ValueError("Un objet doit contenir de 1 à 100 primitives.")
    out = []
    for p in parts:
        if not isinstance(p, dict):
            raise ValueError("Chaque primitive doit être un objet JSON.")
        kind = p.get("kind", "cube")
        if kind not in ("cube", "cylinder", "sphere", "cone"):
            raise ValueError("Primitive inconnue : " + str(kind))
        item = {"kind": kind}
        for key, default in [("location", [0, 0, 0]), ("dimensions", [1, 1, 1]),
                             ("rotation_deg", [0, 0, 0])]:
            a = p.get(key, default)
            if not isinstance(a, (list, tuple)) or len(a) != 3:
                raise ValueError(key + " doit contenir trois nombres.")
            a = [float(x) for x in a]
            if not all(math.isfinite(x) for x in a):
                raise ValueError("Coordonnée non finie.")
            if key == "dimensions" and not all(.001 <= x <= 100 for x in a):
                raise ValueError("Dimensions autorisées : 0,001 à 100 mètres.")
            if key == "location" and not all(abs(x) <= 1000 for x in a):
                raise ValueError("Position hors limites.")
            item[key] = a
        bevel = float(p.get("bevel", .01))
        if not math.isfinite(bevel) or not 0 <= bevel <= .2:
            raise ValueError("Bevel attendu entre 0 et 0,2 m.")
        item["bevel"] = bevel
        out.append(item)
    return out
