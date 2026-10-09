"""Les bornes du serveur local, sans Blender : `python -m unittest discover -s tests`.

guards.py n'importe pas bpy, et c'est voulu : tout ce qui décide si une requête passe doit pouvoir
être vérifié ici, avec un Python ordinaire.
"""
import importlib.util
import tempfile
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "guards", Path(__file__).resolve().parent.parent / "evaveo_blender_bridge" / "guards.py")
guards = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guards)


class TokenTest(unittest.TestCase):
    def test_bon_jeton(self):
        self.assertTrue(guards.token_ok("Bearer abc", "abc"))

    def test_jeton_absent_faux_ou_vide(self):
        self.assertFalse(guards.token_ok(None, "abc"))
        self.assertFalse(guards.token_ok("Bearer abd", "abc"))
        self.assertFalse(guards.token_ok("abc", "abc"))
        self.assertFalse(guards.token_ok("Bearer ", ""))


class OriginTest(unittest.TestCase):
    def test_jamais_d_etoile(self):
        self.assertIsNone(guards.allowed_origin("https://x.example", []))
        self.assertEqual(guards.cors_headers("https://x.example", []), {})
        o = guards.parse_origins(guards.DEFAULT_ORIGINS)
        self.assertEqual(guards.allowed_origin("http://127.0.0.1:8080", o), "http://127.0.0.1:8080")
        self.assertIsNone(guards.allowed_origin("https://x.example", o))

    def test_ajout_origine(self):
        txt = guards.add_origin(guards.DEFAULT_ORIGINS, "https://cloud.example/")
        self.assertIn("https://cloud.example", guards.parse_origins(txt))
        self.assertEqual(guards.add_origin(txt, "https://cloud.example"), txt)
        for bad in ("javascript:alert(1)", "https://a.example/chemin", "*", ""):
            with self.assertRaises(ValueError):
                guards.add_origin(txt, bad)

    def test_liste_blanche(self):
        o = guards.parse_origins("http://localhost:*, https://cloud.example/")
        self.assertEqual(guards.allowed_origin("http://localhost:8080", o), "http://localhost:8080")
        self.assertEqual(guards.allowed_origin("https://cloud.example", o), "https://cloud.example")
        self.assertIsNone(guards.allowed_origin("https://evil.example", o))
        self.assertIsNone(guards.allowed_origin("http://localhost:80x", o))

    def test_reseau_prive(self):
        h = guards.cors_headers("http://localhost:1025", ["http://localhost:*"], True)
        self.assertEqual(h["Access-Control-Allow-Private-Network"], "true")
        self.assertIn("Authorization", h["Access-Control-Allow-Headers"])
        self.assertEqual(guards.cors_headers("https://evil.example", ["http://a"]), {})


class PathTest(unittest.TestCase):
    def test_confinement(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "root"
            root.mkdir()
            (root / "a.glb").write_bytes(b"glTF")
            (Path(d) / "secret.txt").write_text("x")
            self.assertEqual(guards.scoped_file(root, "a.glb").name, "a.glb")
            self.assertEqual(guards.scoped_file(root, str(root / "a.glb")).name, "a.glb")
            with self.assertRaises(PermissionError):
                guards.scoped_file(root, "../secret.txt")
            with self.assertRaises(PermissionError):
                guards.scoped_file(root, str(Path(d) / "secret.txt"))
            with self.assertRaises(FileNotFoundError):
                guards.scoped_file(root, "absent.glb")

    def test_nom_upload(self):
        self.assertEqual(guards.upload_name("..\\..\\concept.png"), "concept.png")
        self.assertEqual(guards.upload_name("dir/hero_v2.GLB"), "hero_v2.GLB")
        for bad in ("", "a..png", "script.py", ".png", "x y.png"):
            with self.assertRaises(ValueError):
                guards.upload_name(bad)


class OperationTest(unittest.TestCase):
    def test_operations(self):
        self.assertTrue(guards.operation_ok("delivery_action"))
        self.assertFalse(guards.operation_ok("execute_blender_code"))
        self.assertTrue(guards.job_id_ok("0" * 32))
        self.assertFalse(guards.job_id_ok("../../x"))


if __name__ == "__main__":
    unittest.main()
