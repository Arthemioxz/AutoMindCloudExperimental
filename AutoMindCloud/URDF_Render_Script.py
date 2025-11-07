# /URDF_Render_Script.py
# Render URDF + integrar viewer modular + callback describe_component_images (3 mecanismos)
import os
import re
import json
import base64
import mimetypes
import textwrap
from pathlib import Path

import requests
from IPython.display import HTML, display
from google.colab import output

# ==========================
# Config
# ==========================

# Endpoints:
# - Puedes sobreescribir con AUTOCLOUD_API_BASE o pasando api_base a register/render.
DEFAULT_API_BASE = os.environ.get(
    "AUTOMINDCLOUD_API_BASE",
    "https://gpt-proxy-github-619255898589.us-central1.run.app"
).rstrip("/")

# ==========================
# Helper: llamada HTTP
# ==========================

def _call_api(api_base, text, images, timeout=90):
    """
    Llama a /infer de tu API.
    images: lista de {image_b64, mime}
    Devuelve texto (lo que responda el modelo).
    """
    url = f"{api_base}/infer"
    payload = {"text": text}
    if images:
        payload["images"] = images

    r = requests.post(url, json=payload, timeout=timeout)
    r.raise_for_status()
    return r.text.strip()

# ==========================
# Callback Colab (3 mecanismos)
# ==========================

def _register_describe_callback(api_base=None):
    api_base = (api_base or DEFAULT_API_BASE).rstrip("/")

    def _describe_component_images(entries):
        """
        entries: lista de { "key": str, "image_b64": str }
        Devuelve JSON (str) con { key: "descripcion" }.

        M1: batch único
        M2: mini-batches (incremental)
        M3: fallback 1x1
        """
        if not entries:
            return "{}"

        # Normaliza entradas
        keys = []
        imgs = []
        for e in entries:
            k = str(e.get("key", "")).strip()
            b64 = str(e.get("image_b64", "")).strip()
            if not k or not b64:
                continue
            keys.append(k)
            imgs.append({"image_b64": b64, "mime": "image/png"})

        if not keys:
            return "{}"

        total = len(keys)
        results = {}
        timeout = 90

        # ---------- M1: batch único ----------
        try:
            print(f"[AC] M1: batch único con {total} imágenes…")
            text = (
                "Eres un ingeniero mecánico. Describe brevemente cada componente del robot "
                "que aparece en las imágenes. Devuelve SOLO un JSON (objeto) donde cada clave "
                "sea exactamente el 'key' recibido y el valor sea una descripción corta en español "
                "(1 a 2 frases, sin saltos de línea)."
            )
            raw = _call_api(api_base, text, imgs, timeout)
            maybe = json.loads(raw)
            if isinstance(maybe, dict):
                ok = 0
                for k in keys:
                    v = maybe.get(k)
                    if isinstance(v, str) and v.strip():
                        results[k] = v.strip()
                        ok += 1
                if ok:
                    print(f"[AC] ✅ M1 OK ({ok}/{total})")
                    return json.dumps(results, ensure_ascii=False)
            print("[AC] ⚠️ M1 sin JSON usable completo, paso a M2.")
        except Exception as e:
            print(f"[AC] ⚠️ M1 falló: {e}")

        # ---------- M2: mini-batches ----------
        BATCH = 8
        for i in range(0, total, BATCH):
            sub_keys = keys[i:i + BATCH]
            sub_imgs = imgs[i:i + BATCH]
            batch_id = i // BATCH + 1
            try:
                print(f"[AC] M2: batch {batch_id} ({len(sub_keys)} imágenes)…")
                text = (
                    "Describe brevemente cada componente del robot. Devuelve SOLO un JSON "
                    "objeto key→descripcion (en español, 1–2 frases)."
                )
                raw = _call_api(api_base, text, sub_imgs, timeout)
                maybe = json.loads(raw)
                if isinstance(maybe, dict):
                    got = 0
                    for k in sub_keys:
                        if k not in results:
                            v = maybe.get(k)
                            if isinstance(v, str) and v.strip():
                                results[k] = v.strip()
                                got += 1
                    print(f"[AC] ✅ M2 batch {batch_id} OK ({got}/{len(sub_keys)})")
                else:
                    print(f"[AC] ⚠️ M2 batch {batch_id}: respuesta no es JSON objeto.")
            except Exception as e:
                print(f"[AC] ⚠️ M2 batch {batch_id} falló: {e}")

        # ---------- M3: fallback 1x1 ----------
        missing = [k for k in keys if k not in results]
        if missing:
            print(f"[AC] M3: fallback 1x1 para {len(missing)} piezas…")

        for idx, k in enumerate(keys):
            if k in results:
                continue
            img = imgs[idx]
            try:
                text = (
                    "Describe brevemente la pieza del robot que se ve en esta imagen. "
                    "Devuelve una frase corta en español."
                )
                raw = _call_api(api_base, text, [img], timeout)
                desc = ""
                # Puede responder texto plano o JSON
                try:
                    maybe = json.loads(raw)
                    if isinstance(maybe, str):
                        desc = maybe
                    elif isinstance(maybe, dict) and maybe:
                        # toma el primer valor string
                        for v in maybe.values():
                            if isinstance(v, str) and v.strip():
                                desc = v
                                break
                    else:
                        desc = str(raw)
                except Exception:
                    desc = str(raw)
                results[k] = (desc or "").strip()
                print(f"[AC] ✅ M3 {k}: OK")
            except Exception as e:
                print(f"[AC] ❌ M3 {k}: {e}")
                results[k] = ""

        print(f"[AC] ✅ Callback completado ({len(results)}/{total})")
        return json.dumps(results, ensure_ascii=False)

    try:
        output.register_callback("describe_component_images", _describe_component_images)
        print("[AC] Callback 'describe_component_images' registrado (3 mecanismos).")
    except Exception as e:
        print(f"[AC] ⚠️ No se pudo registrar callback: {e}")

# ==========================
# Helper: construir HTML viewer
# ==========================

def _b64_file(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def _collect_mesh_db(mesh_root: Path):
    mesh_db = {}
    if not mesh_root or not mesh_root.exists():
        return mesh_db
    for p in mesh_root.rglob("*"):
        if not p.is_file():
            continue
        ext = p.suffix.lower().lstrip(".")
        if not ext:
            continue
        mime, _ = mimetypes.guess_type(p.name)
        if not mime:
            mime = "application/octet-stream"
        b64 = _b64_file(p)
        mesh_db[p.as_posix()] = b64
    return mesh_db


def URDF_Render(
    urdf_path: str,
    mesh_dir: str,
    api_base: str = None,
    width: str = "100%",
    height: str = "520px",
):
    """
    Renderiza un URDF con el viewer modularizado + integra el sistema de descripciones.
    - urdf_path: ruta al .urdf
    - mesh_dir: carpeta con meshes/texturas
    """
    api_base = (api_base or DEFAULT_API_BASE).rstrip("/")

    urdf_path = Path(urdf_path)
    mesh_root = Path(mesh_dir)

    if not urdf_path.exists():
        raise FileNotFoundError(f"URDF no encontrado: {urdf_path}")
    if not mesh_root.exists():
        raise FileNotFoundError(f"Carpeta meshes no encontrada: {mesh_root}")

    urdf_text = urdf_path.read_text(encoding="utf-8")
    mesh_db = _collect_mesh_db(mesh_root)

    # Registra callback (3 mecanismos)
    _register_describe_callback(api_base)

    # HTML con viewer modular
    # Importa /viewer/urdf_viewer_main.js desde tu repo (ESM) y llama a render(opts)
    mesh_db_json = json.dumps(mesh_db)
    urdf_json = json.dumps(urdf_text)

    html = f"""
    <div id="urdf-viewer-root" style="width:{width};height:{height};border-radius:16px;overflow:hidden;border:1px solid #d7e7e7;"></div>
    <script type="module">
      import * as mod from "https://cdn.jsdelivr.net/gh/ArtemioA/AutoMindCloudExperimental/viewer/urdf_viewer_main.js";

      const container = document.getElementById("urdf-viewer-root");

      const opts = {{
        container,
        urdfContent: {urdf_json},
        meshDB: {mesh_db_json},
        selectMode: "link",
        background: 0xffffff,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        autoResize: true
      }};

      try {{
        if (!mod || typeof mod.render !== "function") {{
          console.error("[URDF] urdf_viewer_main.js debe exportar function render(opts).");
        }} else {{
          mod.render(opts);
        }}
      }} catch (e) {{
        console.error("[URDF] Error al inicializar viewer:", e);
      }}
    </script>
    """
    display(HTML(textwrap.dedent(html)))
