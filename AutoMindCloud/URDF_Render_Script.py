# urdf_render.py
import base64, re, os, json, shutil, zipfile
from IPython.display import HTML
import gdown

# -------------------------------
# Descarga y extracción de ZIP con /urdf y /meshes
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

# -------------------------------
# Genera HTML y SOLO carga ComponentSelection.js (último commit)
# -------------------------------

def URDF_Render(
    folder_path="Model",
    select_mode="link",
    background=0xf0f0f0,
    repo="ArtemioA/AutoMindCloudExperimental",      # owner/repo
    compFile="AutoMindCloud/ComponentSelection.js", # JS to load from latest commit
    ensure_three=True
):
    import os, re, json, base64
    from IPython.display import HTML

    # ---- find URDF + meshes ----
    def find_dirs(root):
        d_u, d_m = os.path.join(root, "urdf"), os.path.join(root, "meshes")
        if os.path.isdir(d_u) and os.path.isdir(d_m):
            return d_u, d_m
        if os.path.isdir(root):
            for name in os.listdir(root):
                cand = os.path.join(root, name)
                u, m = os.path.join(cand, "urdf"), os.path.join(cand, "meshes")
                if os.path.isdir(u) and os.path.isdir(m):
                    return u, m
        return None, None

    urdf_dir, meshes_dir = find_dirs(folder_path)
    urdf_raw, mesh_db = "", {}

    if urdf_dir and meshes_dir:
        urdf_files = [f for f in os.listdir(urdf_dir) if f.lower().endswith(".urdf")]
        if urdf_files:
            urdf_path = os.path.join(urdf_dir, urdf_files[0])
            with open(urdf_path, "r", encoding="utf-8") as f:
                urdf_raw = f.read()

            mesh_refs = re.findall(r'filename="([^"]+\.(?:stl|dae))"', urdf_raw, re.IGNORECASE)
            mesh_refs = list(dict.fromkeys(mesh_refs))

            disk_files = []
            for root, _, files in os.walk(meshes_dir):
                for name in files:
                    if name.lower().endswith((".stl", ".dae", ".png", ".jpg", ".jpeg")):
                        disk_files.append(os.path.join(root, name))
            by_basename = {os.path.basename(p).lower(): p for p in disk_files}

            _cache = {}
            def b64(path):
                if path not in _cache:
                    with open(path, "rb") as f:
                        _cache[path] = base64.b64encode(f.read()).decode("ascii")
                return _cache[path]

            def add_entry(key, path):
                k = key.replace("\\", "/").lower()
                if k not in mesh_db:
                    mesh_db[k] = b64(path)

            for ref in mesh_refs:
                base = os.path.basename(ref).lower()
                if base in by_basename:
                    real = by_basename[base]
                    add_entry(ref, real)
                    add_entry(ref.replace("package://", ""), real)
                    add_entry(base, real)

            for p in disk_files:
                bn = os.path.basename(p).lower()
                if bn.endswith((".png", ".jpg", ".jpeg")) and bn not in mesh_db:
                    add_entry(bn, p)

    esc = lambda s: (s.replace('\\', '\\\\')
                      .replace('`', '\\`')
                      .replace('$', '\\$')
                      .replace("</script>", "<\\/script>"))
    urdf_js = esc(urdf_raw) if urdf_raw else ""
    mesh_js = json.dumps(mesh_db)
    bg_js   = 'null' if (background is None) else str(int(background))
    sel_js  = json.dumps(select_mode)

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>URDF Viewer (auto-latest commit JS)</title>
<style>
  html,body {{ margin:0; height:100%; overflow:hidden; background:#f0f0f0; }}
  #app {{ position:fixed; inset:0; }}
  .badge {{ position:fixed; right:14px; bottom:12px; z-index:10; user-select:none; pointer-events:none; }}
  .badge img {{ max-height:40px; display:block; }}
  .ver {{ position:fixed; left:10px; bottom:10px; font:12px/1.2 monospace; background:#fff8;
          padding:6px 8px; border-radius:8px; z-index:20; }}
</style>
</head>
<body>
  <div id="app"></div>
  <div class="badge">
    <img src="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png" alt="badge"/>
  </div>
  <div class="ver" id="verBox">loading latest…</div>

<script>
(async function() {{
  const repo = {json.dumps(repo)};
  const filePath = {json.dumps(compFile)};
  const needThree = {str(bool(ensure_three)).lower()};
  const haveURDF = {json.dumps(bool(urdf_raw))};
  const verBox = document.getElementById('verBox');

  function loadScript(url) {{
    return new Promise((resolve, reject) => {{
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = () => resolve(url);
      s.onerror = () => reject(new Error("Failed to load " + url));
      document.head.appendChild(s);
    }});
  }}
  async function fetchJson(url) {{
    const r = await fetch(url, {{
      headers: {{ "Accept":"application/vnd.github+json" }},
      cache: "no-store"
    }});
    if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
    return r.json();
  }}
  async function getDefaultBranch() {{
    try {{
      const j = await fetchJson(`https://api.github.com/repos/${{repo}}?_=${{Date.now()}}`);
      return j.default_branch || 'main';
    }} catch (e) {{
      console.warn("default_branch fallback to 'main' due to:", e);
      return 'main';
    }}
  }}
  async function getLatestCommitSha(branch) {{
    try {{
      const j = await fetchJson(`https://api.github.com/repos/${{repo}}/commits?sha=${{branch}}&per_page=1&_=${{Date.now()}}`);
      // NOTE: API returns an array (newer endpoint) or an object if you call /commits/${{branch}}
      if (Array.isArray(j) && j[0] && j[0].sha) return j[0].sha;
      if (!Array.isArray(j) && j.sha) return j.sha;
      throw new Error("No SHA in response");
    }} catch (e) {{
      console.warn("Latest commit fallback to branch due to:", e);
      return null;
    }}
  }}
  function jsDelivrAt(ref) {{ return `https://cdn.jsdelivr.net/gh/${{repo}}@${{ref}}/${{filePath}}`; }}
  function rawAt(ref)      {{ return `https://raw.githubusercontent.com/${{repo}}/${{ref}}/${{filePath}}`; }}

  const branch = await getDefaultBranch();
  let sha = await getLatestCommitSha(branch);
  let resolvedRef = sha || branch;
  let loadedFrom = "jsDelivr@commit";

  verBox.textContent = "repo: " + repo + " | branch: " + branch + (sha ? (" | commit: " + sha.slice(0,7)) : " | (using branch)");

  try {{
    if (sha) {{
      await loadScript(jsDelivrAt(sha));
    }} else {{
      throw new Error("No commit SHA, skip to branch");
    }}
  }} catch (e1) {{
    console.warn("Primary failed:", e1);
    try {{
      await loadScript(jsDelivrAt(branch) + "?_=" + Date.now());
      loadedFrom = "jsDelivr@branch"; resolvedRef = branch;
    }} catch (e2) {{
      console.warn("Fallback 1 failed:", e2);
      try {{
        if (sha) {{
          await loadScript(rawAt(sha) + "?_=" + Date.now());
          loadedFrom = "raw@commit"; resolvedRef = sha;
        }} else {{
          throw new Error("No SHA for raw@commit");
        }}
      }} catch (e3) {{
        console.warn("Fallback 2 failed:", e3);
        await loadScript(rawAt(branch) + "?_=" + Date.now());
        loadedFrom = "raw@branch"; resolvedRef = branch;
      }}
    }}
  }}

  verBox.textContent += " | loaded: " + loadedFrom + " | ref: " + (resolvedRef ? resolvedRef.slice(0,7) : branch);

  const haveViewer = (window.URDFViewer && typeof window.URDFViewer.render === 'function');
  let haveTHREE = (typeof window.THREE !== 'undefined');

  if (!haveTHREE && needThree && haveViewer && haveURDF) {{
    try {{
      await loadScript("https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js");
      await loadScript("https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js");
      await loadScript("https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/STLLoader.js");
      await loadScript("https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/ColladaLoader.js");
      await loadScript("https://cdn.jsdelivr.net/npm/urdf-loader@0.12.6/umd/URDFLoader.js");
      haveTHREE = (typeof window.THREE !== 'undefined');
    }} catch (e) {{
      console.warn("Failed to auto-load THREE stack:", e);
    }}
  }}

  if (haveTHREE && haveViewer && haveURDF) {{
    const container = document.getElementById('app');
    const ensureSize = () => {{
      container.style.width = window.innerWidth + 'px';
      container.style.height = window.innerHeight + 'px';
    }};
    ensureSize(); window.addEventListener('resize', ensureSize);

    const opts = {{
      container,
      urdfContent: `{esc(urdf_raw) if urdf_raw else ""}`,
      meshDB: {mesh_js},
      selectMode: {sel_js},
      background: {bg_js}
    }};

    try {{
      window.__URDF_APP__ = window.URDFViewer.render(opts);
      console.log("URDFViewer.render executed.");
    }} catch (err) {{
      console.warn("URDFViewer.render failed (skipping):", err);
    }}
  }} else {{
    console.log("Skipping render. hasTHREE:", typeof window.THREE !== 'undefined',
                "hasViewer:", (window.URDFViewer && typeof window.URDFViewer.render === 'function'),
                "hasURDF:", haveURDF);
  }}
}})();
</script>
</body>
</html>
"""
    return HTML(html)

