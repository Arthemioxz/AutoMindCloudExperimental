# urdf_render.py
import base64, re, os, json, shutil, zipfile
from IPython.display import HTML
import gdown

# -------------------------------
# Download and extract ZIP with /urdf and /meshes
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
        for n in top:
            shutil.move(os.path.join(tmp_extract, n), os.path.join(final_dir, n))
    shutil.rmtree(tmp_extract, ignore_errors=True)
    return final_dir

# -------------------------------
# Render URDF (full-viewport, ISO start/reset, no double-camera jump)
# -------------------------------
def URDF_Render(folder_path="Model",
                select_mode="link", background=0xf0f0f0,
                repo="ArtemioA/AutoMindCloudExperimental",
                branch="main",
                compFile="AutoMindCloud/ComponentSelection.js",
                ensure_three=True,
                click_sound_path="click_sound.mp3",
                # Exact ISO configuration (used at start AND on "Fit/Reset")
                init_az_deg=45,     # azimuth degrees (0=+X, 90=+Z)
                init_el_deg=25,     # elevation degrees from XZ plane
                init_pad=1.90       # fit padding factor (same everywhere)
                ):

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
  /* Full-viewport canvas, no scroll inside the output */
  html, body {{
    margin: 0 !important;
    padding: 0 !important;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background: #f0f0f0;
  }}
  #app {{
    position: fixed;
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

      // --- Make Colab output iframe fill visible area (avoid hidden top/bottom) ---
      function fitIframeOnce(){{
        try {{
          const h = window.innerHeight || document.documentElement.clientHeight || 600;
          if (window.google && google.colab && google.colab.output && google.colab.output.setIframeHeight) {{
            google.colab.output.setIframeHeight(h, true);
          }}
        }} catch(_) {{}}
      }}
      fitIframeOnce();
      window.addEventListener('orientationchange', ()=>setTimeout(fitIframeOnce,100));

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
          const r = await fetch(api, {{ headers: {{ "Accept":"application/vnd.github+json" }}, cache:"no-store" }});
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

      // 3) Render + ISO start + hijack "Fit/Reset" to ISO (no flicker)
      if (haveTHREE && haveViewer && haveURDF) {{
        const container = document.getElementById('app');

        // Keep canvas sized, but DO NOT auto-fit on resize (prevents camera jump)
        function sizeContainer(){{
          const w = window.innerWidth  || document.documentElement.clientWidth  || 1;
          const h = window.innerHeight || document.documentElement.clientHeight || 1;
          container.style.width  = w + 'px';
          container.style.height = h + 'px';
        }}
        sizeContainer();
        window.addEventListener('resize', sizeContainer);

        const opts = {{
          container,
          urdfContent: `{urdf_js}`,
          meshDB: {mesh_js},
          selectMode: {sel_js},
          background: {bg_js},
          clickAudioDataURL: {click_js}
        }};

        // Compute exact ISO distance from bounding sphere, aspect and FOV (uses tan).
        function applyISO(app) {{
          try {{
            const robot = app?.robot, cam = app?.camera, ctrl = app?.controls, rndr = app?.renderer;
            if (!robot || !cam || !ctrl || !rndr) return false;

            const box = new THREE.Box3().setFromObject(robot);
            if (box.isEmpty()) return false;

            const c = box.getCenter(new THREE.Vector3());
            const sz = box.getSize(new THREE.Vector3());
            const r = Math.max(1e-9, Math.sqrt(sz.x*sz.x + sz.y*sz.y + sz.z*sz.z) * 0.5) * {init_pad};

            const w = Math.max(1, container.clientWidth  || window.innerWidth  || 1);
            const h = Math.max(1, container.clientHeight || window.innerHeight || 1);
            rndr.setSize(w, h, false);

            const az = {init_az_deg} * Math.PI/180;
            const el = {init_el_deg} * Math.PI/180;
            const dir = new THREE.Vector3(
              Math.cos(el)*Math.cos(az),
              Math.sin(el),
              Math.cos(el)*Math.sin(az)
            ).normalize();

            if (cam.isPerspectiveCamera) {{
              const fovY = (cam.fov || 60) * Math.PI/180;
              const aspect = w / h;
              const fovX = 2 * Math.atan(Math.tan(fovY/2) * aspect);

              const distY = r / Math.tan(Math.max(1e-6, fovY/2));
              const distX = r / Math.tan(Math.max(1e-6, fovX/2));
              const dist  = Math.max(distX, distY);

              cam.aspect = aspect;
              cam.near   = Math.max(0.001, dist - r*1.5);
              cam.far    = Math.max(1000, dist + r*12.0);
              cam.updateProjectionMatrix();

              cam.position.copy(c).add(dir.multiplyScalar(dist));
            }} else {{
              const aspect = w / h;
              const halfH  = r;
              const halfW  = r * aspect;
              cam.left = -halfW; cam.right = halfW;
              cam.top  =  halfH; cam.bottom = -halfH;
              cam.near = Math.max(0.001, r * 0.02);
              cam.far  = Math.max(1000, r * 50);
              cam.updateProjectionMatrix();
              cam.position.copy(c).add(dir.multiplyScalar(r * 3.0));
            }}

            ctrl.target.copy(c); ctrl.update();
            return true;
          }} catch(e) {{
            return false;
          }}
        }}

        function hijackButtonsToISO(app){{
          // Intercept the viewer's own Fit/Reset handler so ONLY our ISO runs (no double pose).
          // We attach a *capturing* listener that stops the original one.
          const labelIs = (el, txt) => el && el.tagName==='BUTTON' && el.textContent && el.textContent.trim().toLowerCase()===txt;
          function bind(){{
            const btns = Array.from(document.querySelectorAll('button'));
            const targets = btns.filter(b => labelIs(b,'fit') || labelIs(b,'reset'));
            targets.forEach(b => {{
              // Avoid adding twice
              if (b.__amc_iso_bound) return;
              b.__amc_iso_bound = true;
              b.addEventListener('click', (ev) => {{
                ev.stopImmediatePropagation();
                ev.preventDefault();
                requestAnimationFrame(() => applyISO(app));
              }}, true); // capture!
            }});
          }}
          bind();
          // In case UI rebuilds later:
          const mo = new MutationObserver(() => bind());
          mo.observe(document.body, {{ childList:true, subtree:true }});
        }}

        try {{
          const app = (window.__URDF_APP__ = window.URDFViewer.render(opts));

          // Wait for robot to exist, then apply ISO ONCE (no intermediate fit).
          const tries = [80, 180, 320, 600, 1000, 1600];
          let done=false;
          tries.forEach(ms => setTimeout(() => {{ if (!done) done = applyISO(app); }}, ms));

          // Make the "Fit/Reset" button do ISO directly
          hijackButtonsToISO(app);
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

