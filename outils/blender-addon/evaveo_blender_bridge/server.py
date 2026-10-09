"""Le serveur local que le moteur appelle : HTTP sur 127.0.0.1, protocole v1.

Il remplace la chaîne Studio Python → blender-mcp → `execute_blender_code`. Le moteur envoie
des opérations JSON ; elles sont exécutées par `pipeline.dispatch`, celui-là même que le Studio
atteignait par MCP. Aucune route n'exécute de code reçu.

UN FIL HTTP, UN FIL BLENDER. bpy n'est pas utilisable hors du fil principal : le fil HTTP dépose
chaque appel dans une file, qu'un minuteur `bpy.app.timers` vide sur le fil principal. Les
opérations longues (rendu, bake, export) sont déjà des jobs côté pipeline : `dispatch` rend un
`job_id` tout de suite et le travail démarre au minuteur suivant. Le moteur suit ensuite
`/job/<id>`, qui ne fait que relire le fichier d'état écrit par le pipeline — sans passer par le
fil principal, donc sans attendre la fin d'un rendu pour répondre.

Routes (jeton exigé partout sauf /hello) :
  GET  /hello             protocole, versions, dossier de travail, opérations
  POST /call              {op, args} → résultat de dispatch (souvent {job_id})
  GET  /job/<id>          état d'un job : state, progress, message, result | error
  GET  /file?path=        octets d'un fichier du dossier de travail
  GET  /log               derniers appels reçus
  POST /upload?name=      corps binaire → écrit dans uploads/, rend le chemin relatif
"""
import json
import queue
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import bpy

from . import guards
from .common import VERSION

BRIDGE_VERSION = "1.5.1"
HOST = "127.0.0.1"

_tasks = queue.Queue()
_server = None
_thread = None
_blender_version = ""
CONFIG = {"token": "", "origins": [], "project": "", "port": 9877}
LOG = deque(maxlen=30)


def _on_main(fn, timeout=30.0):
    """Exécute `fn` sur le fil principal de Blender et rend son résultat (ou lève son erreur)."""
    done = threading.Event()
    box = {}

    def task():
        try:
            box["value"] = fn()
        except Exception as exc:  # l'erreur repart vers le moteur, en clair
            box["error"] = type(exc).__name__ + ": " + str(exc)
        finally:
            done.set()

    _tasks.put(task)
    if not done.wait(timeout):
        raise TimeoutError("Blender ne répond pas : une opération occupe déjà le fil principal.")
    if "error" in box:
        raise RuntimeError(box["error"])
    return box["value"]


def _pump():
    try:
        while True:
            _tasks.get_nowait()()
    except queue.Empty:
        pass
    return 0.05 if _server else None


def _root():
    root = Path(CONFIG["project"]).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


class Handler(BaseHTTPRequestHandler):
    server_version = "EvaveoBlenderBridge/" + BRIDGE_VERSION

    def log_message(self, *args):  # pas de bruit dans la console de Blender
        pass

    # ---------- réponses ----------

    def _cors(self):
        return guards.cors_headers(self.headers.get("Origin"), CONFIG["origins"],
                                   bool(self.headers.get("Access-Control-Request-Private-Network")))

    def _send(self, status, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        else:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        for k, v in self._cors().items():
            self.send_header(k, v)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _error(self, status, message):
        self._send(status, {"ok": False, "error": message})

    def _authed(self):
        if guards.token_ok(self.headers.get("Authorization"), CONFIG["token"]):
            return True
        self._error(401, "Jeton absent ou invalide : copier le jeton affiché dans Blender (panneau EVAVEO).")
        return False

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > guards.MAX_BODY:
            raise ValueError("Corps trop gros (256 Mo maximum).")
        return self.rfile.read(n) if n else b""

    # ---------- routes ----------

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in self._cors().items():
            self.send_header(k, v)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        try:
            if url.path == "/hello":
                from . import pipeline
                return self._send(200, {
                    "ok": True, "protocol": guards.PROTOCOL, "bridge": BRIDGE_VERSION,
                    "pipeline": VERSION, "blender": _blender_version,
                    "project": str(_root()), "busy": bool(pipeline.BUSY),
                    "operations": list(guards.OPERATIONS)})
            if not self._authed():
                return
            if url.path.startswith("/job/"):
                job_id = url.path[5:]
                if not guards.job_id_ok(job_id):
                    return self._error(400, "Identifiant de job invalide.")
                f = _root() / "jobs" / (job_id + ".json")
                if not f.is_file():
                    return self._error(404, "Job inconnu.")
                # Le pipeline remplace ce fichier pendant qu'on le lit : une lecture à moitié écrite
                # ou refusée (Windows) se réessaie.
                for attempt in range(20):
                    try:
                        return self._send(200, json.loads(f.read_text(encoding="utf-8")))
                    except (PermissionError, json.JSONDecodeError):
                        if attempt == 19:
                            raise
                        time.sleep(0.01)
            if url.path == "/file":
                path = (parse_qs(url.query).get("path") or [""])[0]
                f = guards.scoped_file(_root(), path)
                return self._send(200, f.read_bytes(), guards.content_type(f))
            if url.path == "/log":
                return self._send(200, {"ok": True, "log": list(LOG)})
            self._error(404, "Route inconnue.")
        except PermissionError as exc:
            self._error(403, str(exc))
        except FileNotFoundError as exc:
            self._error(404, str(exc))
        except Exception as exc:
            self._error(500, type(exc).__name__ + ": " + str(exc))

    def do_POST(self):
        url = urlparse(self.path)
        try:
            if not self._authed():
                return
            if url.path == "/call":
                req = json.loads(self._body() or b"{}")
                op = req.get("op")
                if not guards.operation_ok(op):
                    return self._error(400, "Opération inconnue : " + str(op))
                args = req.get("args") or {}
                if not isinstance(args, dict):
                    return self._error(400, "args doit être un objet.")
                LOG.append({"op": op, "action": str(args.get("action", ""))})
                root = str(_root())
                from . import pipeline
                result = _on_main(lambda: pipeline.dispatch({"op": op, "args": args, "project": root}))
                return self._send(200, result)
            if url.path == "/upload":
                name = guards.upload_name((parse_qs(url.query).get("name") or [""])[0])
                data = self._body()
                folder = _root() / "uploads"
                folder.mkdir(parents=True, exist_ok=True)
                (folder / name).write_bytes(data)
                LOG.append({"op": "upload", "action": name})
                return self._send(200, {"ok": True, "path": "uploads/" + name, "bytes": len(data)})
            self._error(404, "Route inconnue.")
        except (ValueError, json.JSONDecodeError) as exc:
            self._error(400, str(exc))
        except TimeoutError as exc:
            self._error(503, str(exc))
        except Exception as exc:
            self._error(500, str(exc))


def running():
    return _server is not None


def start(port, token, origins, project):
    """Démarre le serveur. Il n'écoute QUE sur 127.0.0.1 : une autre interface n'est pas proposée."""
    global _server, _thread, _blender_version
    stop()
    if not token:
        raise ValueError("Jeton vide.")
    CONFIG.update({"port": int(port), "token": token, "origins": list(origins), "project": project})
    _blender_version = bpy.app.version_string
    _server = ThreadingHTTPServer((HOST, int(port)), Handler)
    _server.daemon_threads = True
    _thread = threading.Thread(target=_server.serve_forever, name="evaveo-bridge", daemon=True)
    _thread.start()
    if not bpy.app.timers.is_registered(_pump):
        bpy.app.timers.register(_pump, first_interval=0.05, persistent=True)


def stop():
    global _server, _thread
    if _server:
        _server.shutdown()
        _server.server_close()
    _server = None
    _thread = None
    if bpy.app.timers.is_registered(_pump):
        bpy.app.timers.unregister(_pump)
