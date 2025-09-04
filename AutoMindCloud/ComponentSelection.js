/* AutoMindCloud/ComponentSelection.js
   Component gallery & isolation for URDFViewer
   - Adds a bottom-right "Components" button
   - Opens a scrollable panel with off-screen thumbnails (no flicker)
   - Click an item => HARD-ISOLATE that asset on screen
   - "Show all" button restores visibility & frames model
   - Plays click sound via window.Sound (if available), else fallback beep
   - Assumes URDFViewer has tagged meshes with userData.__assetKey (as in your urdf_viewer.js)

   API:
     ComponentSelection.attach(viewer, {
       descriptions?: { [assetBaseName]: string },
       panelWidth?: number,   // default 420
       panelMaxHeightVh?: number, // default 72
       buttonLabel?: string,  // default "Components"
     })
*/
(function (root) {
  'use strict';

  const ComponentSelection = {};

  // ----- Utilities -----
  function basenameNoExt(p){
    const q = String(p||'').split('/').pop().split('?')[0].split('#')[0];
    const dot = q.lastIndexOf('.');
    return dot>=0 ? q.slice(0,dot) : q;
  }
  function extOf(p){
    const q = String(p||'').split('?')[0].split('#')[0];
    const dot = q.lastIndexOf('.');
    return dot>=0 ? q.slice(dot+1).toLowerCase() : '';
  }
  const ALLOWED_EXTS = new Set(['dae','stl','step','stp']);

  function computeUnionBox(meshes){
    const box = new THREE.Box3();
    let has=false;
    const tmp = new THREE.Box3();
    for (const m of meshes){
      if (!m) continue;
      tmp.setFromObject(m);
      if (!has){ box.copy(tmp); has=true; } else { box.union(tmp); }
    }
    return has ? box : null;
  }

  function fitAndCenter(camera, controls, object, pad=1.05){
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3()).multiplyScalar(pad);
    const maxDim = Math.max(size.x,size.y,size.z)||1;
    const dist   = maxDim * 1.8;
    camera.near = Math.max(maxDim/1000,0.001);
    camera.far  = Math.max(maxDim*1000,1000);
    camera.updateProjectionMatrix();
    camera.position.copy(center.clone().add(new THREE.Vector3(dist, dist*0.9, dist)));
    controls.target.copy(center); controls.update();
  }

  // ----- Sound helpers -----
  function fallbackBeep(){
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.22, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }
  async function playClick(){
    if (root.Sound && root.Sound.isReady) {
      try{
        if (root.Sound.isReady()){
          const ok = await root.Sound.play(1.0);
          if (!ok) fallbackBeep();
          return;
        }
      }catch(_e){}
    }
    fallbackBeep();
  }

  // ----- Build a per-asset index from the viewer's robot model -----
  function buildAssetIndexFromRobot(robot){
    // assetKey -> [scene meshes]
    const assetToMeshes = new Map();
    robot?.traverse?.(o=>{
      if (o && o.isMesh && o.geometry && !o.userData.__isHoverOverlay){
        const k = o.userData && o.userData.__assetKey;
        if (k){
          const arr = assetToMeshes.get(k) || [];
          arr.push(o);
          assetToMeshes.set(k, arr);
        }
      }
    });
    return assetToMeshes;
  }

  // ----- Off-screen snapshot rig -----
  function buildOffscreenFromRobot(robot){
    if (!robot) return null;

    const offCanvas = document.createElement('canvas');
    const OFF_W = 640, OFF_H = 480;
    offCanvas.width = OFF_W; offCanvas.height = OFF_H;

    const offRenderer = new THREE.WebGLRenderer({ canvas: offCanvas, antialias:true, preserveDrawingBuffer:true });
    offRenderer.setSize(OFF_W, OFF_H, false);

    const offScene = new THREE.Scene();
    offScene.background = new THREE.Color(0xffffff);

    const amb = new THREE.AmbientLight(0xffffff, 0.95);
    const d = new THREE.DirectionalLight(0xffffff, 1.1); d.position.set(2.5,2.5,2.5);
    offScene.add(amb); offScene.add(d);

    const offCamera = new THREE.PerspectiveCamera(60, OFF_W/OFF_H, 0.01, 10000);

    const robotClone = robot.clone(true);
    offScene.add(robotClone);

    const cloneAssetToMeshes = new Map();
    robotClone.traverse(o=>{
      const k = o?.userData?.__assetKey;
      if (k && o.isMesh && o.geometry){
        const arr = cloneAssetToMeshes.get(k) || [];
        arr.push(o); cloneAssetToMeshes.set(k, arr);
      }
    });

    return { renderer: offRenderer, scene: offScene, camera: offCamera, canvas: offCanvas, robotClone, cloneAssetToMeshes };
  }

  async function snapshotAssetOffscreen(off, assetKey){
    if (!off) return null;
    const meshes = off.cloneAssetToMeshes.get(assetKey) || [];
    if (!meshes.length) return null;

    // Save current vis
    const vis = [];
    off.robotClone.traverse(o=>{
      if (o.isMesh && o.geometry) vis.push([o, o.visible]);
    });

    // Hide all, show only target
    for (const [m] of vis) m.visible = false;
    for (const m of meshes) m.visible = true;

    // Frame
    const box = computeUnionBox(meshes);
    if (!box){ vis.forEach(([o,v])=>o.visible=v); return null; }
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x,size.y,size.z) || 1;
    const dist = maxDim * 2.0;
    off.camera.near = Math.max(maxDim/1000,0.001);
    off.camera.far  = Math.max(maxDim*1000,1000);
    off.camera.updateProjectionMatrix();

    const az = Math.PI * 0.25, el = Math.PI * 0.18;
    const dir = new THREE.Vector3(
      Math.cos(el)*Math.cos(az),
      Math.sin(el),
      Math.cos(el)*Math.sin(az)
    ).multiplyScalar(dist);
    off.camera.position.copy(center.clone().add(dir));
    off.camera.lookAt(center);

    off.renderer.render(off.scene, off.camera);
    const url = off.renderer.domElement.toDataURL('image/png');

    // Restore vis
    for (const [o,v] of vis) o.visible = v;

    return url;
  }

  // ----- Isolation & Show All -----
  function isolateAssetOnScreen(viewer, assetToMeshes, assetKey){
    const robot = viewer?.robot;
    if (!robot) return;
    const meshes = assetToMeshes.get(assetKey) || [];
    robot.traverse(o=>{
      if (o.isMesh && o.geometry) o.visible = false;
    });
    for (const m of meshes) m.visible = true;

    const box = computeUnionBox(meshes);
    if (box){
      const center = box.getCenter(new THREE.Vector3());
      const size   = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x,size.y,size.z)||1;
      const dist   = maxDim * 1.9;
      const camera = viewer.camera;
      const controls = viewer.controls;
      camera.near = Math.max(maxDim/1000,0.001);
      camera.far  = Math.max(maxDim*1000,1000);
      camera.updateProjectionMatrix();

      const az = Math.PI * 0.25, el = Math.PI * 0.18;
      const dir = new THREE.Vector3(
        Math.cos(el)*Math.cos(az),
        Math.sin(el),
        Math.cos(el)*Math.sin(az)
      ).multiplyScalar(dist);
      camera.position.copy(center.clone().add(dir));
      controls.target.copy(center); controls.update();
    }
  }

  function showAllAndFrame(viewer){
    const robot = viewer?.robot;
    if (!robot) return;
    robot.traverse(o=>{
      if (o.isMesh && o.geometry) o.visible = true;
    });
    fitAndCenter(viewer.camera, viewer.controls, robot, 1.05);
  }

  // ----- UI -----
  function createUI(viewer, opt){
    const panelWidth = Math.max(260, Number(opt?.panelWidth) || 420);
    const panelMaxHeightVh = Math.max(40, Number(opt?.panelMaxHeightVh) || 72);
    const buttonLabel = (opt?.buttonLabel) || 'Components';
    const descriptions = opt?.descriptions || {};

    const container = viewer?.renderer?.domElement?.parentElement || document.body;

    // Root overlay
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'absolute',
      left: '0', top: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none',
      zIndex: '9999',
      fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial'
    });

    // Bottom-right toggle button
    const btn = document.createElement('button');
    btn.textContent = buttonLabel;
    Object.assign(btn.style, {
      position: 'absolute',
      right: '14px',
      bottom: '14px',
      padding: '10px 14px',
      borderRadius: '14px',
      border: '1px solid #d0d0d0',
      background: '#ffffff',
      boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
      fontWeight: '700',
      cursor: 'pointer',
      pointerEvents: 'auto'
    });
    btn.addEventListener('click', ()=>{ playClick(); });

    // Panel (right side)
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'absolute',
      right: '14px',
      bottom: '14px',
      width: panelWidth + 'px',
      maxHeight: panelMaxHeightVh + 'vh',
      background: '#ffffff',
      border: '1px solid #e4e4e7',
      boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
      borderRadius: '16px',
      overflow: 'hidden',
      display: 'none',
      pointerEvents: 'auto'
    });

    // Header with title + Show all
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      padding: '10px 10px',
      borderBottom: '1px solid #eee',
      background: '#fafafa'
    });

    const headerTitle = document.createElement('div');
    headerTitle.textContent = 'Components';
    Object.assign(headerTitle.style, { fontWeight: '800' });

    const showAllBtn = document.createElement('button');
    showAllBtn.textContent = 'Show all';
    Object.assign(showAllBtn.style, {
      padding: '6px 10px',
      borderRadius: '10px',
      border: '1px solid #d0d0d0',
      background: '#ffffff',
      fontWeight: '700',
      cursor: 'pointer'
    });
    showAllBtn.addEventListener('click', ()=>{
      playClick();
      showAllAndFrame(viewer);
    });

    header.appendChild(headerTitle);
    header.appendChild(showAllBtn);

    const list = document.createElement('div');
    Object.assign(list.style, {
      overflowY: 'auto',
      maxHeight: `calc(${panelMaxHeightVh}vh - 52px)`,
      padding: '10px'
    });

    panel.appendChild(header);
    panel.appendChild(list);
    root.appendChild(panel);
    root.appendChild(btn);
    container.appendChild(root);

    // Toggle logic
    let builtOnce = false;
    btn.addEventListener('click', async ()=>{
      if (panel.style.display === 'none'){
        panel.style.display = 'block';
        if (!builtOnce){
          await buildGallery(viewer, list, descriptions);
          builtOnce = true;
        }
      } else {
        panel.style.display = 'none';
      }
    });

    return { root, btn, panel, list, showAllBtn };
  }

  async function buildGallery(viewer, listEl, descriptions){
    listEl.innerHTML = '';

    const robot = viewer?.robot;
    if (!robot){ listEl.textContent = 'No model loaded.'; return; }

    const assetToMeshes = buildAssetIndexFromRobot(robot);
    if (!assetToMeshes.size){
      listEl.textContent = 'No components with visual geometry found.'; return;
    }

    // Offscreen rig for thumbnails
    const off = buildOffscreenFromRobot(robot);

    // Build sorted entries
    const entries = [];
    assetToMeshes.forEach((meshes, assetKey)=>{
      if (!meshes || !meshes.length) return;
      const base = basenameNoExt(assetKey);
      const ext = extOf(assetKey);
      if (!ALLOWED_EXTS.has(ext)) return;
      entries.push({ assetKey, base, ext, meshes });
    });
    entries.sort((a,b)=> a.base.localeCompare(b.base, undefined, {numeric:true, sensitivity:'base'}));

    for (const ent of entries){
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'grid',
        gridTemplateColumns: '128px 1fr',
        gap: '12px',
        alignItems: 'center',
        padding: '10px',
        borderRadius: '12px',
        border: '1px solid #f0f0f0',
        marginBottom: '10px',
        background: '#fff',
        cursor: 'pointer'
      });

      const img = document.createElement('img');
      Object.assign(img.style, {
        width: '128px',
        height: '96px',
        objectFit: 'contain',
        background: '#fafafa',
        borderRadius: '10px',
        border: '1px solid #eee'
      });
      img.alt = ent.base;

      const meta = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = ent.base;
      Object.assign(title.style, { fontWeight: '700', fontSize: '14px' });

      const small = document.createElement('div');
      small.textContent = `.${ent.ext} • ${ent.meshes.length} instance${ent.meshes.length>1?'s':''}`;
      Object.assign(small.style, { color: '#777', fontSize: '12px', marginTop: '2px' });

      const desc = document.createElement('div');
      desc.textContent = descriptions[ent.base] || ' ';
      Object.assign(desc.style, { color: '#555', fontSize: '12px', marginTop: '4px' });

      meta.appendChild(title);
      meta.appendChild(small);
      if (desc.textContent.trim()) meta.appendChild(desc);

      row.appendChild(img);
      row.appendChild(meta);
      listEl.appendChild(row);

      // Click isolates
      row.addEventListener('click', ()=>{
        playClick();
        isolateAssetOnScreen(viewer, assetToMeshes, ent.assetKey);
      });

      // Generate thumbnail (off-screen)
      (async ()=>{
        try{
          const url = await snapshotAssetOffscreen(off, ent.assetKey);
          if (url) img.src = url;
        }catch(_e){}
      })();
    }
  }

  // ----- Public API -----
  ComponentSelection.attach = function(viewer, options){
    if (!viewer || !viewer.renderer || !viewer.camera || !viewer.controls){
      console.warn('[ComponentSelection] Invalid viewer instance.');
      return null;
    }
    return createUI(viewer, options || {});
  };

  // UMD
  root.ComponentSelection = ComponentSelection;
  if (typeof module !== 'undefined' && module.exports){
    module.exports = ComponentSelection;
  }
})(typeof window !== 'undefined' ? window : this);
