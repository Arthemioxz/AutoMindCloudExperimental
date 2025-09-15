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


def Step_Render(Step_Name, target_size=2.0, click_sound_b64=None):
    """
    STEP -> GLB -> scaled viewer (white bg). Features:
      - Render modes: Solid / Wireframe / X-Ray / Ghost
      - Explode slider (auto-hidden if single-part)
      - Section plane (X/Y/Z + distance) [no overlays]
      - Camera presets: Iso / Top / Front / Right
      - Perspective <-> Orthographic toggle
      - Grid, Ground (soft shadows), Axes toggles
      - Fit to view & Snapshot
      - GLOBAL click sound: every <button> (and [role="button"]) plays your base64 audio
        • overlapping allowed
        • original volume/pitch preserved
        • no double sounds (guarded)
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

    # Audio: base64 data URL (leave empty for no sound)
    click_data_url = (
        "data:audio/mpeg;base64," + click_sound_b64
        if (isinstance(click_sound_b64, str) and len(click_sound_b64) > 0)
        else ""  # no sound if none provided
    )

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
  html, body {
    margin: 0;
    height: 100%;
    overflow: hidden;
    background: var(--bgCanvas);
    font-family: "Computer Modern", "CMU Serif", Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  }
  #wrap { position: relative; width: 100vw; height: 100vh; }
  canvas { display: block; width: 100%; height: 100%; }

  #toolsDock {
    position: absolute; right: 14px; top: 14px; width: 440px; max-width: calc(100vw - 28px);
    background: var(--bgPanel); border: 1px solid var(--stroke); border-radius: 18px;
    box-shadow: var(--shadow); overflow: hidden; display: none; z-index: 11;
  }
  .dockHeader {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 12px; border-bottom: 1px solid var(--stroke); background: var(--teal-faint);
  }
  .dockHeader .title { font-weight: 800; color: var(--text); }
  .dockBody { padding: 10px 12px; }
  .row { display: grid; grid-template-columns: 120px 1fr; gap: 10px; align-items: center; margin: 6px 0; }
  .row .label { font-weight: 700; color: var(--textMuted); }
  select, input[type="range"] {
    width: 100%; accent-color: var(--teal);
    border: 1px solid var(--stroke); border-radius: 10px; padding: 6px 8px;
  }
  .tbtn {
    padding: 8px 12px; border-radius: 12px; border: 1px solid var(--stroke);
    background: var(--bgPanel); color: var(--text); font-weight: 700; cursor: pointer;
  }
  #toolsToggle {
    position: absolute; right: 14px; top: 14px; z-index: 12; box-shadow: var(--shadow);
  }
  .tog { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .tog input[type="checkbox"] { accent-color: var(--teal); }

  .badge {
    position: absolute; bottom: 12px; right: 14px; z-index: 12;
    user-select: none; pointer-events: none;
  }
  .badge img { max-height: 40px; display: block; }
</style>
</head>
<body>
  <div id="wrap">
    <button id="toolsToggle" class="tbtn">Open Tools</button>
    <div id="toolsDock">
      <div class="dockHeader">
        <div class="title">Viewer Tools</div>
        <button id="fitBtn" class="tbtn" style="padding:6px 10px;border-radius:10px;">Fit</button>
      </div>
      <div class="dockBody">
        <div class="row">
          <div class="label">Render mode</div>
          <select id="renderMode">
            <option>Solid</option>
            <option>Wireframe</option>
            <option>X-Ray</option>
            <option>Ghost</option>
          </select>
        </div>

        <div class="row" id="explodeRow" style="display:none;">
          <div class="label">Explode</div>
          <input type="range" id="explode" min="0" max="1" step="0.01" value="0" />
        </div>

        <div class="row">
          <div class="label">Section axis</div>
          <select id="axisSel">
            <option>X</option><option>Y</option><option>Z</option>
          </select>
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
            <button id="vIso"  class="tbtn" style="padding:8px;border-radius:10px;">Iso</button>
            <button id="vTop"  class="tbtn" style="padding:8px;border-radius:10px;">Top</button>
            <button id="vFront"class="tbtn" style="padding:8px;border-radius:10px;">Front</button>
            <button id="vRight"class="tbtn" style="padding:8px;border-radius:10px;">Right</button>
            <button id="shot" class="tbtn" style="padding:8px;border-radius:10px;">Snapshot</button>
          </div>
        </div>

        <div class="row">
          <div class="label">Projection</div>
          <select id="projSel">
            <option>Perspective</option>
            <option>Orthographic</option>
          </select>
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
  // ====== Global click sound (base64, overlap, original audio) ======
  const CLICK_URL = "__CLICK_URL__";  // data:audio/...;base64,XXXX
  let baseAudio = null;
  let audioUnlocked = false;
  let __lastCaptureClickTs = 0; // guard to avoid double sound

  function ensureBaseAudio(){
    if (!CLICK_URL) return false;
    if (!baseAudio){
      baseAudio = new Audio(CLICK_URL);
      baseAudio.preload = 'auto'; // keep original properties
    }
    return true;
  }

  // Unlock once on first user interaction (mobile autoplay policies)
  function unlockAudioOnce(){
    if (audioUnlocked) return;
    if (!ensureBaseAudio()) return;
    try {
      const p = baseAudio.play();
      if (p && p.then){
        p.then(()=>{
          baseAudio.pause();
          baseAudio.currentTime = 0;
          audioUnlocked = true;
        }).catch(()=>{ /* try again on next click */ });
      } else {
        audioUnlocked = true;
      }
    } catch(e) {}
  }
  window.addEventListener('pointerdown', unlockAudioOnce, { once:true, passive:true });

  // Global click handler: any <button> or [role="button"] plays sound.
  document.addEventListener('click', (ev)=>{
    const el = ev.target.closest('button,[role="button"]');
    if (!el) return;
    const now = performance.now();
    __lastCaptureClickTs = now; // mark we already played for this click
    if (!CLICK_URL) return;
    if (!audioUnlocked) unlockAudioOnce();
    if (!ensureBaseAudio()) return;
    try {
      const a = baseAudio.cloneNode(true); // allow overlapping
      const p = a.play();
      if (p && p.catch) p.catch(()=>{});
    } catch(e) {}
  }, {capture:true}); // capture ensures this runs before per-button handlers

  // For legacy handlers that call buttonClicked(), make it skip if global already fired.
  function buttonClicked(){
    // If the capture listener just ran for this same click, do nothing.
    if (performance.now() - __lastCaptureClickTs < 150) return;

    if (!CLICK_URL) return;
    if (!audioUnlocked) unlockAudioOnce();
    if (!ensureBaseAudio()) return;
    try {
      const a = baseAudio.cloneNode(true);
      const p = a.play();
      if (p && p.catch) p.catch(()=>{});
    } catch(e) {}
  }

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
  toolsToggle.addEventListener('click', ()=>{ buttonClicked(); setDock(toolsDock.style.display==='none'); });

  fitBtn.addEventListener('click', ()=>{ buttonClicked(); if (model) fitAndCenter(model, 1.06); });
  renderMode.addEventListener('change', ()=>{ buttonClicked(); setRenderMode(renderMode.value); });
  explode.addEventListener('input', ()=>{ applyExplode(Number(explode.value)); });

  axisSel.addEventListener('change', ()=>{ buttonClicked(); secAxis = axisSel.value; updateSectionPlane(); });
  secDist.addEventListener('input', ()=>{ updateSectionPlane(); });

  secEnableEl.addEventListener('change', ()=>{
    buttonClicked();
    secEnabled = !!secEnableEl.checked;
    updateSectionPlane();
  });

  vIso.addEventListener('click', ()=>{ buttonClicked(); viewIso(); });
  vTop.addEventListener('click', ()=>{ buttonClicked(); viewTop(); });
  vFront.addEventListener('click', ()=>{ buttonClicked(); viewFront(); });
  vRight.addEventListener('click', ()=>{ buttonClicked(); viewRight(); });

  shot.addEventListener('click', ()=>{
    buttonClicked();
    try { const url = renderer.domElement.toDataURL('image/png'); const a = document.createElement('a'); a.href=url; a.download='snapshot.png'; a.click(); } catch(_){}
  });

  projSel.addEventListener('change', ()=>{
    buttonClicked();
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
        .replace("__CLICK_URL__", click_data_url)
    )

    html_name = output_glb_scaled + "_viewer.html"
    with open(html_name, "w") as f:
        f.write(html_content)

    with open(html_name, "r") as f:
        html = f.read()
    display(HTML(html))

