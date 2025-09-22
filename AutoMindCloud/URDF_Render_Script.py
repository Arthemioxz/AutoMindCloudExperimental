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
# Genera HTML y carga el viewer (último commit) + audio opcional
# -------------------------------
def URDF_Render(folder_path="Model",
                select_mode="link", background=0xf0f0f0,
                repo="ArtemioA/AutoMindCloudExperimental",
                branch="main",
                compFile="AutoMindCloud/ComponentSelection.js",
                ensure_three=True,
                click_sound_path="click_sound.mp3"):
    """
    - Loads ComponentSelection.js from the repo's latest commit (fallback to @branch).
    - Auto-loads THREE stack if needed (ensure_three=True).
    - Scans folder_path for /urdf + /meshes, builds base64 meshDB, and inlines URDF.
    - If click_sound_path exists, embeds it as data URL and passes to URDFViewer as clickAudioDataURL.
    - Uses full viewport and auto-fits model to the visible area (centered), with a robust fallback.
    """

    # ---- Find urdf + meshes and build meshDB ----
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

            mesh_refs = re.findall(r'filename="([^"]+\.(?:stl|dae))"', urdf_raw, re.IGNORECASE)
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

            for p in disk_files:
                bn = os.path.basename(p).lower()
                if bn.endswith((".png",".jpg",".jpeg")) and bn not in mesh_db:
                    add_entry(bn, p)

    # ---- Optional click-sound data URL ----
    click_data_url = None
    if click_sound_path and os.path.exists(click_sound_path):
        try:
            with open(click_sound_path, "rb") as f:
                click_b64 = base64.b64encode(f.read()).decode("ascii")
            click_data_url = f"data:audio/mpeg;base64,{click_b64}"
        except Exception:
            click_data_url = None

    # ---- Prepare HTML/JS payload ----
    esc = lambda s: (s.replace('\\','\\\\').replace('`','\\`').replace('$','\\$').replace("</script>","<\\/script>"))
    urdf_js  = esc(urdf_raw) if urdf_raw else ""
    mesh_js  = json.dumps(mesh_db)
    bg_js    = 'null' if (background is None) else str(int(background))
    sel_js   = json.dumps(select_mode)
    click_js = json.dumps(click_data_url)  # "null" if None

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>URDF Viewer + Audio</title>
<style>
  /* Fill the entire visible area without scrollbars */
  html, body {{
    margin: 0;
    padding: 0;
    height: 100vh;           /* important for Colab/iframes */
    overflow: hidden;
    background: #f0f0f0;
  }}
  #app {{
    position: fixed;          /* pin to viewport */
    inset: 0;
    width: 100vw;
    height: 100vh;
  }}
  .badge{{ position:fixed; right:14px; bottom:12px; z-index:10; user-select:none; pointer-events:none; }}
  .badge img{{ max-height:40px; display:block; }}
</style>
</head>
<body>
  <div id="app"></div>
  <div class="badge">
    <img src="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png" alt="badge"/>
  </div>

  <script>
    (async function() {{
      const repo = {json.dumps(repo)};
      const branch = {json.dumps(branch)};
      const compFile = {json.dumps(compFile)};
      const needThree = {str(bool(ensure_three)).lower()};
      const haveURDF = {json.dumps(bool(urdf_raw))};

      // Ask Colab (if present) to expand the output frame to viewport height
      function colabFitIframe() {{
        try {{
          const h = window.innerHeight || document.documentElement.clientHeight || 600;
          if (window.google && google.colab && google.colab.output && google.colab.output.setIframeHeight) {{
            google.colab.output.setIframeHeight(h, true);
          }}
        }} catch (e) {{}}
      }}
      colabFitIframe();
      window.addEventListener('resize', colabFitIframe);
      window.addEventListener('orientationchange', colabFitIframe);

      function loadScript(url){{
        return new Promise((res, rej) => {{
          const s = document.createElement('script');
          s.src = url; s.defer = true;
          s.onload = () => res(url);
          s.onerror = () => rej(new Error("load fail: " + url));
          document.head.appendChild(s);
        }});
      }}

      async function getVersion(){{
        try {{
          const api = `https://api.github.com/repos/${{repo}}/commits/${{branch}}?_=${{Date.now()}}`;
          const r = await fetch(api, {{ headers: {{ "Accept":"application/vnd.github+json" }}, cache: "no-store" }});
          if (!r.ok) throw new Error("GitHub API " + r.status);
          const j = await r.json();
          const sha = (j.sha || "").slice(0,7);
          return sha || branch;
        }} catch(e) {{
          return branch;
        }}
      }}

      // 1) Load viewer at latest commit
      const ver = await getVersion();
      const base = `https://cdn.jsdelivr.net/gh/${{repo}}@${{ver}}/`;
      try {{
        await loadScript(base + compFile);
      }} catch(e) {{
        await loadScript(`https://cdn.jsdelivr.net/gh/${{repo}}@${{branch}}/` + compFile);
      }}

      // 2) Ensure THREE stack if needed
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
        }} catch (e) {{}}
      }}

      // 3) Render + strong auto-fit fallback
      if (haveTHREE && haveViewer && haveURDF) {{
        const container = document.getElementById('app');

        // keep container exactly the viewport size
        function sizeContainer(){{
          container.style.width  = (window.innerWidth  || document.documentElement.clientWidth  || 1) + 'px';
          container.style.height = (window.innerHeight || document.documentElement.clientHeight || 1) + 'px';
        }}
        sizeContainer();
        window.addEventListener('resize', sizeContainer);
        window.addEventListener('orientationchange', sizeContainer);

        const opts = {{
          container,
          urdfContent: `{urdf_js}`,
          meshDB: {mesh_js},
          selectMode: {sel_js},
          background: {bg_js},
          clickAudioDataURL: {click_js}
        }};

        // Fallback fit that works even if the viewer script wasn't updated
        function enforceFit(app, pad=1.06){{
          try {{
            const robot = app && app.robot;
            const cam   = app && app.camera;
            const ctrls = app && app.controls;
            const rend  = app && app.renderer;
            if (!robot || !cam || !ctrls) return false;

            const box = new THREE.Box3().setFromObject(robot);
            if (box.isEmpty()) return false;
            const c = box.getCenter(new THREE.Vector3());
            const s = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(s.x, s.y, s.z) || 1;

            const w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
            const h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
            rend.setSize(w, h, false);

            if (cam.isPerspectiveCamera){{
              const fov = (cam.fov || 60) * Math.PI/180;
              const aspect = w / h;
              const fitHeight = (s.y * pad) / (2 * Math.tan(fov/2));
              const fitWidth  = ((s.x * pad) / (2 * Math.tan(fov/2))) / aspect;
              const dist = Math.max(fitHeight, fitWidth, s.z * pad);
              cam.near = Math.max(maxDim/1000, 0.001);
              cam.far  = Math.max(dist*50, maxDim*10, 1000);
              cam.aspect = aspect;
              cam.updateProjectionMatrix();
              const dir = new THREE.Vector3(1, 0.9, 1).normalize();
              cam.position.copy(c).add(dir.multiplyScalar(dist));
            }} else {{
              const aspect = w / h;
              const side = Math.max(s.x, s.y/aspect) * 0.5 * pad;
              cam.left = -side*aspect; cam.right = side*aspect;
              cam.top = side; cam.bottom = -side;
              cam.near = Math.max(maxDim/1000, 0.001);
              cam.far  = Math.max(maxDim*50, 1000);
              cam.updateProjectionMatrix();
              const dir = new THREE.Vector3(1, 0.9, 1).normalize();
              cam.position.copy(c).add(dir.multiplyScalar(Math.max(s.x,s.y,s.z) * 2.0));
            }}
            ctrls.target.copy(c); ctrls.update();
            return true;
          }} catch(e) {{ return false; }}
        }}

        try {{
          const app = (window.__URDF_APP__ = window.URDFViewer.render(opts));

          // Try hard-fit shortly after render, and again once the robot is actually there
          function tryHardFit(){{
            if (!window.__URDF_APP__) return;
            enforceFit(window.__URDF_APP__, 1.06);
          }}
          // First tick
          setTimeout(tryHardFit, 120);
          // Poll briefly until the model is present
          const t0 = Date.now();
          const poll = setInterval(() => {{
            const ok = enforceFit(window.__URDF_APP__, 1.06);
            if (ok || (Date.now() - t0) > 6000) clearInterval(poll);
          }}, 180);

          // Refit on viewport changes
          window.addEventListener('resize', () => enforceFit(window.__URDF_APP__, 1.04));
          window.addEventListener('orientationchange', () => setTimeout(()=>enforceFit(window.__URDF_APP__, 1.04), 100));
        }} catch (err) {{
          console.warn("URDFViewer.render failed:", err);
        }}
      }} else {{
        console.log("Skipping render");
      }}
    }})();
  </script>
</body>
</html>
"""
    return HTML(html)
