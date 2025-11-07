# ==========================================================
# URDF_Render_Script.py  (Fullscreen + batch IA + compresión ~5KB)
# ==========================================================
# - Full-screen viewer (Colab/Jupyter/VSCode)
# - Descripciones de componentes vía callback Colab -> API externa
# - SOLO las imágenes enviadas a la API se comprimen a ~5KB
# - Las miniaturas del panel (thumbnails) mantienen la resolución
#   generada por el sistema offscreen del viewer.
# ==========================================================

import base64
import re
import os
import json
import shutil
import zipfile
import requests
from IPython.display import HTML
import gdown

API_DEFAULT_BASE = "https://gpt-proxy-github-619255898589.us-central1.run.app"
API_INFER_PATH = "/infer"

_COLAB_CALLBACK_REGISTERED = False


# ==========================================================
# Descarga URDF desde Drive y normaliza estructura
# ==========================================================
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


# ==========================================================
# Helper: comprimir base64 a ~target_kb (best-effort)
# (Solo copias para la API, la UI usa el original)
# ==========================================================
def _shrink_to_approx_kb(img_b64: str, target_kb: int = 5) -> str:
    try:
        from io import BytesIO
        from PIL import Image
    except Exception:
        return img_b64

    try:
        raw = base64.b64decode(img_b64)
        max_bytes = target_kb * 1024
        if len(raw) <= max_bytes:
            return img_b64

        im = Image.open(BytesIO(raw)).convert("RGB")

        # Escala aproximada según tamaño actual
        scale = (max_bytes / float(len(raw))) ** 0.5
        scale = max(0.12, min(1.0, scale))
        new_w = max(16, int(im.width * scale))
        new_h = max(16, int(im.height * scale))
        im = im.resize((new_w, new_h))

        buf = BytesIO()
        quality = 80
        for _ in range(7):
            buf.seek(0)
            buf.truncate(0)
            im.save(buf, format="JPEG", quality=quality, optimize=True)
            if buf.tell() <= max_bytes or quality <= 25:
                break
            quality -= 10

        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return img_b64


# ==========================================================
# Callback Colab: describe_component_images
#  - Recibe thumbnails desde JS
#  - Comprime a ~5KB antes de llamar a la API
# ==========================================================
def _register_colab_callback(api_base: str = API_DEFAULT_BASE, timeout: int = 90):
    global _COLAB_CALLBACK_REGISTERED
    if _COLAB_CALLBACK_REGISTERED:
        return

    try:
        from google.colab import output  # type: ignore

        api_base = api_base.rstrip("/")
        infer_url = api_base + API_INFER_PATH

        def _describe_component_images(entries):
            try:
                n = len(entries)
            except TypeError:
                n = 0
            print(f"[Colab] describe_component_images: recibido {n} imágenes.")

            if not isinstance(entries, (list, tuple)) or n == 0:
                print("[Colab] ❌ Payload inválido o vacío.")
                return {}

            keys = []
            imgs = []

            for item in entries:
                if not isinstance(item, dict):
                    continue
                key = item.get("key")
                img_b64 = item.get("image_b64")
                if not (key and img_b64):
                    continue

                mime = item.get("mime") or "image/png"

                # Solo la copia para la API se comprime
                small_b64 = _shrink_to_approx_kb(img_b64, target_kb=5)
                mime_out = "image/jpeg" if small_b64 != img_b64 else mime

                keys.append(key)
                imgs.append({"image_b64": small_b64, "mime": mime_out})

            if not imgs:
                print("[Colab] ⚠️ No hay imágenes válidas para enviar.")
                return {}

            print(f"[Colab] 🚀 Enviando {len(imgs)} imágenes comprimidas al modelo...")

            text = (
                "Describe con certeza y tono técnico cada componente mostrado en las imágenes del robot URDF. "
                "Devuelve EXCLUSIVAMENTE un JSON válido donde cada clave es el nombre de la pieza (de la lista 'keys') "
                "y cada valor una descripción breve en español (máx. 5 frases) indicando directamente su función mecánica, "
                "posición aproximada en el robot y tipo de unión o movimiento, SIN usar expresiones como "
                "'la imagen muestra', 'parece ser', 'probablemente' ni 'la pieza muestra'. "
                + json.dumps({"keys": keys}, ensure_ascii=False)
            )

            payload = {"text": text, "images": imgs}

            try:
                r = requests.post(infer_url, json=payload, timeout=timeout)
            except Exception as e:
                print(f"[Colab] ❌ Error de conexión con API: {e}")
                return {}

            if r.status_code != 200:
                print(f"[Colab] ❌ Error HTTP {r.status_code}: {r.text[:300]}")
                return {}

            raw = r.text.strip()
            if not raw:
                print("[Colab] ⚠️ Respuesta vacía del modelo.")
                return {}

            def parse_json(s: str):
                try:
                    return json.loads(s)
                except Exception:
                    s0, s1 = s.find("{"), s.rfind("}")
                    if s0 != -1 and s1 != -1:
                        try:
                            return json.loads(s[s0 : s1 + 1])
                        except Exception:
                            pass
                    return None

            parsed = parse_json(raw)
            if isinstance(parsed, dict):
                print(f"[Colab] ✅ JSON parseado correctamente ({len(parsed)} claves).")
                return parsed

            print(f"[Colab] ⚠️ No se pudo interpretar JSON, preview:\n{raw[:400]}")
            return {}

        output.register_callback("describe_component_images", _describe_component_images)
        _COLAB_CALLBACK_REGISTERED = True
        print("[Colab] ✅ Callback 'describe_component_images' registrado.")
    except Exception as e:
        print(f"[Colab] ❌ No se pudo registrar callback: {e}")


# ==========================================================
# Render principal fullscreen
# ==========================================================
def URDF_Render(
    folder_path: str = "Model",
    select_mode: str = "link",
    background: int | None = 0xFFFFFF,
    repo: str = "Arthemioxz/AutoMindCloudExperimental",
    branch: str = "main",
    compFile: str = "AutoMindCloud/viewer/urdf_viewer_main.js",
    api_base: str = API_DEFAULT_BASE,
):
    _register_colab_callback(api_base=api_base)

    # Buscar /urdf + /meshes
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
        with open(
            urdf_files[0], "r", encoding="utf-8", errors="ignore"
        ) as f:
            urdf_raw = f.read().lstrip("\ufeff")

    # Mesh DB
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

    # HTML
    def esc(s: str) -> str:
        return (
            s.replace("\\", "\\\\")
            .replace("`", "\\`")
            .replace("$", "\\$")
            .replace("</script>", "<\\/script>")
        )

    urdf_js = esc(urdf_raw)
    mesh_js = json.dumps(mesh_db)
    bg_css = f"#{int(background):06x}" if isinstance(background, int) else "#FFFFFF"
    bg_js = "null" if background is None else str(int(background))
    sel_js = json.dumps(select_mode)

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
    margin:0;
    padding:0;
    width:100%;
    height:100dvh;
    background:{bg_css};
    overflow:hidden;
  }}
  @supports not (height: 100dvh) {{
    html, body {{
      height: calc(var(--vh) * 100);
    }}
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
    #app {{
      height: calc(var(--vh) * 100);
    }}
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
  <img src="https://raw.githubusercontent.com/Arthemioxz/AutoMindCloudExperimental/main/AutoMindCloud/AutoMindCloud.png" alt="badge"/>
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
      window.visualViewport?.height
      || window.innerHeight
      || document.documentElement.clientHeight
      || 600
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

  const repo     = {json.dumps(repo)};
  const branch   = {json.dumps(branch)};
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

  await new Promise(r => setTimeout(r, 50));

  let mod = null;
  try {{
    const ver = await latest();
    const base = 'https://cdn.jsdelivr.net/gh/' + repo + '@' + ver + '/';
    mod = await import(base + compFile + '?v=' + Date.now());
  }} catch (_e) {{
    mod = await import('https://cdn.jsdelivr.net/gh/' + repo + '@' + branch + '/' + compFile + '?v=' + Date.now());
  }}

  if (!mod || typeof mod.render !== 'function') {{
    console.error('[URDF] No se pudo cargar el módulo de entrada o no expone render()');
  }} else {{
    const app = mod.render(opts);

    function onResize() {{
      try {{
        if (app && typeof app.resize === 'function') {{
          const w = window.innerWidth || document.documentElement.clientWidth;
          const h = window.visualViewport?.height
                 || window.innerHeight
                 || document.documentElement.clientHeight;
          app.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
        }}
      }} catch (_e) {{}}
    }}

    window.addEventListener('resize', onResize);
    if (window.visualViewport) {{
      window.visualViewport.addEventListener('resize', onResize);
    }}
    setTimeout(onResize, 0);
    window.URDF_APP = app;
  }}
</script>
</body>
</html>
"""
    return HTML(html)
