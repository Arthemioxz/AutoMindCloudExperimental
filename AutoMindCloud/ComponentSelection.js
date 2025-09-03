/* urdf_viewer.js - UMD-lite: exposes window.URDFViewer
   ✅ Gallery lists EVERY visual component (each Mesh) as its own item
   ✅ Thumbnails and on-screen view are HARD-ISOLATED (only that component visible)
   ✅ Skips images; picks best asset variant per basename (DAE > STL > OBJ; then largest)
   ✅ Auto-scales DAE using its <unit meter="...">
   ✅ “Components” toggle button bottom-left; “Show all” inside the gallery header
*/
(function (root) {
  'use strict';

  const URDFViewer = {};
  let state = null;
  let __LINK_UID_SEQ = 1;
  let __COMP_UID_SEQ = 1;

  // ---------- Helpers ----------
  function normKey(s){ return String(s||'').replace(/\\/g,'/').toLowerCase(); }
  function variantsFor(path){
    const out = new Set(), p = normKey(path);
    out.add(p); out.add(p.replace(/^package:\/\//,''));
    const bn = p.split('/').pop();
    out.add(bn); out.add(bn.split('?')[0].split('#')[0]);
    const parts = p.split('/'); for (let i=1;i<parts.length;i++) out.add(parts.slice(i).join('/'));
    return Array.from(out);
  }
  function basenameNoExt(p){
    const q = String(p||'').split('/').pop().split('?')[0].split('#')[0];
    const dot = q.lastIndexOf('.');
    return dot>=0 ? q.slice(0,dot) : q;
  }
  function approxByteLenFromB64(b64){ return Math.floor(String(b64||'').length * 3 / 4); }

  // Pick ONE asset per basename among available variants (prefer DAE > STL > OBJ; then largest bytes)
  function pickBestAsset(tries, meshDB){
    const extPriority = { dae: 3, stl: 2, obj: 1 };
    const groups = new Map(); // base -> [{key, ext, bytes, prio}]
    for (const k of tries){
      const kk = normKey(k);
      const b64 = meshDB[kk];
      if (!b64) continue;
      const ext = kk.split('.').pop();
      if (!extPriority[ext]) continue; // skip images etc.
      const base = basenameNoExt(kk);
      const arr = groups.get(base) || [];
      arr.push({ key: kk, ext, bytes: approxByteLenFromB64(b64), prio: extPriority[ext] });
      groups.set(base, arr);
    }
    for (const [,arr] of groups){
      arr.sort((a,b)=> (b.prio - a.prio) || (b.bytes - a.bytes));
      return arr[0]?.key || null;
    }
    return null;
  }

  function applyDoubleSided(obj){
    obj?.traverse?.(n=>{
      if (n.isMesh && n.geometry){
        if (Array.isArray(n.material)) n.material.forEach(m=>m.side=THREE.DoubleSide);
        else if (n.material) n.material.side = THREE.DoubleSide;
        n.castShadow = n.receiveShadow = true;
        n.geometry.computeVertexNormals?.();
      }
    });
  }
  function rectifyUpForward(obj){
    if (!obj || obj.userData.__rectified) return;
    // ROS Z-up -> Three Y-up
    obj.rotateX(-Math.PI/2);
    obj.userData.__rectified = true;
    obj.updateMatrixWorld(true);
  }
  function fitAndCenter(camera, controls, object, pad=1.0){
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

  function findAncestorLink(o, linkSet){
    while (o){
      if (linkSet && linkSet.has(o)) return o;
      o = o.parent;
    }
    return null;
  }
  function isMovable(j){ const t = (j?.jointType||'').toString().toLowerCase(); return t && t !== 'fixed'; }
  function isPrismatic(j){ return (j?.jointType||'').toString().toLowerCase()==='prismatic'; }
  function getJointValue(j){ return isPrismatic(j) ? (typeof j.position==='number'?j.position:0) : (typeof j.angle==='number'?j.angle:0); }
  function setJointValue(robot,j,v){
    if (!j) return;
    const t = (j.jointType||'').toString().toLowerCase();
    const lim=j.limit||{};
    if (t!=='continuous'){
      if (typeof lim.lower==='number') v=Math.max(v, lim.lower);
      if (typeof lim.upper==='number') v=Math.min(v, lim.upper);
    }
    if (typeof j.setJointValue==='function') j.setJointValue(v);
    else if (robot && j.name) robot.setJointValue(j.name, v);
    robot?.updateMatrixWorld(true);
  }
  function findAncestorJoint(o){
    while (o){
      if (o.jointType && isMovable(o)) return o;
      if (o.userData && o.userData.__joint && isMovable(o.userData.__joint)) return o.userData.__joint;
      o = o.parent;
    }
    return null;
  }

  function markLinksAndJoints(robot){
    const linkSet = new Set(Object.values(robot.links||{}));
    const joints  = Object.values(robot.joints||{});
    const linkBy  = robot.links||{};
    // Stamp stable UIDs on links we manage
    linkSet.forEach(l=>{
      if (l && !l.userData.__linkUID) l.userData.__linkUID = __LINK_UID_SEQ++;
    });
    joints.forEach(j=>{
      try{
        j.userData.__isURDFJoint = true;
        let childLinkObj = j.child && j.child.isObject3D ? j.child : null;
        const childName =
          (typeof j.childLink==='string' && j.childLink) ||
          (j.child && typeof j.child.name==='string' && j.child.name) ||
          (typeof j.child==='string' && j.child) ||
          (typeof j.child_link==='string' && j.child_link) || null;
        if (!childLinkObj && childName && linkBy[childName]) childLinkObj = linkBy[childName];
        if (!childLinkObj && childName && j.children && j.children.length){
          const stack=j.children.slice();
          while (stack.length){
            const n=stack.pop(); if (!n) continue;
            if (n.name===childName){ childLinkObj=n; break; }
            const kids=n.children?n.children.slice():[];
            for (let i=0;i<kids.length;i++) stack.push(kids[i]);
          }
        }
        if (childLinkObj && isMovable(j)) childLinkObj.userData.__joint = j;
      }catch(_e){}
    });
    return linkSet;
  }

  // ---------- Public API: destroy ----------
  URDFViewer.destroy = function(){
    try{ cancelAnimationFrame(state?.raf); }catch(_){}
    try{ window.removeEventListener('resize', state?.onResize); }catch(_){}
    try{ const el = state?.renderer?.domElement; el && el.parentNode && el.parentNode.removeChild(el); }catch(_){}
    try{ state?.renderer?.dispose?.(); }catch(_){}
    try{ state?.ui?.root && state.ui.root.remove(); }catch(_){}
    try{ state?.off?.renderer?.dispose?.(); }catch(_){}
    state=null;
  };

  /**
   * Renderiza un URDF embebido.
   * opts = {
   *   container: HTMLElement (opcional, default document.body),
   *   urdfContent: string,
   *   meshDB: { key -> base64 },
   *   background: number (hex) o null,
   *   descriptions: { [componentKey]: string } // optional per-component text (key = "link/meshIndex" or mesh.name)
   * }
   */
  URDFViewer.render = function(opts){
    if (state) URDFViewer.destroy();

    const container = opts?.container || document.body;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    const bg = (opts && opts.background!==undefined) ? opts.background : 0xf0f0f0;
    const descriptions = (opts && opts.descriptions) || {};

    // Scene
    const scene = new THREE.Scene();
    if (bg!=null) scene.background = new THREE.Color(bg);

    const camera = new THREE.PerspectiveCamera(
      75,
      Math.max(1e-6, (container.clientWidth||1)/(container.clientHeight||1)),
      0.01,
      10000
    );
    camera.position.set(0,0,3);

    const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
    renderer.setPixelRatio(window.devicePixelRatio||1);
    renderer.setSize(container.clientWidth||1, container.clientHeight||1);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.position = 'relative';
    container.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(2,2,2); scene.add(dirLight);

    function onResize(){
      const w = container.clientWidth||1, h = container.clientHeight||1;
      camera.aspect = Math.max(1e-6, w/h);
      camera.updateProjectionMatrix();
      renderer.setSize(w,h);
    }
    window.addEventListener('resize', onResize);

    // Loader + mesh callbacks from meshDB
    const urdfLoader = new URDFLoader();
    const textDecoder = new TextDecoder();
    const b64ToUint8 = (b64)=>Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
    const b64ToText  = (b64)=>textDecoder.decode(b64ToUint8(b64));
    const MIME = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', stl:'model/stl', dae:'model/vnd.collada+xml', obj:'text/plain' };
    const meshDB = (opts && opts.meshDB) || {};
    const daeCache = new Map();
    let pendingMeshes = 0, fitTimer=null;

    function scheduleFit(){
      if (fitTimer) clearTimeout(fitTimer);
      fitTimer = setTimeout(()=>{
        if (pendingMeshes===0 && api.robotModel){
          rectifyUpForward(api.robotModel);
          fitAndCenter(camera, controls, api.robotModel);
        }
      },80);
    }

    urdfLoader.loadMeshCb = (path, manager, onComplete)=>{
      // choose best asset among available variants
      const bestKey = pickBestAsset(variantsFor(path), meshDB);
      if (!bestKey){ onComplete(new THREE.Mesh()); return; }

      const ext = bestKey.split('.').pop();

      // Skip image files (safety)
      if (['jpg','jpeg','png'].includes(ext)){ onComplete(new THREE.Mesh()); return; }

      pendingMeshes++;
      const done=(mesh)=>{
        applyDoubleSided(mesh);
        onComplete(mesh);
        pendingMeshes--; scheduleFit();
      };

      try{
        if (ext==='stl'){
          const bytes=b64ToUint8(meshDB[bestKey]);
          const loader=new THREE.STLLoader();
          const geom=loader.parse(bytes.buffer);
          geom.computeVertexNormals();
          done(new THREE.Mesh(
            geom,
            new THREE.MeshStandardMaterial({ color:0x8aa1ff, roughness:0.85, metalness:0.15, side:THREE.DoubleSide })
          ));
          return;
        }
        if (ext==='dae'){
          // cache by key
          if (daeCache.has(bestKey)){ done(daeCache.get(bestKey).clone(true)); return; }
          const daeText=b64ToText(meshDB[bestKey]);

          // scale from <unit meter="...">
          let scale = 1.0;
          const m = /<unit[^>]*meter\s*=\s*"([\d.eE+\-]+)"/i.exec(daeText);
          if (m){ const meter = parseFloat(m[1]); if (isFinite(meter) && meter>0) scale = meter; }

          const mgr=new THREE.LoadingManager();
          mgr.setURLModifier((url)=>{
            const tries=variantsFor(url);
            // Reuse best-pick for subordinate assets
            const key = pickBestAsset(tries, meshDB) || tries.map(normKey).find(k=>meshDB[k]);
            if (key){
              const ext2 = key.split('.').pop();
              const mime = MIME[ext2] || 'application/octet-stream';
              return `data:${mime};base64,${meshDB[key]}`;
            }
            return url;
          });
          const loader=new THREE.ColladaLoader(mgr);
          const collada=loader.parse(daeText,'');
          const obj=(collada.scene || new THREE.Object3D());
          if (scale !== 1.0) obj.scale.setScalar(scale);
          daeCache.set(bestKey, obj);
          done(obj.clone(true));
          return;
        }
        // Fallback
        done(new THREE.Mesh());
      }catch(_e){ done(new THREE.Mesh()); }
    };

    const api = { scene, camera, renderer, controls, robotModel:null, linkSet:null, components:[] };

    // ----------- interactions for joints -----------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragState=null;
    const ROT_PER_PIXEL=0.01, PRISM_PER_PIXEL=0.003;

    function getPointer(e){
      const r = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left)/r.width)*2 - 1;
      pointer.y = -((e.clientY - r.top)/r.height)*2 + 1;
    }
    function startJointDrag(joint, ev){
      const originW = joint.getWorldPosition(new THREE.Vector3());
      const qWorld  = joint.getWorldQuaternion(new THREE.Quaternion());
      const axisW   = (joint.axis||new THREE.Vector3(1,0,0)).clone().normalize().applyQuaternion(qWorld).normalize();
      const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisW.clone(), originW);

      raycaster.setFromCamera(pointer, camera);
      const p0 = new THREE.Vector3();
      let r0=null;
      if (raycaster.ray.intersectPlane(dragPlane, p0)){
        r0 = p0.clone().sub(originW);
        if (r0.lengthSq()>1e-12) r0.normalize(); else r0=null;
      }

      dragState = { joint, originW, axisW, dragPlane, r0, value:getJointValue(joint), lastClientX:ev.clientX, lastClientY:ev.clientY };
      controls.enabled=false;
      renderer.domElement.style.cursor='grabbing';
      renderer.domElement.setPointerCapture?.(ev.pointerId);
    }
    function updateJointDrag(ev){
      const ds=dragState; if (!ds) return;
      const fine = ev.shiftKey ? 0.35 : 1.0;
      getPointer(ev); raycaster.setFromCamera(pointer, camera);

      const dX = (ev.clientX - (ds.lastClientX ?? ev.clientX));
      const dY = (ev.clientY - (ds.lastClientY ?? ev.clientY));
      ds.lastClientX = ev.clientX; ds.lastClientY = ev.clientY;

      if (isPrismatic(ds.joint)){
        const hit=new THREE.Vector3(); let delta=0;
        if (raycaster.ray.intersectPlane(ds.dragPlane, hit)){
          const t1 = hit.clone().sub(ds.originW).dot(ds.axisW);
          delta = (t1 - (ds.lastT ?? t1)); ds.lastT = t1;
        } else {
          delta = -(dY * PRISM_PER_PIXEL);
        }
        ds.value += delta * fine; setJointValue(api.robotModel, ds.joint, ds.value); return;
      }

      let applied=false; const hit=new THREE.Vector3();
      if (raycaster.ray.intersectPlane(ds.dragPlane, hit)){
        let r1 = hit.clone().sub(ds.originW);
        if (r1.lengthSq()>=1e-12){
          r1.normalize(); if (!ds.r0) ds.r0 = r1.clone();
          const cross = new THREE.Vector3().crossVectors(ds.r0, r1);
          const dot = THREE.MathUtils.clamp(ds.r0.dot(r1), -1, 1);
          const sign = Math.sign(ds.axisW.dot(cross)) || 1;
          const delta = Math.atan2(cross.length(), dot) * sign;
          ds.value += (delta * fine); ds.r0 = r1;
          setJointValue(api.robotModel, ds.joint, ds.value); applied=true;
        }
      }
      if (!applied){
        const delta = (dX * ROT_PER_PIXEL) * fine;
        ds.value += delta; setJointValue(api.robotModel, ds.joint, ds.value);
      }
    }
    function endJointDrag(ev){
      if (dragState){ renderer.domElement.releasePointerCapture?.(ev.pointerId); }
      dragState=null; controls.enabled=true; renderer.domElement.style.cursor='auto';
    }

    renderer.domElement.addEventListener('pointermove', (e)=>{
      getPointer(e);
      if (dragState){ updateJointDrag(e); return; }
      if (!api.robotModel) return;
      // keep pointer interactions smooth even when many parts hidden
      renderer.domElement.style.cursor='auto';
    }, {passive:true});

    renderer.domElement.addEventListener('pointerdown', (e)=>{
      e.preventDefault();
      if (!api.robotModel || e.button!==0) return;
      // allow joint dragging when visible mesh under pointer (optional)
      const pickables=[]; api.robotModel.traverse(o=>{ if (o.isMesh && o.geometry && o.visible) pickables.push(o); });
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickables, true);
      if (!hits.length) return;
      const joint = findAncestorJoint(hits[0].object);
      if (joint && isMovable(joint)) startJointDrag(joint, e);
    }, {passive:false});
    renderer.domElement.addEventListener('pointerup', endJointDrag);
    renderer.domElement.addEventListener('pointerleave', endJointDrag);
    renderer.domElement.addEventListener('pointercancel', endJointDrag);

    // ---------------- COMPONENT INDEX (each Mesh = one component) ----------------
    function indexComponents(){
      api.components.length = 0;
      const perLinkCounter = new Map();

      // Ensure we know which nodes are links
      const linkSet = api.linkSet;

      api.robotModel.traverse(o=>{
        if (!(o && o.isMesh && o.geometry)) return;
        if (o.userData.__isHoverOverlay) return;

        // component UID
        if (!o.userData.__compUID) o.userData.__compUID = __COMP_UID_SEQ++;

        // find link ancestor (optional metadata)
        const link = findAncestorLink(o, linkSet);
        const linkName = link && typeof link.name==='string' ? link.name : '';

        // label
        const baseName = (o.name && o.name.trim()) || '';
        let idx = perLinkCounter.get(link) || 0;
        perLinkCounter.set(link, idx+1);
        const label = baseName || (linkName ? `${linkName} / mesh #${idx+1}` : `mesh #${o.userData.__compUID}`);

        api.components.push({
          uid: o.userData.__compUID,
          label,
          linkName,
          meshRef: o
        });
      });
    }

    // ---------------- OFF-SCREEN snapshot rig ----------------
    function buildOffscreenFromRobot(){
      if (!api.robotModel) return null;

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

      const robotClone = api.robotModel.clone(true);
      offScene.add(robotClone);

      // Map original compUID -> cloned mesh
      const cloneByCompUID = new Map();
      robotClone.traverse(o=>{
        const uid = o?.userData?.__compUID;
        if (uid && o.isMesh && o.geometry) cloneByCompUID.set(uid, o);
      });

      return { renderer: offRenderer, scene: offScene, camera: offCamera, canvas: offCanvas, robotClone, cloneByCompUID };
    }

    async function snapshotComponentOffscreen(compUID){
      const off = state.off;
      if (!off) return null;
      const meshClone = off.cloneByCompUID.get(compUID);
      if (!meshClone) return null;

      // Save all mesh vis
      const vis = [];
      off.robotClone.traverse(o=>{
        if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay){
          vis.push([o, o.visible]);
        }
      });

      // Hide EVERYTHING first
      for (const [m] of vis) m.visible = false;

      // Then show ONLY this component mesh
      meshClone.visible = true;

      // Frame with padding and 3/4 angle
      const box = new THREE.Box3().setFromObject(meshClone);
      const center = box.getCenter(new THREE.Vector3());
      const size   = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x,size.y,size.z) || 1;

      const dist = maxDim * 2.0;
      off.camera.near = Math.max(maxDim/1000,0.001);
      off.camera.far  = Math.max(maxDim*1000,1000);
      off.camera.updateProjectionMatrix();

      const az = Math.PI * 0.25;
      const el = Math.PI * 0.18;
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
      vis.forEach(([o,v])=>{ o.visible = v; });

      return url;
    }
    // ---------------- end OFF-SCREEN ----------------

    // ---------- UI helpers ----------
    function showAllAndFrame(){
      if (!api.robotModel) return;
      api.robotModel.traverse(o=>{
        if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay){
          o.visible = true;
        }
      });
      fitAndCenter(camera, controls, api.robotModel, 1.05);
    }

    function isolateComponentOnScreen(compUID){
      // Hide everything
      api.robotModel.traverse(o=>{
        if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay){
          o.visible = false;
        }
      });
      // Show only the selected mesh
      let target=null;
      api.robotModel.traverse(o=>{
        if (o.isMesh && o.geometry && o.userData.__compUID === compUID){
          o.visible = true; target = o;
        }
      });
      if (target) fitAndCenter(camera, controls, target, 1.1);
    }

    // ---------- UI: bottom-left toggle + right panel with header Show-all ----------
    function createUI(){
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

      // Bottom-left toggle button (opens/closes panel)
      const btn = document.createElement('button');
      btn.textContent = 'Components';
      Object.assign(btn.style, {
        position: 'absolute',
        left: '14px',
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

      // Panel (bottom-right)
      const panel = document.createElement('div');
      Object.assign(panel.style, {
        position: 'absolute',
        right: '14px',
        bottom: '14px',
        width: '420px',
        maxHeight: '72%',
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
      showAllBtn.addEventListener('click', showAllAndFrame);

      header.appendChild(headerTitle);
      header.appendChild(showAllBtn);

      const list = document.createElement('div');
      Object.assign(list.style, {
        overflowY: 'auto',
        maxHeight: 'calc(72vh - 52px)',
        padding: '10px'
      });

      panel.appendChild(header);
      panel.appendChild(list);
      root.appendChild(panel);
      root.appendChild(btn);
      container.appendChild(root);

      let builtOnce = false;
      btn.addEventListener('click', async ()=>{
        if (panel.style.display === 'none'){
          panel.style.display = 'block';
          if (!builtOnce){ await buildGallery(list); builtOnce = true; }
        } else {
          panel.style.display = 'none';
        }
      });

      return { root, btn, panel, list, showAllBtn };
    }

    // Build per-component (per-mesh) gallery
    async function buildGallery(listEl){
      listEl.innerHTML = '';
      if (!api.robotModel || !api.linkSet){ listEl.textContent = 'No components found.'; return; }

      // Build component index (each mesh = a component)
      indexComponents();

      if (!api.components.length){
        listEl.textContent = 'No components with visual geometry found.'; return;
      }

      // UI rows
      for (const comp of api.components){
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
        img.alt = comp.label;

        const meta = document.createElement('div');
        const title = document.createElement('div');
        title.textContent = comp.label;
        Object.assign(title.style, { fontWeight: '700', fontSize: '14px' });

        const small = document.createElement('div');
        small.textContent = comp.linkName ? comp.linkName : '';
        Object.assign(small.style, { color: '#777', fontSize: '12px', marginTop: '2px' });

        const desc = document.createElement('div');
        const descKey = comp.meshRef.name || `${comp.linkName}/mesh#${comp.uid}`;
        desc.textContent = descriptions[descKey] || ' ';
        Object.assign(desc.style, { color: '#555', fontSize: '12px', marginTop: '4px' });

        meta.appendChild(title);
        if (small.textContent) meta.appendChild(small);
        if (desc.textContent.trim()) meta.appendChild(desc);

        row.appendChild(img);
        row.appendChild(meta);
        listEl.appendChild(row);

        // Clicking the row isolates that component in the ON-SCREEN viewer (hard isolation)
        row.addEventListener('click', ()=>{
          isolateComponentOnScreen(comp.uid);
        });

        // Thumbnail captured OFF-SCREEN (no flicker), hard isolation
        (async ()=>{
          try{
            const url = await snapshotComponentOffscreen(comp.uid);
            if (url) img.src = url;
          }catch(_e){ /* ignore */ }
        })();
      }
    }
    // ---------- end UI ----------

    // Public state holder
    state = { scene, camera, renderer, controls, api, onResize, raf:null, ui: null, off: null };

    // Load URDF text
    function loadURDF(urdfText){
      if (api.robotModel){ scene.remove(api.robotModel); api.robotModel=null; }
      if (state.off){ try{ state.off.renderer.dispose(); }catch(_){} state.off=null; }
      api.components.length = 0;

      try{
        const robot = urdfLoader.parse(urdfText||'');
        if (robot?.isObject3D){
          api.robotModel=robot; scene.add(api.robotModel);
          rectifyUpForward(api.robotModel);
          api.linkSet = markLinksAndJoints(api.robotModel);
          setTimeout(()=>fitAndCenter(camera, controls, api.robotModel), 50);

          // Build OFF-SCREEN rig now that links exist; index components afterwards
          state.off = buildOffscreenFromRobot();
          indexComponents();
        }
      } catch(_e){}
    }

    function animate(){
      state.raf = requestAnimationFrame(animate);
      controls.update(); renderer.render(scene, camera);
    }

    loadURDF((opts && opts.urdfContent) || '');
    state.ui = createUI();
    animate();

    return {
      scene, camera, renderer, controls,
      get robot(){ return api.robotModel; },
      openGallery(){ state.ui?.btn?.click?.(); }
    };
  };

  root.URDFViewer = URDFViewer;
})(typeof window!=='undefined' ? window : this);
