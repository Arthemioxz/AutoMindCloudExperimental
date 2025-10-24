# urdf_render_fixed.py — Full-screen, always-fit viewer (Colab/Jupyter/VSCode)
import base64, re, os, json, shutil, zipfile
from IPython.display import HTML
import gdown

def Download_URDF(Drive_Link, Output_Name="Model"):
    root_dir = "/content"
    file_id = Drive_Link.split('/d/')[1].split('/')[0]
    url = f"https://drive.google.com/uc?id={file_id}"
    zip_path = os.path.join(root_dir, Output_Name + ".zip")
    tmp_extract = os.path.join(root_dir, f"__tmp_extract_{Output_Name}")
    final_dir = os.path.join(root_dir, Output_Name)

    if os.path.exists(tmp_extract): shutil.rmtree(tmp_extract)
    os.makedirs(tmp_extract, exist_ok=True)
    if os.path.exists(final_dir): shutil.rmtree(final_dir)

    gdown.download(url, zip_path, quiet=True)
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(tmp_extract)

    def junk(n): return n.startswith('.') or n == '__MACOSX'
    top = [n for n in os.listdir(tmp_extract) if not junk(n)]
    if len(top) == 1 and os.path.isdir(os.path.join(tmp_extract, top[0])):
        shutil.move(os.path.join(tmp_extract, top[0]), final_dir)
    else:
        os.makedirs(final_dir, exist_ok=True)
        for n in top:
            shutil.move(os.path.join(tmp_extract, n), os.path.join(final_dir, n))
    shutil.rmtree(tmp_extract, ignore_errors=True)
    return final_dir


def URDF_Render(folder_path="Model",
                select_mode="link",
                background=0xffffff,
                # dynamic loader (repo/branch/file)
                repo="Arthemioxz/AutoMindCloudExperimental",
                branch="main",
                compFile="AutoMindCloud/viewer/urdf_viewer_main.js"):
    """Render a full-screen URDF viewer. Output cell auto-fits any device."""

    # ---- Find /urdf + /meshes and build mesh DB ----
    def find_dirs(root):
        u, m = os.path.join(root, "urdf"), os.path.join(root, "meshes")
        if os.path.isdir(u) and os.path.isdir(m): return u, m
        if os.path.isdir(root):
            for name in os.listdir(root):
                cand = os.path.join(root, name)
                uu, mm = os.path.join(cand, "urdf"), os.path.join(cand, "meshes")
                if os.path.isdir(uu) and os.path.isdir(mm): return uu, mm
        return None, None

    urdf_dir, meshes_dir = find_dirs(folder_path)
    if not urdf_dir or not meshes_dir:
        return HTML(f"<b style='color:red'>No se encontró /urdf y /meshes en {folder_path}</b>")

    urdf_files = [os.path.join(urdf_dir, f) for f in os.listdir(urdf_dir) if f.lower().endswith(".urdf")]
    urdf_files.sort(key=lambda p: os.path.getsize(p) if os.path.exists(p) else 0, reverse=True)

    urdf_raw = ""
    mesh_refs = []
    for upath in urdf_files:
        try:
            with open(upath, "r", encoding="utf-8", errors="ignore") as f:
                txt = f.read().lstrip('\ufeff')
            refs = re.findall(r'filename="([^"]+\.(?:stl|dae))"', txt, re.I)
            if refs:
                urdf_raw = txt
                mesh_refs = list(dict.fromkeys(refs))
                break
        except Exception:
            pass
    if not urdf_raw and urdf_files:
        with open(urdf_files[0], "r", encoding="utf-8", errors="ignore") as f:
            urdf_raw = f.read().lstrip('\ufeff')

    disk_files = []
    for root, _, files in os.walk(meshes_dir):
        for name in files:
            if name.lower().endswith((".stl", ".dae", ".png", ".jpg", ".jpeg")):
                disk_files.append(os.path.join(root, name))

    meshes_root_abs = os.path.abspath(meshes_dir)
    by_rel, by_base = {}, {}
    for p in disk_files:
        rel = os.path.relpath(os.path.abspath(p), meshes_root_abs).replace("\\", "/").lower()
        by_rel[rel] = p
        by_base[os.path.basename(p).lower()] = p

    _cache, mesh_db = {}, {}
    def b64(path):
        if path not in _cache:
            with open(path, "rb") as f:
                _cache[path] = base64.b64encode(f.read()).decode("ascii")
        return _cache[path]

    def add_entry(key, path):
        k = key.replace("\\", "/").lower().lstrip("./")
        if k.startswith("package://"): k = k[len("package://"):]
        if k not in mesh_db: mesh_db[k] = b64(path)

    for ref in mesh_refs:
        raw = ref.replace("\\", "/").lower().lstrip("./")
        pkg = raw[10:] if raw.startswith("package://") else raw
        bn = os.path.basename(raw).lower()
        cand = by_rel.get(raw) or by_rel.get(pkg) or by_base.get(bn)
        if cand:
            add_entry(raw, cand); add_entry(pkg, cand); add_entry(bn, cand)

    for p in disk_files:
        bn = os.path.basename(p).lower()
        if bn.endswith((".png", ".jpg", ".jpeg")) and bn not in mesh_db:
            add_entry(bn, p)

    # ---- HTML payload ----
    def esc(s: str) -> str:
        return (s.replace('\\','\\\\')
                .replace('`','\\`')
                .replace('$','\\$')
                .replace("</script>","<\\/script>"))

    urdf_js = esc(urdf_raw)            # escape once for backtick JS string
    mesh_js = json.dumps(mesh_db)      # dict -> JS object
    bg_js   = 'null' if (background is None) else str(int(background))
    sel_js  = json.dumps(select_mode)

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/>
<title>URDF Viewer</title>
<style>
  /* Use dynamic viewport units with safe fallbacks */
  :root {{
    --vh: 1vh;
  }}
  html, body {{
    margin:0; padding:0;
    width:100%;
    height:100dvh; /* modern browsers */
    background:#{int(background):06x};
    overflow:hidden;
  }}
  @supports not (height: 100dvh) {{
    html, body {{ height: calc(var(--vh) * 100); }}
  }}

  /* Respect iOS safe areas */
  body {{
    padding-top: env(safe-area-inset-top);
    padding-right: env(safe-area-inset-right);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
  }}

  /* Full-bleed mount */
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

  /* Badge (non-interactive) */
  .badge{{ position:fixed; right:14px; bottom:12px; z-index:10; user-select:none; pointer-events:none; }}
  .badge img{{ max-height:40px; display:block; }}
</style>
</head>
<body>
<div id="app"></div>

<div class="badge">
  <img src="https://raw.githubusercontent.com/Arthemioxz/AutoMindCloudExperimental/refs/heads/main/AutoMindCloud/AutoMindCloud.png" alt="badge"/>
</div>

<!-- UMD deps -->
<script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/STLLoader.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/ColladaLoader.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/urdf-loader@0.12.6/umd/URDFLoader.js"></script>

<script type="module">
  // ---- Viewport + cell autosize helpers (Colab/Jupyter/VSCode) ----
  function applyVHVar(){{
    const vh = (window.visualViewport?.height || window.innerHeight || 600) * 0.01;
    document.documentElement.style.setProperty('--vh', `${{vh}}px`);
  }}
  applyVHVar();

  function setColabFrameHeight(){{
    const h = Math.ceil((window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 600));
    try {{
      // Only in Google Colab
      if (window.google?.colab?.output?.setIframeHeight) {{
        window.google.colab.output.setIframeHeight(h, true);
      }}
    }} catch (_e) {{}}
  }}
  // Keep output cell in sync with any size changes (rotate, keyboard up, split view)
  const ro = new ResizeObserver(() => {{ applyVHVar(); setColabFrameHeight(); }});
  ro.observe(document.body);
  window.addEventListener('resize', () => {{ applyVHVar(); setColabFrameHeight(); }});
  if (window.visualViewport) {{
    window.visualViewport.addEventListener('resize', () => {{ applyVHVar(); setColabFrameHeight(); }});
  }}
  // Nudge once after paint to avoid off-by-1 truncation in some embeds
  setTimeout(setColabFrameHeight, 50);

  // ---- Latest commit loader (with branch fallback) ----
  const repo = {json.dumps(repo)};
  const branch = {json.dumps(branch)};
  const compFile = {json.dumps(compFile)};

  async function latest(){{
    try {{
      const api = 'https://api.github.com/repos/' + repo + '/commits/' + branch + '?_=' + Date.now();
      const r = await fetch(api, {{ headers: {{ 'Accept':'application/vnd.github+json' }}, cache:'no-store' }});
      if (!r.ok) throw 0;
      const j = await r.json();
      return (j.sha || '').slice(0, 7) || branch;
    }} catch (_e) {{
      return branch;
    }}
  }}

  // Wait a tick so UMD globals are ready
  await new Promise(r => setTimeout(r, 50));

  const SELECT_MODE = {sel_js};
  const BACKGROUND  = {bg_js};

  const opts = {{
    container: document.getElementById('app'),
    urdfContent: `{urdf_js}`,
    meshDB: {mesh_js},
    selectMode: SELECT_MODE,
    background: BACKGROUND,
    // Hints your renderer can use (optional):
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    autoResize: true
  }};

  // Import entry module from latest short SHA (fallback to branch)
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

    // If your render() returns a {{ resize }} hook, wire it to viewport changes:
    function onResize(){{
      try {{
        if (app && typeof app.resize === 'function') {{
          const w = window.innerWidth || document.documentElement.clientWidth;
          const h = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight;
          app.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
        }}
      }} catch (_e) {{}}
    }}
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    setTimeout(onResize, 0);
  }}

import { result } from './viewer/urdf_viewer_main.js';
console.log(result); // 4

</script>
</body>
</html>
"""
    return HTML(html)
