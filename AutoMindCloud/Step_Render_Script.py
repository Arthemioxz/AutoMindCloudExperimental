import os, io, base64, tempfile, shutil
from IPython.display import HTML, display

# Optional helpers if you pull from Google Drive or have STEP/STL locally
import gdown
import trimesh

# If you use cascadio for STEP→GLB conversion:
import cascadio


def download_step_to_tmp(drive_link: str) -> str:
    """
    Download a STEP from a Google Drive sharing link into a temp directory.
    Returns the absolute path to the temp STEP file.
    """
    tmpdir = tempfile.mkdtemp(prefix="stepdl_")
    file_id = drive_link.split('/d/')[1].split('/')[0]
    url = f"https://drive.google.com/uc?id={file_id}"
    step_path = os.path.join(tmpdir, "model.step")
    gdown.download(url, step_path, quiet=True)
    return step_path  # caller will clean tmpdir AFTER render


def _step_or_stl_to_glb_bytes(step_or_stl_path: str) -> bytes:
    """
    Convert STEP or STL → GLB (bytes), using temp files only when strictly needed.
    """
    ext = os.path.splitext(step_or_stl_path)[1].lower()
    tmpdir = os.path.dirname(step_or_stl_path)

    if ext == ".step":
        # cascadio writes to a file path; write to a temp path inside tmpdir, read, then delete.
        out_glb = os.path.join(tmpdir, "model.glb")
        cascadio.step_to_glb(step_or_stl_path, out_glb)  # produces file
        with open(out_glb, "rb") as f:
            glb_bytes = f.read()
        try: os.remove(out_glb)
        except: pass
        return glb_bytes

    elif ext == ".stl":
        # Use trimesh to load and export GLB to bytes (no files needed)
        mesh = trimesh.load(step_or_stl_path)
        scene = mesh if isinstance(mesh, trimesh.Scene) else trimesh.Scene(mesh)
        glb_bytes = scene.export(file_type="glb")
        return glb_bytes if isinstance(glb_bytes, (bytes, bytearray)) else glb_bytes.encode("utf-8")

    else:
        raise ValueError("Input must be a .step or .stl file")


def _scale_glb_bytes(glb_bytes: bytes, target_size=2.0) -> bytes:
    """
    Uniformly scale GLB (bytes) so its largest dimension ≈ target_size. Returns new GLB bytes.
    """
    # Load from bytes
    scene = trimesh.load(io.BytesIO(glb_bytes), file_type="glb")
    # Compute current size (fallbacks included)
    try:
        # If Scene, compute extents over geometry; if Trimesh, extents available directly
        if isinstance(scene, trimesh.Scene):
            # Combine bounds from all geometry
            bounds = scene.bounds  # (min, max) across the scene
            size_vec = bounds[1] - bounds[0]
            current_size = float(max(size_vec))
            if current_size <= 0: current_size = 1.0
            scale = float(target_size) / current_size
            scene.apply_scale(scale)
            out_bytes = scene.export(file_type="glb")
        else:
            # Trimesh
            current_size = float(max(getattr(scene, "extents", [1,1,1])))
            if current_size <= 0: current_size = 1.0
            scale = float(target_size) / current_size
            scene.apply_scale(scale)
            out_bytes = scene.export(file_type="glb")
    except Exception:
        # Fallback: wrap in Scene and try again
        sc = scene if isinstance(scene, trimesh.Scene) else trimesh.Scene(scene)
        bounds = sc.bounds
        size_vec = bounds[1] - bounds[0]
        current_size = float(max(size_vec)) if size_vec is not None else 1.0
        if current_size <= 0: current_size = 1.0
        sc.apply_scale(float(target_size)/current_size)
        out_bytes = sc.export(file_type="glb")

    return out_bytes if isinstance(out_bytes, (bytes, bytearray)) else out_bytes.encode("utf-8")


def _file_to_data_url_audio(file_path: str) -> str | None:
    try:
        if file_path and os.path.exists(file_path):
            with open(file_path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("ascii")
            return f"data:audio/mpeg;base64,{b64}"
    except Exception:
        pass
    return None


def Step_Render_NoArtifacts(
    *,
    # Provide exactly one of the following sources:
    drive_link: str | None = None,       # Google Drive sharing link to a STEP
    local_step_or_stl: str | None = None, # Absolute path to a local .step or .stl

    target_size: float = 2.0,
    background: int | None = 0xffffff,   # set to None for transparent
    click_sound_path: str | None = None  # optional local MP3 to embed as data URL
):
    """
    Render inline (no HTML/GLB/STEP artifacts left in /content). All temps are cleaned up.
    - If `drive_link` is given, the STEP is downloaded to a temp dir.
    - If `local_step_or_stl` is given, it is READ ONLY (not moved/modified).
    """
    # Create a private temp dir that we will delete at the end
    tmpdir = tempfile.mkdtemp(prefix="steprender_")
    created_step_tmp = None

    try:
        # Get a working STEP/STL path in temp
        if drive_link:
            created_step_tmp = download_step_to_tmp(drive_link)  # this makes its own tmpdir; we’ll clean later
            step_or_stl_path = created_step_tmp
        elif local_step_or_stl:
            # Copy to our tmpdir so we never touch the original and keep cleanup simple
            dst = os.path.join(tmpdir, os.path.basename(local_step_or_stl))
            shutil.copy2(local_step_or_stl, dst)
            step_or_stl_path = dst
        else:
            raise ValueError("Provide either drive_link or local_step_or_stl.")

        # Convert to GLB (bytes), scale (bytes)
        glb_bytes = _step_or_stl_to_glb_bytes(step_or_stl_path)
        glb_scaled = _scale_glb_bytes(glb_bytes, target_size=target_size)
        glb_b64 = base64.b64encode(glb_scaled).decode("ascii")

        click_data_url = _file_to_data_url_audio(click_sound_path)
        click_js = "null" if not click_data_url else f'"{click_data_url}"'
        bg_js = 'null' if (background is None) else str(int(background))

        # ——— Inline HTML viewer (no file saved) ———
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>STEP Viewer</title>
<style>
  html, body {{ margin:0; padding:0; height:100vh; overflow:hidden; background:transparent; }}
  #app {{ position:fixed; inset:0; }}
  .ui-root {{ position:absolute; inset:0; pointer-events:none; z-index:9999; font-family:Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial; }}
  .panel {{ background:#fff; border:1px solid #e6e6e6; border-radius:18px; box-shadow:0 12px 36px rgba(0,0,0,.14); pointer-events:auto; overflow:hidden; }}
  .btn {{ padding:8px 12px; border-radius:12px; border:1px solid #e6e6e6; background:#fff; color:#0b3b3c; font-weight:700; cursor:pointer; }}
  .row {{ display:grid; grid-template-columns:120px 1fr; gap:10px; align-items:center; margin:6px 0; }}
  .lbl {{ color:#577e7f; font-weight:700; }}
  .hdr {{ display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; border-bottom:1px solid #e6e6e6; background:#fff; }}
  select, input[type="range"] {{ padding:8px; border:1px solid #e6e6e6; border-radius:10px; accent-color:#0ea5a6; }}
  .tools-toggle {{ position:absolute; right:14px; top:14px; pointer-events:auto; padding:8px 12px; border-radius:12px; border:1px solid #e6e6e6; background:#fff; color:#0b3b3c; font-weight:700; box-shadow:0 12px 36px rgba(0,0,0,.14); z-index:10000; }}
</style>
</head>
<body>
  <div id="app"></div>

  <script>
  (function(){{
    function fitIframe(){{
      try {{
        const h = window.innerHeight || document.documentElement.clientHeight || 600;
        if (window.google && google.colab && google.colab.output && google.colab.output.setIframeHeight) {{
          google.colab.output.setIframeHeight(h, true);
        }}
      }} catch (e) {{}}
    }}
    fitIframe();
    window.addEventListener('resize', fitIframe);
    window.addEventListener('orientationchange', fitIframe);
  }})();
  </script>

  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/GLTFLoader.js"></script>
  <script>
  (function(){{
    const THEME = {{ bgCanvas: {bg_js} }};

    // Optional click sound (data URL)
    let audioCtx=null, clickBuf=null, clickURL={click_js};
    async function ensureClickBuffer(){{
      if (!clickURL) return;
      if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      if (!clickBuf){{
        const resp = await fetch(clickURL); const arr = await resp.arrayBuffer();
        clickBuf = await new Promise((res, rej)=>{{ try{{ audioCtx.decodeAudioData(arr, res, rej); }}catch(e){{ rej(e); }} }});
      }}
    }}
    function playClick(){{
      if (!clickURL) return;
      if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      if (audioCtx.state==='suspended') audioCtx.resume();
      if (!clickBuf) {{ ensureClickBuffer().then(()=>playClick()).catch(()=>{{}}); return; }}
      const src = audioCtx.createBufferSource(); src.buffer = clickBuf; src.connect(audioCtx.destination); try{{ src.start(); }}catch(_e){{}}
    }}

    const container = document.getElementById('app');
    const renderer = new THREE.WebGLRenderer({{ antialias:true, preserveDrawingBuffer:true }});
    renderer.setPixelRatio(window.devicePixelRatio||1);
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    if (THEME.bgCanvas !== null) scene.background = new THREE.Color(THEME.bgCanvas);

    const persp = new THREE.PerspectiveCamera(60, 1, 0.01, 10000);
    const ortho = new THREE.OrthographicCamera(-1,1,1,-1,0.01,10000);
    let camera = persp;

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;

    const hemi = new THREE.HemisphereLight(0xffffff, 0xeeeeee, 0.7);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.05);
    dirLight.position.set(3,4,2); scene.add(hemi); scene.add(dirLight);

    const grid = new THREE.GridHelper(10, 20, 0xbbbbbb, 0xeeeeee); grid.visible=false; scene.add(grid);
    const axesHelper = new THREE.AxesHelper(1); axesHelper.visible=false; scene.add(axesHelper);
    function sizeAxesHelper(maxDim, center) {{
      axesHelper.scale.setScalar(maxDim * 0.75);
      axesHelper.position.copy(center || new THREE.Vector3());
    }}

    function ensureSize() {{
      const w = Math.max(1, window.innerWidth  || document.documentElement.clientWidth  || 1);
      const h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
      renderer.setSize(w, h, true);
      if (camera.isPerspectiveCamera) {{
        camera.aspect = w / h;
      }} else {{
        const maxDim = _lastMaxDim || 1;
        camera.left   = -maxDim * (w/h);
        camera.right  =  maxDim * (w/h);
        camera.top    =  maxDim;
        camera.bottom = -maxDim;
      }}
      camera.updateProjectionMatrix();
    }}

    function base64ToArrayBuffer(b64) {{
      const bin = atob(b64); const len = bin.length; const bytes = new Uint8Array(len);
      for (let i=0;i<len;i++) bytes[i]=bin.charCodeAt(i); return bytes.buffer;
    }}
    const glbBase64 = "{base64.b64encode(glb_scaled).decode('ascii') if False else glb_b64}";
    const arrayBuffer = base64ToArrayBuffer(glbBase64);

    let model = null, _lastMaxDim=1;
    const loader = new THREE.GLTFLoader();
    loader.parse(arrayBuffer, '', function(gltf) {{
      model = gltf.scene;
      model.traverse(n => {{
        if (n.isMesh && n.material) {{
          const mats = Array.isArray(n.material)? n.material : [n.material];
          for (const m of mats) m.side = THREE.DoubleSide;
        }}
      }});
      scene.add(model);
      centerAndFrame(1.12);
    }}, function(err) {{ console.error('GLB parse error:', err); }});

    function centerAndFrame(pad=1.12){{
      if (!model) return;
      const box = new THREE.Box3().setFromObject(model);
      if (box.isEmpty()) return;
      const c = box.getCenter(new THREE.Vector3());
      const s = box.getSize(new THREE.Vector3());
      model.position.sub(c);
      _lastMaxDim = Math.max(s.x, s.y, s.z) * pad;

      const w = Math.max(1, window.innerWidth  || document.documentElement.clientWidth  || 1);
      const h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
      const aspect = w / h;

      if (camera.isPerspectiveCamera) {{
        const radius = box.getBoundingSphere(new THREE.Sphere()).radius * pad;
        const vFOV = THREE.MathUtils.degToRad(camera.fov);
        const hFOV = 2 * Math.atan(Math.tan(vFOV/2) * aspect);
        const dist = Math.max(radius/Math.sin(vFOV/2), radius/Math.sin(hFOV/2)) * 1.02;
        camera.near = Math.max(radius/1000, 0.001);
        camera.far  = Math.max(radius*1500, 1500);
        camera.updateProjectionMatrix();
        const dir = new THREE.Vector3(1,0.9,1).normalize();
        camera.position.copy(dir.multiplyScalar(dist));
      }} else {{
        const radius = box.getBoundingSphere(new THREE.Sphere()).radius * pad;
        camera.left=-radius*aspect; camera.right=radius*aspect; camera.top=radius; camera.bottom=-radius;
        camera.near=Math.max(radius/1000,0.001); camera.far=Math.max(radius*1500,1500); camera.updateProjectionMatrix();
        camera.position.set(radius, radius*0.9, radius);
      }}
      controls.target.set(0,0,0); controls.update();
      sizeAxesHelper(_lastMaxDim, new THREE.Vector3(0,0,0));
    }}

    // Minimal tools (no downloads)
    const ui = document.createElement('div'); ui.className='ui-root';
    const toolsToggle = document.createElement('button'); toolsToggle.className='tools-toggle btn'; toolsToggle.textContent='Fit';
    toolsToggle.onclick = ()=>{{ playClick(); centerAndFrame(1.12); }};
    ui.appendChild(toolsToggle); document.body.appendChild(ui);

    function onResize(){{ ensureSize(); centerAndFrame(1.12); }}
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    new ResizeObserver(onResize).observe(document.getElementById('app'));

    ensureSize(); centerAndFrame(1.12);
    (function animate(){{ requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }})();
  }})();
  </script>
</body>
</html>"""

        display(HTML(html))

    finally:
        # Clean everything: our tmpdir + any temporary dir created by download_step_to_tmp
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass
        if created_step_tmp:
            # download_step_to_tmp created its own temp dir; remove its parent folder
            try:
                shutil.rmtree(os.path.dirname(created_step_tmp), ignore_errors=True)
            except Exception:
                pass
