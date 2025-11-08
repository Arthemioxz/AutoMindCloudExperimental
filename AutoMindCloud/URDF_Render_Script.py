# ==========================================================
# URDF_Render_Script.py
# - Descarga URDF desde Google Drive (opcional)
# - Construye meshDB
# - Renderiza viewer via urdf_viewer_main.js
# - Integra IA opcional usando IA_Widgets:
#     IA_Widgets = False -> NO llamadas IA, solo thumbnails UI
#     IA_Widgets = True  -> Usa thumbnails existentes, llama IA,
#                          llena app.componentDescriptions y dispara
#                          ia_descriptions_ready (para ComponentsPanel.js)
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
            raise RuntimeError(
                f"Error HTTP {resp.status_code} al descargar (Drive)."
            )

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
    Construye un meshDB básico:
      { "rel/path/to/mesh.ext": "rel/path/to/mesh.ext" }
    El sistema antiguo/AssetDB se encarga del resto (thumbs, etc).
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
                    "No comiences con 'La imagen muestra', 'La pieza' ni 'Este componente'. "
                    "Solo la descripción. "
                    "Formato JSON exacto: {\"descriptions\": {\"assetKey\": \"texto\"}}."
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
      True  -> Usa thumbnails existentes + IA → app.componentDescriptions + evento ia_descriptions_ready
      False -> NO IA, solo thumbnails locales en ComponentsPanel (costo 0)
    """
    if not os.path.isdir(folder_path):
        raise NotADirectoryError(folder_path)

    urdf_file = _find_urdf_file(folder_path)
    with open(urdf_file, "r", encoding="utf-8") as f:
        urdf_xml = f.read()

    mesh_db = _build_mesh_db(folder_path)

    if IA_Widgets:
        _register_describe_callback(api_base)

    enable_ia_js = "true" if IA_Widgets else "false"

    js = f"""
<div id="urdf-viewer" style="width:100%; height:600px; position:relative; border-radius:12px; overflow:hidden; background:#111111;"></div>

<script type="module">
  import {{ render }} from "https://cdn.jsdelivr.net/gh/{repo}@{branch}/{compFile}";

  const container = document.getElementById("urdf-viewer");

  const app = render({{
    container,
    urdfContent: {json.dumps(urdf_xml)},
    meshDB: {json.dumps(mesh_db)},
    selectMode: {json.dumps(select_mode)},
    background: {hex(background)}
  }});

  if (!app) {{
    console.error("[URDF_Render] 'render' no devolvió app.");
  }} else {{
    console.log("[URDF_Render] Viewer inicializado. IA_Widgets = {enable_ia_js}");

    // IA desactivada: no hacemos nada extra, ComponentsPanel usa app.assets.thumbnail.
    if (!({enable_ia_js})) {{
      console.log("[URDF_Render] IA_Widgets = false → sin llamadas IA. Solo thumbnails locales.");
      return;
    }}

    // IA activada: usar thumbnails existentes para mandar a Colab.
    (async () => {{
      try {{
        if (!app.assets || typeof app.assets.list !== "function" || typeof app.assets.thumbnail !== "function") {{
          console.error("[IA] app.assets.list/thumbnail no disponibles. No se puede hacer pipeline IA.");
          return;
        }}

        let items = await app.assets.list();
        if (!Array.isArray(items)) {{
          console.warn("[IA] app.assets.list() no devolvió array:", items);
          items = [];
        }}

        if (!items.length) {{
          console.warn("[IA] Sin items en app.assets.list(). Nada que describir.");
          return;
        }}

        async function urlToBase64(url) {{
          if (!url) return null;
          if (url.startsWith("data:image")) {{
            return url.replace(/^data:image\\/[^;]+;base64,/, "");
          }}
          const resp = await fetch(url);
          const blob = await resp.blob();
          return await new Promise((resolve, reject) => {{
            const reader = new FileReader();
            reader.onloadend = () => {{
              const res = reader.result || "";
              const b64 = String(res).replace(/^data:image\\/[^;]+;base64,/, "");
              resolve(b64);
            }};
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          }});
        }}

        const entries = [];
        for (const ent of items) {{
          const assetKey =
            ent.assetKey ||
            ent.key ||
            ent.path ||
            (ent.base
              ? (ent.ext ? ent.base + "." + ent.ext : ent.base)
              : null);

          if (!assetKey) continue;

          let thumbUrl = null;
          try {{
            thumbUrl = await app.assets.thumbnail(assetKey);
          }} catch (err) {{
            console.warn("[IA] Error obteniendo thumbnail para", assetKey, err);
          }}
          if (!thumbUrl) continue;

          let image_b64 = null;
          try {{
            image_b64 = await urlToBase64(thumbUrl);
          }} catch (err) {{
            console.warn("[IA] Error convirtiendo thumbnail a base64 para", assetKey, err);
          }}
          if (!image_b64) continue;

          entries.push({{ assetKey, image_b64 }});
        }}

        console.log("[IA] Entradas preparadas para IA:", entries.length);

        if (!entries.length) {{
          console.warn("[IA] No se generaron entries válidas. Abort IA.");
          return;
        }}

        const resp = await google.colab.kernel.invokeFunction(
          "describe_component_images",
          [entries],
          {{}}
        );

        console.log("[IA] Respuesta cruda Colab:", resp);

        const mapping = (resp && resp.data && resp.data[0]) ? resp.data[0] : {{}};
        if (!mapping || typeof mapping !== "object" || !Object.keys(mapping).length) {{
          console.warn("[IA] Mapping vacío o inválido:", mapping);
          return;
        }}

        // Inyectar en app para que ComponentsPanel.js lo use
        app.componentDescriptions = app.componentDescriptions || {{}};

        for (const [k, v] of Object.entries(mapping)) {{
          if (typeof v === "string" && v.trim()) {{
            app.componentDescriptions[String(k)] = v.trim();
          }}
        }}

        if (typeof app.getComponentDescription !== "function") {{
          app.getComponentDescription = (assetKey, index) => {{
            const direct = app.componentDescriptions[assetKey];
            if (direct) return direct;
            const base = String(assetKey || "").split("/").pop().split("?")[0].split("#")[0];
            const dot = base.lastIndexOf(".");
            const bare = dot >= 0 ? base.slice(0, dot) : base;
            return (
              app.componentDescriptions[base] ||
              app.componentDescriptions[bare] ||
              ""
            );
          }};
        }}

        console.log(
          "[IA] Descripciones aplicadas:",
          Object.keys(app.componentDescriptions).length
        );

        // Disparar evento global para tu ComponentsPanel.js original
        window.dispatchEvent(
          new CustomEvent("ia_descriptions_ready", {{
            detail: {{
              count: Object.keys(app.componentDescriptions).length,
            }},
          }})
        );
      }} catch (err) {{
        console.error("[IA] Error en pipeline IA:", err);
      }}
    }})();
  }}
</script>
"""
    return HTML(js)
