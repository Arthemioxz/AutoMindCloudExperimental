/* urdf_viewer_separated.js - teal/white UI + "Autodesk-like" tools (+axes, tab toggle, stable slice plane, single-fire click audio)
   Adds:
     - Render modes: Solid / Wireframe / X-Ray / Ghost
     - Explode slider (per-link radial offset)
     - Section plane (X/Y/Z axis + distance) + stable teal plane (no grid/wire; no pulsing)
     - Camera presets: Iso / Top / Front / Right
     - Perspective <-> Orthographic toggle
     - Grid + Ground + Soft shadows (grid OFF by default)
     - Fit to view & Snapshot
     - XYZ Axes toggle (auto-sized)
     - Tools tab starts CLOSED + floating "Open/Close Tools" button
     - Optional click sound on every UI interaction (opts.clickAudioDataURL) with overlapping playback
   Keeps:
     - Hover aura (configurable)
     - Stable, throttled hover
     - Joint drag (revolute/prismatic) with limits (+Shift fine)
     - Components panel (isolate & show all), thumbnails off-screen
     - Single buttonClicked() handler wiring
*/
(function (root) {
  'use strict';

  const URDFViewer = {};
  let state = null;

  // ================
  //  Theme (Teal UI)
  // ================
  const THEME = {
    teal: '#0ea5a6',
    tealSoft: '#14b8b9',
    tealFaint: 'rgba(20,184,185,0.12)',
    bgPanel: '#ffffff',
    bgCanvas: 0xf6fafb,
    stroke: '#d7e7e7',
    text: '#0b3b3c',
    textMuted: '#577e7f',
    shadow: '0 12px 36px rgba(0,0,0,0.14)'
  };

  // =========================
  // === Utility / Helpers ===
  // =========================
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

  function fitAndCenter(camera, controls, object, pad=1.08){
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

    // keep helpers in scale/position
    sizeAxesHelper(maxDim, center);
    refreshSectionVisual(maxDim, center);
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

  // === Configurable + cached hover ===
  function buildHoverAPI({color=0x0ea5a6, opacity=0.28}={}){
    const overlays=[];
    function clear(){ for(const o of overlays){ if (o?.parent) o.parent.remove(o); } overlays.length=0; }
    function overlayFor(mesh){
      if (!mesh || !mesh.isMesh || !mesh.geometry) return null;
      const m = new THREE.Mesh(
        mesh.geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent:true,
          opacity,
          depthTest:false,
          depthWrite:false,
          polygonOffset:true,
          polygonOffsetFactor:-1,
          polygonOffsetUnits:1
        })
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

  // ============================
  // === URDFViewer.render API ===
  // ============================
  URDFViewer.render = function(opts){
    if (state) URDFViewer.destroy();

    const container = opts?.container || document.body;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    const selectMode = (opts && opts.selectMode) || 'link';
    const bg = (opts && opts.background!==undefined) ? opts.background : THEME.bgCanvas;
    const hoverCfg = Object.assign({enabled:true, color:0x0ea5a6, opacity:0.28, throttleMs:16}, (opts && opts.hover)||{});

    // Optional click audio via WebAudio (overlapping playback)
    let audioCtx = null, clickBuf = null, clickURL =
      (opts && typeof opts.clickAudioDataURL === 'string' && opts.clickAudioDataURL.startsWith('data:audio/'))
        ? opts.clickAudioDataURL
        : null;

    async function ensureClickBuffer(){
      if (!clickURL) return;
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (!clickBuf){
        const resp = await fetch(clickURL);
        const arr  = await resp.arrayBuffer();
        clickBuf   = await new Promise((res, rej)=>{
          try { audioCtx.decodeAudioData(arr, res, rej); } catch(e){ rej(e); }
        });
      }
    }
    function playClick(){
      if (!clickURL) return;
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') { audioCtx.resume(); }
      if (!clickBuf){
        ensureClickBuffer().then(()=>{
          if (clickBuf){
            const src = audioCtx.createBufferSource();
            src.buffer = clickBuf;
            src.connect(audioCtx.destination);
            try { src.start(); } catch(_){}
          }
        }).catch(()=>{});
        return;
      }
      const src = audioCtx.createBufferSource();
      src.buffer = clickBuf;
      src.connect(audioCtx.destination);
      try { src.start(); } catch(_){}
    }

    const scene = new THREE.Scene();
    if (bg!=null) scene.background = new THREE.Color(bg);

    // === Cameras: Perspective + Ortho (toggle) ===
    const aspect = Math.max(1e-6, (container.clientWidth||1)/(container.clientHeight||1));
    const persp = new THREE.PerspectiveCamera(75, aspect, 0.01, 10000);
    persp.position.set(0,0,3);
    const orthoSize = 2.5;
    const ortho = new THREE.OrthographicCamera(-orthoSize*aspect, orthoSize*aspect, orthoSize, -orthoSize, 0.01, 10000);
    ortho.position.set(0,0,3);

    let camera = persp; // default
    const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
    renderer.setPixelRatio(window.devicePixelRatio||1);
    renderer.setSize(container.clientWidth||1, container.clientHeight||1);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.position = 'relative';
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0xcfeeee, 0.7);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.05);
    dirLight.position.set(3,4,2);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024,1024);
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 1000;
    scene.add(hemi); scene.add(dirLight);

    // Ground + grid (toggled)
    const groundGroup = new THREE.Group(); scene.add(groundGroup);
    const grid = new THREE.GridHelper(10, 20, 0x84d4d4, 0xdef3f3);
    grid.visible = false; // disabled by default
    groundGroup.add(grid);
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.25 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200,200), groundMat);
    ground.rotation.x = -Math.PI/2; ground.position.y = -0.0001;
    ground.receiveShadow = true; ground.visible = true; groundGroup.add(ground);

    // XYZ Axes helper (toggle)
    const axesHelper = new THREE.AxesHelper(1);
    axesHelper.visible = false; // off by default
    scene.add(axesHelper);
    function sizeAxesHelper(maxDim, center){
      axesHelper.scale.setScalar(maxDim * 0.75);
      axesHelper.position.copy(center || new THREE.Vector3());
    }

    function onResize(){
      const w = container.clientWidth||1, h = container.clientHeight||1;
      const asp = Math.max(1e-6, w/h);
      if (camera.isPerspectiveCamera){
        camera.aspect = asp;
      } else {
        const size = orthoSize;
        camera.left = -size*asp; camera.right = size*asp;
        camera.top = size; camera.bottom = -size;
      }
      camera.updateProjectionMatrix();
      renderer.setSize(w,h);
    }

    // Loaders + meshDB
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
          rectifyUpForward(api.robotModel);
          fitAndCenter(camera, controls, api.robotModel);
        }
      },80);
    }

    urdfLoader.loadMeshCb = function(path, manager, onComplete){
      const bestKey = pickBestAsset(variantsFor(path), meshDB);
      if (!bestKey){ onComplete(new THREE.Mesh()); return; }
      const ext = extOf(bestKey);
      if (!ALLOWED_EXTS.has(ext)){ onComplete(new THREE.Mesh()); return; }

      const tagAndComplete = (obj)=>{
        obj.userData.__assetKey = bestKey;
        obj.traverse(o=>{
          if (o.isMesh && o.geometry){
            o.userData.__assetKey = bestKey;
            o.castShadow = true; o.receiveShadow = true;
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
            new THREE.MeshStandardMaterial({ color:0x7fd4d4, roughness:0.85, metalness:0.12, side:THREE.DoubleSide })
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

    // Pointer + hover + joint drag
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const hover = buildHoverAPI({color:0x0ea5a6, opacity:hoverCfg.opacity});

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

    // OFF-SCREEN snapshot rig
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

    async function snapshotAssetOffscreen(assetKey){
      const off = state.off;
      if (!off) return null;
      const meshes = off.cloneAssetToMeshes.get(assetKey) || [];
      if (!meshes.length) return null;

      const vis = [];
      off.robotClone.traverse(o=>{
        if (o.isMesh && o.geometry) vis.push([o, o.visible]);
      });

      for (const [m] of vis) m.visible = false;
      for (const m of meshes) m.visible = true;

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

      for (const [o,v] of vis) o.visible = v;

      return url;
    }

    // =========
    //   UI
    // =========
    function mkTealButton(label){
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        padding: '8px 12px',
        borderRadius: '12px',
        border: `1px solid ${THEME.stroke}`,
        background: THEME.bgPanel,
        color: THEME.text,
        fontWeight: '700',
        cursor: 'pointer',
        pointerEvents: 'auto'
      });
      // IMPORTANT: no onpointerdown here (prevents double sound)
      return b;
    }
    function mkTealToggle(label){
      const wrap = document.createElement('label');
      const cb = document.createElement('input'); cb.type='checkbox';
      const span = document.createElement('span'); span.textContent = label;
      Object.assign(wrap.style, {display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',pointerEvents:'auto'});
      cb.style.accentColor = THEME.teal;
      Object.assign(span.style,{fontWeight:'700', color: THEME.text});
      wrap.appendChild(cb); wrap.appendChild(span);
      return {wrap, cb};
    }
    function mkSlider(min,max,step,value){
      const s = document.createElement('input');
      s.type='range'; s.min=min; s.max=max; s.step=step; s.value=value;
      s.style.width='100%'; s.style.accentColor = THEME.teal;
      // no pointerdown hook
      return s;
    }
    function mkRow(label, child){
      const row = document.createElement('div');
      Object.assign(row.style, {display:'grid', gridTemplateColumns:'120px 1fr', gap:'10px', alignItems:'center', margin:'6px 0'});
      const l = document.createElement('div'); l.textContent=label; l.style.color=THEME.textMuted; l.style.fontWeight='700';
      row.appendChild(l); row.appendChild(child);
      return row;
    }
    function mkSelect(options, value){
      const sel = document.createElement('select');
      options.forEach(o=>{
        const opt = document.createElement('option');
        opt.value = o; opt.textContent = o; sel.appendChild(opt);
      });
      sel.value = value;
      Object.assign(sel.style,{padding:'8px',border:`1px solid ${THEME.stroke}`,borderRadius:'10px',pointerEvents:'auto'});
      // no pointerdown hook
      return sel;
    }

    function createUI(){
      const root = document.createElement('div');
      Object.assign(root.style, {
        position: 'absolute',
        left: '0', top: '0',
        width: '100%', height: '100%',
        pointerEvents: 'none',
        zIndex: '9999',
        fontFamily: 'Computer Modern, CMU Serif, Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial'
      });

      // === Components Panel
      const compBtn = mkTealButton('Components');
      Object.assign(compBtn.style, { position:'absolute', left:'14px', bottom:'14px', boxShadow: THEME.shadow });
      const compPanel = document.createElement('div');
      Object.assign(compPanel.style, {
        position:'absolute', right:'14px', bottom:'14px',
        width:'440px', maxHeight:'72%',
        background: THEME.bgPanel, border:`1px solid ${THEME.stroke}`,
        boxShadow: THEME.shadow, borderRadius:'18px', overflow:'hidden', display:'none', pointerEvents:'auto'
      });
      const compHeader = document.createElement('div');
      Object.assign(compHeader.style,{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px',padding:'10px 12px', borderBottom:`1px solid ${THEME.stroke}`, background: THEME.tealFaint});
      const compTitle = document.createElement('div'); compTitle.textContent='Components'; Object.assign(compTitle.style,{fontWeight:'800', color:THEME.text});
      const showAllBtn = mkTealButton('Show all'); Object.assign(showAllBtn.style,{padding:'6px 10px',borderRadius:'10px'});
      compHeader.appendChild(compTitle); compHeader.appendChild(showAllBtn);
      const compList = document.createElement('div'); Object.assign(compList.style,{overflowY:'auto', maxHeight:'calc(72vh - 52px)', padding:'10px'});
      compPanel.appendChild(compHeader); compPanel.appendChild(compList);

      // === Tools Dock (top-right)
      const dock = document.createElement('div');
      Object.assign(dock.style,{
        position:'absolute', right:'14px', top:'14px', width:'440px',
        background: THEME.bgPanel, border:`1px solid ${THEME.stroke}`,
        borderRadius:'18px', boxShadow: THEME.shadow, pointerEvents:'auto', overflow:'hidden',
        display: 'none' // start CLOSED
      });

      const dockHeader = document.createElement('div');
      Object.assign(dockHeader.style,{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px', borderBottom:`1px solid ${THEME.stroke}`, background: THEME.tealFaint});
      const title = document.createElement('div'); title.textContent='Viewer Tools'; Object.assign(title.style,{fontWeight:'800', color:THEME.text});
      const fitBtn = mkTealButton('Fit'); Object.assign(fitBtn.style,{padding:'6px 10px',borderRadius:'10px'});
      dockHeader.appendChild(title); dockHeader.appendChild(fitBtn);

      const dockBody = document.createElement('div'); dockBody.style.padding='10px 12px';

      // Render mode
      const renderMode = mkSelect(['Solid','Wireframe','X-Ray','Ghost'], 'Solid');
      dockBody.appendChild(mkRow('Render mode', renderMode));

      // Explode
      const explodeSlider = mkSlider(0, 1, 0.01, 0);
      dockBody.appendChild(mkRow('Explode', explodeSlider));

      // Section plane
      const axisSel = mkSelect(['X','Y','Z'], 'X');
      const secDist = mkSlider(-1, 1, 0.001, 0);
      const secToggle = mkTealToggle('Enable section');
      const secPlaneToggle = mkTealToggle('Show slice plane');
      dockBody.appendChild(mkRow('Section axis', axisSel));
      dockBody.appendChild(mkRow('Section dist', secDist));
      dockBody.appendChild(mkRow('', secToggle.wrap));
      dockBody.appendChild(mkRow('', secPlaneToggle.wrap));

      // Camera block
      const rowCam = document.createElement('div'); Object.assign(rowCam.style,{display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'8px', margin:'8px 0'});
      const bIso = mkTealButton('Iso'), bTop = mkTealButton('Top'), bFront= mkTealButton('Front'), bRight = mkTealButton('Right'), bSnap = mkTealButton('Snapshot');
      [bIso,bTop,bFront,bRight,bSnap].forEach(b=>{ b.style.padding='8px'; b.style.borderRadius='10px'; });
      dockBody.appendChild(mkRow('Views', rowCam));
      rowCam.appendChild(bIso); rowCam.appendChild(bTop); rowCam.appendChild(bFront); rowCam.appendChild(bRight); rowCam.appendChild(bSnap);

      // Projection + helpers
      const projSel = mkSelect(['Perspective','Orthographic'], 'Perspective');
      const togGrid = mkTealToggle('Grid');       // OFF by default
      const togGround = mkTealToggle('Ground & shadows'); togGround.cb.checked = true;
      const togAxes = mkTealToggle('XYZ axes');   // axes toggle
      togAxes.cb.checked = false;
      dockBody.appendChild(mkRow('Projection', projSel));
      dockBody.appendChild(mkRow('', togGrid.wrap));
      dockBody.appendChild(mkRow('', togGround.wrap));
      dockBody.appendChild(mkRow('', togAxes.wrap));

      // Assemble dock
      dock.appendChild(dockHeader); dock.appendChild(dockBody);

      // Floating Tools toggle button
      const toolsToggleBtn = document.createElement('button');
      toolsToggleBtn.textContent = 'Open Tools';
      Object.assign(toolsToggleBtn.style, {
        position:'absolute', right:'14px', top:'14px',
        padding:'8px 12px', borderRadius:'12px', border:`1px solid ${THEME.stroke}`,
        background: THEME.bgPanel, color: THEME.text, fontWeight:'700',
        boxShadow: THEME.shadow, pointerEvents:'auto', zIndex: '10000'
      });
      // no pointerdown hook

      // Root assembly
      root.appendChild(compPanel);
      root.appendChild(compBtn);
      root.appendChild(dock);
      root.appendChild(toolsToggleBtn);
      container.appendChild(root);

      // Initial defaults
      togGrid.cb.checked = false; // grid disabled initially

      return {
        root,
        // components
        btn: compBtn, panel: compPanel, list: compList, showAllBtn,
        // tools
        fitBtn, renderMode, explodeSlider, axisSel, secDist, secToggle, secPlaneToggle,
        bIso, bTop, bFront, bRight, bSnap,
        projSel, togGrid, togGround, togAxes,
        dock, toolsToggleBtn
      };
    }

    async function buildGallery(listEl){
      listEl.innerHTML = '';

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

      for (const ent of entries){
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'grid',
          gridTemplateColumns: '128px 1fr',
          gap: '12px',
          alignItems: 'center',
          padding: '10px',
          borderRadius: '12px',
          border: `1px solid ${THEME.stroke}`,
          marginBottom: '10px',
          background: '#fff',
          cursor: 'pointer'
        });

        const img = document.createElement('img');
        Object.assign(img.style, {
          width: '128px',
          height: '96px',
          objectFit: 'contain',
          background: '#f7fbfb',
          borderRadius: '10px',
          border: `1px solid ${THEME.stroke}`
        });
        img.alt = ent.base;

        const meta = document.createElement('div');
        const title = document.createElement('div');
        title.textContent = ent.base;
        Object.assign(title.style, { fontWeight: '700', fontSize: '14px', color:THEME.text });

        const small = document.createElement('div');
        small.textContent = `.${ent.ext} • ${ent.meshes.length} instance${ent.meshes.length>1?'s':''}`;
        Object.assign(small.style, { color: THEME.textMuted, fontSize: '12px', marginTop: '2px' });

        const desc = document.createElement('div');
        desc.textContent = (opts?.descriptions||{})[ent.base] || ' ';
        Object.assign(desc.style, { color: THEME.textMuted, fontSize: '12px', marginTop: '4px' });

        meta.appendChild(title);
        meta.appendChild(small);
        if (desc.textContent.trim()) meta.appendChild(desc);

        row.appendChild(img);
        row.appendChild(meta);

        row.dataset.assetKey = ent.assetKey;
        row.dataset.base = ent.base;
        row.dataset.ext = ent.ext;

        listEl.appendChild(row);

        (async ()=>{
          try{
            const url = await snapshotAssetOffscreen(ent.assetKey);
            if (url) img.src = url;
          }catch(_e){}
        })();
      }
    }

    function loadURDF(urdfText){
      if (api.robotModel){ scene.remove(api.robotModel); api.robotModel=null; }
      if (state.off){ try{ state.off.renderer.dispose(); }catch(_){} state.off=null; }

      try{
        const robot = urdfLoader.parse(urdfText||'');
        if (robot?.isObject3D){
          api.robotModel=robot; scene.add(api.robotModel);
          rectifyUpForward(api.robotModel);
          api.linkSet = markLinksAndJoints(api.robotModel);
          setTimeout(()=>fitAndCenter(camera, controls, api.robotModel), 50);
          state.off = buildOffscreenFromRobot();
          prepareExplodeVectors();
        }
      } catch(_e){}
    }

    // ===========
    //  Explode
    // ===========
    let explodeVecByLink = new Map();
    function prepareExplodeVectors(){
      explodeVecByLink.clear();
      if (!api.robotModel) return;

      const rootBox = new THREE.Box3().setFromObject(api.robotModel);
      const rootCenter = rootBox.getCenter(new THREE.Vector3());

      api.robotModel.traverse(o=>{
        if (o.isObject3D && o !== api.robotModel && (!o.isMesh || (o.isMesh && !o.userData.__isHoverOverlay))){
          const b = new THREE.Box3().setFromObject(o);
          if (!b.isEmpty()){
            const c = b.getCenter(new THREE.Vector3());
            const v = c.clone().sub(rootCenter);
            if (v.lengthSq() < 1e-10) v.set( (Math.random()*2-1)*0.01, (Math.random()*2-1)*0.01, (Math.random()*2-1)*0.01 );
            v.normalize();
            explodeVecByLink.set(o, v);
            o.userData.__explodeBase = o.userData.__explodeBase || o.position.clone();
          }
        }
      });
    }
    function applyExplode(f){
      if (!api.robotModel) return;
      api.robotModel.traverse(o=>{
        if (o.userData && o.userData.__explodeBase && explodeVecByLink.has(o)){
          const base = o.userData.__explodeBase;
          const dir = explodeVecByLink.get(o);
          o.position.copy( base.clone().add( dir.clone().multiplyScalar(f * 0.6) ) );
        }
      });
    }

    // ===========
    //  Section (clipping + STABLE teal plane visual)
    // ===========
    let sectionPlane = null;
    let secAxis = 'X';         // 'X' | 'Y' | 'Z'
    let secEnabled = false;
    let secPlaneVisible = false;

    // visual: translucent teal sheet (no wire/grid) — tuned to avoid pulsing
    let secVisual = null;      // THREE.Mesh for the plane

    function ensureSectionVisual(){
      if (!secVisual){
        const geom = new THREE.PlaneGeometry(1,1,1,1);
        const mat  = new THREE.MeshBasicMaterial({
          color: 0x0ea5a6,
          transparent: true,
          opacity: 0.14,
          depthWrite: false,
          depthTest: false,     // draw on top; no z-fighting
          toneMapped: false,
          side: THREE.DoubleSide
        });
        secVisual = new THREE.Mesh(geom, mat);
        secVisual.visible = false;
        secVisual.renderOrder = 10000; // very high to stay stable
        scene.add(secVisual);
      }
      return secVisual;
    }

    function refreshSectionVisual(maxDim, center){
      if (!secVisual) return;
      const size = Math.max(1e-6, maxDim || 1);
      secVisual.scale.set(size*1.2, size*1.2, 1);
      if (center) secVisual.position.copy(center);
    }

    function updateSectionPlane(){
      renderer.clippingPlanes = [];
      if (!secEnabled || !api.robotModel) {
        renderer.localClippingEnabled=false;
        if (secVisual) secVisual.visible = false;
        return;
      }
      const n = new THREE.Vector3(
        secAxis==='X'?1:0,
        secAxis==='Y'?1:0,
        secAxis==='Z'?1:0
      );
      const box = new THREE.Box3().setFromObject(api.robotModel);
      if (box.isEmpty()){ renderer.localClippingEnabled=false; if (secVisual) secVisual.visible=false; return; }
      const size   = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x,size.y,size.z)||1;
      const center = box.getCenter(new THREE.Vector3());
      const dist = (Number(state.ui.secDist.value) || 0) * maxDim * 0.5;
      const plane = new THREE.Plane(n, -center.dot(n) - dist); // n·x + d = 0
      renderer.localClippingEnabled = true;
      renderer.clippingPlanes = [ plane ];
      sectionPlane = plane;

      // orient & show the teal sheet (stable, no pulsing)
      ensureSectionVisual();
      refreshSectionVisual(maxDim, center);
      secVisual.visible = !!secPlaneVisible;

      // align to plane
      const look = new THREE.Vector3().copy(n);
      const up   = new THREE.Vector3(0,1,0);
      if (Math.abs(look.dot(up)) > 0.999) up.set(1,0,0);
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0,0,0), look, up);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      secVisual.setRotationFromQuaternion(q);
      const p0 = n.clone().multiplyScalar(-plane.constant);
      secVisual.position.copy(p0);
    }

    // ===========
    //  Render modes
    // ===========
    function setRenderMode(mode){
      if (!api.robotModel) return;
      api.robotModel.traverse(o=>{
        if (o.isMesh && o.material){
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats){
            m.wireframe = (mode==='Wireframe');
            if (mode==='X-Ray'){
              m.transparent = true;
              m.opacity = 0.35;
              m.depthWrite = false;
              m.depthTest = true;
            } else if (mode==='Ghost'){
              m.transparent = true;
              m.opacity = 0.70;
              m.depthWrite = true;
              m.depthTest = true;
            } else {
              m.transparent = false;
              m.opacity = 1.0;
              m.depthWrite = true;
              m.depthTest = true;
            }
            m.needsUpdate = true;
          }
        }
      });
    }

    // ===========
    //  Views
    // ===========
    function viewIso(){
      if (!api.robotModel) return;
      const box = new THREE.Box3().setFromObject(api.robotModel);
      if (box.isEmpty()) return;
      const c = box.getCenter(new THREE.Vector3());
      const s = box.getSize(new THREE.Vector3());
      const d = Math.max(s.x,s.y,s.z) * 1.9;
      const az = Math.PI * 0.25, el = Math.PI * 0.2;
      const dir = new THREE.Vector3(Math.cos(el)*Math.cos(az), Math.sin(el), Math.cos(el)*Math.sin(az)).multiplyScalar(d);
      camera.position.copy(c.clone().add(dir)); controls.target.copy(c); controls.update();
    }
    function viewTop(){
      if (!api.robotModel) return;
      const box=new THREE.Box3().setFromObject(api.robotModel); const c=box.getCenter(new THREE.Vector3()); const s=box.getSize(new THREE.Vector3()); const d=Math.max(s.x,s.y,s.z)*1.9;
      camera.position.set(c.x, c.y + d, c.z); controls.target.copy(c); controls.update();
    }
    function viewFront(){
      if (!api.robotModel) return;
      const box=new THREE.Box3().setFromObject(api.robotModel); const c=box.getCenter(new THREE.Vector3()); const s=box.getSize(new THREE.Vector3()); const d=Math.max(s.x,s.y,s.z)*1.9;
      camera.position.set(c.x, c.y, c.z + d); controls.target.copy(c); controls.update();
    }
    function viewRight(){
      if (!api.robotModel) return;
      const box=new THREE.Box3().setFromObject(api.robotModel); const c=box.getCenter(new THREE.Vector3()); const s=box.getSize(new THREE.Vector3()); const d=Math.max(s.x,s.y,s.z)*1.9;
      camera.position.set(c.x + d, c.y, c.z); controls.target.copy(c); controls.update();
    }

    // ===========
    //  Helpers
    // ===========
    function showAllAndFrame(){
      if (!api.robotModel) return;
      api.robotModel.traverse(o=>{
        if (o.isMesh && o.geometry) o.visible = true;
      });
      fitAndCenter(camera, controls, api.robotModel, 1.05);
    }

    function isolateAssetOnScreen(assetKey){
      const meshes = assetToMeshes.get(assetKey) || [];
      api.robotModel.traverse(o=>{
        if (o.isMesh && o.geometry) o.visible = false;
      });
      for (const m of meshes) m.visible = true;

      const box = computeUnionBox(meshes);
      if (box){
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x,size.y,size.z)||1;
        if (camera.isPerspectiveCamera){
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
        } else {
          camera.left = -maxDim; camera.right = maxDim; camera.top = maxDim; camera.bottom = -maxDim;
          camera.near = Math.max(maxDim/1000,0.001); camera.far = Math.max(maxDim*1000,1000);
          camera.updateProjectionMatrix();
          camera.position.copy(center.clone().add(new THREE.Vector3(maxDim, maxDim*0.9, maxDim)));
        }
        controls.target.copy(center); controls.update();
        sizeAxesHelper(maxDim, center);
      }
    }

    // Single handler: GUI press + click sound (exactly once per user action)
    function buttonClicked(){
      try { playClick(); } catch(_){}
      try {
        if (window && window.Jupyter && window.Jupyter.notebook && window.Jupyter.notebook.kernel){
          window.Jupyter.notebook.kernel.execute("print('button clicked')");
        }
      } catch(e){}
    }

    // attach resize listener
    window.addEventListener('resize', onResize);

    // === Hover state ===
    let lastHoverKey = null;
    const hoverKeyFor = (meshHit)=>{
      if (!meshHit) return null;
      if (selectMode==='link'){
        const link = findAncestorLink(meshHit, api.linkSet);
        return link ? ('link#'+link.id) : ('mesh#'+meshHit.id);
      }
      return 'mesh#'+meshHit.id;
    };

    // throttled pointermove
    let hoverRafPending = false, lastMoveEvt=null, lastHoverTs=0;
    function scheduleHover(){
      if (hoverRafPending) return;
      hoverRafPending = true;
      requestAnimationFrame(()=>{
        hoverRafPending = false;
        if (!lastMoveEvt) return;
        processHover(lastMoveEvt);
      });
    }

    function processHover(e){
      lastHoverTs = performance.now();
      if (!api.robotModel || !hoverCfg.enabled){
        hover.clear();
        renderer.domElement.style.cursor='auto';
        return;
      }
      getPointer(e);
      if (dragState){ updateJointDrag(e); return; }

      raycaster.setFromCamera(pointer, camera);
      const pickables=[]; api.robotModel.traverse(o=>{ if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay && o.visible) pickables.push(o); });
      const hits = raycaster.intersectObjects(pickables, true);

      let newKey = null;
      let meshHit = null;
      if (hits.length){
        meshHit = hits[0].object;
        newKey = hoverKeyFor(meshHit);
      }

      if (newKey !== lastHoverKey){
        hover.clear();
        if (newKey && meshHit){
          if (selectMode==='link'){
            const link = findAncestorLink(meshHit, api.linkSet);
            if (link) hover.showLink(link); else hover.showMesh(meshHit);
          }else{
            hover.showMesh(meshHit);
          }
        }
        lastHoverKey = newKey;
      }

      const joint = meshHit ? findAncestorJoint(meshHit) : null;
      renderer.domElement.style.cursor = (joint && isMovable(joint)) ? 'grab' : 'auto';
    }

    function onPointerMove(e){
      lastMoveEvt = e;
      const now = performance.now();
      if (now - lastHoverTs >= (hoverCfg.throttleMs|0)){
        scheduleHover();
      } else {
        scheduleHover();
      }
    }

    function onPointerDown(e){
      e.preventDefault();
      if (!api.robotModel || e.button!==0) return;
      getPointer(e);
      raycaster.setFromCamera(pointer, camera);
      const pickables=[]; api.robotModel.traverse(o=>{ if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay && o.visible) pickables.push(o); });
      const hits = raycaster.intersectObjects(pickables, true);
      if (!hits.length) return;
      const joint = findAncestorJoint(hits[0].object);
      if (joint && isMovable(joint)) startJointDrag(joint, e);
    }

    renderer.domElement.addEventListener('pointermove', onPointerMove, {passive:true});
    renderer.domElement.addEventListener('pointerdown', onPointerDown, {passive:false});
    renderer.domElement.addEventListener('pointerup', endJointDrag);
    renderer.domElement.addEventListener('pointerleave', endJointDrag);
    renderer.domElement.addEventListener('pointercancel', endJointDrag);

    // Public state holder
    state = { scene, camera, renderer, controls, api, onResize, raf:null, ui:null, off:null };

    // Build UI
    state.ui = createUI();

    // ==== UI Interactions ====
    (function attachUIInteractions(){
      const { btn, panel, list, showAllBtn,
              fitBtn, renderMode, explodeSlider, axisSel, secDist, secToggle, secPlaneToggle,
              bIso, bTop, bFront, bRight, bSnap, projSel, togGrid, togGround, togAxes,
              dock, toolsToggleBtn } = state.ui;

      let builtOnce = false;

      // Tools open/close toggle button (single click handler)
      function setDock(open){
        dock.style.display = open ? 'block' : 'none';
        toolsToggleBtn.textContent = open ? 'Close Tools' : 'Open Tools';
      }
      toolsToggleBtn.addEventListener('click', ()=>{ buttonClicked(); setDock(dock.style.display==='none'); });
      setDock(false); // start CLOSED

      // Components panel (single click handler)
      btn.addEventListener('click', async ()=>{
        buttonClicked();
        if (panel.style.display === 'none'){
          panel.style.display = 'block';
          if (!builtOnce){ await buildGallery(list); builtOnce = true; }
        } else {
          panel.style.display = 'none';
        }
      });

      showAllBtn.addEventListener('click', (ev)=>{ buttonClicked(); showAllAndFrame(); });

      // Gallery row delegation
      list.addEventListener('click', (ev)=>{
        let el = ev.target;
        while (el && el !== list && !el.dataset?.assetKey) el = el.parentElement;
        if (!el || el === list) return;
        buttonClicked();
        const key = el.dataset.assetKey;
        if (key) isolateAssetOnScreen(key);
      });

      // Fit
      fitBtn.addEventListener('click', ()=>{ buttonClicked(); if (api.robotModel) fitAndCenter(camera, controls, api.robotModel, 1.06); });

      // Render mode
      renderMode.addEventListener('change', ()=>{ buttonClicked(); setRenderMode(renderMode.value); });

      // Explode
      explodeSlider.addEventListener('input', ()=>{ /* no sound on slider move */ applyExplode(Number(explodeSlider.value)); });

      // Section
      axisSel.addEventListener('change', ()=>{ buttonClicked(); secAxis = axisSel.value; updateSectionPlane(); });
      secDist.addEventListener('input', ()=>{ updateSectionPlane(); }); // continuous — no sound
      secToggle.cb.addEventListener('change', ()=>{ buttonClicked(); secEnabled = !!secToggle.cb.checked; updateSectionPlane(); });
      secPlaneToggle.cb.addEventListener('change', ()=>{ buttonClicked(); secPlaneVisible = !!secPlaneToggle.cb.checked; updateSectionPlane(); });

      // Views
      bIso.addEventListener('click', ()=>{ buttonClicked(); viewIso(); });
      bTop.addEventListener('click', ()=>{ buttonClicked(); viewTop(); });
      bFront.addEventListener('click', ()=>{ buttonClicked(); viewFront(); });
      bRight.addEventListener('click', ()=>{ buttonClicked(); viewRight(); });

      // Snapshot
      bSnap.addEventListener('click', ()=>{
        buttonClicked();
        try{
          const url = renderer.domElement.toDataURL('image/png');
          const a = document.createElement('a'); a.href=url; a.download='snapshot.png'; a.click();
        }catch(_e){}
      });

      // Projection
      projSel.addEventListener('change', ()=>{
        buttonClicked();
        const w = container.clientWidth||1, h=container.clientHeight||1, asp = Math.max(1e-6, w/h);
        if (projSel.value==='Orthographic' && camera.isPerspectiveCamera){
          const box = api.robotModel ? new THREE.Box3().setFromObject(api.robotModel) : null;
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

      // Helpers
      togGrid.cb.addEventListener('change', ()=>{ buttonClicked(); grid.visible = !!togGrid.cb.checked; });
      togGround.cb.addEventListener('change', ()=>{ buttonClicked(); ground.visible = !!togGround.cb.checked; dirLight.castShadow = !!togGround.cb.checked; });
      togAxes.cb.addEventListener('change', ()=>{
        buttonClicked();
        axesHelper.visible = !!togAxes.cb.checked;
        if (api.robotModel){
          const box = new THREE.Box3().setFromObject(api.robotModel);
          if (!box.isEmpty()){
            const c = box.getCenter(new THREE.Vector3());
            const s = box.getSize(new THREE.Vector3());
            sizeAxesHelper(Math.max(s.x,s.y,s.z)||1, c);
          }
        }
      });

    })();

    // Animate
    function animate(){
      state.raf = requestAnimationFrame(animate);
      controls.update(); renderer.render(scene, camera);
    }

    loadURDF((opts && opts.urdfContent) || '');
    animate();

    // expose minimal API
    return {
      scene, get camera(){ return camera; }, renderer, controls,
      get robot(){ return api.robotModel; },
      openGallery(){ state.ui?.btn?.click?.(); },
      openTools(open=true){ if (!state?.ui) return; const s=state.ui; const wantOpen = !!open; const isOpen = s.dock.style.display!=='none'; if (wantOpen!==isOpen) s.toolsToggleBtn.click(); }
    };
  };

  root.URDFViewer = URDFViewer;
})(typeof window!=='undefined' ? window : this);




