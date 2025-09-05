/* urdf_viewer.js - UMD-lite: exposes window.URDFViewer
   Mobile-stable version: caps DPR, avoids preserveDrawingBuffer, uses ONE WebGLRenderer,
   makes thumbnails via a RenderTarget (no second WebGL context), disposes aggressively,
   and handles WebGL context loss.

   Features:
   - OrbitControls camera rotate/zoom/pan
   - Gray hover overlay (mesh or link, via selectMode)
   - Joint drag (revolute/prismatic) with limits and Shift for fine control
   - Per-FILE gallery on the right; clicking an item HARD-ISOLATES its meshes on screen
   - Off-screen thumbnails rendered through a RenderTarget
   - Auto-scales DAE via <unit meter="...">
   - UI: bottom-left “Components” toggle + “Show all” in the gallery header
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

  // Component files allowed for gallery isolation
  const ALLOWED_EXTS = new Set(['dae','stl','step','stp']);

  // Dedup per basename with priority: DAE > STL > STEP/STP, then largest byte size
  function pickBestAsset(tries, meshDB){
    const extPriority = { dae: 3, stl: 2, step: 1, stp: 1 };
    const groups = new Map(); // base -> [{key, ext, bytes, prio}]
    for (const k of tries){
      const kk = normKey(k);
      const b64 = meshDB[kk];
      if (!b64) continue;
      const ext = extOf(kk);
      if (!ALLOWED_EXTS.has(ext)) continue; // skip images/others
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
        // Keep normals if present; computing on mobile can be expensive
        if (!n.geometry.attributes?.normal) { try{ n.geometry.computeVertexNormals?.(); }catch(_){} }
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

  // ---------- Hover overlay (gray marker) ----------
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

  // ---------- Dispose helpers ----------
  function disposeObject3D(root){
    root?.traverse?.(o=>{
      if (o.isMesh){
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach(m=>m?.dispose?.());
        else o.material?.dispose?.();
      }
    });
  }

  // ---------- Public API: destroy ----------
  URDFViewer.destroy = function(){
    try{ cancelAnimationFrame(state?.raf); }catch(_){}
    try{ window.removeEventListener('resize', state?.onResize); }catch(_){}
    try{ state?.renderer?.domElement?.remove?.(); }catch(_){}
    try{ state?.renderer?.dispose?.(); }catch(_){}
    try{
      if (state?.api?.robotModel){
        disposeObject3D(state.api.robotModel);
        state.scene?.remove?.(state.api.robotModel);
      }
    }catch(_){}
    try{ state?.ui?.root?.remove?.(); }catch(_){}
    try{ state?.rt?.dispose?.(); }catch(_){}
    state=null;
  };

  /**
   * Render a URDF with a per-file gallery.
   * opts = {
   *   container: HTMLElement (default document.body),
   *   urdfContent: string,
   *   meshDB: { key -> base64 },
   *   selectMode: 'link'|'mesh' (default 'link')  // hover overlay behavior
   *   background: number (hex) or null,
   *   descriptions: { [assetBaseName]: string }
   * }
   */
  URDFViewer.render = function(opts){
    if (state) URDFViewer.destroy();

    const container = opts?.container || document.body;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    const selectMode = (opts && opts.selectMode) || 'link';
    const bg = (opts && opts.background!==undefined) ? opts.background : 0xf0f0f0;
    const descriptions = (opts && opts.descriptions) || {};

    // Mobile guards
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const DPR = Math.min(isMobile ? 1.5 : 2, window.devicePixelRatio || 1);

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

    // ONE renderer: no preserveDrawingBuffer
    const renderer = new THREE.WebGLRenderer({
      antialias: !isMobile,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(DPR);
    renderer.setSize(container.clientWidth||1, container.clientHeight||1, false);
    Object.assign(renderer.domElement.style, {
      width:"100%", height:"100%", touchAction:'none', display:'block', position:'relative'
    });
    container.appendChild(renderer.domElement);

    // Handle context loss (prevent default so browser doesn't kill it immediately)
    renderer.domElement.addEventListener('webglcontextlost', (e)=>{
      e.preventDefault();
      // You can show a small overlay here if you want
    }, false);
    renderer.domElement.addEventListener('webglcontextrestored', ()=>{
      // In this minimalist flow Three.js reinitializes; app state is still in memory
    }, false);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(2,2,2); scene.add(dirLight);

    function onResize(){
      const w = container.clientWidth||1, h = container.clientHeight||1;
      const maxW = isMobile ? 900 : 4096;
      const maxH = isMobile ? 700 : 4096;
      const W = Math.min(w, maxW), H = Math.min(h, maxH);
      camera.aspect = Math.max(1e-6, W/H);
      camera.updateProjectionMatrix();
      renderer.setSize(W, H, false);
    }
    window.addEventListener('resize', onResize);

    // Loader + mesh callbacks
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

    // assetKey -> [scene meshes]
    const assetToMeshes = new Map();

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
      const bestKey = pickBestAsset(variantsFor(path), meshDB);
      if (!bestKey){ onComplete(new THREE.Mesh()); return; }
      const ext = extOf(bestKey);
      if (!ALLOWED_EXTS.has(ext)){ onComplete(new THREE.Mesh()); return; } // safety

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
          // On mobile, skip computeVertexNormals() unless missing
          if (!geom.attributes.normal && !isMobile) geom.computeVertexNormals();
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

          // scale using <unit meter="...">
          let scale = 1.0;
          const m = /<unit[^>]*meter\s*=\s*"([\d.eE+\-]+)"/i.exec(daeText);
          if (m){ const meter = parseFloat(m[1]); if (isFinite(meter) && meter>0) scale = meter; }

          const mgr=new THREE.LoadingManager();
          mgr.setURLModifier((url)=>{
            // for referenced resources in DAE (textures, etc.)
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
          // No STEP parser in this bundle—return empty mesh so scene remains valid.
          onComplete(new THREE.Mesh());
          pendingMeshes--; scheduleFit();
          return;
        }
        onComplete(new THREE.Mesh());
        pendingMeshes--; scheduleFit();
      }catch(_e){
        onComplete(new THREE.Mesh());
        pendingMeshes--; scheduleFit();
      }
    };

    const api = { scene, camera, renderer, controls, robotModel:null, linkSet:null };

    // ---------- Pointer + hover + joint drag ----------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const hover = buildHoverAPI();

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

      // revolute/continuous
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

      raycaster.setFromCamera(pointer, camera);
      const pickables=[]; api.robotModel.traverse(o=>{ if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay && o.visible) pickables.push(o); });
      const hits = raycaster.intersectObjects(pickables, true);

      hover.clear();
      if (hits.length){
        const meshHit = hits[0].object;
        const link = findAncestorLink(meshHit, api.linkSet);
        const joint = findAncestorJoint(meshHit);
        if (selectMode==='link' && link) hover.showLink(link); else hover.showMesh(meshHit);
        renderer.domElement.style.cursor = (joint && isMovable(joint)) ? 'grab' : 'auto';
      } else {
        renderer.domElement.style.cursor='auto';
      }
    }, {passive:true});

    renderer.domElement.addEventListener('pointerdown', (e)=>{
      e.preventDefault();
      if (!api.robotModel || e.button!==0) return;
      raycaster.setFromCamera(pointer, camera);
      const pickables=[]; api.robotModel.traverse(o=>{ if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay && o.visible) pickables.push(o); });
      const hits = raycaster.intersectObjects(pickables, true);
      if (!hits.length) return;
      const joint = findAncestorJoint(hits[0].object);
      if (joint && isMovable(joint)) startJointDrag(joint, e);
    }, {passive:false});
    renderer.domElement.addEventListener('pointerup', endJointDrag);
    renderer.domElement.addEventListener('pointerleave', endJointDrag);
    renderer.domElement.addEventListener('pointercancel', endJointDrag);

    // ---------------- RenderTarget-based thumbnail rig (ONE renderer) ----------------
    // Will be (re)built after robot is loaded:
    let rt = null; // THREE.WebGLRenderTarget
    const RT_W = isMobile ? 320 : 640;
    const RT_H = isMobile ? 240 : 480;

    // Copy pixels from the current RenderTarget into a 2D canvas URL
    function readRTToDataURL(){
      const gl = renderer.getContext();
      const pixels = new Uint8Array(RT_W * RT_H * 4);
      gl.readPixels(0, 0, RT_W, RT_H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const c2d = document.createElement('canvas');
      c2d.width = RT_W; c2d.height = RT_H;
      const ctx = c2d.getContext('2d');
      const imgData = new ImageData(new Uint8ClampedArray(pixels), RT_W, RT_H);
      // Flip Y (WebGL is bottom-up)
      const row = RT_W * 4, h = RT_H, data = imgData.data;
      const flipped = new Uint8ClampedArray(data.length);
      for (let y=0; y<h; y++){
        flipped.set(data.subarray(y*row, y*row+row), (h-1-y)*row);
      }
      ctx.putImageData(new ImageData(flipped, RT_W, RT_H), 0, 0);
      return c2d.toDataURL('image/png');
    }

    async function snapshotAssetOffscreen(assetKey){
      if (!api.robotModel || !rt) return null;

      // Save vis + camera
      const vis = [];
      api.robotModel.traverse(o=>{
        if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay) { vis.push([o, o.visible]); o.visible = false; }
      });

      const meshes = assetToMeshes.get(assetKey) || [];
      for (const m of meshes) m.visible = true;

      // Frame the group
      const box = computeUnionBox(meshes);
      if (!box){ vis.forEach(([o,v])=>o.visible=v); return null; }
      const center = box.getCenter(new THREE.Vector3());
      const size   = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x,size.y,size.z)||1;
      const dist   = maxDim * 2.0;
      camera.near = Math.max(maxDim/1000,0.001);
      camera.far  = Math.max(maxDim*500,500);
      camera.updateProjectionMatrix();
      const az = Math.PI*0.25, el = Math.PI*0.18;
      const dir = new THREE.Vector3(
        Math.cos(el)*Math.cos(az),
        Math.sin(el),
        Math.cos(el)*Math.sin(az)
      ).multiplyScalar(dist);
      const oldPos = camera.position.clone(), oldTarget = controls.target.clone(), oldBg = scene.background;
      camera.position.copy(center.clone().add(dir));
      camera.lookAt(center);

      // Render to target with white bg
      scene.background = new THREE.Color(0xffffff);
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      const url = readRTToDataURL();

      // Restore
      renderer.setRenderTarget(prevTarget);
      scene.background = oldBg;
      camera.position.copy(oldPos);
      controls.target.copy(oldTarget); controls.update();
      vis.forEach(([o,v])=>o.visible=v);

      return url;
    }
    // ---------------- end RT rig ----------------

    // ---------- UI helpers ----------
    function showAllAndFrame(){
      if (!api.robotModel) return;
      api.robotModel.traverse(o=>{
        if (o.isMesh && o.geometry) o.visible = true;
      });
      fitAndCenter(camera, controls, api.robotModel, 1.05);
    }

    function isolateAssetOnScreen(assetKey){
      const meshes = assetToMeshes.get(assetKey) || [];
      // Hide ALL
      api.robotModel.traverse(o=>{
        if (o.isMesh && o.geometry) o.visible = false;
      });
      // Show ONLY that asset's meshes
      for (const m of meshes) m.visible = true;

      // Frame
      const box = computeUnionBox(meshes);
      if (box){
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x,size.y,size.z)||1;
        const dist   = maxDim * 1.9;
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

    // ---------- UI: bottom-left toggle + right panel ----------
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

      // Bottom-left toggle button
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

      // Panel
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

    // Build PER-FILE gallery (one item per assetKey that produced meshes)
    async function buildGallery(listEl){
      listEl.innerHTML = '';

      // Collect entries
      const entries = [];
      assetToMeshes.forEach((meshes, assetKey)=>{
        if (!meshes || !meshes.length) return;
        const base = basenameNoExt(assetKey);
        const ext = extOf(assetKey);
        if (!ALLOWED_EXTS.has(ext)) return;
        entries.push({ assetKey, base, ext, meshes });
      });

      entries.sort((a,b)=> a.base.localeCompare(b.base, undefined, {numeric:true, sensitivity:'base'}));

      if (!entries.length){
        listEl.textContent = 'No components with visual geometry found.'; return;
      }

      // Throttle thumb generation to avoid spikes on mobile
      let delay = 0;

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

        row.addEventListener('click', ()=>{
          isolateAssetOnScreen(ent.assetKey);
        });

        // Lazy thumbnail generation
        setTimeout(async ()=>{
          try{
            const url = await snapshotAssetOffscreen(ent.assetKey);
            if (url) img.src = url;
          }catch(_e){}
        }, delay);
        delay += isMobile ? 120 : 50;
      }
    }
    // ---------- end UI ----------

    // Public state holder
    state = { scene, camera, renderer, controls, api, onResize, raf:null, ui:null, rt:null };

    // Load URDF
    function loadURDF(urdfText){
      // reset scene + maps
      if (api.robotModel){
        disposeObject3D(api.robotModel);
        scene.remove(api.robotModel);
        api.robotModel=null;
      }
      assetToMeshes.clear();

      try{
        const robot = urdfLoader.parse(urdfText||'');
        if (robot?.isObject3D){
          api.robotModel=robot; scene.add(api.robotModel);
          rectifyUpForward(api.robotModel);
          api.linkSet = markLinksAndJoints(api.robotModel);
          setTimeout(()=>fitAndCenter(camera, controls, api.robotModel), 50);

          // (Re)build RenderTarget for thumbnails
          if (state.rt){ try{ state.rt.dispose(); }catch(_){} }
          state.rt = new THREE.WebGLRenderTarget(RT_W, RT_H, { samples: 0 });
          rt = state.rt;
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
