# urdf_render_fixed.py — Full-screen, always-fit viewer (Colab/Jupyter/VSCode)
import base64, re, os, json, shutil, zipfile
from IPython.display import HTML, display

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

    import gdown
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
    """
    Renders the URDF viewer and RETURNS a Python list of base64 images (PNG) collected from JS.
    - In Colab: returns list[str] with base64 images.
    - In non-Colab: returns [] but still renders the viewer.
    """

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
        display(HTML(f"<b style='color:red'>No se encontró /urdf y /meshes en {folder_path}</b>"))
        return []

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
                .replace("</script>","<\\/script>")
                .replace("\u2028","\\u2028").replace("\u2029","\\u2029"))

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
  :root {{ --vh: 1vh; }}
  html, body {{
    margin:0; padding:0; width:100%; height:100dvh; background:#{int(background):06x}; overflow:hidden;
  }}
  @supports not (height: 100dvh) {{ html, body {{ height: calc(var(--vh) * 100); }} }}
  body {{
    padding-top: env(safe-area-inset-top);
    padding-right: env(safe-area-inset-right);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
  }}
  #app {{ position: fixed; inset: 0; width:100vw; height:100dvh; touch-action: none; }}
  @supports not (height: 100dvh) {{ #app {{ height: calc(var(--vh) * 100); }} }}
  .badge{{ position:fixed; right:14px; bottom:12px; z-index:10; user-select:none; pointer-events:none; }}
  .badge img{{ max-height:40px; display:block; }}
</style>
</head>
<body>
<div id="app"></div>
<div class="badge">
  <img src="https://raw.githubusercontent.com/Arthemioxz/AutoMindCloudExperimental/refs/heads/main/AutoMindCloud/AutoMindCloud.png" alt="badge"/>
</div>

<script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/STLLoader.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/ColladaLoader.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/urdf-loader@0.12.6/umd/URDFLoader.js"></script>

<script type="module">
  // --- viewport helpers ---
  function applyVHVar(){{
    const vh = (window.visualViewport?.height || window.innerHeight || 600) * 0.01;
    document.documentElement.style.setProperty('--vh', `${{vh}}px`);
  }}
  function setColabFrameHeight(){{
    const h = Math.ceil((window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 600));
    try {{
      if (window.google?.colab?.output?.setIframeHeight) {{
        window.google.colab.output.setIframeHeight(h, true);
      }}
    }} catch (_e) {{}}
  }}
  applyVHVar(); setColabFrameHeight();
  const ro = new ResizeObserver(() => {{ applyVHVar(); setColabFrameHeight(); }});
  ro.observe(document.body);
  window.addEventListener('resize', () => {{ applyVHVar(); setColabFrameHeight(); }});
  if (window.visualViewport) {{
    window.visualViewport.addEventListener('resize', () => {{ applyVHVar(); setColabFrameHeight(); }});
  }}
  setTimeout(setColabFrameHeight, 50);

  // --- latest commit loader ---
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

  await new Promise(r => setTimeout(r, 50)); // let UMD globals settle

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
  }} catch (_e) {{
    mod = await import('https://cdn.jsdelivr.net/gh/' + repo + '@' + branch + '/' + compFile + '?v=' + Date.now());
  }}

  // Expose for eval_js calls
  window.__last_mod = mod;

  if (!mod || typeof mod.render !== 'function') {{
    console.error('[URDF] Module missing render()');
    window.__urdf_ready__ = false;
  }} else {{
    const app = mod.render(opts);
    window.URDFViewer = window.URDFViewer || {{}};
    window.URDFViewer.__app = app;

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

    // signal ready
    window.__urdf_ready__ = true;
  }}
</script>
</body>
</html>
"""
    # Display the viewer now
    display(HTML(html))

    # Try to collect Base64Images back into Python (Colab only)
    images = []
    try:
        from google.colab import output  # type: ignore

        js = r"""
        (async () => {
          // Wait for the module/app to be ready
          const waitReady = async (timeoutMs = 10000) => {
            const t0 = performance.now();
            while (!window.__urdf_ready__) {
              await new Promise(r => setTimeout(r, 50));
              if (performance.now() - t0 > timeoutMs) throw new Error("timeout waiting for __urdf_ready__");
            }
          };

          try {
            await waitReady();
            const app = window.URDFViewer?.__app;
            const mod = window.__last_mod || null;

            if (!app || typeof app.collectAllThumbnails !== 'function') {
              return JSON.stringify({ ok:false, error: "app or collectAllThumbnails() missing" });
            }

            // run collection (fills global Base64Images in the module/helper)
            try { await app.collectAllThumbnails(); } catch (e) {}

            // Prefer the window mirror first, then the module export
            let arr = [];
            try {
              if (Array.isArray(window.Base64Images)) {
                arr = window.Base64Images.slice();
              } else if (mod && Array.isArray(mod.Base64Images)) {
                arr = mod.Base64Images.slice();
              }
            } catch (e) {}

            // If they are objects, map to the base64 field
            if (arr.length && typeof arr[0] === 'object' && arr[0] !== null) {
              arr = arr.map(x => x?.base64 ?? x);
            }

            // Ensure strings only
            arr = arr.filter(x => typeof x === 'string');

            return JSON.stringify({ ok:true, images: arr });
          } catch (err) {
            return JSON.stringify({ ok:false, error: String(err && err.message || err) });
          }
        })()
        """
        res = output.eval_js(js)
        data = json.loads(res) if isinstance(res, str) else {"ok": False, "error": "no response"}
        if data.get("ok") and isinstance(data.get("images"), list):
            images = data["images"]
        else:
            # still return an empty list if something went wrong
            images = []
    except Exception:
        # Not in Colab (or eval_js not available)
        images = []

    return images
