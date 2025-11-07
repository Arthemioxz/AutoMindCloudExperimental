# URDF_Render_Script.py 
# Puente Colab <-> JS para descripciones de piezas del URDF.
#
# Uso en Colab:
#   from URDF_Render_Script import URDF_Render
#   URDF_Render("Model")
#
# JS:
#   - Genera thumbnails base64 de cada componente al inicio.
#   - Llama a google.colab.kernel.invokeFunction("describe_component_images", [entries], {}).
#   - Recibe { assetKey: descripcion }.
#   - Al hacer click en un componente, muestra la descripción en el frame del panel.

import base64
import re
import os
import json
import shutil
import zipfile
import requests
from IPython.display import HTML

API_DEFAULT_BASE = "https://gpt-proxy-github-619255898589.us-central1.run.app"
API_INFER_PATH = "/infer"

_COLAB_CALLBACK_REGISTERED = False


def Download_URDF(Drive_Link, Output_Name="Model"):
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


def _register_colab_callback(api_base: str = API_DEFAULT_BASE, timeout: int = 120):
    """
    Registra el callback 'describe_component_images' una sola vez.
    Recibe imágenes base64 desde JS y devuelve { assetKey: descripcion }.
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
            entries: [{ "key": assetKey, "image_b64": "<base64_sin_prefijo>" }, ...]
            """
            try:
                n = len(entries)
            except TypeError:
                n = 0
            print(f"[Colab] describe_component_images: recibido payload con {n} imágenes.")

            results = {}
            if not isinstance(entries, (list, tuple)):
                print("[Colab] Payload inválido (no lista).")
                return results

            for item in entries:
                try:
                    key = item.get("key")
                    img_b64 = item.get("image_b64")
                except AttributeError:
                    continue

                if not key or not img_b64:
                    continue

                payload = {
                    "text": (
                        "Describe brevemente qué pieza de robot se ve en esta imagen. "
                        "Se formal, directo y robotico, no digas cosas como En esta imagen se muestra o la pieza es"
                        "Indica precisamente su función mecánica, la zona aproximada del robot donde va "
                        "y el tipo de unión o movimiento que sugiere. Español, 8 frases."
                    ),
                    "images": [{"image_b64": img_b64, "mime": "image/png"}],
                }

                try:
                    r = requests.post(infer_url, json=payload, timeout=timeout)
                except Exception as e:
                    print(f"[Colab] Error de conexión API para {key}: {e}")
                    results[key] = ""
                    continue

                if r.status_code != 200:
                    print(
                        f"[Colab] API respondió {r.status_code} para {key}: {r.text[:200]}"
                    )
                    results[key] = ""
                    continue

                txt = r.text.strip()
                # Si viene como string JSON con comillas
                try:
                    if txt.startswith('"') and txt.endswith('"'):
                        txt = json.loads(txt)
                except Exception:
                    pass

                results[key] = txt or ""

            print(
                f"[Colab] describe_component_images: enviando {len(results)} descripciones de vuelta al JS."
            )
            return results

        output.register_callback("describe_component_images", _describe_component_images)
        _COLAB_CALLBACK_REGISTERED = True
        print("[Colab] Callback 'describe_component_images' registrado correctamente.")

    except Exception as e:
        print(
            f"[Colab] No se pudo registrar callback describe_component_images (no Colab o error): {e}"
        )


def URDF_Render(
    folder_path: str = "Model",
    select_mode: str = "link",
    background: int | None = 0xFFFFFF,
    repo: str = "Arthemioxz/AutoMindCloudExperimental",
    branch: str = "main",
    compFile: str = "AutoMindCloud/viewer/urdf_viewer_main.js",
    api_base: str = API_DEFAULT_BASE,
):
    """
    Renderiza el URDF Viewer.

    - JS captura imágenes de componentes al inicio.
    - JS manda base64 a Colab.
    - Colab llama a la API y responde con descripciones.
    - JS guarda el mapa y el ComponentsPanel lo usa al hacer click.
    """
    _register_colab_callback(api_base=api_base)

    # Buscar urdf/meshes
    def find_dirs(root):
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
            f"<b style='color:red'>No se encontró /urdf y /meshes en {folder_path}</b>"
        )

    # URDF principal
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
                r'filename="([^"]+\.(?:stl|dae))"', txt, re.IGNORECASE
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

    # Construir meshDB
    disk_files = []
    for root, _, files in os.walk(meshes_dir):
        for name in files:
            if name.lower().endswith(
                (".stl", ".dae", ".png", ".jpg", ".jpeg")
            ):
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
        k = key.replace("\\", "/").lower().lstrip("./")
        if k.startswith("package://"):
            k = k[len("package://") :]
        if k not in mesh_db:
            mesh_db[k] = b64(path)

    for ref in mesh_refs:
        raw = ref.replace("\\", "/").lower().lstrip("./")
        pkg = raw[10:] if raw.startswith("package://") else raw
        bn = os.path.basename(raw).lower()
        cand = by_rel.get(raw) or by_rel.get(pkg) or by_base.get(bn)
        if cand:
            add_entry(raw, cand)
            add_entry(pkg, cand)
            add_entry(bn, cand)

    for path in disk_files:
        bn = os.path.basename(path).lower()
        if bn.endswith((".png", ".jpg", ".jpeg")) and bn not in mesh_db:
            add_entry(bn, path)

    def esc(s: str) -> str:
        return (
            s.replace("\\", "\\\\")
            .replace("`", "\\`")
            .replace("$", "\\$")
            .replace("</script>", "<\\/script>")
        )

    urdf_js = esc(urdf_raw)
    mesh_js = json.dumps(mesh_db)
    bg_js = "null" if background is None else str(int(background))
    sel_js = json.dumps(select_mode)

    # HTML que carga el viewer modularizado
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/>
<title>URDF Viewer</title>
<style>
  :root {{
    --vh: 1vh;
  }}
  html, body {{
    margin:0; padding:0;
    width:100%;
    height:100dvh;
    background:#{int(background or 0xFFFFFF):06x};
    overflow:hidden;
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
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100dvh;
    touch-action: none;
  }}
  @supports not (height: 100dvh) {{
    #app {{ height: calc(var(--vh) * 100); }}
  }}
  .badge {{
    position:fixed;
    right:14px;
    bottom:12px;
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
  <img src="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png" alt="badge"/>
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
      (window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 600)
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
  setTimeout(setColabFrameHeight, 50);

  const repo = {json.dumps(repo)};
  const branch = {json.dumps(branch)};
  const compFile = {json.dumps(compFile)};

  async function latest() {{
    try {{
      const api = 'https://api.github.com/repos/' + repo + '/commits/' + branch + '?_=' + Date.now();
      const r = await fetch(api, {{
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

  await new Promise(r => setTimeout(r, 50));

  const SELECT_MODE = {sel_js};
  const BACKGROUND  = {bg_js};

  const opts = {{
    container: document.getElementById('app'),
    urdfContent: `{urdf_js}`,
    meshDB: {mesh_js},
    selectMode: SELECT_MODE,
    background: BACKGROUND,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    autoResize: true
  }};

  let mod = null;
  try {{
    const ver = await latest();
    const base = 'https://cdn.jsdelivr.net/gh/' + repo + '@' + ver + '/';
    mod = await import(base + compFile + '?v=' + Date.now());
    console.debug('[URDF] Cargado módulo viewer desde commit', ver);
  }} catch (_e) {{
    console.debug('[URDF] Fallback a branch', branch);
    mod = await import(
      'https://cdn.jsdelivr.net/gh/' + repo + '@' + branch + '/' + compFile + '?v=' + Date.now()
    );
  }}

  if (!mod || typeof mod.render !== 'function') {{
    console.error('[URDF] No se pudo cargar el módulo de entrada o no expone render()');
  }} else {{
    const app = mod.render(opts);

    function onResize() {{
      try {{
        if (app && typeof app.resize === 'function') {{
          const w = window.innerWidth || document.documentElement.clientWidth;
          const h = (
            window.visualViewport?.height ||
            window.innerHeight ||
            document.documentElement.clientHeight
          );
          app.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
        }}
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
