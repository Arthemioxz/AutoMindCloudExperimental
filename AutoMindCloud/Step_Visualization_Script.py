import base64
import gdown
from IPython.display import display, HTML
import os

def Download_Step(Drive_Link, Output_Name):
    """
    Downloads a STEP file from Google Drive using the full Drive link.
    Saves it as Output_Name.step in /content.
    """
    root_dir = "/content"
    file_id = Drive_Link.split('/d/')[1].split('/')[0]
    url = f"https://drive.google.com/uc?id={file_id}"
    output_step = os.path.join(root_dir, Output_Name + ".step")
    gdown.download(url, output_step, quiet=True)

def Step_Visualization(Step_Name, height_px=390, tools_panel_scale=0.5):
    """
    STEP viewer (same size system as the simple script):
      - width: 100% of output cell
      - height: fixed height_px
      - renderer uses container.clientWidth/Height
    Plus:
      - Viewer Tools panel
      - Hotkey: press 't' (or 'c') to toggle panel
      - Tools panel scaled smaller (tools_panel_scale, default 0.5 => 50% smaller)
    """
    STEP_PATH = f"{Step_Name}.step"
    bg_js = "0xffffff"
    click_js = "null"  # e.g. '"https://.../click.mp3"' or "null"

    if not os.path.exists(STEP_PATH):
        raise FileNotFoundError(f"No se encontró {STEP_PATH}. Súbelo a Colab o ajusta la ruta.")

    with open(STEP_PATH, "rb") as f:
        step_b64 = base64.b64encode(f.read()).decode("ascii")

    H = int(height_px)
    panel_scale = float(tools_panel_scale)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>{Step_Name} 3D Viewer</title>
<style>
  html, body {{
    margin:0;
    padding:0;
    width:100%;
    height:auto;
    overflow:hidden;
    background:transparent;
    font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial;
  }}

  /* ✅ EXACT same sizing system as your simple script */
  #app {{
    width:100%;
    height:{H}px;
    box-sizing:border-box;
    position:relative;
    overflow:hidden;
    background:transparent;
  }}

  canvas {{
    display:block;
    width:100% !important;
    height:100% !important;
  }}

  .ui-root {{
    position:absolute; inset:0; pointer-events:none; z-index:9999;
    font-family:"Computer Modern","CMU Serif",Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial;
  }}
  .panel {{
    background:#ffffff; border:1px solid #e6e6e6; border-radius:18px;
    box-shadow:0 12px 36px rgba(0,0,0,.14); pointer-events:auto; overflow:hidden;
  }}
  .btn {{
    padding:8px 12px; border-radius:12px; border:1px solid #e6e6e6;
    background:#ffffff; color:#0b3b3c; font-weight:700; cursor:pointer;
    box-shadow:0 10px 24px rgba(0,0,0,.12);
    transition:all 0.16s ease-out;
  }}
  .btn:hover {{
    transform:translateY(-1px) scale(1.02);
    background:#ecfeff;
    border-color:#0ea5a6;
    box-shadow:0 16px 40px rgba(0,0,0,.16);
  }}
  .row {{
    display:grid; grid-template-columns:120px 1fr; gap:10px;
    align-items:center; margin:6px 0;
  }}
  .lbl {{
    color:#577e7f; font-weight:700;
  }}
  .hdr {{
    display:flex; align-items:center; justify-content:space-between; gap:8px;
    padding:10px 12px; border-bottom:1px solid #e6e6e6;
    background:#0ea5a6;
  }}
  .hdr-left {{
    font-weight:800;
    color:#ffffff;
  }}
  .hdr-right {{
    display:flex;
    gap:6px;
    align-items:center;
  }}
  .hdr-right .btn {{
    box-shadow:0 8px 20px rgba(0,0,0,.18);
  }}
  select, input[type="range"] {{
    padding:8px; border:1px solid #e6e6e6; border-radius:10px; accent-color:#0ea5a6;
  }}

  .tools-toggle {{
    position:absolute; right:14px; top:14px; pointer-events:auto;
    padding:8px 12px; border-radius:999px; border:1px solid #e6e6e6;
    background:#ffffff; color:#0b3b3c; font-weight:700;
    box-shadow:0 12px 36px rgba(0,0,0,.14); z-index:10000;
    transition:all 0.16s ease-out;
  }}
  .tools-toggle:hover {{
    transform:translateY(-1px) scale(1.02);
    background:#ecfeff;
    border-color:#0ea5a6;
    box-shadow:0 16px 40px rgba(0,0,0,.18);
  }}

  :root {{
    --tools-scale: {panel_scale};
  }}

  /* ✅ Viewer Tools panel (50% smaller by default via scale) */
  .panel.dock {{
    position:absolute; right:14px; top:54px; width:440px;

    transform-origin: top right;
    transform: translateX(560px) scale(var(--tools-scale));

    opacity:0;
    pointer-events:none;
    transition:
      transform 260ms cubic-bezier(.2,.7,.2,1),
      opacity 180ms ease;
  }}
  .panel.dock.open {{
    transform: translateX(0) scale(var(--tools-scale));
    opacity:1;
    pointer-events:auto;
  }}

  .badge {{
    position:absolute; bottom:12px; right:14px; z-index:10;
    user-select:none; pointer-events:none;
  }}
  .badge img {{
    max-height:40px; display:block;
  }}
</style>
</head>
<body>

  <div id="app">
    <div class="badge" style="display:inline-block; transform: scale(1.5) translateX(-15px); transform-origin: bottom right; margin:0; overflow:visible; pointer-events:none;">
      <img src="https://raw.githubusercontent.com/artemioadaysolvers/AutoMindCloudExperimental/main/AutoMindCloud/AutoMindCloud2.png"
           alt="AutoMind" style="display:block; height:40px; width:auto;"/>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js"></script>

  <script type="importmap">
  {{
    "imports": {{
      "three": "https://unpkg.com/three@0.181.0/build/three.module.js"
    }}
  }}
  </script>

  <script type="module">
  import * as THREE from "three";
  import {{ TrackballControls }} from "https://unpkg.com/three@0.181.0/examples/jsm/controls/TrackballControls.js";

  const THEME = {{
    teal: 0x0ea5a6,
    bgCanvas: {bg_js}
  }};

  const STEP_B64 = "{step_b64}";
  const CLICK_URL = {click_js};

  function base64ToUint8Array(b64) {{
    const bin = atob(b64);
    const len = bin.length;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return out;
  }}

  // Audio click opcional
  let audioCtx = null;
  let clickBuf = null;
  async function ensureClickBuffer() {{
    if (!CLICK_URL) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (!clickBuf) {{
      const resp = await fetch(CLICK_URL);
      const arr = await resp.arrayBuffer();
      clickBuf = await new Promise((res, rej) => {{
        try {{ audioCtx.decodeAudioData(arr, res, rej); }}
        catch (e) {{ rej(e); }}
      }});
    }}
  }}
  function playClick() {{
    if (!CLICK_URL) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (!clickBuf) {{
      ensureClickBuffer().then(() => playClick()).catch(() => {{}});
      return;
    }}
    const src = audioCtx.createBufferSource();
    src.buffer = clickBuf;
    src.connect(audioCtx.destination);
    try {{ src.start(); }} catch (e) {{}}
  }}

  function getSize(container) {{
    const w = container.clientWidth || 800;
    const h = container.clientHeight || {H};
    return {{ w, h }};
  }}

  (async function init() {{
    const container = document.getElementById("app");
    if (!container) return;
    if (typeof occtimportjs !== "function") {{
      console.error("occtimportjs no disponible");
      return;
    }}

    let {{ w, h }} = getSize(container);

    const renderer = new THREE.WebGLRenderer({{ antialias: true, preserveDrawingBuffer: true }});
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.shadowMap.enabled = false;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.left = "0";
    renderer.domElement.style.top = "0";
    renderer.domElement.style.zIndex = "1";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    if (THEME.bgCanvas !== null) scene.background = new THREE.Color(THEME.bgCanvas);

    const persp = new THREE.PerspectiveCamera(60, w / h, 0.01, 10000);
    persp.up.set(0,1,0);

    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10000);
    ortho.up.set(0,1,0);

    let camera = persp;

    const controls = new TrackballControls(camera, renderer.domElement);
    controls.rotateSpeed          = 4.0;
    controls.zoomSpeed            = 1.4;
    controls.panSpeed             = 0.8;
    controls.staticMoving         = false;
    controls.dynamicDampingFactor = 0.15;
    controls.mouseButtons = {{
      LEFT:   THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.ZOOM,
      RIGHT:  THREE.MOUSE.PAN
    }};
    controls.target.set(0, 0, 0);
    controls.update();

    const hemi = new THREE.HemisphereLight(0xffffff, 0xeeeeee, 0.7);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.05);
    dirLight.position.set(3, 4, 2);
    dirLight.castShadow = false;
    scene.add(hemi);
    scene.add(dirLight);

    const GRID_SIZE = 10;
    const grid = new THREE.GridHelper(GRID_SIZE, 20, 0x0ea5a6, 0x0ea5a6);
    grid.visible = false;
    scene.add(grid);

    const axesHelper = new THREE.AxesHelper(1);
    axesHelper.visible = false;
    scene.add(axesHelper);

    let _lastMaxDim = 1;
    let boundsInfo = null;
    let model = null;

    function applySizeToCamera() {{
      const s = getSize(container);
      w = s.w; h = s.h;

      if (camera.isPerspectiveCamera) {{
        camera.aspect = w / h;
      }} else {{
        const span = Math.max(_lastMaxDim, GRID_SIZE * 0.5);
        const aspect = w / h;
        camera.left   = -span * aspect;
        camera.right  =  span * aspect;
        camera.top    =  span;
        camera.bottom = -span;
      }}
      camera.updateProjectionMatrix();
    }}

    function sizeAxesHelper(maxDim) {{
      axesHelper.scale.setScalar(maxDim * 0.75);
      axesHelper.position.set(0,0,0);
    }}

    // --- Section clipping (same logic) ---
    let secEnabled = false;
    let secAxis = 'X';
    let secPlaneVisible = false;
    let secVisual = null;

    function clearSectionClipping() {{
      if (!model) return;
      model.traverse(obj => {{
        if (!obj.isMesh) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {{
          if (!m) return;
          m.clippingPlanes = null;
          m.needsUpdate = true;
        }});
      }});
    }}

    function applySectionPlaneToModel(plane) {{
      if (!model) return;
      model.traverse(obj => {{
        if (!obj.isMesh) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {{
          if (!m) return;
          m.clippingPlanes = [plane];
          m.needsUpdate = true;
        }});
      }});
    }}

    function ensureSectionVisual() {{
      if (!secVisual) {{
        const geom = new THREE.BoxGeometry(1,1,1);
        const mat  = new THREE.MeshBasicMaterial({{
          color: THEME.teal,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
          depthTest: false,
          toneMapped: false,
          side: THREE.DoubleSide
        }});
        secVisual = new THREE.Mesh(geom, mat);
        secVisual.visible = false;
        secVisual.renderOrder = 9999;
        scene.add(secVisual);
      }}
      return secVisual;
    }}

    function updateSectionPlane(distNorm) {{
      if (!secEnabled || !model) {{
        renderer.localClippingEnabled = false;
        clearSectionClipping();
        if (secVisual) secVisual.visible = false;
        return;
      }}

      const n = new THREE.Vector3(
        secAxis === 'X' ? 1 : 0,
        secAxis === 'Y' ? 1 : 0,
        secAxis === 'Z' ? 1 : 0
      );

      const box = new THREE.Box3().setFromObject(model);
      if (box.isEmpty()) {{
        renderer.localClippingEnabled = false;
        clearSectionClipping();
        if (secVisual) secVisual.visible = false;
        return;
      }}

      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const dist = distNorm * maxDim * 0.5;
      const plane = new THREE.Plane(n, -dist);

      renderer.localClippingEnabled = true;
      clearSectionClipping();
      applySectionPlaneToModel(plane);

      ensureSectionVisual();

      const thickness = maxDim * 0.004;
      const dim = maxDim * 1.2;

      const look = n.clone();
      const up = Math.abs(look.dot(new THREE.Vector3(0,1,0))) > 0.999
        ? new THREE.Vector3(1,0,0)
        : new THREE.Vector3(0,1,0);

      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0,0,0), look, up);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      secVisual.setRotationFromQuaternion(q);

      secVisual.scale.set(dim, dim, thickness);

      const p0 = n.clone().multiplyScalar(-plane.constant);
      secVisual.position.copy(p0);

      secVisual.visible = !!secPlaneVisible;
    }}

    // --- Render modes ---
    function setRenderMode(mode) {{
      if (!model) return;
      model.traverse(obj => {{
        if (!obj.isMesh) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {{
          if (!m) return;
          m.wireframe   = false;
          m.transparent = false;
          m.opacity     = 1.0;
          m.depthWrite  = true;
          m.depthTest   = true;

          if (mode === 'Wireframe') {{
            m.wireframe = true;
          }} else if (mode === 'X-Ray') {{
            m.transparent = true;
            m.opacity     = 0.25;
            m.depthWrite  = false;
          }} else if (mode === 'Ghost') {{
            m.transparent = true;
            m.opacity     = 0.6;
            m.depthWrite  = false;
          }}
          m.needsUpdate = true;
        }});
      }});
    }}

    function centerAndFrame(pad = 1.12) {{
      if (!model) return;
      const box = new THREE.Box3().setFromObject(model);
      if (box.isEmpty()) return;

      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      model.position.sub(center);

      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      const radius = Math.max(1e-8, sphere.radius) * pad;

      _lastMaxDim = Math.max(size.x, size.y, size.z) * pad;

      const s = getSize(container);
      const aspect = s.w / s.h;

      if (camera.isPerspectiveCamera) {{
        const vFOV = THREE.MathUtils.degToRad(camera.fov);
        const hFOV = 2 * Math.atan(Math.tan(vFOV / 2) * aspect);
        const distV = radius / Math.sin(Math.max(1e-6, vFOV / 2));
        const distH = radius / Math.sin(Math.max(1e-6, hFOV / 2));
        const dist = Math.max(distV, distH) * 1.02;

        camera.near = Math.max(radius / 1000, 0.001);
        camera.far  = Math.max(radius * 1500, 1500);
        camera.updateProjectionMatrix();

        const dir = new THREE.Vector3(1, 1, 1).normalize();
        camera.position.copy(dir.multiplyScalar(dist));
      }} else {{
        const span = Math.max(radius, GRID_SIZE * 0.5);
        camera.left   = -span * aspect;
        camera.right  =  span * aspect;
        camera.top    =  span;
        camera.bottom = -span;
        camera.updateProjectionMatrix();
        camera.position.set(span, span, span);
      }}

      controls.target.set(0, 0, 0);
      controls.update();

      sizeAxesHelper(_lastMaxDim);
      boundsInfo = {{ center: new THREE.Vector3(0,0,0), radius, maxDim: _lastMaxDim }};
    }}

    function setModelScaleToFitGrid() {{
      if (!model) return;
      const box = new THREE.Box3().setFromObject(model);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const target = GRID_SIZE * 0.1;
      const scale = target / maxDim;
      if (scale > 0 && isFinite(scale)) {{
        model.scale.setScalar(scale);
      }}
    }}

    // --- Views + tween ---
    const easeInOutCubic = (t) => t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

    function viewEndPose(kind) {{
      if (!boundsInfo) return null;

      const target = boundsInfo.center.clone();
      const pad = 1.18;

      const s = getSize(container);
      const aspect = s.w / s.h;

      const effectiveRadius = boundsInfo.radius * pad;

      let r;
      if (camera.isPerspectiveCamera) {{
        const vFOV = THREE.MathUtils.degToRad(camera.fov);
        const hFOV = 2 * Math.atan(Math.tan(vFOV / 2) * aspect);
        const distV = effectiveRadius / Math.sin(Math.max(1e-6, vFOV / 2));
        const distH = effectiveRadius / Math.sin(Math.max(1e-6, hFOV / 2));
        r = Math.max(distV, distH);
      }} else {{
        const span = Math.max(effectiveRadius, GRID_SIZE * 0.5);
        camera.left   = -span * aspect;
        camera.right  =  span * aspect;
        camera.top    =  span;
        camera.bottom = -span;
        camera.updateProjectionMatrix();
        r = span * 2.6;
      }}

      let dir = new THREE.Vector3(1, 1, 1); // Iso
      if (kind === 'front') dir.set(0, 0, 1);
      if (kind === 'right') dir.set(1, 0, 0);
      if (kind === 'top') dir.set(0.001, 1, 0).normalize();

      dir.normalize();
      const pos = target.clone().add(dir.multiplyScalar(r));
      return {{ pos, target }};
    }}

    function tweenCameraToPose(endPos, endTarget, duration = 750) {{
      const startPos = camera.position.clone();
      const startTarget = controls.target.clone();
      const t0 = performance.now();

      camera.up.set(0, 1, 0);

      function anim() {{
        const now = performance.now();
        const t = Math.min(1, (now - t0) / duration);
        const k = easeInOutCubic(t);

        camera.position.lerpVectors(startPos, endPos, k);
        controls.target.lerpVectors(startTarget, endTarget, k);
        camera.lookAt(controls.target);
        controls.update();

        if (t < 1) requestAnimationFrame(anim);
      }}
      requestAnimationFrame(anim);
    }}

    function viewIso()   {{ const v = viewEndPose('iso');   if (v) tweenCameraToPose(v.pos, v.target, 750); }}
    function viewFront() {{ const v = viewEndPose('front'); if (v) tweenCameraToPose(v.pos, v.target, 750); }}
    function viewRight() {{ const v = viewEndPose('right'); if (v) tweenCameraToPose(v.pos, v.target, 750); }}
    function viewTop()   {{ const v = viewEndPose('top');   if (v) tweenCameraToPose(v.pos, v.target, 900); }}

    // --- Load STEP ---
    const stepBytes = base64ToUint8Array(STEP_B64);
    const occt = await occtimportjs();
    const result = occt.ReadStepFile(stepBytes, null);
    if (!result || !result.success || !result.meshes || !result.meshes.length) {{
      console.error("Fallo al leer STEP");
      return;
    }}

    model = new THREE.Group();
    const defaultMat = new THREE.MeshStandardMaterial({{
      color: 0xcccccc,
      metalness: 0.2,
      roughness: 0.7
    }});

    for (const m of result.meshes) {{
      if (!m.attributes || !m.attributes.position || !m.index) continue;

      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
      geom.setIndex(m.index.array);
      geom.computeVertexNormals();

      let mat = defaultMat;
      if (m.color && m.color.length === 3) {{
        mat = new THREE.MeshStandardMaterial({{
          color: new THREE.Color(m.color[0] / 255, m.color[1] / 255, m.color[2] / 255),
          metalness: 0.2,
          roughness: 0.7
        }});
      }}

      model.add(new THREE.Mesh(geom, mat));
    }}

    if (!model.children.length) {{
      console.error("Modelo vacío");
      return;
    }}

    scene.add(model);

    applySizeToCamera();
    setModelScaleToFitGrid();
    centerAndFrame(1.12);
    setRenderMode('Solid');

    // ---------- UI ----------
    const ui = document.createElement('div');
    ui.className = 'ui-root';

    const toolsToggle = document.createElement('button');
    toolsToggle.className = 'tools-toggle btn';
    toolsToggle.textContent = 'Open Tools';

    const dock = document.createElement('div');
    dock.className = 'panel dock';

    const dockHeader = document.createElement('div');
    dockHeader.className = 'hdr';

    const hdrLeft = document.createElement('div');
    hdrLeft.className = 'hdr-left';
    hdrLeft.textContent = 'Viewer Tools';

    const hdrRight = document.createElement('div');
    hdrRight.className = 'hdr-right';

    const snapBtn = document.createElement('button');
    snapBtn.className = 'btn';
    snapBtn.style.padding = '6px 12px';
    snapBtn.style.borderRadius = '999px';
    snapBtn.textContent = 'Snapshot';

    hdrRight.appendChild(snapBtn);
    dockHeader.appendChild(hdrLeft);
    dockHeader.appendChild(hdrRight);

    const body = document.createElement('div');
    body.style.padding = '10px 12px';

    function row(label, child) {{
      const r = document.createElement('div');
      r.className = 'row';
      const l = document.createElement('div');
      l.className = 'lbl';
      l.textContent = label;
      r.appendChild(l);
      r.appendChild(child);
      return r;
    }}

    function mkSelect(opts, val) {{
      const s = document.createElement('select');
      opts.forEach(o => {{
        const op = document.createElement('option');
        op.value = o;
        op.textContent = o;
        s.appendChild(op);
      }});
      s.value = val;
      return s;
    }}

    function mkSlider(min,max,step,val) {{
      const s = document.createElement('input');
      s.type = 'range';
      s.min = min;
      s.max = max;
      s.step = step;
      s.value = val;
      return s;
    }}

    function mkToggle(label, init=false) {{
      const wrap=document.createElement('label');
      wrap.style.display='flex';
      wrap.style.gap='8px';
      wrap.style.alignItems='center';
      wrap.style.cursor='pointer';
      const cb=document.createElement('input');
      cb.type='checkbox';
      cb.checked=init;
      cb.style.accentColor='#0ea5a6';
      const sp=document.createElement('span');
      sp.textContent=label;
      sp.style.fontWeight='700';
      sp.style.color='#0b3b3c';
      wrap.appendChild(cb);
      wrap.appendChild(sp);
      return {{wrap, cb}};
    }}

    const renderModeSel = mkSelect(['Solid','Wireframe','X-Ray','Ghost'],'Solid');

    const axisSel = mkSelect(['X','Y','Z'],'X');
    const secDist = mkSlider(-1,1,0.001,0);
    const secToggle = mkToggle('Enable section', false);
    const secPlaneToggle = mkToggle('Show slice plane', false);

    const viewsRow = document.createElement('div');
    Object.assign(viewsRow.style, {{
      display:'grid',
      gridTemplateColumns:'repeat(4,1fr)',
      gap:'8px',
      margin:'8px 0'
    }});

    const bIso   = document.createElement('button');
    const bTop   = document.createElement('button');
    const bFront = document.createElement('button');
    const bRight = document.createElement('button');
    [bIso,bTop,bFront,bRight].forEach(b=>{{
      b.className='btn';
      b.style.padding='8px';
      b.style.borderRadius='10px';
      viewsRow.appendChild(b);
    }});
    bIso.textContent='Iso';
    bTop.textContent='Top';
    bFront.textContent='Front';
    bRight.textContent='Right';

    const projSel = mkSelect(['Perspective','Orthographic'],'Perspective');
    const togGrid = mkToggle('Grid', false);
    const togAxes = mkToggle('XYZ axes', false);

    body.appendChild(row('Render mode', renderModeSel));
    body.appendChild(row('Section axis', axisSel));
    body.appendChild(row('Section dist', secDist));
    body.appendChild(row('', secToggle.wrap));
    body.appendChild(row('', secPlaneToggle.wrap));
    body.appendChild(row('Views', viewsRow));
    body.appendChild(row('Projection', projSel));
    body.appendChild(row('', togGrid.wrap));
    body.appendChild(row('', togAxes.wrap));

    dock.appendChild(dockHeader);
    dock.appendChild(body);
    ui.appendChild(dock);
    ui.appendChild(toolsToggle);
    container.appendChild(ui);

    let dockOpen = false;
    function setDock(open) {{
      dockOpen = !!open;
      if (dockOpen) {{
        dock.classList.add('open');
        toolsToggle.textContent = 'Close Tools';
      }} else {{
        dock.classList.remove('open');
        toolsToggle.textContent = 'Open Tools';
      }}
    }}
    setDock(false);

    toolsToggle.addEventListener('click', () => {{
      playClick();
      setDock(!dockOpen);
    }});

    // ✅ Hotkey: press "t" (or "c") to toggle tools panel
    function onHotkeyToggle(e) {{
      const tag = ((e.target && e.target.tagName) || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.isComposing) return;

      if (e.key === 't' || e.key === 'T' || e.key === 'c' || e.key === 'C') {{
        e.preventDefault();
        playClick();
        setDock(!dockOpen);
      }}
    }}
    document.addEventListener('keydown', onHotkeyToggle, true);

    snapBtn.addEventListener('click', () => {{
      playClick();
      try {{
        const url = renderer.domElement.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        const name = '{Step_Name}'.replace(/[^a-z0-9_-]/gi,'_') || 'snapshot';
        a.download = name + '_snapshot.png';
        a.click();
      }} catch(e) {{}}
    }});

    renderModeSel.addEventListener('change', () => {{
      playClick();
      setRenderMode(renderModeSel.value);
    }});

    axisSel.addEventListener('change', () => {{
      playClick();
      secAxis = axisSel.value;
      updateSectionPlane(parseFloat(secDist.value)||0);
    }});

    secDist.addEventListener('input', () => {{
      updateSectionPlane(parseFloat(secDist.value)||0);
    }});

    secToggle.cb.addEventListener('change', () => {{
      playClick();
      secEnabled = !!secToggle.cb.checked;
      updateSectionPlane(parseFloat(secDist.value)||0);
    }});

    secPlaneToggle.cb.addEventListener('change', () => {{
      playClick();
      secPlaneVisible = !!secPlaneToggle.cb.checked;
      updateSectionPlane(parseFloat(secDist.value)||0);
    }});

    bIso.addEventListener('click',   () => {{ playClick(); viewIso(); }});
    bTop.addEventListener('click',   () => {{ playClick(); viewTop(); }});
    bFront.addEventListener('click', () => {{ playClick(); viewFront(); }});
    bRight.addEventListener('click', () => {{ playClick(); viewRight(); }});

    projSel.addEventListener('change', () => {{
      playClick();

      const wasSectionEnabled = secEnabled;
      if (secEnabled) {{
        secEnabled = false;
        updateSectionPlane(parseFloat(secDist.value)||0);
      }}

      if (!boundsInfo) {{
        camera = (projSel.value === 'Perspective') ? persp : ortho;
        controls.object = camera;
        controls.update();
        applySizeToCamera();
        return;
      }}

      const s = getSize(container);
      const aspect = s.w / s.h;
      const span = Math.max(boundsInfo.maxDim, GRID_SIZE * 0.5);
      const target = boundsInfo.center.clone();

      if (projSel.value === 'Orthographic' && camera.isPerspectiveCamera) {{
        const dir = camera.position.clone().sub(target).normalize();
        const distance = Math.max(span * 2, 1);

        ortho.left   = -span * aspect;
        ortho.right  =  span * aspect;
        ortho.top    =  span;
        ortho.bottom = -span;

        ortho.position.copy(target).add(dir.multiplyScalar(distance));
        ortho.up.copy(camera.up);
        ortho.lookAt(target);
        ortho.updateProjectionMatrix();

        camera = ortho;
        controls.object = ortho;

      }} else if (projSel.value === 'Perspective' && camera.isOrthographicCamera) {{
        const dir = camera.position.clone().sub(target).normalize();
        const distance = Math.max(span * 3, 1);

        persp.aspect = aspect;
        persp.fov = 60;
        persp.near = 0.01;
        persp.far  = 10000;

        persp.position.copy(target).add(dir.multiplyScalar(distance));
        persp.up.copy(camera.up);
        persp.lookAt(target);
        persp.updateProjectionMatrix();

        camera = persp;
        controls.object = persp;
      }}

      controls.target.copy(target);
      controls.update();
      applySizeToCamera();

      if (wasSectionEnabled) {{
        setTimeout(() => {{
          secEnabled = true;
          secToggle.cb.checked = true;
          updateSectionPlane(parseFloat(secDist.value)||0);
        }}, 100);
      }}
    }});

    togGrid.cb.addEventListener('change', () => {{
      playClick();
      grid.visible = !!togGrid.cb.checked;
    }});

    togAxes.cb.addEventListener('change', () => {{
      playClick();
      axesHelper.visible = !!togAxes.cb.checked;
      if (axesHelper.visible) sizeAxesHelper(_lastMaxDim);
    }});

    // ✅ Resize exactly like the simple script: use container sizes
    window.addEventListener("resize", () => {{
      const s = getSize(container);
      renderer.setSize(s.w, s.h, false);
      applySizeToCamera();
      renderer.render(scene, camera);
    }});

    (function animate() {{
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }})();
  }})();
  </script>
</body>
</html>"""

    display(HTML(html))
