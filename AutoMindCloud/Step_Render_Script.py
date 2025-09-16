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


def Step_Render(Step_Name, target_size=2.0):
    import base64, os
    import trimesh
    import cascadio
    from IPython.display import display, HTML

    output_step = Step_Name + ".step"
    output_glb = Step_Name + ".glb"
    output_glb_scaled = Step_Name + "_scaled.glb"

    # STEP -> GLB
    _ = cascadio.step_to_glb(output_step, output_glb)

    # scale to target_size ~ 2.0
    mesh = trimesh.load(output_glb)
    current_size = max(getattr(mesh, "extents", [1,1,1]))
    if not current_size or current_size <= 0: current_size = 1.0
    mesh.apply_scale(float(target_size)/float(current_size))
    mesh.export(output_glb_scaled)

    with open(output_glb_scaled, "rb") as f:
        glb_base64 = base64.b64encode(f.read()).decode("ascii")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>{Step_Name} 3D Viewer</title>
<style>
  html, body {{ margin:0; height:100%; background:#ffffff; }}
  #app {{ position:fixed; inset:0; }}
  .ui-root {{ position:absolute; inset:0; pointer-events:none; z-index:9999;
              font-family: "Computer Modern", Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial; }}
  .panel {{ background:#ffffff; border:1px solid #e6e6e6; border-radius:18px;
           box-shadow:0 12px 36px rgba(0,0,0,.12); pointer-events:auto; overflow:hidden; }}
  .btn {{ padding:8px 12px; border-radius:12px; border:1px solid #e6e6e6;
         background:#ffffff; color:#0b3b3c; font-weight:700; cursor:pointer; }}
  .row {{ display:grid; grid-template-columns:120px 1fr; gap:10px; align-items:center; margin:6px 0; }}
  .lbl {{ color:#587071; font-weight:700; }}
  .hdr {{ display:flex; align-items:center; justify-content:space-between; gap:8px;
          padding:10px 12px; border-bottom:1px solid #e6e6e6; background:#ffffff; }}
  select, input[type="range"] {{ padding:8px; border:1px solid #e6e6e6; border-radius:10px; accent-color:#0ea5a6; }}
  .tools-toggle {{ position:absolute; right:14px; top:14px; pointer-events:auto; }}
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
    // ---------- Click sound (no files needed) ----------
    let audioCtx = null;
    function playClick(){{
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      // short blip envelope
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'triangle';
      o.frequency.value = 660; // Hz
      g.gain.setValueAtTime(0, audioCtx.currentTime);
      g.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
      o.connect(g); g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.14);
    }}

    // ---------- Scene / camera / renderer ----------
    const container = document.getElementById('app');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff); // pure white

    const aspect = window.innerWidth / window.innerHeight;
    const persp = new THREE.PerspectiveCamera(75, aspect, 0.01, 1e4);
    persp.position.set(0,0,3);
    const orthoSize = 2.5;
    const ortho = new THREE.OrthographicCamera(-orthoSize*aspect, orthoSize*aspect, orthoSize, -orthoSize, 0.01, 1e4);
    ortho.position.set(0,0,3);
    let camera = persp;

    const renderer = new THREE.WebGLRenderer({{ antialias:true, preserveDrawingBuffer:true }});
    renderer.setPixelRatio(window.devicePixelRatio||1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0xdedede, 0.7);
    const dir = new THREE.DirectionalLight(0xffffff, 1.05);
    dir.position.set(3,4,2); dir.castShadow = true;
    scene.add(hemi, dir);

    // Ground + grid (grid off by default)
    const grid = new THREE.GridHelper(10, 20, 0xbbbbbb, 0xeeeeee); grid.visible = false; scene.add(grid);
    const groundMat = new THREE.ShadowMaterial({{ opacity: 0.22 }});
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200,200), groundMat);
    ground.rotation.x = -Math.PI/2; ground.position.y = -0.0001; ground.receiveShadow = true; ground.visible = true;
    scene.add(ground);

    // Axes helper (off by default)
    const axes = new THREE.AxesHelper(1); axes.visible = false; scene.add(axes);

    // ----- Load model (embedded base64) -----
    function base64ToArrayBuffer(b64){{
      const bin = atob(b64); const len = bin.length; const bytes = new Uint8Array(len);
      for (let i=0;i<len;i++) bytes[i]=bin.charCodeAt(i); return bytes.buffer;
    }}
    const loader = new THREE.GLTFLoader();
    const arrayBuffer = base64ToArrayBuffer("{glb_base64}");
    let model = null;

    loader.parse(arrayBuffer, '', (gltf)=>{{
      model = gltf.scene;
      model.traverse(n=>{{
        if (n.isMesh && n.material){{
          const mats = Array.isArray(n.material)? n.material : [n.material];
          for (const m of mats){{ m.side = THREE.DoubleSide; }}
          n.castShadow = n.receiveShadow = true;
        }}
      }});
      scene.add(model);
      frameModel();
    }}, (err)=>console.error(err));

    function frameModel(pad=1.08){{
      if (!model) return;
      const box = new THREE.Box3().setFromObject(model); if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).multiplyScalar(pad);
      const maxDim = Math.max(size.x,size.y,size.z)||1;
      model.position.sub(center);
      if (camera.isPerspectiveCamera){{
        const d = maxDim*1.9;
        camera.near = Math.max(maxDim/1000,0.001);
        camera.far  = Math.max(maxDim*1500,1500);
        camera.position.set(d, d*0.9, d);
      }} else {{
        const asp = Math.max(1e-6, window.innerWidth/window.innerHeight);
        camera.left=-maxDim*asp; camera.right=maxDim*asp; camera.top=maxDim; camera.bottom=-maxDim;
        camera.near=Math.max(maxDim/1000,0.001); camera.far=Math.max(maxDim*1500,1500);
      }}
      camera.updateProjectionMatrix();
      controls.target.set(0,0,0); controls.update();
      axes.scale.setScalar(maxDim*0.75); axes.position.set(0,0,0);
    }}

    // ----- Section plane with visible sheet -----
    let secEnabled=false, secAxis='X', secPlaneVisible=false, secMesh=null;
    function ensureSecMesh(){{
      if (!secMesh){{
        secMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1,1),
          new THREE.MeshBasicMaterial({{ color: 0x0ea5a6, transparent:true, opacity:0.14, depthWrite:false, depthTest:false, side:THREE.DoubleSide, toneMapped:false }})
        );
        secMesh.visible = false; secMesh.renderOrder = 10000;
        scene.add(secMesh);
      }}
    }}
    function refreshSecMesh(){{
      if (!model || !secMesh) return;
      const box = new THREE.Box3().setFromObject(model); if (box.isEmpty()) return;
      const s = Math.max(...box.getSize(new THREE.Vector3()).toArray())||1;
      secMesh.scale.set(s*1.2, s*1.2, 1);
      secMesh.position.set(0,0,0);
    }}
    function updateSection(distNorm){{
      renderer.clippingPlanes = [];
      if (!secEnabled || !model){{ renderer.localClippingEnabled=false; if (secMesh) secMesh.visible=false; return; }}
      const n = new THREE.Vector3(secAxis==='X'?1:0, secAxis==='Y'?1:0, secAxis==='Z'?1:0);
      const box = new THREE.Box3().setFromObject(model);
      const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray())||1;
      const dist = distNorm * maxDim * 0.5;
      const plane = new THREE.Plane(n, -dist);
      renderer.localClippingEnabled = true;
      renderer.clippingPlanes = [plane];

      ensureSecMesh(); refreshSecMesh();
      secMesh.visible = !!secPlaneVisible;

      // orient plane mesh to normal n and place at plane position
      const up = Math.abs(n.dot(new THREE.Vector3(0,1,0)))>0.999 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0,0,0), n, up);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      secMesh.setRotationFromQuaternion(q);
      const p0 = n.clone().multiplyScalar(-plane.constant);
      secMesh.position.copy(p0);
    }}

    // ----- Render modes -----
    function setRenderMode(mode){{
      if (!model) return;
      model.traverse(o=>{{
        if (o.isMesh && o.material){{
          const mats = Array.isArray(o.material)? o.material : [o.material];
          for (const m of mats){{
            m.wireframe = (mode==='Wireframe');
            if (mode==='X-Ray') {{ m.transparent=true; m.opacity=0.35; m.depthWrite=false; m.depthTest=true; }}
            else if (mode==='Ghost') {{ m.transparent=true; m.opacity=0.70; m.depthWrite=true; m.depthTest=true; }}
            else {{ m.transparent=false; m.opacity=1.0; m.depthWrite=true; m.depthTest=true; }}
            m.needsUpdate = true;
          }}
        }}
      }});
    }}

    // ----- Views -----
    function viewIso(){{
      if (!model) return;
      const box=new THREE.Box3().setFromObject(model); if (box.isEmpty()) return;
      const s=box.getSize(new THREE.Vector3()); const d=Math.max(s.x,s.y,s.z)*1.9;
      const az=Math.PI*0.25, el=Math.PI*0.2;
      const dir=new THREE.Vector3(Math.cos(el)*Math.cos(az), Math.sin(el), Math.cos(el)*Math.sin(az)).multiplyScalar(d);
      camera.position.copy(dir); controls.target.set(0,0,0); controls.update();
    }}
    function viewTop(){{
      if (!model) return;
      const box=new THREE.Box3().setFromObject(model); const d=Math.max(...box.getSize(new THREE.Vector3()).toArray())*1.9;
      camera.position.set(0,d,0); controls.target.set(0,0,0); controls.update();
    }}
    function viewFront(){{
      if (!model) return;
      const box=new THREE.Box3().setFromObject(model); const d=Math.max(...box.getSize(new THREE.Vector3()).toArray())*1.9;
      camera.position.set(0,0,d); controls.target.set(0,0,0); controls.update();
    }}
    function viewRight(){{
      if (!model) return;
      const box=new THREE.Box3().setFromObject(model); const d=Math.max(...box.getSize(new THREE.Vector3()).toArray())*1.9;
      camera.position.set(d,0,0); controls.target.set(0,0,0); controls.update();
    }}

    // ----- UI -----
    const ui = document.createElement('div'); ui.className='ui-root';
    const toolsBtn = document.createElement('button'); toolsBtn.className='btn tools-toggle'; toolsBtn.textContent='Open Tools';

    const dock = document.createElement('div'); dock.className='panel';
    Object.assign(dock.style, {{ position:'absolute', right:'14px', top:'14px', width:'440px', display:'none' }});
    const hdr = document.createElement('div'); hdr.className='hdr';
    const title = document.createElement('div'); title.textContent='Viewer Tools'; title.style.fontWeight='800'; title.style.color='#0b3b3c';
    const fit = document.createElement('button'); fit.className='btn'; fit.textContent='Fit';
    hdr.appendChild(title); hdr.appendChild(fit);

    const body = document.createElement('div'); body.style.padding='10px 12px';
    function row(label, child){{
      const r=document.createElement('div'); r.className='row';
      const l=document.createElement('div'); l.className='lbl'; l.textContent=label;
      r.appendChild(l); r.appendChild(child); return r;
    }}
    function mkSelect(opts, val){{
      const s=document.createElement('select'); opts.forEach(o=>{{ const op=document.createElement('option'); op.value=o; op.textContent=o; s.appendChild(op); }}); s.value=val; return s;
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

    const renderMode = mkSelect(['Solid','Wireframe','X-Ray','Ghost'], 'Solid');
    const axisSel = mkSelect(['X','Y','Z'], 'X');
    const secDist = mkSlider(-1,1,0.001,0);
    const secOn   = mkToggle('Enable section', false);
    const secVis  = mkToggle('Show slice plane', false);

    const views = document.createElement('div');
    Object.assign(views.style, {{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'8px', margin:'8px 0' }});
    const bIso=document.createElement('button'); bIso.className='btn'; bIso.textContent='Iso';
    const bTop=document.createElement('button'); bTop.className='btn'; bTop.textContent='Top';
    const bFront=document.createElement('button'); bFront.className='btn'; bFront.textContent='Front';
    const bRight=document.createElement('button'); bRight.className='btn'; bRight.textContent='Right';
    const bSnap=document.createElement('button'); bSnap.className='btn'; bSnap.textContent='Snapshot';
    [bIso,bTop,bFront,bRight,bSnap].forEach(b=>{{ b.style.padding='8px'; b.style.borderRadius='10px'; views.appendChild(b); }});

    const projSel = mkSelect(['Perspective','Orthographic'],'Perspective');
    const gridT = mkToggle('Grid', false);
    const groundT = mkToggle('Ground & shadows', true);
    const axesT = mkToggle('XYZ axes', false);

    body.appendChild(row('Render mode', renderMode));
    body.appendChild(row('Section axis', axisSel));
    body.appendChild(row('Section dist', secDist));
    body.appendChild(row('', secOn.wrap));
    body.appendChild(row('', secVis.wrap));
    body.appendChild(row('Views', views));
    body.appendChild(row('Projection', projSel));
    body.appendChild(row('', gridT.wrap));
    body.appendChild(row('', groundT.wrap));
    body.appendChild(row('', axesT.wrap));

    dock.appendChild(hdr); dock.appendChild(body);
    ui.appendChild(dock); ui.appendChild(toolsBtn);
    document.body.appendChild(ui);

    function setDock(open){{
      dock.style.display = open ? 'block' : 'none';
      toolsBtn.textContent = open ? 'Close Tools' : 'Open Tools';
    }}
    toolsBtn.addEventListener('click', ()=>{{ playClick(); setDock(dock.style.display==='none'); }});
    fit.addEventListener('click', ()=>{{ playClick(); frameModel(1.06); }});

    renderMode.addEventListener('change', ()=>{{ playClick(); setRenderMode(renderMode.value); }});
    axisSel.addEventListener('change', ()=>{{ playClick(); secAxis = axisSel.value; updateSection(parseFloat(secDist.value)||0); }});
    secDist.addEventListener('input', ()=>{{ updateSection(parseFloat(secDist.value)||0); }});
    secOn.cb.addEventListener('change', ()=>{{ playClick(); secEnabled = !!secOn.cb.checked; updateSection(parseFloat(secDist.value)||0); }});
    secVis.cb.addEventListener('change', ()=>{{ playClick(); secPlaneVisible = !!secVis.cb.checked; updateSection(parseFloat(secDist.value)||0); }});
    bIso.addEventListener('click', ()=>{{ playClick(); viewIso(); }});
    bTop.addEventListener('click', ()=>{{ playClick(); viewTop(); }});
    bFront.addEventListener('click', ()=>{{ playClick(); viewFront(); }});
    bRight.addEventListener('click', ()=>{{ playClick(); viewRight(); }});
    bSnap.addEventListener('click', ()=>{{ playClick(); try{{ const url=renderer.domElement.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download='snapshot.png'; a.click(); }}catch(_){{}} }});
    projSel.addEventListener('change', ()=>{{
      playClick();
      const asp = Math.max(1e-6, window.innerWidth/window.innerHeight);
      if (projSel.value==='Orthographic' && camera.isPerspectiveCamera){{
        ortho.left=-2.5*asp; ortho.right=2.5*asp; ortho.top=2.5; ortho.bottom=-2.5;
        ortho.near=0.001; ortho.far=1e4; ortho.position.copy(camera.position); ortho.updateProjectionMatrix();
        controls.object = ortho; camera = ortho; controls.update();
      }} else if (projSel.value==='Perspective' && camera.isOrthographicCamera){{
        persp.aspect = asp; persp.updateProjectionMatrix();
        persp.position.copy(camera.position);
        controls.object = persp; camera = persp; controls.update();
      }}
    }});

    window.addEventListener('resize', ()=>{{
      renderer.setSize(window.innerWidth, window.innerHeight);
      const asp = Math.max(1e-6, window.innerWidth/window.innerHeight);
      if (camera.isPerspectiveCamera){{ camera.aspect=asp; }}
      else {{ camera.left=-orthoSize*asp; camera.right=orthoSize*asp; }}
      camera.updateProjectionMatrix();
    }});

    (function animate(){{
      requestAnimationFrame(animate);
      controls.update(); renderer.render(scene, camera);
    }})();
  }})();
  </script>
</body>
</html>"""
    display(HTML(html))
