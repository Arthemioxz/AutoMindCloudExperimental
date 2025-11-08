# ==========================================================
# URDF_Render_Script.py
# Versión: integración estable con IA para descripciones
# - Registra callback 'describe_component_images' en Colab
# - Renderiza viewer usando urdf_viewer_main.js desde tu repo
# - Llama AUTOMÁTICAMENTE a la IA apenas se ejecuta la celda
# - Envía thumbnails de componentes y recibe {assetKey: desc}
# ==========================================================

import os
import re
import json
import base64
import mimetypes
import zipfile
import shutil
import requests

from IPython.display import HTML
from google.colab import output

API_DEFAULT_BASE = "https://gpt-proxy-github-619255898589.us-central1.run.app"
API_INFER_PATH = "/infer"

_COLAB_CALLBACK_REGISTERED = False


def _find_urdf_file(folder_path):
    for root, _, files in os.walk(folder_path):
        for f in files:
            if f.lower().endswith(".urdf"):
                return os.path.join(root, f)
    raise FileNotFoundError("No se encontró ningún archivo .urdf en " + folder_path)


def _build_mesh_db(folder_path):
    """
    Crea un meshDB simple:
    { "relative/path/to/mesh.ext": "data:model/..." (si quieres embebido) }
    Aquí lo dejamos como rutas relativas tal como tus viewers anteriores.
    """
    mesh_db = {}
    for root, _, files in os.walk(folder_path):
        for f in files:
            if f.lower().endswith((".dae", ".obj", ".stl", ".glb", ".gltf")):
                full = os.path.join(root, f)
                rel = os.path.relpath(full, folder_path).replace("\\", "/")
                mesh_db[rel] = rel
    return mesh_db


def _register_describe_callback(api_base: str):
    global _COLAB_CALLBACK_REGISTERED
    if _COLAB_CALLBACK_REGISTERED:
        return

    @output.register_callback("describe_component_images")
    def _describe_component_images(entries):
        """
        entries: [ { "assetKey": str, "image_b64": str }, ... ]
        Debe devolver: { assetKey: "Descripción limpia" }
        """
        print(f"[Python/IA] Recibidos {len(entries)} thumbnails para describir.")

        if not entries:
            return {}

        try:
            payload = {
                "mode": "components_v1",
                "prompt": (
                    "Eres un sistema experto en robótica. Para cada imagen de componente, "
                    "devuelve una descripción corta, directa y técnica de la pieza. "
                    "No comiences con 'La imagen muestra' ni 'La pieza'. "
                    "Devuélvelo como JSON: "
                    "{ \"descriptions\": { \"assetKey\": \"texto\" } }."
                ),
                "entries": entries,
            }

            url = api_base.rstrip("/") + API_INFER_PATH
            print(f"[Python/IA] POST {url}")
            r = requests.post(url, json=payload, timeout=240)
            print("[Python/IA] Status:", r.status_code)

            r.raise_for_status()
            data = r.json()
        except Exception as e:
            print("[Python/IA] Error en petición IA:", repr(e))
            return {}

        mapping = {}

        # Formato esperado: { "descriptions": { assetKey: text } }
        if isinstance(data, dict) and "descriptions" in data:
            raw_map = data["descriptions"]
            if isinstance(raw_map, dict):
                for k, v in raw_map.items():
                    if isinstance(v, str) and v.strip():
                        clean = v.strip()
                        # Limpieza básica
                        clean = re.sub(r"^(La imagen muestra|La pieza|Este componente)\s*[:,\-]*\s*", "", clean, flags=re.I)
                        mapping[str(k)] = clean
        # Fallback: lista de objetos
        elif isinstance(data, list):
            for item in data:
                if not isinstance(item, dict):
                    continue
                k = item.get("assetKey") or item.get("id") or item.get("name")
                v = item.get("description") or item.get("text")
                if k and isinstance(v, str) and v.strip():
                    clean = re.sub(r"^(La imagen muestra|La pieza|Este componente)\s*[:,\-]*\s*", "", v.strip(), flags=re.I)
                    mapping[str(k)] = clean

        print(f"[Python/IA] Devueltas {len(mapping)} descripciones.")
        # Devuelve algo JSON-serializable para JS
        return mapping

    _COLAB_CALLBACK_REGISTERED = True
    print("[Colab] ✅ Callback 'describe_component_images' registrado.")


def URDF_Render(
    folder_path: str,
    select_mode: str = "link",
    background: int = 0x111111,
    repo: str = "Arthemioxz/AutoMindCloudExperimental",
    branch: str = "main",
    compFile: str = "viewer/urdf_viewer_main.js",
    api_base: str = API_DEFAULT_BASE,
):
    """
    Render principal. Uso:
        URDF_Render("/content/URDFModel")
    """
    if not os.path.isdir(folder_path):
        raise NotADirectoryError(folder_path)

    _register_describe_callback(api_base)

    urdf_file = _find_urdf_file(folder_path)
    with open(urdf_file, "r", encoding="utf-8") as f:
        urdf_xml = f.read()

    mesh_db = _build_mesh_db(folder_path)

    js = f"""
<div id="urdf-viewer" style="width:100%; height:600px; position:relative; border-radius:8px; overflow:hidden; background:#111111;"></div>

<script type="module">
  import {{ render }} from "https://cdn.jsdelivr.net/gh/{repo}@{branch}/{compFile}";

  const container = document.getElementById("urdf-viewer");

  const app = render({{
    container,
    urdfContent: {json.dumps(urdf_xml)},
    meshDB: {json.dumps(mesh_db)},
    selectMode: {json.dumps(select_mode)},
    background: {hex(background)},
  }});

  // 🚀 Bootstrap IA: se ejecuta inmediatamente después del render,
  // no depende del botón de componentes.
  (async () => {{
    try {{
      if (!app || !app.captureComponentThumbnails || !app.setComponentDescriptions) {{
        console.error("[Components] app no tiene APIs requeridas para IA.");
        return;
      }}

      const entries = await app.captureComponentThumbnails();
      console.log("[Components] Thumbnails generados:", entries);

      const resp = await google.colab.kernel.invokeFunction(
        "describe_component_images",
        [entries],
        {{}}
      );

      console.log("[Components] Respuesta cruda de Colab:", resp);

      const mapping = (resp && resp.data && resp.data[0]) ? resp.data[0] : {{}};
      console.log("[Components] Mapeo procesado:", mapping);

      app.setComponentDescriptions(mapping);
    }} catch (err) {{
      console.error("[Components] Error en bootstrap IA:", err);
    }}
  }})();
</script>
"""
    return HTML(js)
