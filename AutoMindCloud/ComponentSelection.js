import sympy  # requested import
import gdown
import cascadio
import trimesh
import base64
from IPython.display import display, HTML
import os


def Download_Step(Drive_Link, Output_Name):
    """
    Downloads a STEP file from Google Drive using the full Drive link.
    Saves it as /content/<Output_Name>.step
    """
    root_dir = "/content"
    file_id = Drive_Link.split('/d/')[1].split('/')[0]  # Extract ID from full link
    url = f"https://drive.google.com/uc?id={file_id}"
    output_step = os.path.join(root_dir, Output_Name + ".step")
    gdown.download(url, output_step, quiet=True)


def Step_Render(Step_Name, target_size=2.0, click_sound_b64=None, click_sound_mime="audio/mpeg"):
    """
    STEP -> GLB -> scaled viewer (white bg) with global click sound:
      - Every button plays your sound (base64), overlapping, original volume/pitch.
      - Reliable in notebook/iframe: WebAudio decode from base64 (no fetch of data URLs).
      - One-time "Enable sound" banner to satisfy autoplay policies.
    """
    output_step = Step_Name + ".step"
    output_glb = Step_Name + ".glb"
    output_glb_scaled = Step_Name + "_scaled.glb"

    # STEP -> GLB
    _ = cascadio.step_to_glb(output_step, output_glb)

    # Scale GLB to target_size
    mesh = trimesh.load(output_glb)
    current_size = max(mesh.extents) if hasattr(mesh, "extents") else 1.0
    if current_size <= 0:
        current_size = 1.0
    scale_factor = float(target_size) / float(current_size)
    mesh.apply_scale(scale_factor)
    mesh.export(output_glb_scaled)

    # Base64-embed GLB
    with open(output_glb_scaled, "rb") as f:
        glb_base64 = base64.b64encode(f.read()).decode("utf-8")

    # If no sound provided, leave blank (viewer handles gracefully)
    click_b64 = click_sound_b64 or ""

    html_template = r"""
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>__TITLE__ 3D Viewer</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  :root {
    --teal: #0ea5a6;
    --teal-faint: rgba(20,184,185,0.12);
    --bgPanel: #ffffff;
    --bgCanvas: #ffffff; /* pure white bg */
    --stroke: #d7e7e7;
    --text: #0b3b3c;
    --textMuted: #577e7f;
    --shadow: 0 12px 36px rgba(0,0,0,0.14);
  }
  html, body { margin:0; height:100%; overflow:hidden; background:var(--bgCanvas);
    font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
  #wrap { position:relative; width:100vw; height:100vh; }
  canvas { display:block; width:100%; height:100%; }

  #toolsDock {
    position:absolute; right:14px; top:14px; width:440px; max-width:calc(100vw - 28px);
    background:var(--bgPanel); border:1px solid var(--stroke); border-radius:18px;
    box-shadow:var(--shadow); overflow:hidden; display:none; z-index:11;
  }
  .dockHeader { display:flex; align-items:center; justify-content:space-between; gap:8px;
    padding:10px 12px; border-bottom:1px solid var(--stroke); background:var(--teal-faint); }
  .dockHeader .title { font-weight:800; color:var(--text); }
  .dockBody { padding:10px 12px; }
  .row { display:grid; grid-template-columns:120px 1fr; gap:10px; align-items:center; margin:6px 0; }
  .row .label { font-weight:700; color:var(--textMuted); }
  select, input[type="range"] { width:100%; accent-color:var(--teal); border:1px solid var(--stroke);
    border-radius:10px; padding:6px 8px; }
  .tbtn { padding:8px 12px; border-radius:12px; border:1px solid var(--stroke);
    background:var(--bgPanel); color:var(--text); font-weight:700; cursor:pointer; }
  #toolsToggle { position:absolute; right:14px; top:14px; z-index:12; box-shadow:var(--shadow); }
  .tog { display:flex; align-items:center; gap:8px; cursor:pointer; }
  .tog input[type="checkbox"] { accent-color:var(--teal); }

  .badge { position:absolute; bottom:12px; right:14px; z-index:12; user-select:none; pointer-events:none; }
  .badge img { max-height:40px; display:block; }

  /* One-time sound unlock hint */
  #soundHint {
    position:absolute; left:50%; top:14px; transform:translateX(-50%);
    background:var(--bgPanel); color:var(--text); border:1px solid var(--stroke);
    border-radius:12px; padding:8px 12px; box-shadow:var(--shadow); z-index:13;
    display:none; font-weight:700;
  }
</style>
</head>
<body>
  <div id="wrap">
    <div id="soundHint">Click anywhere to enable sound</div>

    <button id="toolsToggle" class="tbtn" role="button">Open Tools</button>
    <div id="toolsDock">
      <div class="dockHeader">
        <div class="title">Viewer Tools</div>
        <button id="fitBtn" class="tbtn" style="padding:6px 10px;border-radius:10px;" role="button">Fit</button>
      </div>
      <div class="dockBody">
        <div class="row">
          <div class="label">Render mode</div>
          <select id="renderMode">
            <option>Solid</option><option>Wireframe</option><option>X-Ray</option><option>Ghost</option>
          </select>
        </div>

        <div class="row" id="explodeRow" style="display:none;">
          <div class="label">Explode</div>
          <input type="range" id="explode" min="0" max="1" step="0.01" value="0" />
        </div>

        <div class="row">
          <div class="label">Section axis</div>
          <select id="axisSel"><option>X</option><option>Y</option><option>Z</option></select>
        </div>
        <div class="row">
          <div class="label">Section dist</div>
          <input type="range" id="secDist" min="-1" max="1" step="0.001" value="0" />
        </div>
        <div class="row">
          <label class="tog"><input id="secEnable" type="checkbox" /> Enable section</label>
        </div>

        <div class="row">
          <div class="label">Views</div>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;">
            <button id="vIso"   class="tbtn" role="button">Iso</button>
            <button id="vTop"   class="tbtn" role="button">Top</button>
            <button id="vFront" class="tbtn" role="button">Front</button>
            <button id="vRight" class="tbtn" role="button">Right</button>
            <button id="shot"   class="tbtn" role="button">Snapshot</button>
          </div>
        </div>

        <div class="row">
          <div class="label">Projection</div>
          <select id="projSel"><option>Perspective</option><option>Orthographic</option></select>
        </div>

        <div class="row"><label class="tog"><input id="togGrid"   type="checkbox" /> Grid</label></div>
        <div class="row"><label class="tog"><input id="togGround" type="checkbox" checked /> Ground &amp; shadows</label></div>
        <div class="row"><label class="tog"><input id="togAxes"   type="checkbox" /> XYZ axes</label></div>
      </div>
    </div>

    <div class="badge">
      <img src="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png" alt="badge">
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/GLTFLoader.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js"></script>

  <script>
  // ====== Robust WebAudio click sound from BASE64 (no data: fetch) ======
  const CLICK_B64  = "__CLICK_B64__";        // raw base64 (no prefix)
  const CLICK_MIME = "__CLICK_MIME__";       // e.g., "audio/mpeg" or "audio/wav"

  let __audioCtx = null;
  let __clickBuf = null;
  let __audioReady = false;

  function b64ToUint8(base64){
    if (!base64) return new Uint8Array();
    const bin = atob(base64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i=0;i<len;i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function ensureAudio(){
    if (!CLICK_B64) return false;               // no sound provided
    if (!__audioCtx) __audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (!__clickBuf){
      // Decode from base64 directly
      const bytes = b64ToUint8(CLICK_B64);
      try {
        __clickBuf = await __audioCtx.decodeAudioData(bytes.buffer.slice(0));
      } catch(e){
        console.warn("Audio decode failed:", e);
        __clickBuf = null;
      }
    }
    return !!__clickBuf;
  }

  function playClick(){
    if (!__clickBuf || !__audioReady) return;
    try {
      const src = __audioCtx.createBufferSource();
      src.buffer = __clickBuf;                   // original audio, no changes
      const gain = __audioCtx.createGain();      // unity gain (no volume change)
      gain.gain.value = 1.0;
      src.connect(gain).connect(__audioCtx.destination);
      src.start();
    } catch(e){}
  }

  // Autoplay unlock (first user action)
  const soundHint = document.getElementById('soundHint');
  if (CLICK_B64) soundHint.style.display = 'block';

  async function unlockOnce(){
    if (!CLICK_B64) return;
    try {
      if (!__audioCtx) __audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (__audioCtx.state === 'suspended') await __audioCtx.resume();
      await ensureAudio();
      __audioReady = !!__clickBuf;
      soundHint.style.display = 'none';
      // Give immediate feedback on first tap
      playClick();
    } catch(e){
      console.warn("Audio unlock failed:", e);
    }
  }
  window.addEventListener('pointerdown', unlockOnce, { once:true, passive:true });

  // Global: every button click fires sound (overlap OK)
  document.addEventListener('click', (ev)=>{
    const el = ev.target.closest('button,[role="button"]');
    if (!el) return;
    playClick();
  }, {capture:true});

  // ====== Scene (white bg) ======
  const wrap = document.getElementById('wrap');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  const aspect = Math.max(1e-6, wrap.clientWidth / wrap.clientHeight);
  const persp = new THREE.PerspectiveCamera(75, aspect, 0.01, 10000);
  persp.position.set(0,0,3);

  const orthoSize = 2.5;
  const ortho = new THREE.OrthographicCamera(-orthoSize*aspect, orthoSize*aspect, orthoSize, -orthoSize, 0.01, 10000);
  ortho.position.set(0,0,3);

  let camera = persp;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer:true });
  renderer.setPixelRatio(window.devicePixelRatio||1);
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  wrap.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;

  // Lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0xcfeeee, 0.7);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.05);
  dirLight.position.set(3,4,2);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024,1024);
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 1000;
  scene.add(hemi); scene.add(dirLight);

  // Ground + grid
  const groundGroup = new THREE.Group(); scene.add(groundGroup);
  const grid = new THREE.GridHelper(10, 20, 0x84d4d4, 0xdef3f3);
  grid.visible = false; groundGroup.add(grid);
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.25 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200,200), groundMat);
  ground.rotation.x = -Math.PI/2; ground.position.y = -0.0001;
  ground.receiveShadow = true; ground.visible = true; groundGroup.add(ground);

  // Axes
  const axesHelper = new THREE.AxesHelper(1);
  axesHelper.visible = false; scene.add(axesHelper);
  function sizeAxesHelper(maxDim, center){ axesHelper.scale.setScalar(maxDim * 0.75); axesHelper.position.copy(center||new THREE.Vector3()); }

  function onResize(){
    const w = wrap.clientWidth||1, h = wrap.clientHeight||1;
    const asp = Math.max(1e-6, w/h);
    if (camera.isPerspectiveCamera){ camera.aspect = asp; }
    else { const s = orthoSize; camera.left=-s*asp; camera.right=s*asp; camera.top=s; camera.bottom=-s; }
    camera.updateProjectionMatrix(); renderer.setSize(w,h);
  }
  window.addEventListener('resize', onResize);

  // ====== GLB load (embedded base64) ======
  function base64ToArrayBuffer(base64){
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i=0;i<len;i++) bytes[i] = binary_string.charCodeAt(i);
    return bytes.buffer;
  }
  const glbBase64 = "__GLB_B64__";
  const arrayBuffer = base64ToArrayBuffer(glbBase64);

  let model=null;
  let sectionPlane = null;
  let secAxis = 'X';
  let secEnabled = false;

  function updateSectionPlane(){
    renderer.clippingPlanes = [];
    if (!secEnabled || !model) { renderer.localClippingEnabled=false; return; }
    const n = new THREE.Vector3(secAxis==='X'?1:0, secAxis==='Y'?1:0, secAxis==='Z'?1:0);
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()){ renderer.localClippingEnabled=false; return; }
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x,size.y,size.z)||1;
    const center = box.getCenter(new THREE.Vector3());
    const dist = (Number(document.getElementById('secDist').value) || 0) * maxDim * 0.5;
    const plane = new THREE.Plane(n, -center.dot(n) - dist);
    renderer.localClippingEnabled = true;
    renderer.clippingPlanes = [ plane ];
    sectionPlane = plane;
  }

  function fitAndCenter(object, pad=1.08){
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3()).multiplyScalar(pad);
    const maxDim = Math.max(size.x,size.y,size.z)||1;

    if (camera.isPerspectiveCamera){
      const dist   = maxDim * 1.9;
      camera.near = Math.max(maxDim/1000,0.001);
      camera.far  = Math.max(maxDim*1500,1500);
      camera.updateProjectionMatrix();
      camera.position.copy(center.clone().add(new THREE.Vector3(dist, dist*0.9, dist)));
    } else {
      camera.left = -maxDim; camera.right = maxDim;
      camera.top  =  maxDim; camera.bottom= -maxDim;
      camera.near = Math.max(maxDim/1000,0.001);
      camera.far  = Math.max(maxDim*1500,1500);
      camera.updateProjectionMatrix();
      camera.position.copy(center.clone().add(new THREE.Vector3(maxDim, maxDim*0.9, maxDim)));
    }
    controls.target.copy(center); controls.update();
    sizeAxesHelper(maxDim, center);
  }

  // Render modes
  function setRenderMode(mode){
    if (!model) return;
    model.traverse(o=>{
      if (o.isMesh && o.material){
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for(const m of mats){
          m.wireframe = (mode==='Wireframe');
          if (mode==='X-Ray'){ m.transparent = true; m.opacity = 0.35; m.depthWrite = false; m.depthTest = true; }
          else if (mode==='Ghost'){ m.transparent = true; m.opacity = 0.7; m.depthWrite = true; m.depthTest = true; }
          else { m.transparent = false; m.opacity = 1.0; m.depthWrite = true; m.depthTest = true; }
          m.needsUpdate = true;
        }
      }
    });
  }

  // Camera presets
  function viewIso(){
    if (!model) return;
    const box = new THREE.Box3().setFromObject(model); if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3()); const d = Math.max(s.x,s.y,s.z)*1.9;
    const az = Math.PI*0.25, el = Math.PI*0.2;
    const dir = new THREE.Vector3(Math.cos(el)*Math.cos(az), Math.sin(el), Math.cos(el)*Math.sin(az)).multiplyScalar(d);
    camera.position.copy(c.clone().add(dir)); controls.target.copy(c); controls.update();
  }
  function viewTop(){
    if (!model) return;
    const b=new THREE.Box3().setFromObject(model); const c=b.getCenter(new THREE.Vector3()); const s=b.getSize(new THREE.Vector3()); const d=Math.max(s.x,s.y,s.z)*1.9;
    camera.position.set(c.x, c.y + d, c.z); controls.target.copy(c); controls.update();
  }
  function viewFront(){
    if (!model) return;
    const b=new THREE.Box3().setFromObject(model); const c=b.getCenter(new THREE.Vector3()); const s=b.getSize(new THREE.Vector3()); const d=Math.max(s.x,s.y,s.z)*1.9;
    camera.position.set(c.x, c.y, c.z + d); controls.target.copy(c); controls.update();
  }
  function viewRight(){
    if (!model) return;
    const b=new THREE.Box3().setFromObject(model); const c=b.getCenter(new THREE.Vector3()); const s=b.getSize(new THREE.Vector3()); const d=Math.max(s.x,s.y,s.z)*1.9;
    camera.position.set(c.x + d, c.y, c.z); controls.target.copy(c); controls.update();
  }

  // Explode (auto-enable only if multiple groups exist)
  let explodeTargets = [];
  function prepareExplodeVectors(){
    explodeTargets = [];
    if (!model) return;

    const children = [];
    model.children.forEach(ch => {
      let hasGeom=false;
      ch.traverse(o=>{ if (o.isMesh && o.geometry) hasGeom=true; });
      if (hasGeom) children.push(ch);
    });

    const explodeRow = document.getElementById('explodeRow');
    explodeRow.style.display = (children.length <= 1) ? 'none' : '';

    const rootBox = new THREE.Box3().setFromObject(model);
    const rootCenter = rootBox.getCenter(new THREE.Vector3());

    children.forEach(ch => {
      const b = new THREE.Box3().setFromObject(ch);
      if (!b.isEmpty()){
        const c = b.getCenter(new THREE.Vector3());
        const v = c.clone().sub(rootCenter);
        if (v.lengthSq() < 1e-10) v.set((Math.random()*2-1)*0.01,(Math.random()*2-1)*0.01,(Math.random()*2-1)*0.01);
        v.normalize();
        ch.userData.__explodeBase = ch.position.clone();
        explodeTargets.push({ node: ch, base: ch.userData.__explodeBase, dir: v });
      }
    });
  }
  function applyExplode(f){
    explodeTargets.forEach(t => {
      t.node.position.copy( t.base.clone().add( t.dir.clone().multiplyScalar(f * 0.6) ) );
    });
  }

  // Load GLB
  const loader = new THREE.GLTFLoader();
  loader.parse(arrayBuffer, '', function(gltf){
    model = gltf.scene;

    // CAD-friendly: double-sided + shadows
    model.traverse(function(node){
      if (node.isMesh && node.material){
        if (Array.isArray(node.material)) node.material.forEach(mat => mat.side = THREE.DoubleSide);
        else node.material.side = THREE.DoubleSide;
        node.castShadow = true; node.receiveShadow = true;
      }
    });

    scene.add(model);

    // Center to origin
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);

    prepareExplodeVectors();
    fitAndCenter(model, 1.06);
    updateSectionPlane();
  }, function(err) {
    console.error('GLB load error:', err);
  });

  // ====== UI wiring ======
  const toolsToggle = document.getElementById('toolsToggle');
  const toolsDock   = document.getElementById('toolsDock');
  const fitBtn      = document.getElementById('fitBtn');
  const renderMode  = document.getElementById('renderMode');
  const explode     = document.getElementById('explode');
  const axisSel     = document.getElementById('axisSel');
  const secDist     = document.getElementById('secDist');
  const secEnableEl = document.getElementById('secEnable');
  const vIso        = document.getElementById('vIso');
  const vTop        = document.getElementById('vTop');
  const vFront      = document.getElementById('vFront');
  const vRight      = document.getElementById('vRight');
  const shot        = document.getElementById('shot');
  const projSel     = document.getElementById('projSel');
  const togGrid     = document.getElementById('togGrid');
  const togGround   = document.getElementById('togGround');
  const togAxes     = document.getElementById('togAxes');

  function setDock(open){
    toolsDock.style.display = open ? 'block' : 'none';
    toolsToggle.textContent = open ? 'Close Tools' : 'Open Tools';
  }
  toolsToggle.addEventListener('click', ()=>{ setDock(toolsDock.style.display==='none'); });

  fitBtn.addEventListener('click', ()=>{ if (model) fitAndCenter(model, 1.06); });
  renderMode.addEventListener('change', ()=>{ setRenderMode(renderMode.value); });
  explode.addEventListener('input', ()=>{ applyExplode(Number(explode.value)); });

  axisSel.addEventListener('change', ()=>{ secAxis = axisSel.value; updateSectionPlane(); });
  secDist.addEventListener('input', ()=>{ updateSectionPlane(); });

  secEnableEl.addEventListener('change', ()=>{
    secEnabled = !!secEnableEl.checked;
    updateSectionPlane();
  });

  vIso.addEventListener('click', ()=>{ viewIso(); });
  vTop.addEventListener('click', ()=>{ viewTop(); });
  vFront.addEventListener('click', ()=>{ viewFront(); });
  vRight.addEventListener('click', ()=>{ viewRight(); });

  shot.addEventListener('click', ()=>{
    try { const url = renderer.domElement.toDataURL('image/png'); const a = document.createElement('a'); a.href=url; a.download='snapshot.png'; a.click(); } catch(_){}
  });

  projSel.addEventListener('change', ()=>{
    const w = wrap.clientWidth||1, h=wrap.clientHeight||1, asp = Math.max(1e-6, w/h);
    if (projSel.value==='Orthographic' && camera.isPerspectiveCamera){
      const box = model ? new THREE.Box3().setFromObject(model) : null;
      const c = box && !box.isEmpty() ? box.getCenter(new THREE.Vector3()) : controls.target.clone();
      const size = box && !box.isEmpty() ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(2,2,2);
      const maxDim = Math.max(size.x,size.y,size.z)||1;
      ortho.left=-maxDim*asp; ortho.right=maxDim*asp; ortho.top=maxDim; ortho.bottom=-maxDim;
      ortho.near=Math.max(maxDim/1000,0.001); ortho.far=Math.max(maxDim*1500,1500);
      ortho.position.copy(camera.position); ortho.updateProjectionMatrix();
      controls.object = ortho; camera = ortho;
      controls.target.copy(c); controls.update();
    } else if (projSel.value==='Perspective' && camera.isOrthographicCamera){
      persp.aspect = asp; persp.updateProjectionMatrix();
      persp.position.copy(camera.position);
      controls.object = persp; camera = persp;
      controls.update();
    }
  });

  // Initial state
  setDock(false);
  secEnableEl.checked = false;

  // Animate
  (function animate(){
    requestAnimationFrame(animate);
    controls.update(); renderer.render(scene, camera);
  })();
  </script>
</body>
</html>
    """

    html_content = (
        html_template
        .replace("__TITLE__", Step_Name)
        .replace("__GLB_B64__", glb_base64)
        .replace("__CLICK_B64__", click_b64)
        .replace("__CLICK_MIME__", click_sound_mime or "audio/mpeg")
    )

    html_name = output_glb_scaled + "_viewer.html"
    with open(html_name, "w") as f:
        f.write(html_content)

    with open(html_name, "r") as f:
        html = f.read()
    display(HTML(html))


