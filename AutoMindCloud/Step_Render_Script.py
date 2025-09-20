import sympy
import gdown
import cascadio
import trimesh
import base64
from IPython.display import display, HTML
import os

def Download_Step(Drive_Link, Output_Name):
    """
    Downloads a STEP file from Google Drive using the full Drive link.
    Saves it as Output_Name.step in /content.
    """
    root_dir = "/content"
    file_id = Drive_Link.split('/d/')[1].split('/')[0]  # Extract ID from full link
    url = f"https://drive.google.com/uc?id={file_id}"
    output_step = os.path.join(root_dir, Output_Name + ".step")
    gdown.download(url, output_step, quiet=True)

def Step_Render(Step_Name, target_size=2.0, click_sound_path="/content/click_sound.mp3", background=0xffffff):
    """
    STEP/STL -> GLB -> scaled viewer (white UI).
      - Starts with NO SHADOWS
      - More zoomed-out fit so the whole model is visible
      - Render modes: Solid / Wireframe / X-Ray / Ghost
      - Section plane (X/Y/Z axis + distance) + visible teal plane
      - Camera presets: Iso / Top / Front / Right
      - Perspective <-> Orthographic toggle
      - Grid + Ground (+shadows when enabled)
      - Fit to view & Snapshot
      - XYZ Axes toggle (auto-sized)
      - Click sound via MP3 buffer (no oscillator; pitch unchanged)
    """
    import base64, os, io
    import trimesh
    import cascadio
    from IPython.display import display, HTML

    def _to_data_url_audio(file_path):
        try:
            if file_path and os.path.exists(file_path):
                with open(file_path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("ascii")
                return f"data:audio/mpeg;base64,{b64}"
        except Exception:
            pass
        return None

    output_step = Step_Name + ".step"
    output_stl  = Step_Name + ".stl"
    output_glb = Step_Name + ".glb"
    output_glb_scaled = Step_Name + "_scaled.glb"

    # --- Convert to GLB (supports STEP or STL) ---
    if os.path.exists(output_step):
        _ = cascadio.step_to_glb(output_step, output_glb)
    elif os.path.exists(output_stl):
        mesh = trimesh.load(output_stl)  # can be Trimesh or Scene
        if isinstance(mesh, trimesh.Trimesh):
            scene = trimesh.Scene(mesh)
        else:
            scene = mesh
        scene.export(output_glb)  # trimesh can export .glb by extension
    else:
        raise FileNotFoundError("Neither .step nor .stl found for '{}'".format(Step_Name))

    # --- Uniform scale to target_size ~ 2.0 ---
    mesh = trimesh.load(output_glb)
    try:
        current_size = float(max(getattr(mesh, "extents", [1,1,1])))
        if not current_size or current_size <= 0:
            current_size = 1.0
    except Exception:
        current_size = 1.0
    scale = float(target_size)/float(current_size)
    try:
        mesh.apply_scale(scale)
        mesh.export(output_glb_scaled)
    except Exception:
        # If it's a Scene: re-pack and export with scale
        scene = mesh if isinstance(mesh, trimesh.Scene) else trimesh.Scene(mesh)
        scene.apply_scale(scale)
        scene.export(output_glb_scaled)

    with open(output_glb_scaled, "rb") as f:
        glb_base64 = base64.b64encode(f.read()).decode("ascii")

    click_data_url = _to_data_url_audio(click_sound_path)
    click_js = "null" if not click_data_url else f'"{click_data_url}"'
    bg_js = 'null' if (background is None) else str(int(background))

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>{Step_Name} 3D Viewer</title>
<style>
  html, body {{ margin:0; height:100%; overflow:hidden; background:#ffffff; }}
  #app {{ position:fixed; inset:0; }}
  .ui-root {{ position:absolute; inset:0; pointer-events:none; z-index:9999;
              font-family:"Computer Modern","CMU Serif",Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial; }}
  .panel {{ background:#ffffff; border:1px solid #e6e6e6; border-radius:18px;
           box-shadow:0 12px 36px rgba(0,0,0,.14); pointer-events:auto; overflow:hidden; }}
  .btn {{ padding:8px 12px; border-radius:12px; border:1px solid #e6e6e6;
         background:#ffffff; color:#0b3b3c; font-weight:700; cursor:pointer; }}
  .row {{ display:grid; grid-template-columns:120px 1fr; gap:10px; align-items:center; margin:6px 0; }}
  .lbl {{ color:#577e7f; font-weight:700; }}
  .hdr {{ display:flex; align-items:center; justify-content:space-between; gap:8px;
          padding:10px 12px; border-bottom:1px solid #e6e6e6; background:#ffffff; }}
  select, input[type="range"] {{ padding:8px; border:1px solid #e6e6e6; border-radius:10px; accent-color:#0ea5a6; }}
  .tools-toggle {{ position:absolute; right:14px; top:14px; pointer-events:auto;
                   padding:8px 12px; border-radius:12px; border:1px solid #e6e6e6;
                   background:#ffffff; color:#0b3b3c; font-weight:700;
                   box-shadow:0 12px 36px rgba(0,0,0,.14); z-index:10000; }}
  .badge {{ position:absolute; bottom:12px; right:14px; z-index:10; user-select:none; pointer-events:none; }}
  .badge img {{ max-height:40px; display:block; }}
</style>
</head>
<body>
  <div id="app"></div>
  <div class="badge"><img src="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png" alt="badge"></div>

  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/GLTFLoader.js"></script>
  <script>
  (function(){{
    const THEME = {{
      teal: 0x0ea5a6,
      bgCanvas: {bg_js}, // white by default
    }};

    // ----- MP3 click (no oscillator; overlapping allowed) -----
    let audioCtx = null, clickBuf = null, clickURL = {click_js};
    async function ensureClickBuffer(){{
      if (!clickURL) return;
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (!clickBuf){{
        const resp = await fetch(clickURL); const arr = await resp.arrayBuffer();
        clickBuf = await new Promise((res, rej)=>{{ try{{ audioCtx.decodeAudioData(arr, res, rej); }}catch(e){{ rej(e); }} }});
      }}
    }}
    function playClick(){{
      if (!clickURL) return;
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      if (!clickBuf) {{ ensureClickBuffer().then(()=>playClick()).catch(()=>{{}}); return; }}
      const src = audioCtx.createBufferSource(); src.buffer = clickBuf; src.connect(audioCtx.destination); try{{ src.start(); }}catch(_e){{}}
    }}

    // ---------- Scene / camera / renderer ----------
    const container = document.getElementById('app');
    function ensureSize() {{
      container.style.width = window.innerWidth + 'px';
      container.style.height = window.innerHeight + 'px';
      renderer.setSize(container.clientWidth||1, container.clientHeight||1);
      const asp = Math.max(1e-6, (container.clientWidth||1)/(container.clientHeight||1));
      if (camera.isPerspectiveCamera) {{ camera.aspect = asp; }}
      else {{ const s = orthoSize; camera.left=-s*asp; camera.right=s*asp; camera.top=s; camera.bottom=-s; }}
      camera.updateProjectionMatrix();
    }}

    const scene = new THREE.Scene();
    if (THEME.bgCanvas !== null) scene.background = new THREE.Color(THEME.bgCanvas); // pure white

    const aspect = Math.max(1e-6, (container.clientWidth||window.innerWidth)/(container.clientHeight||window.innerHeight));
    const persp = new THREE.PerspectiveCamera(75, aspect, 0.01, 10000);
    persp.position.set(0,0,3);

    const orthoSize = 2.5;
    const ortho = new THREE.OrthographicCamera(-orthoSize*aspect, orthoSize*aspect, orthoSize, -orthoSize, 0.01, 10000);
    ortho.position.set(0,0,3);

    let camera = persp;

    const renderer = new THREE.WebGLRenderer({{ antialias: true, preserveDrawingBuffer: true }});
    renderer.setPixelRatio(window.devicePixelRatio||1);
    renderer.setSize(window.innerWidth, window.innerHeight);

    // ===== Start with NO SHADOWS =====
    renderer.shadowMap.enabled = false; // off initially
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0xeeeeee, 0.7);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.05);
    dirLight.position.set(3,4,2);
    dirLight.castShadow = false; // off initially
    dirLight.shadow.mapSize.set(1024,1024);
    scene.add(hemi); scene.add(dirLight);

    // Ground + grid (grid OFF by default; ground OFF by default now)
    const groundGroup = new THREE.Group(); scene.add(groundGroup);
    const grid = new THREE.GridHelper(10, 20, 0xbbbbbb, 0xeeeeee); grid.visible = false; groundGroup.add(grid);
    const groundMat = new THREE.ShadowMaterial({{ opacity: 0.22 }});
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200,200), groundMat);
    ground.rotation.x = -Math.PI/2; ground.position.y = -0.0001; ground.receiveShadow = false;
    ground.visible = false; // OFF initially
    groundGroup.add(ground);

    // Axes helper (OFF by default)
    const axesHelper = new THREE.AxesHelper(1); axesHelper.visible = false; scene.add(axesHelper);
    function sizeAxesHelper(maxDim, center) {{
      axesHelper.scale.setScalar(maxDim * 0.75);
      axesHelper.position.copy(center || new THREE.Vector3());
    }}

    // ----- Load model (embedded) -----
    function base64ToArrayBuffer(b64) {{
      const bin = atob(b64); const len = bin.length; const bytes = new Uint8Array(len);
      for (let i=0;i<len;i++) bytes[i]=bin.charCodeAt(i); return bytes.buffer;
    }}
    const glbBase64 = "{glb_base64}";
    const arrayBuffer = base64ToArrayBuffer(glbBase64);

    let model = null;
    const loader = new THREE.GLTFLoader();
    loader.parse(arrayBuffer, '', function(gltf) {{
      model = gltf.scene;
      model.traverse(n => {{
        if (n.isMesh && n.material) {{
          const mats = Array.isArray(n.material)? n.material : [n.material];
          for (const m of mats) m.side = THREE.DoubleSide;
          n.castShadow = false; // off at start
          n.receiveShadow = false; // off at start
          if (n.geometry && n.geometry.computeVertexNormals) n.geometry.computeVertexNormals();
        }}
      }});
      scene.add(model);
      centerAndFrame();
    }}, function(err) {{ console.error('Error loading GLB:', err); }});

    // === More zoomed-out fit so the whole model shows ===
    function centerAndFrame(pad=1.12){{
      if (!model) return;
      const box = new THREE.Box3().setFromObject(model);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).multiplyScalar(pad);
      const maxDim = Math.max(size.x,size.y,size.z) || 1;

      model.position.sub(center);

      if (camera.isPerspectiveCamera){{
        const dist = maxDim * 2.6;  // <- slightly farther than before
        camera.near = Math.max(maxDim/1000,0.001);
        camera.far  = Math.max(maxDim*1500,1500);
        camera.updateProjectionMatrix();
        camera.position.set(dist, dist*0.9, dist);
      }} else {{
        camera.left = -maxDim; camera.right = maxDim; camera.top = maxDim; camera.bottom = -maxDim;
        camera.near = Math.max(maxDim/1000,0.001);
        camera.far  = Math.max(maxDim*1500,1500);
        camera.updateProjectionMatrix();
        camera.position.set(maxDim, maxDim*0.9, maxDim);
      }}
      controls.target.set(0,0,0); controls.update();
      sizeAxesHelper(maxDim, new THREE.Vector3(0,0,0));
    }}

    // -------- Section plane (visible teal sheet) --------
    let secEnabled=false, secAxis='X', secPlaneVisible=false;
    let secVisual=null;
    function ensureSectionVisual(){{
      if (!secVisual){{
        const geom = new THREE.PlaneGeometry(1,1,1,1);
        const mat  = new THREE.MeshBasicMaterial({{
          color: 0x0ea5a6, transparent: true, opacity: 0.14,
          depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide
        }});
        secVisual = new THREE.Mesh(geom, mat);
        secVisual.visible = false; secVisual.renderOrder = 10000;
        scene.add(secVisual);
      }}
      return secVisual;
    }}
    function refreshSectionVisual(){{
      if (!model || !secVisual) return;
      const box = new THREE.Box3().setFromObject(model);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x,size.y,size.z)||1;
      secVisual.scale.set(maxDim*1.2, maxDim*1.2, 1);
      secVisual.position.set(0,0,0);
    }}
    function updateSectionPlane(distNorm){{
      renderer.clippingPlanes = [];
      if (!secEnabled || !model){{
        renderer.localClippingEnabled=false; if (secVisual) secVisual.visible=false; return;
      }}
      const n = new THREE.Vector3(secAxis==='X'?1:0, secAxis==='Y'?1:0, secAxis==='Z'?1:0);
      const box = new THREE.Box3().setFromObject(model);
      if (box.isEmpty()){{ renderer.localClippingEnabled=false; if (secVisual) secVisual.visible=false; return; }}
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x,size.y,size.z)||1;
      const dist = distNorm * maxDim * 0.5;
      const plane = new THREE.Plane(n, -dist);  // model centered at origin
      renderer.localClippingEnabled = true;
      renderer.clippingPlanes = [plane];

      ensureSectionVisual(); refreshSectionVisual();
      secVisual.visible = !!secPlaneVisible;
      const look = new THREE.Vector3().copy(n);
      const up = Math.abs(look.dot(new THREE.Vector3(0,1,0)))>0.999 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0,0,0), look, up);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      secVisual.setRotationFromQuaternion(q);
      const p0 = n.clone().multiplyScalar(-plane.constant);
      secVisual.position.copy(p0);
    }}

    // -------- Render modes --------
    function setRenderMode(mode){{
      if (!model) return;
      model.traverse(o=>{{
        if (o.isMesh && o.material){{
          const mats = Array.isArray(o.material)? o.material : [o.material];
          for (const m of mats){{
            m.wireframe = (mode==='Wireframe');
            if (mode==='X-Ray') {{
              m.transparent = true; m.opacity=0.35; m.depthWrite=false; m.depthTest=true;
            }} else if (mode==='Ghost') {{
              m.transparent = true; m.opacity=0.70; m.depthWrite=true; m.depthTest=true;
            }} else {{
              m.transparent=false; m.opacity=1.0; m.depthWrite=true; m.depthTest=true;
            }}
            m.needsUpdate = true;
          }}
        }}
      }});
    }}

    // -------- Views --------
    function viewIso(){{
      if (!model) return;
      const box=new THREE.Box3().setFromObject(model); if (box.isEmpty()) return;
      const s=box.getSize(new THREE.Vector3()); const d=Math.max(s.x,s.y,s.z)*2.6;
      const az=Math.PI*0.25, el=Math.PI*0.2;
      const dir=new THREE.Vector3(Math.cos(el)*Math.cos(az), Math.sin(el), Math.cos(el)*Math.sin(az)).multiplyScalar(d);
      camera.position.copy(dir); controls.target.set(0,0,0); controls.update();
    }}
    function viewTop(){{
      if (!model) return;
      const box=new THREE.Box3().setFromObject(model); const s=box.getSize(new THREE.Vector3()); const d=Math.max(s.x,s.y,s.z)*2.6;
      camera.position.set(0, d, 0); controls.target.set(0,0,0); controls.update();
    }}
    function viewFront(){{
      if (!model) return;
      const box=new THREE.Box3().setFromObject(model); const s=box.getSize(new THREE.Vector3()); const d=Math.max(s.x,s.y,s.z)*2.6;
      camera.position.set(0, 0, d); controls.target.set(0,0,0); controls.update();
    }}
    function viewRight(){{
      if (!model) return;
      const box=new THREE.Box3().setFromObject(model); const s=box.getSize(new THREE.Vector3()); const d=Math.max(s.x,s.y,s.z)*2.6;
      camera.position.set(d, 0, 0); controls.target.set(0,0,0); controls.update();
    }}

    // --- UI ---
    const ui = document.createElement('div'); ui.className = 'ui-root';
    const toolsToggle = document.createElement('button'); toolsToggle.className = 'tools-toggle btn'; toolsToggle.textContent = 'Open Tools';
    const dock = document.createElement('div'); dock.className = 'panel'; Object.assign(dock.style, {{ position:'absolute', right:'14px', top:'14px', width:'440px', display:'none' }});
    const dockHeader = document.createElement('div'); dockHeader.className='hdr';
    const hdrTitle = document.createElement('div'); hdrTitle.textContent='Viewer Tools'; hdrTitle.style.fontWeight='800'; hdrTitle.style.color='#0b3b3c';
    const fitBtn = document.createElement('button'); fitBtn.className='btn'; fitBtn.style.padding='6px 10px'; fitBtn.style.borderRadius='10px'; fitBtn.textContent='Fit';
    dockHeader.appendChild(hdrTitle); dockHeader.appendChild(fitBtn);

    const body = document.createElement('div'); body.style.padding='10px 12px';

    function row(label, child){{
      const r = document.createElement('div'); r.className='row';
      const l = document.createElement('div'); l.className='lbl'; l.textContent = label;
      r.appendChild(l); r.appendChild(child); return r;
    }}
    function mkSelect(opts, val){{
      const s = document.createElement('select'); opts.forEach(o=>{{ const op=document.createElement('option'); op.value=o; op.textContent=o; s.appendChild(op); }}); s.value=val; return s;
    }}
    function mkSlider(min,max,step,val){{
      const s=document.createElement('input'); s.type='range'; s.min=min; s.max=max; s.step=step; s.value=val; return s;
    }}
    function mkToggle(label, init=false){{
      const wrap=document.createElement('label'); wrap.style.display='flex'; wrap.style.gap='8px'; wrap.style.alignItems='center'; wrap.style.cursor='pointer';
      const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=init; cb.style.accentColor='#0ea5a6';
      const sp=document.createElement('span'); sp.textContent=label; sp.style.fontWeight='700'; sp.style.color='#0b3b3c';
      wrap.appendChild(cb); wrap.appendChild(sp); return {{wrap, cb}};
    }}

    // Controls
    const renderMode = mkSelect(['Solid','Wireframe','X-Ray','Ghost'],'Solid');
    const axisSel = mkSelect(['X','Y','Z'],'X');
    const secDist = mkSlider(-1,1,0.001,0);
    const secToggle = mkToggle('Enable section', false);
    const secPlaneToggle = mkToggle('Show slice plane', false);

    const viewsRow = document.createElement('div'); Object.assign(viewsRow.style, {{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'8px', margin:'8px 0' }});
    const bIso=document.createElement('button'); bIso.className='btn'; bIso.textContent='Iso';
    const bTop=document.createElement('button'); bTop.className='btn'; bTop.textContent='Top';
    const bFront=document.createElement('button'); bFront.className='btn'; bFront.textContent='Front';
    const bRight=document.createElement('button'); bRight.className='btn'; bRight.textContent='Right';
    const bSnap=document.createElement('button'); bSnap.className='btn'; bSnap.textContent='Snapshot';
    [bIso,bTop,bFront,bRight,bSnap].forEach(b=>{{ b.style.padding='8px'; b.style.borderRadius='10px'; viewsRow.appendChild(b); }});

    const projSel = mkSelect(['Perspective','Orthographic'],'Perspective');
    const togGrid = mkToggle('Grid', false);
    const togGround = mkToggle('Ground & shadows', false);  // OFF by default now
    const togAxes = mkToggle('XYZ axes', false);

    body.appendChild(row('Render mode', renderMode));
    body.appendChild(row('Section axis', axisSel));
    body.appendChild(row('Section dist', secDist));
    body.appendChild(row('', secToggle.wrap));
    body.appendChild(row('', secPlaneToggle.wrap));
    body.appendChild(row('Views', viewsRow));
    body.appendChild(row('Projection', projSel));
    body.appendChild(row('', togGrid.wrap));
    body.appendChild(row('', togGround.wrap));
    body.appendChild(row('', togAxes.wrap));

    dock.appendChild(dockHeader); dock.appendChild(body);
    ui.appendChild(dock); ui.appendChild(toolsToggle);
    document.body.appendChild(ui);

    function setDock(open){{
      dock.style.display = open ? 'block' : 'none';
      toolsToggle.textContent = open ? 'Close Tools' : 'Open Tools';
    }}
    toolsToggle.addEventListener('click', ()=>{{ playClick(); setDock(dock.style.display==='none'); }});

    fitBtn.addEventListener('click', ()=>{{ playClick(); centerAndFrame(1.12); }});
    renderMode.addEventListener('change', ()=>{{ playClick(); setRenderMode(renderMode.value); }});
    axisSel.addEventListener('change', ()=>{{ playClick(); secAxis = axisSel.value; updateSectionPlane(parseFloat(secDist.value)||0); }});
    secDist.addEventListener('input', ()=>{{ updateSectionPlane(parseFloat(secDist.value)||0); }}); // continuous, no sound
    secToggle.cb.addEventListener('change', ()=>{{ playClick(); secEnabled = !!secToggle.cb.checked; updateSectionPlane(parseFloat(secDist.value)||0); }});
    secPlaneToggle.cb.addEventListener('change', ()=>{{ playClick(); secPlaneVisible = !!secPlaneToggle.cb.checked; updateSectionPlane(parseFloat(secDist.value)||0); }});
    bIso.addEventListener('click', ()=>{{ playClick(); viewIso(); }});
    bTop.addEventListener('click', ()=>{{ playClick(); viewTop(); }});
    bFront.addEventListener('click', ()=>{{ playClick(); viewFront(); }});
    bRight.addEventListener('click', ()=>{{ playClick(); viewRight(); }});
    bSnap.addEventListener('click', ()=>{{ playClick(); try{{ const url=renderer.domElement.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download='snapshot.png'; a.click(); }}catch(_e){{}} }});
    projSel.addEventListener('change', ()=>{{
      playClick();
      const w = container.clientWidth||1, h=container.clientHeight||1, asp = Math.max(1e-6, w/h);
      if (projSel.value==='Orthographic' && camera.isPerspectiveCamera){{
        const box = model ? new THREE.Box3().setFromObject(model) : null;
        const s = box && !box.isEmpty() ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(2,2,2);
        const maxDim = Math.max(s.x,s.y,s.z)||1;
        ortho.left=-maxDim*asp; ortho.right=maxDim*asp; ortho.top=maxDim; ortho.bottom=-maxDim;
        ortho.near=Math.max(maxDim/1000,0.001); ortho.far=Math.max(maxDim*1500,1500);
        ortho.position.copy(camera.position); ortho.updateProjectionMatrix();
        controls.object = ortho; camera = ortho; controls.update();
      }} else if (projSel.value==='Perspective' && camera.isOrthographicCamera){{
        persp.aspect = asp; persp.updateProjectionMatrix();
        persp.position.copy(camera.position);
        controls.object = persp; camera = persp; controls.update();
      }}
    }});
    togGrid.cb.addEventListener('change', ()=>{{ playClick(); grid.visible = !!togGrid.cb.checked; }});
    togGround.cb.addEventListener('change', ()=>{{
      playClick();
      const on = !!togGround.cb.checked;
      // toggle ground plane + mesh shadow flags + renderer shadowMap
      ground.visible = on;
      dirLight.castShadow = on;
      renderer.shadowMap.enabled = on;
      if (model) model.traverse(n=>{{ if(n.isMesh){{ n.castShadow = on; n.receiveShadow = on; }} }});
    }});
    togAxes.cb.addEventListener('change', ()=>{{
      playClick(); axesHelper.visible = !!togAxes.cb.checked;
      if (model) {{
        const box=new THREE.Box3().setFromObject(model); if (!box.isEmpty()) {{
          const s=box.getSize(new THREE.Vector3()); const maxDim=Math.max(s.x,s.y,s.z)||1;
          sizeAxesHelper(maxDim, new THREE.Vector3(0,0,0));
        }}
      }}
    }});

    window.addEventListener('resize', ensureSize);
    ensureSize();

    // Animate
    (function animate(){{
      requestAnimationFrame(animate);
      controls.update(); renderer.render(scene, camera);
    }})();
  }})();
  </script>
</body>
</html>"""
    display(HTML(html))
