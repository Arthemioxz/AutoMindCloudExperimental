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
    repo="ArtemioA/AutoMindCloudExperimental",
    compFile="AutoMindCloud/ComponentSelection.js",  # optional; loads latest commit
    ensure_three=True
):
    import os, re, json, base64
    from IPython.display import HTML

    # ---- Find URDF + meshes; pack meshes as base64 ----
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
            with open(os.path.join(urdf_dir, urdf_files[0]), "r", encoding="utf-8") as f:
                urdf_raw = f.read()

            # Collect referenced meshes from URDF
            mesh_refs = re.findall(r'filename="([^"]+\.(?:stl|dae|obj|png|jpg|jpeg))"', urdf_raw, re.IGNORECASE)
            mesh_refs = list(dict.fromkeys(mesh_refs))

            # Gather files on disk (meshes + possible textures)
            disk_files = []
            for r, _, files in os.walk(meshes_dir):
                for name in files:
                    if name.lower().endswith((".stl",".dae",".obj",".png",".jpg",".jpeg")):
                        disk_files.append(os.path.join(r, name))
            by_basename = {os.path.basename(p).lower(): p for p in disk_files}

            _cache = {}
            def b64(path):
                if path not in _cache:
                    with open(path, "rb") as f:
                        _cache[path] = base64.b64encode(f.read()).decode("ascii")
                return _cache[path]

            def add_entry(key, path):
                k = key.replace("\\","/").lower()
                if k not in mesh_db:
                    mesh_db[k] = b64(path)

            # Map URDF refs to actual files by basename and variants
            for ref in mesh_refs:
                base = os.path.basename(ref).lower()
                if base in by_basename:
                    real = by_basename[base]
                    add_entry(ref, real)
                    add_entry(ref.replace("package://",""), real)
                    add_entry(base, real)

            # Include textures that may be referenced inside .dae
            for p in disk_files:
                bn = os.path.basename(p).lower()
                if bn.endswith((".png",".jpg",".jpeg")) and bn not in mesh_db:
                    add_entry(bn, p)

    esc = lambda s: (s.replace('\\','\\\\').replace('`','\\`').replace('$','\\$').replace("</script>","<\\/script>"))
    urdf_js = esc(urdf_raw) if urdf_raw else ""
    mesh_js = json.dumps(mesh_db)
    bg_js   = 'null' if (background is None) else str(int(background))
    sel_js  = json.dumps(select_mode)

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>URDF Viewer (inline)</title>
<style>
  html,body {{ margin:0; height:100%; overflow:hidden; background:#f0f0f0; }}
  #app {{ position:fixed; inset:0; }}
  .badge{{ position:fixed; right:14px; bottom:12px; z-index:10; user-select:none; pointer-events:none; }}
  .badge img{{ max-height:40px; display:block; }}
  .ov {{ position:fixed; left:12px; top:12px; z-index:20; background:#0009; color:#fff;
         font:12px/1.3 monospace; padding:8px 10px; border-radius:8px; max-width:70vw; white-space:pre-wrap; }}
</style>
</head>
<body>
  <div id="app"></div>
  <div class="badge"><img src="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png" alt="badge"/></div>
  <div class="ov" id="ov">loading…</div>

<script>
(async function() {{
  const needThree  = {str(bool(ensure_three)).lower()};
  const haveURDF   = {json.dumps(bool(urdf_raw))};
  const meshDB     = {mesh_js};
  const urdfText   = `{urdf_js}`;
  const selectMode = {sel_js};
  const bgColor    = {bg_js};
  const repo       = {json.dumps(repo)};
  const compFile   = {json.dumps(compFile)};
  const ov = document.getElementById('ov');
  const say = m => {{ console.log(m); if (ov) ov.textContent = m; }};

  function loadScript(u) {{
    return new Promise((res, rej) => {{
      const s = document.createElement('script');
      s.src = u; s.async = true;
      s.onload = () => res(u);
      s.onerror = () => rej(new Error("Failed to load " + u));
      document.head.appendChild(s);
    }});
  }}

  async function fetchJson(u) {{
    const r = await fetch(u, {{ headers: {{ "Accept":"application/vnd.github+json" }}, cache:"no-store" }});
    if (!r.ok) throw new Error("HTTP " + r.status + " for " + u);
    return r.json();
  }}

  async function getDefaultBranch() {{
    try {{
      const j = await fetchJson(`https://api.github.com/repos/${{repo}}?_=${{Date.now()}}`);
      return j.default_branch || 'main';
    }} catch {{ return 'main'; }}
  }}
  async function getLatestSha(branch) {{
    try {{
      const j = await fetchJson(`https://api.github.com/repos/${{repo}}/commits?sha=${{branch}}&per_page=1&_=${{Date.now()}}`);
      if (Array.isArray(j) && j[0] && j[0].sha) return j[0].sha;
      if (!Array.isArray(j) && j.sha) return j.sha;
      return null;
    }} catch {{ return null; }}
  }}
  function jsDelivrAt(ref) {{ return `https://cdn.jsdelivr.net/gh/${{repo}}@${{ref}}/${{compFile}}`; }}
  function rawAt(ref)      {{ return `https://raw.githubusercontent.com/${{repo}}/${{ref}}/${{compFile}}`; }}

  async function loadCompLatest() {{
    const branch = await getDefaultBranch();
    const sha = await getLatestSha(branch);
    const tries = [];
    if (sha) tries.push(jsDelivrAt(sha));
    tries.push(jsDelivrAt(branch) + "?_=" + Date.now());
    if (sha) tries.push(rawAt(sha) + "?_=" + Date.now());
    tries.push(rawAt(branch) + "?_=" + Date.now());
    for (const u of tries) {{
      try {{ await loadScript(u); return u; }} catch (e) {{}}
    }}
    return null; // fine if it doesn't load — viewer works anyway
  }}

  try {{
    if (needThree) {{
      say("loading THREE…");
      await loadScript("https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js");
      await loadScript("https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js");
      await loadScript("https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/STLLoader.js");
      await loadScript("https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/ColladaLoader.js");
      // Silence specific Collada warnings
      (function(){{
        const ow = console.warn;
        console.warn = function(...a){{
          const m = String(a[0]||"");
          if (m.includes("Couldn't find camera with ID") || m.includes("Couldn't find light with ID")) return;
          return ow.apply(this, a);
        }};
      }})();
      await loadScript("https://cdn.jsdelivr.net/npm/urdf-loader@0.12.6/umd/URDFLoader.js");
    }}
  }} catch (e) {{
    say("CDN load error:\\n" + (e && e.message ? e.message : e)); return;
  }}

  if (!haveURDF) {{
    say("No URDF found. Ensure /urdf and /meshes exist in the folder."); return;
  }}

  // ---- Minimal inline viewer (defines window.URDFViewer.render) ----
  window.URDFViewer = {{
    render(opts) {{
      const container = opts.container;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
      const renderer = new THREE.WebGLRenderer({{ antialias:true }});
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      container.appendChild(renderer.domElement);

      const controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;

      // Lights
      const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
      hemi.position.set(0,1,0); scene.add(hemi);
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(3,6,5); scene.add(dir);

      if (opts.background !== null) scene.background = new THREE.Color(opts.background);

      // Resize
      function onResize(){{
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        renderer.setSize(w,h,false);
        camera.aspect = w/h; camera.updateProjectionMatrix();
      }}
      window.addEventListener('resize', onResize);

      // Map URL → data: URI from meshDB (by exact, stripped, or basename)
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => {{
        const norm = (s)=>String(s||'').replace(/\\\\/g,'/').toLowerCase();
        const k1 = norm(url);
        const k2 = norm(url).replace(/^package:\\/\\//,'');
        const k3 = norm(url).split('/').pop();
        const hit = meshDB[k1] || meshDB[k2] || meshDB[k3];
        if (!hit) return url;
        const ext = k1.split('?')[0].split('#')[0].split('.').pop();
        const mime = (ext==='stl') ? 'model/stl'
                   : (ext==='dae') ? 'model/vnd.collada+xml'
                   : (ext==='png') ? 'image/png'
                   : (ext==='jpg' || ext==='jpeg') ? 'image/jpeg'
                   : 'application/octet-stream';
        return `data:${{mime}};base64,${{hit}}`;
      }});

      const loader = new URDFLoader(manager);
      // Render URDF from string
      const robot = loader.parse(opts.urdfContent);
      scene.add(robot);

      // Fit camera to content
      function fit() {{
        const box = new THREE.Box3().setFromObject(robot);
        if (!box.isEmpty()) {{
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const radius = Math.max(size.x, size.y, size.z) * 0.6 || 1.0;
          camera.near = radius/100; camera.far = radius*100; camera.updateProjectionMatrix();
          camera.position.copy(center.clone().add(new THREE.Vector3(radius*1.8, radius*1.2, radius*1.8)));
          controls.target.copy(center);
          controls.update();
        }} else {{
          camera.position.set(2,1.2,2); controls.target.set(0,0,0); controls.update();
        }}
      }}
      fit();

      // Render loop
      function tick(){{
        controls.update();
        renderer.render(scene,camera);
        requestAnimationFrame(tick);
      }}
      tick(); onResize();

      return {{ scene, camera, renderer, controls, robot }};
    }}
  }};

  // Load your ComponentSelection.js at latest (optional)
  try {{ await loadCompLatest(); }} catch (e) {{ /* non-fatal */ }}

  // Create container and render
  const container = document.getElementById('app');
  try {{
    const app = window.URDFViewer.render({{
      container,
      urdfContent: urdfText,
      meshDB: meshDB,
      selectMode: selectMode,
      background: bgColor
    }});
    if (ov) ov.remove();
    window.__URDF_APP__ = app;
  }} catch (e) {{
    say("render error:\\n" + (e && e.message ? e.message : e));
  }}
}})();
</script>
</body>
</html>
"""
    return HTML(html)
