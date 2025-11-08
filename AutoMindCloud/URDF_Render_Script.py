# ==========================================================
# URDF_Render_Script.py
# ----------------------------------------------------------
# Puente Colab <-> JS para descripciones de piezas del URDF.
#
# Flujo:
#  - JS genera:
#       * 1 imagen de contexto ISO del robot completo (is_context = true)
#       * 1 imagen por componente (is_context = false)
#  - Envía TODO en UNA llamada:
#       google.colab.kernel.invokeFunction(
#           "describe_component_images",
#           [entries],
#           {}
#       )
#    donde entries es una lista de:
#       {
#         "assetKey": str,
#         "image_b64": str,   # sin "data:image..."
#         "mime": "image/jpeg" | "image/png",
#         "is_context": bool
#       }
#  - Este script hace UN solo POST a /infer y espera SOLO:
#       { "assetKey1": "desc", "assetKey2": "desc", ... }
#  - Devuelve al JS:
#       { "descriptions": { assetKey: "desc limpia" } }
#
# Además:
#  - IA_Widgets=True registra el callback y NO debe achicar el viewer:
#       * Fullscreen en el iframe de Colab
#       * setIframeHeight para ocupar bien el alto disponible
# ==========================================================

import os
import re
import json
import base64
import shutil
import zipfile
import requests
from IPython.display import HTML

API_DEFAULT_BASE = "https://gpt-proxy-github-619255898589.us-central1.run.app"
API_INFER_PATH = "/infer"

_COLAB_CALLBACK_REGISTERED = False


# ----------------------------------------------------------
# Utilidades
# ----------------------------------------------------------

def Download_URDF(Drive_Link, Output_Name="Model"):
    """
    Descarga un ZIP de Google Drive y lo deja en /content/Output_Name
    con subcarpetas /urdf y /meshes.
    """
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

    import gdown
    gdown.download(url, zip_path, quiet=True)

    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(tmp_extract)

    def junk(name: str) -> bool:
        return name.startswith(".") or name == "__MACOSX"

    visibles = [n for n in os.listdir(tmp_extract) if not junk(n)]
    if len(visibles) == 1 and os.path.isdir(os.path.join(tmp_extract, visibles[0])):
        shutil.move(os.path.join(tmp_extract, visibles[0]), final_dir)
    else:
        os.makedirs(final_dir, exist_ok=True)
        for n in visibles:
            shutil.move(os.path.join(tmp_extract, n), os.path.join(final_dir, n))

    shutil.rmtree(tmp_extract, ignore_errors=True)
    return final_dir


def _clean_desc(s: str) -> str:
    """Limpia frases flojas y deja descripción técnica y directa."""
    if not s:
        return ""
    s = s.strip()

    prefixes = [
        "La imagen muestra",
        "la imagen muestra",
        "Esta imagen muestra",
        "En la imagen se ve",
        "La pieza mostrada",
        "La pieza",
        "El componente mostrado",
        "El componente",
    ]
    for p in prefixes:
        if s.startswith(p):
            s = s[len(p):].lstrip(" :,-")

    if s:
        s = s[0].upper() + s[1:]
    return s


def _extract_json(text: str):
    """Intenta extraer el primer objeto JSON válido de un texto."""
    text = (text or "").strip()
    try:
        return json.loads(text)
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        snippet = text[start : end + 1]
        try:
            return json.loads(snippet)
        except Exception:
            return None
    return None


def _call_infer_api_batch(entries, infer_url: str, timeout: int = 180):
    """
    Llama a la API /infer UNA vez con:
      - imágenes de contexto (is_context = true)
      - imágenes de componentes (is_context = false)

    entries: lista de dicts:
      {
        "assetKey": str,
        "image_b64": str,
        "mime": str,
        "is_context": bool
      }

    Se construye un prompt que:
      - Explica que las primeras imágenes (si hay) son contexto del robot completo.
      - El resto son componentes, en el mismo orden que sus assetKey.
      - Pide como salida SOLO un JSON:
            { "assetKey": "descripcion", ... }

    Devuelve:
      dict { assetKey: desc_limpia }
    """
    if not isinstance(entries, (list, tuple)) or not entries:
        return {}

    contexts = [e for e in entries if e.get("is_context")]
    parts = [e for e in entries if not e.get("is_context")]

    if not parts:
        return {}

    images_payload = []

    # primero contexto
    for c in contexts:
        b64 = c.get("image_b64") or ""
        if not b64:
            continue
        images_payload.append(
            {
                "image_b64": b64,
                "mime": c.get("mime") or "image/jpeg",
            }
        )

    # luego partes
    part_keys = []
    for p in parts:
        key = p.get("assetKey") or p.get("key")
        b64 = p.get("image_b64") or ""
        if not key or not b64:
            continue
        images_payload.append(
            {
                "image_b64": b64,
                "mime": p.get("mime") or "image/jpeg",
            }
        )
        part_keys.append(key)

    if not part_keys or not images_payload:
        return {}

    # Prompt
    lines = []
    if contexts:
        lines.append(
            f"Las primeras {len(contexts)} imágenes son del robot completo en vista isométrica como CONTEXTO global."
        )
    else:
        lines.append("No se incluyen imágenes explícitas de contexto global del robot.")

    lines.append(
        "Después vienen imágenes de componentes individuales del robot, en el mismo orden que esta lista de assetKey:"
    )
    lines.append(", ".join(part_keys))
    lines.append(
        (
            "Responde EXCLUSIVAMENTE con un objeto JSON. "
            "Cada clave debe ser uno de esos assetKey y cada valor una descripción técnica, concisa y determinante "
            "de la pieza en español, máximo 25 palabras, sin frases como "
            "'La imagen muestra' ni viñetas ni texto extra."
        )
    )

    payload = {
        "text": "\n".join(lines),
        "images": images_payload,
    }

    try:
        r = requests.post(infer_url, json=payload, timeout=timeout)
    except Exception as e:
        print(f"[Colab] Error de red en /infer: {e}")
        return {}

    if r.status_code != 200:
        print(f"[Colab] /infer {r.status_code}: {r.text[:400]}")
        return {}

    # Intentar parsear JSON directamente
    data = None
    try:
        data = r.json()
    except Exception:
        data = _extract_json(r.text)

    if not isinstance(data, dict):
        print("[Colab] Respuesta de /infer no interpretable como JSON.")
        return {}

    result = {}
    for key, val in data.items():
        if isinstance(key, str) and isinstance(val, str):
            cleaned = _clean_desc(val)
            if cleaned:
                result[key] = cleaned

    if not result:
        print("[Colab] JSON de /infer sin descripciones utilizables.")
    return result


# ----------------------------------------------------------
# Callback Colab: describe_component_images
# ----------------------------------------------------------

def _register_colab_callback(api_base: str = API_DEFAULT_BASE, timeout: int = 180):
    global _COLAB_CALLBACK_REGISTERED
    if _COLAB_CALLBACK_REGISTERED:
        return

    try:
        from google.colab import output  # type: ignore
    except Exception as e:
        print(f"[Colab] No se pudo importar google.colab.output: {e}")
        return

    infer_url = api_base.rstrip("/") + API_INFER_PATH

    def _describe_component_images(entries):
        """
        entries: lista enviada desde JS con:
          {
            "assetKey": str,
            "image_b64": str,
            "mime": str,
            "is_context": bool
          }

        Devuelve:
          { "descriptions": { assetKey: "desc limpia" } }
        """
        if not isinstance(entries, list):
            print("[Colab] Payload inválido en describe_component_images (no lista).")
            return {"descriptions": {}}

        print(f"[Colab] describe_component_images: {len(entries)} entradas recibidas.")

        mapping = _call_infer_api_batch(entries, infer_url, timeout=timeout)
        print(f"[Colab] describe_component_images: {len(mapping)} descripciones generadas.")
        return {"descriptions": mapping}

    output.register_callback("describe_component_images", _describe_component_images)
    _COLAB_CALLBACK_REGISTERED = True
    print("[Colab] ✅ Callback 'describe_component_images' registrado (batch único).")


# ----------------------------------------------------------
# URDF_Render: renderiza viewer + opcional IA
# ----------------------------------------------------------

def URDF_Render(
    folder_path: str = "Model",
    select_mode: str = "link",
    background: int | None = 0xFFFFFF,
    repo: str = "Arthemioxz/AutoMindCloudExperimental",
    branch: str = "main",
    compFile: str = "AutoMindCloud/viewer/urdf_viewer_main.js",
    api_base: str = API_DEFAULT_BASE,
    IA_Widgets: bool = False,
):
    """
    Renderiza el URDF Viewer para Colab.

    - Siempre:
        * Carga URDF + meshes desde folder_path.
        * Inserta meshDB embebido.
        * Muestra viewer fullscreen + ToolsDock + ComponentsPanel.
    - Si IA_Widgets=True:
        * Registra callback 'describe_component_images'.
        * JS envía TODAS las imágenes en una sola llamada.
    """

    if IA_Widgets:
        _register_colab_callback(api_base=api_base)

    # --- Buscar /urdf y /meshes ---

    def find_dirs(root: str):
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

    urdf_dir, meshes_dir = find_dirs(folder_path)
    if not urdf_dir or not meshes_dir:
        return HTML(
            f"<b style='color:red'>No se encontró /urdf y /meshes dentro de {folder_path}</b>"
        )

    # --- URDF principal ---

    urdf_files = [
        os.path.join(urdf_dir, f)
        for f in os.listdir(urdf_dir)
        if f.lower().endswith(".urdf")
    ]
    urdf_files.sort(
        key=lambda p: os.path.getsize(p) if os.path.exists(p) else 0,
        reverse=True,
    )

    urdf_raw = ""
    mesh_refs: list[str] = []

    for upath in urdf_files:
        try:
            with open(upath, "r", encoding="utf-8", errors="ignore") as f:
                txt = f.read().lstrip("\ufeff")
            refs = re.findall(
                r'filename="([^"]+\.(?:stl|dae|STL|DAE))"', txt, re.IGNORECASE
            )
            if refs:
                urdf_raw = txt
                mesh_refs = list(dict.fromkeys(refs))
                break
        except Exception:
            pass

    if not urdf_raw and urdf_files:
        with open(urdf_files[0], "r", encoding="utf-8", errors="ignore") as f:
            urdf_raw = f.read().lstrip("\ufeff")

    # --- Construir meshDB embebido ---

    disk_files = []
    for root, _, files in os.walk(meshes_dir):
        for name in files:
            if name.lower().endswith((".stl", ".dae", ".png", ".jpg", ".jpeg")):
                disk_files.append(os.path.join(root, name))

    meshes_root_abs = os.path.abspath(meshes_dir)
    by_rel, by_base = {}, {}
    for path in disk_files:
        rel = (
            os.path.relpath(os.path.abspath(path), meshes_root_abs)
            .replace("\\", "/")
            .lower()
        )
        by_rel[rel] = path
        by_base[os.path.basename(path).lower()] = path

    _cache: dict[str, str] = {}
    mesh_db: dict[str, str] = {}

    def b64(path: str) -> str:
        if path not in _cache:
            with open(path, "rb") as f:
                _cache[path] = base64.b64encode(f.read()).decode("ascii")
        return _cache[path]

    def add_entry(key: str, path: str):
        k = key.replace("\\", "/")
        if k not in mesh_db:
            mesh_db[k] = b64(path)

    # 1) Desde URDF (coincidir refs)
    for ref in mesh_refs:
        raw = ref.replace("\\", "/")
        lower = raw.lower()
        base = os.path.basename(lower)
        rel = lower.lstrip("./")
        cand = (
            by_rel.get(rel)
            or by_rel.get(rel.replace("package://", ""))
            or by_base.get(base)
        )
        if cand:
            add_entry(raw, cand)
            add_entry(lower, cand)
            add_entry(base, cand)

    # 2) Fallback: basenames restantes
    for base, path in by_base.items():
        if base not in mesh_db:
            add_entry(base, path)

    def esc_js(s: str) -> str:
        return (
            s.replace("\\", "\\\\")
            .replace("`", "\\`")
            .replace("$", "\\$")
            .replace("</script>", "<\\/script>")
        )

    urdf_js = esc_js(urdf_raw or "")
    mesh_js = json.dumps(mesh_db)
    bg_js = "null" if background is None else str(int(background))
    sel_js = json.dumps(select_mode)
    ia_js = "true" if IA_Widgets else "false"

    # --- HTML fullscreen con fix IA_Widgets (altura estable) ---

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport"
        content="width=device-width, initial-scale=1, maximum-scale=1,
                 user-scalable=no, viewport-fit=cover"/>
  <title>URDF Viewer</title>
  <style>
    :root {{
      --vh: 1vh;
    }}
    html, body {{
      margin:0;
      padding:0;
      width:100%;
      height:100dvh;
      overflow:hidden;
      background:#{int(background or 0xFFFFFF):06x};
    }}
    @supports not (height: 100dvh) {{
      html, body {{ height: calc(var(--vh) * 100); }}
    }}
    body {{
      padding-top: env(safe-area-inset-top);
      padding-right: env(safe-area-inset-right);
      padding-bottom: env(safe-area-inset-bottom);
      padding-left: env(safe-area-inset-left);
    }}
    #app {{
      position:fixed;
      inset:0;
      width:100vw;
      height:100dvh;
      touch-action:none;
      box-sizing:border-box;
    }}
    @supports not (height: 100dvh) {{
      #app {{ height: calc(var(--vh) * 100); }}
    }}
    .badge {{
      position:fixed;
      right:14px;
      bottom:10px;
      z-index:10;
      user-select:none;
      pointer-events:none;
    }}
    .badge img {{
      max-height:40px;
      display:block;
    }}
  </style>
</head>
<body>
  <div id="app"></div>
  <div class="badge">
    <img src="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png" alt="AutoMind"/>
  </div>

  <script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/STLLoader.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/ColladaLoader.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/urdf-loader@0.12.6/umd/URDFLoader.js"></script>

  <script type="module">
    function applyVHVar() {{
      const vh = (window.visualViewport?.height || window.innerHeight || 600) * 0.01;
      document.documentElement.style.setProperty('--vh', `${{vh}}px`);
    }}

    function setColabFrameHeight() {{
      const h = Math.ceil(
        (window.visualViewport?.height ||
         window.innerHeight ||
         document.documentElement.clientHeight ||
         720)
      );
      try {{
        if (window.google?.colab?.output?.setIframeHeight) {{
          window.google.colab.output.setIframeHeight(h, true);
        }}
      }} catch (_e) {{}}
    }}

    applyVHVar();
    setColabFrameHeight();

    const ro = new ResizeObserver(() => {{
      applyVHVar();
      setColabFrameHeight();
    }});
    ro.observe(document.body);

    if (window.visualViewport) {{
      window.visualViewport.addEventListener('resize', () => {{
        applyVHVar();
        setColabFrameHeight();
      }});
    }}
    window.addEventListener('resize', () => {{
      applyVHVar();
      setColabFrameHeight();
    }});
  </script>

  <script type="module">
    const repo     = {json.dumps(repo)};
    const branch   = {json.dumps(branch)};
    const compFile = {json.dumps(compFile)};
    const SELECT_MODE = {sel_js};
    const BACKGROUND  = {bg_js};
    const IA_WIDGETS  = {ia_js};

    const opts = {{
      container: document.getElementById('app'),
      urdfContent: `{urdf_js}`,
      meshDB: {mesh_js},
      selectMode: SELECT_MODE,
      background: BACKGROUND,
      IA_Widgets: IA_WIDGETS
    }};

    async function loadViewerModule() {{
      try {{
        const url = 'https://cdn.jsdelivr.net/gh/' + repo + '@' + branch + '/' + compFile + '?v=' + Date.now();
        return await import(url);
      }} catch (e) {{
        console.error('[URDF] Error cargando módulo viewer:', e);
        return null;
      }}
    }}

    const mod = await loadViewerModule();
    if (!mod || typeof mod.render !== 'function') {{
      console.error('[URDF] No se pudo cargar urdf_viewer_main.js o falta render()');
    }} else {{
      mod.render(opts);
    }}
  </script>
</body>
</html>
"""
    return HTML(html)
