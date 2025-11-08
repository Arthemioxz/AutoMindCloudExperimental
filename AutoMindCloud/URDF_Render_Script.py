# ==========================================================
# URDF_Render_Script.py
# - Descarga URDF desde Google Drive
# - Renderiza viewer con urdf_viewer_main.js
# - IA_Widgets:
#     True  -> Thumbnails + IA + descripciones
#     False -> Solo thumbnails en el UI, sin IA (costo 0)
# ==========================================================

import os
import re
import json
import shutil
import zipfile
import requests

from IPython.display import HTML
from google.colab import output

API_DEFAULT_BASE = "https://gpt-proxy-github-619255898589.us-central1.run.app"
API_INFER_PATH = "/infer"

_COLAB_CALLBACK_REGISTERED = False


# ==========================================================
# Descarga URDF desde Google Drive
# ==========================================================
def Download_URDF(Drive_Link, Output_Name="Model"):
    """
    Descarga y extrae un ZIP desde un link de Google Drive.
    Uso:
        folder = Download_URDF(Link, "URDFModel")
    """
    try:
        print(f"[Download] Descargando desde: {Drive_Link}")
        file_id = Drive_Link.split("/d/")[1].split("/")[0]
        gdrive_url = f"https://drive.google.com/uc?export=download&id={file_id}"

        resp = requests.get(gdrive_url, stream=True)
        if resp.status_code != 200:
            raise RuntimeError(f"Error HTTP {resp.status_code} al descargar (Drive).")

        zip_path = f"/content/{Output_Name}.zip"
        with open(zip_path, "wb") as f:
            f.write(resp.content)

        extract_path = f"/content/{Output_Name}"
        if os.path.exists(extract_path):
            shutil.rmtree(extract_path)

        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(extract_path)

        print(f"[Download] Extraído en: {extract_path}")
        return extract_path
    except Exception as e:
        print("[Download] Error al descargar:", e)
        raise


# ==========================================================
# Utilidades URDF / Mesh
# ==========================================================
def _find_urdf_file(folder_path: str) -> str:
    for root, _, files in os.walk(folder_path):
        for f in files:
            if f.lower().endswith(".urdf"):
                return os.path.join(root, f)
    raise FileNotFoundError("No se encontró ningún archivo .urdf en " + folder_path)


def _build_mesh_db(folder_path: str):
    """
    Construye un meshDB sencillo:
      { "rel/path/to/mesh.ext": "rel/path/to/mesh.ext" }
    """
    mesh_db = {}
    for root, _, files in os.walk(folder_path):
        for f in files:
            if f.lower().endswith((".dae", ".obj", ".stl", ".glb", ".gltf")):
                full = os.path.join(root, f)
                rel = os.path.relpath(full, folder_path).replace("\\", "/")
                mesh_db[rel] = rel
    return mesh_db


# ==========================================================
# Callback IA en Colab (solo si IA_Widgets=True)
# ==========================================================
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
                    "devuelve una descripción corta, directa y técnica. "
                    "No comiences con 'La imagen muestra', 'La pieza', "
                    "ni 'Este componente'. Solo la descripción concisa. "
                    "Formato: {\"descriptions\": {\"assetKey\": \"texto\"}}."
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

        # Caso 1: { "descriptions": {k: v} }
        if isinstance(data, dict) and "descriptions" in data:
            raw = data["descriptions"]
            if isinstance(raw, dict):
                for k, v in raw.items():
                    if isinstance(v, str) and v.strip():
                        txt = v.strip()
                        txt = re.sub(
                            r"^(La imagen muestra|La pieza|Este componente)\s*[:,\-]*\s*",
                            "",
                            txt,
                            flags=re.I,
                        )
                        mapping[str(k)] = txt

        # Caso 2: lista [{assetKey, description}, ...]
        elif isinstance(data, list):
            for item in data:
                if not isinstance(item, dict):
                    continue
                k = item.get("assetKey") or item.get("id") or item.get("name")
                v = item.get("description") or item.get("text")
                if k and isinstance(v, str) and v.strip():
                    txt = re.sub(
                        r"^(La imagen muestra|La pieza|Este componente)\s*[:,\-]*\s*",
                        "",
                        v.strip(),
                        flags=re.I,
                    )
                    mapping[str(k)] = txt

        print(f"[Python/IA] Devueltas {len(mapping)} descripciones limpias.")
        return mapping

    _COLAB_CALLBACK_REGISTERED = True
    print("[Colab] ✅ Callback 'describe_component_images' registrado.")


# ==========================================================
# Render principal
# ==========================================================
def URDF_Render(
    folder_path: str,
    select_mode: str = "link",
    background: int = 0x111111,
    repo: str = "Arthemioxz/AutoMindCloudExperimental",
    branch: str = "main",
    compFile: str = "viewer/urdf_viewer_main.js",
    api_base: str = API_DEFAULT_BASE,
    IA_Widgets: bool = True,
):
    """
    IA_Widgets:
      True  -> thumbnails + IA + descripciones en UI
      False -> thumbnails en UI, sin llamadas IA
    """
    if not os.path.isdir(folder_path):
        raise NotADirectoryError(folder_path)

    urdf_file = _find_urdf_file(folder_path)
    with open(urdf_file, "r", encoding="utf-8") as f:
        urdf_xml = f.read()

    mesh_db = _build_mesh_db(folder_path)

    if IA_Widgets:
        _register_describe_callback(api_base)

    enable_ia = "true" if IA_Widgets else "false"

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
    enableIA: {enable_ia}
  }});

  // Siempre generamos thumbnails para el UI (no cuestan tokens).
  (async () => {{
    try {{
      if (!app || !app.captureComponentThumbnails || !app.setComponentThumbnails) {{
        console.error("[Thumbs] API de thumbnails no disponible en app.");
        return;
      }}

      const thumbs = await app.captureComponentThumbnails();
      console.log("[Thumbs] Capturados:", thumbs?.length);
      app.setComponentThumbnails(thumbs);

      if ({enable_ia}) {{
        // Solo si IA_Widgets=True mandamos a la IA
        const entries = thumbs.map(t => ({{
          assetKey: t.assetKey,
          image_b64: t.image_b64
        }}));

        const resp = await google.colab.kernel.invokeFunction(
          "describe_component_images",
          [entries],
          {{}}
        );

        console.log("[IA] Respuesta cruda Colab:", resp);

        const mapping = (resp && resp.data && resp.data[0]) ? resp.data[0] : {{}};
        console.log("[IA] Mapeo procesado:", mapping);

        if (mapping && Object.keys(mapping).length) {{
          app.setComponentDescriptions(mapping);
        }} else {{
          console.warn("[IA] Sin descripciones utilizables desde callback.");
        }}
      }} else {{
        console.log("[IA] IA_Widgets=False → No se llama a la IA (solo thumbnails locales).");
      }}
    }} catch (err) {{
      console.error("[Bootstrap] Error en pipeline thumbnails/IA:", err);
    }}
  }})();
</script>
"""
    return HTML(js)
