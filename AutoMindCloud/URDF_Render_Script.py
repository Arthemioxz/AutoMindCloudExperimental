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
# Genera el visor: carga libs + JS del repo (SHA más reciente) y renderiza
# -------------------------------
def URDF_Render(folder_path="Model",
                select_mode="link", background=0xf0f0f0,
                repo="ArtemioA/AutoMindCloudExperimental",
                branch="main",
                viewerFile="AutoMindCloud/urdf_viewer.js",
                compFile="AutoMindCloud/ComponentSelection.js"):
    """
    Carga automáticamente urdf_viewer.js + ComponentSelection.js desde tu repo en jsDelivr
    usando el último commit de 'branch' (fallback a @branch si falla el API).
    """

    # 1) localizar /urdf y /meshes
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
    if not urdf_dir or not meshes_dir:
        raise FileNotFoundError(f"Could not find urdf/ and meshes/ inside '{folder_path}' (or one nested level).")

    # 2) elegir el .urdf principal
    urdf_files = [f for f in os.listdir(urdf_dir) if f.lower().endswith(".urdf")]
    if not urdf_files:
        raise FileNotFoundError(f"No .urdf file in {urdf_dir}")
    urdf_path = os.path.join(urdf_dir, urdf_files[0])
    with open(urdf_path, "r", encoding="utf-8") as f:
        urdf_raw = f.read()

    # 3) refs a mallas desde el URDF
    mesh_refs = re.findall(r'filename="([^"]+\.(?:stl|dae))"', urdf_raw, re.IGNORECASE)
    mesh_refs = list(dict.fromkeys(mesh_refs))  # unique y estable

    # 4) indexar ficheros en /meshes (stl, dae, png, jpg, jpeg)
    disk_files = []
    for root, _, files in os.walk(meshes_dir):
        for name in files:
            if name.lower().endswith((".stl",".dae",".png",".jpg",".jpeg")):
                disk_files.append(os.path.join(root, name))
    by_basename = {os.path.basename(p).lower(): p for p in disk_files}

    _cache={}
    def b64(path):
        if path not in _cache:
            with open(path, "rb") as f:
                _cache[path] = base64.b64encode(f.read()).decode("ascii")
        return _cache[path]

    mesh_db = {}
    def add_entry(key, path):
        k = key.replace("\\","/").lower()
        if k not in mesh_db: mesh_db[k] = b64(path)

    # mapear refs del URDF a archivos
    for ref in mesh_refs:
        base = os.path.basename(ref).lower()
        if base in by_basename:
            real = by_basename[base]
            add_entry(ref, real)
            add_entry(ref.replace("package://",""), real)
            add_entry(base, real)

    # incluir texturas por basename
    for p in disk_files:
        bn = os.path.basename(p).lower()
        if bn.endswith((".png",".jpg",".jpeg")) and bn not in mesh_db:
            add_entry(bn, p)

    # 5) HTML que monta el visor y llama a URDFViewer.render
    esc = lambda s: (s.replace('\\','\\\\').replace('`','\\`').replace('$','\\$').replace("</script>","<\\/script>"))
    urdf_js  = esc(urdf_raw)
    mesh_js  = json.dumps(mesh_db)
    bg_js    = 'null' if (background is None) else str(int(background))
    sel_js   = json.dumps(select_mode)

    base_html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>URDF Viewer</title>
<style>
  html,body {{ margin:0; height:100%; overflow:hidden; background:#f0f0f0; }}
  #app {{ position:fixed; inset:0; }}
  .badge{{ position:fixed; right:14px; bottom:12px; z-index:10; user-select:none; pointer-events:none; }}
  .badge img{{ max-height:40px; display:block; }}
</style>
</head>
<body>
  <div id="app"></div>
  <div class="badge">
    <img src="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png" alt="badge"/>
  </div>

  <!-- libs -->
  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/STLLoader.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/ColladaLoader.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/urdf-loader@0.12.6/umd/URDFLoader.js"></script>

  <!-- Cargador dinámico: obtiene SHA y carga viewer + ComponentSelection -->
  <script>
    (async function() {{
      const repo = {json.dumps(repo)};
      const branch = {json.dumps(branch)};
      const viewerFile = {json.dumps(viewerFile)};
      const compFile = {json.dumps(compFile)};

      function loadScript(url) {{
        return new Promise((resolve, reject) => {{
          const s = document.createElement("script");
          s.src = url;
          s.defer = true;
          s.onload = () => {{ console.log("Loaded:", url); resolve(url); }};
          s.onerror = () => {{ console.warn("Failed:", url); reject(new Error("load fail")); }};
          document.head.appendChild(s);
        }});
      }}

      async function getVersion() {{
        try {{
          const api = `https://api.github.com/repos/${{repo}}/commits/${{branch}}?_=${{Date.now()}}`;
          const r = await fetch(api, {{ headers: {{ "Accept":"application/vnd.github+json" }}, cache: "no-store" }});
          if (!r.ok) throw new Error("GitHub API " + r.status);
          const j = await r.json();
          const sha = (j.sha||"").slice(0,7);
          return sha || branch; // si no hay sha, fallback a rama
        }} catch(e) {{
          console.warn("Using fallback @branch due to API error:", e);
          return branch;
        }}
      }}

      const ver = await getVersion();
      const base = `https://cdn.jsdelivr.net/gh/${{repo}}@${{ver}}/`;

      // Cargar viewer y luego ComponentSelection (orden importa)
      try {{
        await loadScript(base + viewerFile);
      }} catch(e) {{
        // último fallback a @branch explícito
        await loadScript(`https://cdn.jsdelivr.net/gh/${{repo}}@${{branch}}/` + viewerFile);
      }}

      try {{
        await loadScript(base + compFile);
      }} catch(e) {{
        await loadScript(`https://cdn.jsdelivr.net/gh/${{repo}}@${{branch}}/` + compFile);
      }}

      // Señal para el bootstrap
      window.__AMC_READY__ = true;
    }})();
  </script>

  <!-- Bootstrap: espera a URDFViewer.render -->
  <script>
    (async function(){{
      const container = document.getElementById('app');
      const ensureSize = () => {{
        container.style.width = window.innerWidth + 'px';
        container.style.height = window.innerHeight + 'px';
      }};
      ensureSize(); window.addEventListener('resize', ensureSize);

      // Esperar a que carguen los JS
      const waitFor = async (cond, ms=10000) => {{
        const t0 = Date.now();
        while (Date.now()-t0 < ms) {{
          if (cond()) return true;
          await new Promise(r=>setTimeout(r, 50));
        }}
        return false;
      }};

      const ok = await waitFor(() => window.__AMC_READY__ && window.URDFViewer && typeof window.URDFViewer.render === 'function', 12000);
      if (!ok) {{
        console.error("URDFViewer not loaded (revisa ruta/nombre de 'viewerFile').");
        return;
      }}

      const opts = {{
        container,
        urdfContent: `{urdf_js}`,
        meshDB: {mesh_js},
        selectMode: {sel_js},
        background: {bg_js}
      }};

      window.__URDF_APP__ = window.URDFViewer.render(opts);
    }})();
  </script>
</body>
</html>
"""
    return HTML(base_html)
