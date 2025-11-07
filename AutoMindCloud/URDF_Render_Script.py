# URDF_Render_Script.py
# Puente Colab <-> JS para descripciones de piezas del URDF.
#
# Uso típico en Colab:
#   from URDF_Render_Script import URDF_Render
#   URDF_Render("URDFModel")                      # solo viewer
#   URDF_Render("URDFModel", IA_Widgets=True)     # viewer + IA opt-in
#
# Este script:
#   - Busca /urdf y /meshes dentro de folder_path.
#   - Construye un meshDB embebido (base64) para el viewer JS.
#   - Renderiza un viewer HTML fullscreen para Colab.
#   - (Opcional) registra el callback "describe_component_images"
#     para que el JS pueda pedir descripciones vía API externa.
#
# IMPORTANTE:
#   - Si NO pasas IA_Widgets=True:
#       * No se registra callback.
#       * No se envía ninguna imagen a ninguna API.
#       * Solo funciona el viewer + panel de componentes "local".

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


def _register_colab_callback(api_base: str = API_DEFAULT_BASE, timeout: int = 120):
    """
    Registra el callback 'describe_component_images' si estamos en Colab.
    Recibe thumbnails ~5KB en base64 y devuelve { assetKey: descripcion }.
    """
    global _COLAB_CALLBACK_REGISTERED
    if _COLAB_CALLBACK_REGISTERED:
        return

    try:
        from google.colab import output  # type: ignore

        api_base = api_base.rstrip("/")
        infer_url = api_base + API_INFER_PATH

        def _describe_component_images(entries):
            """
            entries: [{ "key": assetKey, "image_b64": "..." }, ...]
            """
            try:
                n = len(entries)
            except TypeError:
                n = 0
            print(f"[Colab] describe_component_images: {n} imágenes recibidas.")

            if not isinstance(entries, (list, tuple)):
                print("[Colab] Payload inválido (no lista).")
                return {}

            results = {}
            for item in entries:
                if not isinstance(item, dict):
                    continue
                key = item.get("key")
                img_b64 = item.get("image_b64")
                if not key or not img_b64:
                    continue

                payload = {
                    "text": (
                        "Describe brevemente qué pieza de robot se ve en esta imagen. "
                        "Sé conciso, técnico y directo. NO uses frases como "
                        "'En esta imagen se muestra' ni 'La pieza es'. "
                        "Indica función mecánica, zona aproximada del robot "
                        "y tipo de unión/movimiento que sugiere. Español, máx 8 frases."
                    ),
                    "images": [{"image_b64": img_b64, "mime": "image/png"}],
                }

                try:
                    r = requests.post(infer_url, json=payload, timeout=timeout)
                except Exception as e:
                    print(f"[Colab] Error conexión API para {key}: {e}")
                    results[key] = ""
                    continue

                if r.status_code != 200:
                    print(f"[Colab] API {r.status_code} para {key}: {r.text[:200]}")
                    results[key] = ""
                    continue

                txt = (r.text or "").strip()
                try:
                    if txt.startswith('"') and txt.endswith('"'):
                        txt = json.loads(txt)
                except Exception:
                    pass

                results[key] = txt or ""

            print(f"[Colab] describe_component_images: devueltas {len(results)} descripciones.")
            return results

        output.register_callback("describe_component_images", _describe_component_images)
        _COLAB_CALLBACK_REGISTERED = True
        print("[Colab] ✅ Callback 'describe_component_images' registrado (IA_Widgets=True).")

    except Exception as e:
        print(f"[Colab] (Opcional) No se pudo registrar callback describe_component_images: {e}")


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
        * Inserta meshDB embedido.
        * Muestra viewer + ToolsDock + ComponentsPanel.
    - Si IA_Widgets=True:
        * Registra callback 'describe_component_images'.
        * El JS enviará thumbnails comprimidos (~5KB) a ese callback.
    - Si IA_Widgets=False:
        * No se registra callback.
        * No hay tráfico a ninguna API.

    Puedes llamar:
        URDF_Render("URDFModel")
        URDF_Render("URDFModel", IA_Widgets=True)
    """

    if IA_Widgets:
        _register_colab_callback(api_base=api_base)

    # --- Buscar directorios urdf / meshes ---

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

    # --- Construir meshDB embedido ---

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

    # 2) Incluir basenames restantes como fallback
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

    # --- HTML + JS (usa urdf_viewer_main.js del repo) ---

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
    applyVHVar();

    function setColabFrameHeight() {{
      const h = Math.ceil(
        (window.visualViewport?.height ||
         window.innerHeight ||
         document.documentElement.clientHeight ||
         600)
      );
      try {{
        if (window.google?.colab?.output?.setIframeHeight) {{
          window.google.colab.output.setIframeHeight(h, true);
        }}
      }} catch (_e) {{}}
    }}

    const ro = new ResizeObserver(() => {{
      applyVHVar();
      setColabFrameHeight();
    }});
    ro.observe(document.body);

    window.addEventListener('resize', () => {{
      applyVHVar();
      setColabFrameHeight();
    }});
    if (window.visualViewport) {{
      window.visualViewport.addEventListener('resize', () => {{
        applyVHVar();
        setColabFrameHeight();
      }});
    }}
    setTimeout(setColabFrameHeight, 60);

    const repo     = {json.dumps(repo)};
    const branch   = {json.dumps(branch)};
    const compFile = {json.dumps(compFile)};

    async function latestSha() {{
      try {{
        const url = 'https://api.github.com/repos/' + repo + '/commits/' + branch + '?_=' + Date.now();
        const r = await fetch(url, {{
          headers: {{ 'Accept': 'application/vnd.github+json' }},
          cache: 'no-store'
        }});
        if (!r.ok) throw 0;
        const j = await r.json();
        return (j.sha || '').slice(0, 7) || branch;
      }} catch (_e) {{
        return branch;
      }}
    }}

    const SELECT_MODE = {sel_js};
    const BACKGROUND  = {bg_js};
    const IA_WIDGETS  = {ia_js};

    const opts = {{
      container: document.getElementById('app'),
      urdfContent: `{urdf_js}`,
      meshDB: {mesh_js},
      selectMode: SELECT_MODE,
      background: BACKGROUND,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      autoResize: true,
      IA_Widgets: IA_WIDGETS
    }};

    let mod = null;
    try {{
      const sha = await latestSha();
      const base = 'https://cdn.jsdelivr.net/gh/' + repo + '@' + sha + '/';
      mod = await import(base + compFile + '?v=' + Date.now());
      console.debug('[URDF] Módulo viewer desde', sha);
    }} catch (_e) {{
      console.debug('[URDF] Fallback branch', branch);
      mod = await import(
        'https://cdn.jsdelivr.net/gh/' + repo + '@' + branch + '/' + compFile + '?v=' + Date.now()
      );
    }}

    if (!mod || typeof mod.render !== 'function') {{
      console.error('[URDF] No se pudo cargar urdf_viewer_main.js o falta render()');
    }} else {{
      const app = mod.render(opts);

      function onResize() {{
        try {{
          if (!app || typeof app.resize !== 'function') return;
          const w = window.innerWidth || document.documentElement.clientWidth;
          const h = (
            window.visualViewport?.height ||
            window.innerHeight ||
            document.documentElement.clientHeight
          );
          app.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
        }} catch (_e) {{}}
      }}

      window.addEventListener('resize', onResize);
      if (window.visualViewport) {{
        window.visualViewport.addEventListener('resize', onResize);
      }}
      setTimeout(onResize, 0);
    }}
  </script>
</body>
</html>
"""
    return HTML(html)
