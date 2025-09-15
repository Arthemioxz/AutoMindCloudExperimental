# urdf_render.py
import base64, re, os, json, shutil, zipfile
from IPython.display import HTML
import gdown

# -------------------------------
# Download + unpack a Google Drive ZIP with /urdf and /meshes
# -------------------------------
def Download_URDF(Drive_Link, Output_Name="Model"):
    root_dir = "/content"
    file_id = Drive_Link.split('/d/')[1].split('/')[0]
    download_url = f"https://drive.google.com/uc?id={file_id}"
    zip_path = os.path.join(root_dir, Output_Name + ".zip")
    tmp_extract = os.path.join(root_dir, f"__tmp_extract_{Output_Name}")
    final_dir = os.path.join(root_dir, Output_Name)

    if os.path.exists(tmp_extract): shutil.rmtree(tmp_extract)
    os.makedirs(tmp_extract, exist_ok=True)
    if os.path.exists(final_dir): shutil.rmtree(final_dir)

    gdown.download(download_url, zip_path, quiet=True)
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(tmp_extract)

    def is_junk(n): return n.startswith('.') or n == '__MACOSX'
    top = [n for n in os.listdir(tmp_extract) if not is_junk(n)]
    if len(top)==1 and os.path.isdir(os.path.join(tmp_extract, top[0])):
        shutil.move(os.path.join(tmp_extract, top[0]), final_dir)
    else:
        os.makedirs(final_dir, exist_ok=True)
        for n in top: shutil.move(os.path.join(tmp_extract, n), os.path.join(final_dir, n))
    shutil.rmtree(tmp_extract, ignore_errors=True)
    return final_dir


# ============================================================
# 1) URDF_Functions — load JS stack + your LIB at latest commit
# ============================================================
def URDF_Functions(
    repo="ArtemioA/AutoMindCloudExperimental",
    branch="main",
    libFile="AutoMindCloud/JavaScript/urdf_viewer_lib.js",
    ensure_three=True,
    three_ver="0.160",
    urdf_loader_ver="0.12.6"
):
    """
    Loads:
      - THREE + loaders (if missing and ensure_three=True)
      - Your library (functions only) from latest commit (fallback to @branch)
    Exposes:
      - window.__URDF_FUNCS_READY  (Promise)
      - window.URDFViewer          (from your lib)
    Safe to call multiple times; it won’t double-load.
    """
    html = f"""
    <div id="__amc_js_loader" style="font:12px/1.2 Inter,system-ui; color:#555; margin:6px 0;">
      Loading URDF functions… (only once)
    </div>
    <script>
    (function() {{
      if (window.__URDF_FUNCS_READY) {{
        document.getElementById("__amc_js_loader")?.remove();
        return;
      }}

      let _resolve;
      window.__URDF_FUNCS_READY = new Promise(res => _resolve = res);

      const repo = {json.dumps(repo)};
      const branch = {json.dumps(branch)};
      const libFile = {json.dumps(libFile)};
      const needThree = {str(bool(ensure_three)).lower()};

      function loadScript(src){{
        return new Promise((resolve, reject) => {{
          const s = document.createElement('script');
          s.src = src; s.defer = true;
          s.onload = () => resolve(src);
          s.onerror = () => reject(new Error("Failed to load " + src));
          document.head.appendChild(s);
        }});
      }}

      async function latestShaOrBranch() {{
        try {{
          const api = `https://api.github.com/repos/${{repo}}/commits/${{branch}}?_=${{Date.now()}}`;
          const r = await fetch(api, {{
            headers: {{ "Accept":"application/vnd.github+json" }},
            cache: "no-store"
          }});
          if (!r.ok) throw new Error("GitHub API " + r.status);
          const j = await r.json();
          return (j.sha || "").slice(0,7) || branch;
        }} catch(e) {{
          console.warn("Using fallback @branch due to API error:", e);
          return branch;
        }}
      }}

      async function ensureThreeStack(){{
        if (typeof window.THREE !== 'undefined') return;
        // Three + controls + loaders + URDFLoader (UMD)
        await loadScript("https://cdn.jsdelivr.net/npm/three@{three_ver}/build/three.min.js");
        await loadScript("https://cdn.jsdelivr.net/npm/three@{three_ver}/examples/js/controls/OrbitControls.js");
        await loadScript("https://cdn.jsdelivr.net/npm/three@{three_ver}/examples/js/loaders/STLLoader.js");
        await loadScript("https://cdn.jsdelivr.net/npm/three@{three_ver}/examples/js/loaders/ColladaLoader.js");
        await loadScript("https://cdn.jsdelivr.net/npm/urdf-loader@{urdf_loader_ver}/umd/URDFLoader.js");
      }}

      (async () => {{
        try {{
          if (needThree && typeof window.THREE === 'undefined') {{
            await ensureThreeStack();
          }}
          const ver = await latestShaOrBranch();
          const base = `https://cdn.jsdelivr.net/gh/${{repo}}@${{ver}}/`;
          try {{
            await loadScript(base + libFile);
          }} catch (_e) {{
            // fallback to branch
            await loadScript(`https://cdn.jsdelivr.net/gh/${{repo}}@${{branch}}/` + libFile);
          }}
          document.getElementById("__amc_js_loader")?.remove();
          _resolve(true);
        }} catch (e) {{
          console.warn("URDF_Functions failed:", e);
          document.getElementById("__amc_js_loader")?.remove();
          _resolve(false);
        }}
      }})();
    }})();
    </script>
    """
    return HTML(html)


# ============================================================
# 2) URDF_Render — build URDF + meshDB, load RUNNER at latest
# ============================================================
def URDF_Render(folder_path="Model",
                select_mode="link",
                background=0xf0f0f0,
                repo="ArtemioA/AutoMindCloudExperimental",
                branch="main",
                runFile="AutoMindCloud/JavaScript/urdf_viewer_run.js"):
    """
    - Reads URDF + meshes under folder_path (/urdf + /meshes)
    - Builds base64 mesh DB
    - Waits for URDF_Functions() to be ready
    - Loads runner from latest commit (fallback branch) which performs the render

    NOTE: Call URDF_Functions() once before this.
    """

    # ----- discover folders
    def find_dirs(root):
        d_u, d_m = os.path.join(root,"urdf"), os.path.join(root,"meshes")
        if os.path.isdir(d_u) and os.path.isdir(d_m): return d_u, d_m
        if os.path.isdir(root):
            for name in os.listdir(root):
                cand = os.path.join(root, name)
                u, m = os.path.join(cand,"urdf"), os.path.join(cand,"meshes")
                if os.path.isdir(u) and os.path.isdir(m): return u, m
        return None, None

    urdf_dir, meshes_dir = find_dirs(folder_path)
    urdf_raw, mesh_db = "", {}

    if urdf_dir and meshes_dir:
        urdf_files = [f for f in os.listdir(urdf_dir) if f.lower().endswith(".urdf")]
        if urdf_files:
            urdf_path = os.path.join(urdf_dir, urdf_files[0])
            with open(urdf_path, "r", encoding="utf-8") as f:
                urdf_raw = f.read()

            # mesh refs from URDF
            mesh_refs = re.findall(r'filename="([^"]+\\.(?:stl|dae|step|stp))"', urdf_raw, re.IGNORECASE)
            mesh_refs = list(dict.fromkeys(mesh_refs))

            # collect disk assets
            disk_files = []
            for root, _, files in os.walk(meshes_dir):
                for name in files:
                    if name.lower().endswith((".stl",".dae",".png",".jpg",".jpeg",".step",".stp")):
                        disk_files.append(os.path.join(root, name))
            by_basename = {os.path.basename(p).lower(): p for p in disk_files}

            _cache={}
            def b64(path):
                if path not in _cache:
                    with open(path, "rb") as f:
                        _cache[path] = base64.b64encode(f.read()).decode("ascii")
                return _cache[path]

            def add_entry(key, path):
                k = key.replace("\\","/").lower()
                if k not in mesh_db: mesh_db[k] = b64(path)

            # map refs -> files on disk (plus useful aliases)
            for ref in mesh_refs:
                base = os.path.basename(ref).lower()
                if base in by_basename:
                    real = by_basename[base]
                    add_entry(ref, real)
                    add_entry(ref.replace("package://",""), real)
                    add_entry(base, real)

            # extra images that might be referenced by DAE
            for p in disk_files:
                bn = os.path.basename(p).lower()
                if bn.endswith((".png",".jpg",".jpeg")) and bn not in mesh_db:
                    add_entry(bn, p)

    # HTML payload
    def _esc(s: str) -> str:
        return (s.replace('\\','\\\\')
                 .replace('`','\\`')
                 .replace('$','\\$')
                 .replace("</script>","<\\/script>"))

    urdf_js  = _esc(urdf_raw) if urdf_raw else ""
    mesh_js  = json.dumps(mesh_db)
    bg_js    = 'null' if (background is None) else str(int(background))
    sel_js   = json.dumps(select_mode)

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>URDF Render (latest commit)</title>
<style>
  html,body {{ margin:0; height:100%; overflow:hidden; background:#f0f0f0; }}
  #app {{ position:fixed; inset:0; }}
  .note{{ position:fixed; left:12px; bottom:12px; font:12px/1.3 Inter,system-ui; color:#666; }}
</style>
</head>
<body>
  <div id="app"></div>
  <div class="note">Waiting for functions, then fetching runner @ latest commit…</div>

  <script>
  (async function() {{
    const repo = {json.dumps(repo)};
    const branch = {json.dumps(branch)};
    const runFile = {json.dumps(runFile)};

    // Provide data for the runner (many runners read these globals)
    window.AMC_URDF = `{urdf_js}`;
    window.AMC_MESH_DB = {mesh_js};
    window.AMC_CONFIG = {{
      background: {bg_js},
      selectMode: {sel_js},
      containerId: "app"
    }};

    function loadScript(url){{
      return new Promise((res, rej) => {{
        const s = document.createElement('script');
        s.src = url; s.defer = true;
        s.onload = () => res(url);
        s.onerror = () => rej(new Error("load fail: " + url));
        document.head.appendChild(s);
      }});
    }}

    async function latestShaOrBranch() {{
      try {{
        const api = `https://api.github.com/repos/${{repo}}/commits/${{branch}}?_=${{Date.now()}}`;
        const r = await fetch(api, {{ headers: {{ "Accept":"application/vnd.github+json" }}, cache: "no-store" }});
        if (!r.ok) throw new Error("GitHub API " + r.status);
        const j = await r.json();
        return (j.sha || "").slice(0,7) || branch;
      }} catch(e) {{
        console.warn("Using fallback @branch due to API error:", e);
        return branch;
      }}
    }}

    // Wait for functions loader
    const funcsReady = (window.__URDF_FUNCS_READY ? await window.__URDF_FUNCS_READY : false);
    const haveViewer = (window.URDFViewer && typeof window.URDFViewer.render === 'function');
    const haveTHREE  = (typeof window.THREE !== 'undefined');
    const haveURDF   = !!window.AMC_URDF;

    if (!funcsReady || !haveViewer || !haveTHREE || !haveURDF) {{
      console.warn("Cannot render yet.", {{funcsReady, haveViewer, haveTHREE, haveURDF}});
      document.querySelector(".note")?.replaceChildren(document.createTextNode(
        "Missing stack or URDF. Did you run URDF_Functions() first?"
      ));
      return;
    }}

    // Fetch runner from the latest commit; fallback to branch
    const ver = await latestShaOrBranch();
    try {{
      await loadScript(`https://cdn.jsdelivr.net/gh/${{repo}}@${{ver}}/` + runFile);
    }} catch(_e) {{
      await loadScript(`https://cdn.jsdelivr.net/gh/${{repo}}@{branch}/` + runFile);
    }}

    // If your runner renders automatically, we're done.
    // If it exposes a callable instead, you could call it here using AMC_* globals.

    document.querySelector(".note")?.remove();
  }})();
  </script>
</body>
</html>
"""
    return HTML(html)
