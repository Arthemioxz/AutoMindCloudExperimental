/* urdf_viewer.js - UMD-lite: exposes window.URDFViewer
   - Keeps original interactions:
     * OrbitControls camera rotate/zoom/pan
     * Gray hover overlay (mesh or link, via selectMode)
     * Joint drag (revolute/prismatic) with limits and Shift for fine control
   - Gallery is PER FILE (DAE/STL/STEP) — not per link/mesh fragment.
     Clicking an item HARD-ISOLATES all instances of that asset in the main view.
   - Thumbnails are captured OFF-SCREEN with the same isolation (no flicker).
   - Skips images; dedup path variants per basename (DAE > STL > STEP; then largest).
   - Auto-scales DAE via <unit meter="...">.
   - UI: bottom-left “Components” toggle, “Show all” button in the gallery header.
*/
(function (root) {
  'use strict';

  const URDFViewer = {};
  let state = null;

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
  function extOf(p){
    const q = String(p||'').split('?')[0].split('#')[0];
    const dot = q.lastIndexOf('.');
    return dot>=0 ? q.slice(dot+1).toLowerCase() : '';
  }
  function approxByteLenFromB64(b64){ return Math.floor(String(b64||'').length * 3 / 4); }

  const ALLOWED_EXTS = new Set(['dae','stl','step','stp']);

  function pickBestAsset(tries, meshDB){
    const extPriority = { dae: 3, stl: 2, step: 1, stp: 1 };
    const groups = new Map(); 
    for (const k of tries){
      const kk = normKey(k);
      const b64 = meshDB[kk];
      if (!b64) continue;
      const ext = extOf(kk);
      if (!ALLOWED_EXTS.has(ext)) continue;
      const base = basenameNoExt(kk);
      const arr = groups.get(base) || [];
      arr.push({ key: kk, ext, bytes: approxByteLenFromB64(b64), prio: extPriority[ext] ?? 0 });
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

  function collectMeshesInLink(linkObj){
    const t=[], stack=[linkObj];
    while (stack.length){
      const n = stack.pop(); if (!n) continue;
      if (n.isMesh && n.geometry && !n.userData.__isHoverOverlay) t.push(n);
      const kids = n.children ? n.children.slice() : [];
      for (let i=0;i<kids.length;i++) stack.push(kids[i]);
    }
    return t;
  }

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

  // ---------- Hover overlay ----------
  function buildHoverAPI(){
    const overlays=[];
    function clear(){ for(const o of overlays){ if (o?.parent) o.parent.remove(o); } overlays.length=0; }
    function overlayFor(mesh){
      if (!mesh || !mesh.isMesh || !mesh.geometry) return null;
      const m = new THREE.Mesh(
        mesh.geometry,
        new THREE.MeshBasicMaterial({ color:0x9e9e9e, transparent:true, opacity:0.35, depthTest:false, depthWrite:false })
      );
      m.renderOrder = 999; m.userData.__isHoverOverlay = true; return m;
    }
    function showMesh(mesh){
      const ov = overlayFor(mesh);
      if (ov){ mesh.add(ov); overlays.push(ov); }
    }
    function showLink(link){
      const arr = collectMeshesInLink(link);
      for(const m of arr){
        const ov = overlayFor(m);
        if (ov){ m.add(ov); overlays.push(ov); }
      }
    }
    return { clear, showMesh, showLink };
  }

  // ---------- Joint helpers ----------
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
  function findAncestorLink(o, linkSet){
    while (o){
      if (linkSet && linkSet.has(o)) return o;
      o = o.parent;
    }
    return null;
  }

  function markLinksAndJoints(robot){
    const linkSet = new Set(Object.values(robot.links||{}));
    const joints  = Object.values(robot.joints||{});
    const linkBy  = robot.links||{};
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

  URDFViewer.destroy = function(){
    try{ cancelAnimationFrame(state?.raf); }catch(_){}
    try{ window.removeEventListener('resize', state?.onResize); }catch(_){}
    try{ const el = state?.renderer?.domElement; el && el.parentNode && el.parentNode.removeChild(el); }catch(_){}
    try{ state?.renderer?.dispose?.(); }catch(_){}
    try{ state?.ui?.root && state.ui.root.remove(); }catch(_){}
    try{ state?.off?.renderer?.dispose?.(); }catch(_){}
    state=null;
  };

  URDFViewer.render = function(opts){
    if (state) URDFViewer.destroy();
    const container = opts?.container || document.body;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    const selectMode = (opts && opts.selectMode) || 'link';
    const bg = (opts && opts.background!==undefined) ? opts.background : 0xf0f0f0;
    const descriptions = (opts && opts.descriptions) || {};

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

    const urdfLoader = new URDFLoader();
    const textDecoder = new TextDecoder();
    const b64ToUint8 = (b64)=>Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
    const b64ToText  = (b64)=>textDecoder.decode(b64ToUint8(b64));
    const MIME = {
      png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
      stl:'model/stl', dae:'model/vnd.collada+xml', step:'model/step', stp:'model/step'
    };
    const meshDB = (opts && opts.meshDB) || {};
    const daeCache = new Map();
    let pendingMeshes = 0, fitTimer=null;
    const assetToMeshes = new Map();

    function scheduleFit(){
      if (fitTimer) clearTimeout(fitTimer);
      fitTimer = setTimeout(()=>{
        if (pendingMeshes===0 && api.robotModel){
          rectifyUpForward(camera, controls, api.robotModel);
          fitAndCenter(camera, controls, api.robotModel);
        }
      },80);
    }

    urdfLoader.loadMeshCb = (path, manager, onComplete)=>{
      const bestKey = pickBestAsset(variantsFor(path), meshDB);
      if (!bestKey){ onComplete(new THREE.Mesh()); return; }
      const ext = extOf(bestKey);
      if (!ALLOWED_EXTS.has(ext)){ onComplete(new THREE.Mesh()); return; }

      const tagAndComplete = (obj)=>{
        obj.userData.__assetKey = bestKey;
        obj.traverse(o=>{
          if (o.isMesh && o.geometry){
            o.userData.__assetKey = bestKey;
            const arr = assetToMeshes.get(bestKey) || [];
            arr.push(o);
            assetToMeshes.set(bestKey, arr);
          }
        });
        applyDoubleSided(obj);
        onComplete(obj);
        pendingMeshes--; scheduleFit();
      };

      pendingMeshes++;
      try{
        if (ext==='stl'){
          const bytes=b64ToUint8(meshDB[bestKey]);
          const loader=new THREE.STLLoader();
          const geom=loader.parse(bytes.buffer);
          geom.computeVertexNormals();
          const mesh = new THREE.Mesh(
            geom,
            new THREE.MeshStandardMaterial({ color:0x8aa1ff, roughness:0.85, metalness:0.15, side:THREE.DoubleSide })
          );
          tagAndComplete(mesh);
          return;
        }
        if (ext==='dae'){
          if (daeCache.has(bestKey)){ tagAndComplete(daeCache.get(bestKey).clone(true)); return; }
          const daeText=b64ToText(meshDB[bestKey]);
          let scale = 1.0;
          const m = /<unit[^>]*meter\s*=\s*"([\d.eE+\-]+)"/i.exec(daeText);
          if (m){ const meter = parseFloat(m[1]); if (isFinite(meter) && meter>0) scale = meter; }

          const mgr=new THREE.LoadingManager();
          mgr.setURLModifier((url)=>{
            const tries=variantsFor(url);
            const key = tries.map(normKey).find(k=>meshDB[k]);
            if (key){
              const mime = MIME[extOf(key)] || 'application/octet-stream';
              return `data:${mime};base64,${meshDB[key]}`;
            }
            return url;
          });
          const loader=new THREE.ColladaLoader(mgr);
          const collada=loader.parse(daeText,'');
          const obj=(collada.scene || new THREE.Object3D());
          if (scale !== 1.0) obj.scale.setScalar(scale);
          daeCache.set(bestKey, obj);
          tagAndComplete(obj.clone(true));
          return;
        }
        if (ext==='step' || ext==='stp'){
         
