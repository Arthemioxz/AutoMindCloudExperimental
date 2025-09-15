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
# 1) CARGA DE FUNCIONES JS (UNA VEZ) 
#    - Three.js + loaders (opcional)
#    - Tu librería que define window.URDFViewer.render(...)
#    - Expone window.__URDF_FUNCS_READY (Promise global)
# -------------------------------
def URDF_Functions(
    repo="ArtemioA/AutoMindCloudExperimental",
    branch="main",
    compFile="AutoMindCloud/ComponentSelection.js",
    ensure_three=True,
    three_ver="0.160",
    urdf_loader_ver="0.12.6"  # usa UMD o ESM; aquí cargamos UMD si no hay THREE
):
    """
    Carga el stack JS en el front-end de Colab:
    - Si THREE ya existe y URDFViewer ya está, NO recarga.
    - Si faltan, trae desde CDN/tu repo.
    - Deja window.__URDF_FUNCS_READY listo para que URDF_Render espere.
    """
    html = f"""
    <div id="__amc_js_loader" style="font:12px/1.2 Inter,system-ui; color:#555; margin:6px 0;">
      Loading URDF functions… (only once)
    </div>
    <script>
    (function() {{
      if (window.__URDF_FUNCS_READY) {{
        // Ya estaba cargado; resolver inmediato
        document.getElementById("__amc_js_loader")?.remove();
        return;
      }}

      let _resolve; 
      window.__URDF_FUNCS_READY = new Promise(res => _resolve = res);

      function log(msg){{ try{{console.log("[URDF_Functions]", msg);}}catch(e){{}} }}
      function loadScript(src){{
        return new Promise((resolve, reject) => {{
          const s = document.createElement('script');
          s.src = src; s.defer = true;
          s.onload = () => resolve(src);
          s.onerror = () => reject(new Error("Failed to load " + src));
          document.head.appendChild(s);
        }});
      }}

      const needThree = {str(bool(ensure_three)).lower()};
      const haveTHREE = (typeof window.THREE !== 'undefined');
      const haveViewer = (window.URDFViewer && typeof window.URDFViewer.render === 'function');

      const repo = {json.dumps(repo)};
      const branch = {json.dumps(branch)};
      const compFile = {json.dumps(compFile)};

      async function loadViewerFromRepo(){{
        // jsDelivr: raw file by branch (or tag/SHA if you prefer pinning)
        const base = "https://cdn.jsdelivr.net/gh/" + repo + "@" + branch + "/";
        await loadScript(base + compFile);
      }}

      async function ensureThreeStack(){{
        if (typeof window.THREE !== 'undefined') return;
        // Three + controls + loaders + URDFLoader (UMD) — versiones fijas
        await loadScript("https://cdn.jsdelivr.net/npm/three@{three_ver}/build/three.min.js");
        await loadScript("https://cdn.jsdelivr.net/npm/three@{three_ver}/examples/js/controls/OrbitControls.js");
        await loadScript("https://cdn.jsdelivr.net/npm/three@{three_ver}/examples/js/loaders/STLLoader.js");
        await loadScript("https://cdn.jsdelivr.net/npm/three@{three_ver}/examples/js/loaders/ColladaLoader.js");
        await loadScript("https://cdn.jsdelivr.net/npm/urdf-loader@{urdf_loader_ver}/umd/URDFLoader.js");
      }}

      (async () => {{
        try {{
          if (!haveViewer) {{
            if (!haveTHREE && needThree) {{
              log("Loading THREE stack…");
              await ensureThreeStack();
            }}
            log("Loading URDFViewer from repo…");
            await loadViewerFromRepo();
          }}
          log("Ready.");
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


# -------------------------------
# 2) RENDER — usa lo que cargó URDF_Functions()
#    (no vuelve a cargar librerías)
# -------------------------------
def URDF_Render(folder_path="Model",
                select_mode="link",
                background=0xf0f0f0):
    """
    - Busca /urdf y /meshes en 'folder_path'
    - Construye urdf_raw + mesh_db (png/jpg stl/dae en base64)
    - Espera a window.__URDF_FUNCS_READY y ejecuta URDFViewer.render(...)
    """

    # ----- Buscar archivos
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

            mesh_refs = re.findall(r'filename="([^"]+\\.(?:stl|dae))"', urdf_raw, re.IGNORECASE)
            mesh_refs = list(dict.fromkeys(mesh_refs))

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

            def add_entry(key, path):
                k = key.replace("\\","/").lower()
                if k not in mesh_db: mesh_db[k] = b64(path)

            for ref in mesh_refs:
                base = os.path.basename(ref).lower()
                if base in by_basename:
                    real = by_basename[base]
                    add_entry(ref, real)
                    add_entry(ref.replace("package://",""), real)
                    add_entry(base, real)

            # imágenes sueltas
            for p in disk_files:
                bn = os.path.basename(p).lower()
                if bn.endswith((".png",".jpg",".jpeg")) and bn not in mesh_db:
                    add_entry(bn, p)

    # ----- HTML + JS que ESPERA a __URDF_FUNCS_READY y renderiza
    esc = lambda s: (s.replace('\\','\\\\')
                       .replace('`','\\`')
                       .replace('$','\\$')
                       .replace("</script>","<\\/script>"))
    urdf_js  = esc(urdf_raw) if urdf_raw else ""
    mesh_js  = json.dumps(mesh_db)
    bg_js    = 'null' if (background is None) else str(int(background))
    sel_js   = json.dumps(select_mode)

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>URDF Render</title>
<style>
  html,body {{ margin:0; height:100%; overflow:hidden; background:#f0f0f0; }}
  #app {{ position:fixed; inset:0; }}
  .badge{{ position:fixed; right:14px; bottom:12px; z-index:10; user-select:none; pointer-events:none; }}
  .badge img{{ max-height:40px; display:block; }}
  .note{{ position:fixed; left:12px; bottom:12px; font:12px/1.3 Inter,system-ui; color:#666; }}
</style>
</head>
<body>
  <div id="app"></div>
  <div class="badge">
    <img src="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png" alt="badge"/>
  </div>
  <div class="note">Waiting for functions… then rendering.</div>

  <script>
  (async function() {{
    // Esperar a que URDF_Functions haya cargado todo
    const ok = (window.__URDF_FUNCS_READY ? await window.__URDF_FUNCS_READY : false);

    const haveViewer = (window.URDFViewer && typeof window.URDFViewer.render === 'function');
    const haveTHREE = (typeof window.THREE !== 'undefined');
    const haveURDF = {json.dumps(bool(urdf_raw))};

    const container = document.getElementById('app');
    const ensureSize = () => {{
      container.style.width = window.innerWidth + 'px';
      container.style.height = window.innerHeight + 'px';
    }};
    ensureSize(); window.addEventListener('resize', ensureSize);

    if (!haveViewer || !haveTHREE || !haveURDF) {{
      console.warn("Cannot render. haveViewer:", haveViewer, " haveTHREE:", haveTHREE, " haveURDF:", haveURDF, " funcsReady:", ok);
      document.querySelector(".note")?.replaceChildren(document.createTextNode("Missing stack or URDF. Did you run URDF_Functions()?"));
      return;
    }}

    const opts = {{
      container,
      urdfContent: `{urdf_js}`,
      meshDB: {mesh_js},
      selectMode: {sel_js},
      background: {bg_js}
    }};

    try {{
      window.__URDF_APP__ = window.URDFViewer.render(opts);
      document.querySelector(".note")?.remove();
      console.log("URDFViewer.render executed.");
    }} catch (err) {{
      console.warn("URDFViewer.render failed:", err);
      const el = document.querySelector(".note");
      if (el) el.textContent = "Render failed: " + err;
    }}
  }})();
  </script>
</body>
</html>
"""
    return HTML(html)
