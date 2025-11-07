# URDF_Render_Script.py
# Puente Colab <-> JS para URDF Viewer + IA de descripciones por componente (secuencial).
#
# Uso:
#   from URDF_Render_Script import Download_URDF, URDF_Render
#   Download_URDF("LINK_DE_DRIVE", "URDFModel")
#   URDF_Render("URDFModel")

import os
import re
import json
import base64
import shutil
import zipfile
from typing import Dict, Any
from IPython.display import HTML

import requests

# ======================== CONFIG API ========================

API_DEFAULT_BASE = os.getenv(
    "GPT_PROXY_BASE",
    "https://gpt-proxy-github-619255898589.us-central1.run.app"
)
API_INFER_PATH = "/infer"

_COLAB_CALLBACK_REGISTERED = False


# ======================= UTILIDADES URDF =====================

def Download_URDF(Drive_Link: str, Output_Name: str = "Model") -> str:
    """Descarga ZIP de Drive y deja carpeta con /urdf y /meshes."""
    root_dir = "/content"
    file_id = Drive_Link.split("/d/")[1].split("/")[0]
    url = f"https://drive.google.com/uc?id={file_id}"
    zip_path = os.path.join(root_dir, Output_Name + ".zip")
    tmp_extract = os.path.join(root_dir, f"__tmp_extract_{Output_Name}")
    final_dir = os.path.join(root_dir, Output_Name)

    if os.path.exists(tmp_extract):
        shutil.rmtree(tmp_extract)
    os.makedirs(tmp_extract, exist_ok=True)

    if os.path.exists(final_dir):
        shutil.rmtree(final_dir)

    import gdown  # type: ignore
    gdown.download(url, zip_path, quiet=True)

    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(tmp_extract)

    def junk(n: str) -> bool:
        return n.startswith(".") or n == "__MACOSX"

    top = [n for n in os.listdir(tmp_extract) if not junk(n)]
    if len(top) == 1 and os.path.isdir(os.path.join(tmp_extract, top[0])):
        shutil.move(os.path.join(tmp_extract, top[0]), final_dir)
    else:
        os.makedirs(final_dir, exist_ok=True)
        for n in top:
            shutil.move(os.path.join(tmp_extract, n), os.path.join(final_dir, n))

    shutil.rmtree(tmp_extract, ignore_errors=True)
    return final_dir


def _encode_file_b64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def _collect_mesh_db(meshes_dir: str) -> Dict[str, str]:
    """Construye meshDB: key -> base64 (meshes + texturas)."""
    exts_bin = {".stl", ".dae", ".step", ".stp"}
    exts_tex = {".png", ".jpg", ".jpeg"}

    mesh_db: Dict[str, str] = {}

    for root, _, files in os.walk(meshes_dir):
        for name in files:
            ext = os.path.splitext(name)[1].lower()
            if ext not in (exts_bin | exts_tex):
                continue

            full = os.path.join(root, name)
            rel = os.path.relpath(full, meshes_dir).replace(os.sep, "/")
            key = f"meshes/{rel}"

            try:
                mesh_db[key] = _encode_file_b64(full)
            except Exception as e:
                print(f"[URDF] Error leyendo {full}: {e}")

    print(f"[URDF] meshDB con {len(mesh_db)} entradas.")
    return mesh_db


def _find_urdf_and_meshes(root: str):
    """Busca /urdf y /meshes en root o un nivel abajo."""
    u = os.path.join(root, "urdf")
    m = os.path.join(root, "meshes")
    if os.path.isdir(u) and os.path.isdir(m):
        return u, m

    if os.path.isdir(root):
        for name in os.listdir(root):
            cand = os.path.join(root, name)
            uu = os.path.join(cand, "urdf")
            mm = os.path.join(cand, "meshes")
            if os.path.isdir(uu) and os.path.isdir(mm):
                return uu, mm

    return None, None


def _pick_main_urdf(urdf_dir: str) -> str:
    """Elige el URDF principal (heurística: más grande con refs a meshes)."""
    urdf_files = [
        os.path.join(urdf_dir, f)
        for f in os.listdir(urdf_dir)
        if f.lower().endswith(".urdf")
    ]
    if not urdf_files:
        return ""

    urdf_files.sort(
        key=lambda p: os.path.getsize(p) if os.path.exists(p) else 0,
        reverse=True,
    )

    for upath in urdf_files:
        try:
            with open(upath, "r", encoding="utf-8", errors="ignore") as f:
                txt = f.read().lstrip("\ufeff")
            refs = re.findall(
                r'filename="([^"]+\.(?:stl|dae|step|stp))"',
                txt,
                re.IGNORECASE,
            )
            if refs:
                print(f"[URDF] Usando URDF: {os.path.basename(upath)} con {len(refs)} meshes.")
                return txt
        except Exception:
            pass

    try:
        with open(urdf_files[0], "r", encoding="utf-8", errors="ignore") as f:
            return f.read().lstrip("\ufeff")
    except Exception:
        return ""


# =================== CALLBACK COLAB SECUENCIAL ===================

def _register_colab_callback(api_base: str = API_DEFAULT_BASE, timeout: int = 120) -> None:
    """
    Registra describe_component_image (1 imagen -> 1 descripción).
    JS envía: { "key": assetKey, "image_b64": "..." }
    Python responde: { assetKey: "descripcion" }
    """
    global _COLAB_CALLBACK_REGISTERED
    if _COLAB_CALLBACK_REGISTERED:
        return

    try:
        from google.colab import output  # type: ignore
    except Exception as e:
        print(f"[Colab] No se pudo importar google.colab.output: {e}")
        return

    api_base = api_base.rstrip("/")
    infer_url = api_base + API_INFER_PATH

    def _parse_model_response(raw: str, key: str) -> Dict[str, str]:
        raw = (raw or "").strip()
        if not raw:
            return {}

        # JSON directo
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                if key in parsed and isinstance(parsed[key], (str, int, float)):
                    return {key: str(parsed[key]).strip()}
                if "description" in parsed and isinstance(parsed["description"], (str, int, float)):
                    return {key: str(parsed["description"]).strip()}
            if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
                d0 = parsed[0]
                if key in d0 and isinstance(d0[key], (str, int, float)):
                    return {key: str(d0[key]).strip()}
                if "description" in d0 and isinstance(d0["description"], (str, int, float)):
                    return {key: str(d0["description"]).strip()}
        except Exception:
            pass

        # Dict estilo Python
        try:
            fixed = (
                raw.replace("'", '"')
                .replace("False", "false")
                .replace("True", "true")
                .replace("None", "null")
            )
            parsed2 = json.loads(fixed)
            if isinstance(parsed2, dict):
                if key in parsed2 and isinstance(parsed2[key], (str, int, float)):
                    return {key: str(parsed2[key]).strip()}
                if "description" in parsed2 and isinstance(parsed2["description"], (str, int, float)):
                    return {key: str(parsed2["description"]).strip()}
        except Exception:
            pass

        # Fragmento {...}
        try:
            i = raw.find("{")
            j = raw.rfind("}")
            if i != -1 and j != -1 and j > i:
                frag = raw[i:j+1]
                parsed3 = json.loads(frag)
                if isinstance(parsed3, dict):
                    if key in parsed3 and isinstance(parsed3[key], (str, int, float)):
                        return {key: str(parsed3[key]).strip()}
                    if "description" in parsed3 and isinstance(parsed3["description"], (str, int, float)):
                        return {key: str(parsed3["description"]).strip()}
        except Exception:
            pass

        print(f"[Colab] No se pudo extraer descripción válida para {key}.")
        return {}

    def _describe_component_image(entry: Any) -> Dict[str, str]:
        print("[Colab] describe_component_image: payload recibido.")

        if isinstance(entry, list):
            if not entry:
                return {}
            entry = entry[0]

        if not isinstance(entry, dict):
            print("[Colab] Entrada inválida (no dict).")
            return {}

        key = str(entry.get("key") or "item_0")
        img_b64 = entry.get("image_b64")
        if not img_b64 or not isinstance(img_b64, str):
            print(f"[Colab] Sin image_b64 válida para {key}.")
            return {}

        payload = {
            "text": (
                "Te envío una imagen de un componente de un robot.\n"
                f"ID del componente: {json.dumps(key, ensure_ascii=False)}\n\n"
                "Devuélveme SOLO un JSON válido (sin texto extra). Formatos aceptados:\n"
                f'- {{\"{key}\": \"descripcion breve en español\"}}\n'
                '- o {\"description\": \"...\"}\n\n'
                "La descripción (1-2 frases) debe indicar función mecánica aproximada, "
                "zona del robot donde va y tipo de unión o movimiento sugerido."
            ),
            "images": [
                {
                    "image_b64": img_b64,
                    "mime": "image/png",
                }
            ],
        }

        try:
            r = requests.post(infer_url, json=payload, timeout=timeout)
        except Exception as e:
            print(f"[Colab] Error de conexión con la API IA: {e}")
            return {}

        if r.status_code != 200:
            print(f"[Colab] API IA respondió {r.status_code}: {r.text[:200]}")
            return {}

        raw = (r.text or "").strip()
        print("[Colab] Respuesta bruta IA (<=400 chars):")
        print(raw[:400])

        desc_map = _parse_model_response(raw, key)
        if desc_map:
            print(f"[Colab] OK: descripción generada para {key}.")
        else:
            print(f"[Colab] WARNING: sin descripción utilizable para {key}.")
        return desc_map

    try:
        output.register_callback("describe_component_image", _describe_component_image)
        print("[Colab] Callback 'describe_component_image' registrado (secuencial).")
        _COLAB_CALLBACK_REGISTERED = True
    except Exception as e:
        print(f"[Colab] No se pudo registrar callback describe_component_image: {e}")


# ========================= RENDER PRINCIPAL =========================

def URDF_Render(
    folder_path: str = "Model",
    select_mode: str = "link",
    background: int = 0xffffff,
    repo: str = "Arthemioxz/AutoMindCloudExperimental",
    branch: str = "main",
    compFile: str = "viewer/urdf_viewer_main.js",
    api_base: str = API_DEFAULT_BASE,
):
    """Renderiza el viewer con THREE + OrbitControls + URDFLoader + urdf_viewer_main.js."""

    _register_colab_callback(api_base=api_base)

    urdf_dir, meshes_dir = _find_urdf_and_meshes(folder_path)
    if not urdf_dir or not meshes_dir:
        return HTML(
            f"<b style='color:red'>No se encontró /urdf y /meshes en {folder_path}</b>"
        )

    urdf_text = _pick_main_urdf(urdf_dir)
    if not urdf_text:
        return HTML("<b style='color:red'>No se encontró un URDF válido.</b>")

    mesh_db = _collect_mesh_db(meshes_dir)

    urdf_b64 = base64.b64encode(urdf_text.encode("utf-8")).decode("ascii")
    mesh_db_json = json.dumps(mesh_db)

    # Cache-buster simple
    import time
    cache_bust = str(int(time.time()))

    html = f"""
<div id="urdf-viewer" style="
  width: 100%;
  height: 640px;
  border-radius: 16px;
  border: 1px solid #dde7e7;
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
  overflow: hidden;
  position: relative;
"></div>

<!-- THREE + OrbitControls + URDFLoader (globales) -->
<script src="https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js"></script>
<script src="https://cdn.jsdelivr.net/npm/urdf-loader@0.12.6/build/URDFLoader.min.js"></script>

<script type="module">
  const container = document.getElementById("urdf-viewer");
  const urdfContent = atob("{urdf_b64}");
  const meshDB = {mesh_db_json};

  import {{ render }} from "https://cdn.jsdelivr.net/gh/{repo}@{branch}/{compFile}?v={cache_bust}";

  render({{
    container,
    urdfContent,
    meshDB,
    selectMode: "{select_mode}",
    background: 0x{background:06x}
  }});
</script>
"""
    return HTML(html)
