/* urdf_viewer.js - UMD-lite: exposes window.URDFViewer; button centered over render */
(function (root) {
  'use strict';

  const URDFViewer = {};
  let state = null;

  // ---------- Helpers for assets/paths ----------
  function normKey(s){ return String(s||'').replace(/\\/g,'/').toLowerCase(); }
  function variantsFor(path){
    const out = new Set(), p = normKey(path);
    out.add(p); out.add(p.replace(/^package:\/\//,''));
    const bn = p.split('/').pop();
    out.add(bn); out.add(bn.split('?')[0].split('#')[0]);
    const parts = p.split('/'); for (let i=1;i<parts.length;i++) out.add(parts.slice(i).join('/'));
    return Array.from(out);
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

  function fitAndCenter(camera, controls, object){
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
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

  // ---------- Public API: destroy ----------
  URDFViewer.destroy = function(){
    try{ cancelAnimationFrame(state?.raf); }catch(_){}
    try{ window.removeEventListener('resize', state?.onResize); }catch(_){}
    try{ const el = state?.renderer?.domElement; el && el.parentNode && el.parentNode.removeChild(el); }catch(_){}
    try{ state?.renderer?.dispose?.(); }catch(_){}
    try{
      state?.ui?.root && state.ui.root.remove();
      state?.ui?.btn && state.ui.btn.remove();
    }catch(_){}
    state=null;
  };

  /**
   * Renderiza un URDF embebido.
   * opts = {
   *   container: HTMLElement (opcional, default document.body),
   *   urdfContent: string,
   *   meshDB: { key -> base64 },
   *   selectMode: 'link'|'mesh' (default 'link'),
   *   background: number (hex) o null,
   *   descriptions: { [linkName]: string }  // optional per-component text
   * }
   */
  URDFViewer.render = function(opts){
    if (state) URDFViewer.destroy();

    const container = opts?.container || document.body;
    // ensure container can host absolutely-positioned UI
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    const selectMode = (opts && opts.selectMode) || 'link';
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
    const MIME = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', stl:'model/stl', dae:'model/vnd.collada+xml' };
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
      const tries = variantsFor(path);
      let keyFound=null;
      for (const k of tries){ const kk=normKey(k); if (meshDB[kk]){ keyFound=kk; break; } }
      if (!keyFound){ onComplete(new THREE.Mesh()); return; }
      pendingMeshes++;
      const done=(mesh)=>{
        applyDoubleSided(mesh);
        onComplete(mesh);
        pendingMeshes--; scheduleFit();
      };
      const ext = keyFound.split('.').pop();
      try{
        if (ext==='stl'){
          const bytes=b64ToUint8(meshDB[keyFound]);
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
          if (daeCache.has(keyFound)){ done(daeCache.get(keyFound).clone(true)); return; }
          const daeText=b64ToText(meshDB[keyFound]);
          const mgr=new THREE.LoadingManager();
          mgr.setURLModifier((url)=>{
            const tries2=variantsFor(url);
            for (const k2 of tries2){
              const key2=normKey(k2);
              if (meshDB[key2]){
                const mime = MIME[key2.split('.').pop()] || 'application/octet-stream';
                return `data:${mime};base64,${meshDB[key2]}`;
              }
            }
            return url;
          });
          const loader=new THREE.ColladaLoader(mgr);
          const collada=loader.parse(daeText,'');
          const obj=collada.scene || new THREE.Object3D();
          daeCache.set(keyFound, obj);
          done(obj.clone(true));
          return;
        }
        // Fallback
        done(new THREE.Mesh());
      }catch(_e){ done(new THREE.Mesh()); }
    };

    const api = { scene, camera, renderer, controls, robotModel:null, linkSet:null };
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
      const pickables=[]; api.robotModel.traverse(o=>{ if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay) pickables.push(o); });
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
      const pickables=[]; api.robotModel.traverse(o=>{ if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay) pickables.push(o); });
      const hits = raycaster.intersectObjects(pickables, true);
      if (!hits.length) return;
      const joint = findAncestorJoint(hits[0].object);
      if (joint && isMovable(joint)) startJointDrag(joint, e);
    }, {passive:false});
    renderer.domElement.addEventListener('pointerup', endJointDrag);
    renderer.domElement.addEventListener('pointerleave', endJointDrag);
    renderer.domElement.addEventListener('pointercancel', endJointDrag);

    // Load URDF text
    function loadURDF(urdfText){
      if (api.robotModel){ scene.remove(api.robotModel); api.robotModel=null; }
      pendingMeshes=0;
      try{
        const robot = urdfLoader.parse(urdfText||'');
        if (robot?.isObject3D){
          api.robotModel=robot; scene.add(api.robotModel);
          rectifyUpForward(api.robotModel);
          api.linkSet = markLinksAndJoints(api.robotModel);
          setTimeout(()=>fitAndCenter(camera, controls, api.robotModel), 50);
        }
      } catch(_e){}
    }

    function animate(){
      state.raf = requestAnimationFrame(animate);
      controls.update(); renderer.render(scene, camera);
    }

    // ---------- UI: centered button + scrollable panel ----------
    function createUI(){
      // Root overlay anchored to container
      const root = document.createElement('div');
      Object.assign(root.style, {
        position: 'absolute',
        left: '0', top: '0',
        width: '100%', height: '100%',
        pointerEvents: 'none',
        zIndex: '9999',
        fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial'
      });

      // Centered button
      const btn = document.createElement('button');
      btn.textContent = 'Components';
      Object.assign(btn.style, {
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        padding: '12px 16px',
        borderRadius: '14px',
        border: '1px solid #d0d0d0',
        background: '#ffffff',
        boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
        fontWeight: '700',
        cursor: 'pointer',
        pointerEvents: 'auto'
      });

      // Panel (still bottom-right of the render for practicality)
      const panel = document.createElement('div');
      Object.assign(panel.style, {
        position: 'absolute',
        right: '14px',
        bottom: '14px',
        width: '360px',
        maxHeight: '65%',
        background: '#ffffff',
        border: '1px solid #e4e4e7',
        boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
        borderRadius: '16px',
        overflow: 'hidden',
        display: 'none',
        pointerEvents: 'auto'
      });

      const header = document.createElement('div');
      header.textContent = 'Components';
      Object.assign(header.style, {
        padding: '10px 14px',
        fontWeight: '800',
        borderBottom: '1px solid #eee',
        background: '#fafafa'
      });

      const list = document.createElement('div');
      Object.assign(list.style, {
        overflowY: 'auto',
        maxHeight: 'calc(65vh - 48px)',
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

      return { root, btn, panel, list };
    }

    async function buildGallery(listEl){
      listEl.innerHTML = '';
      if (!api.robotModel || !api.linkSet || api.linkSet.size===0){
        listEl.textContent = 'No components found.'; return;
      }

      function setOthersVisibility(onlyLink){
        api.robotModel.traverse(o=>{
          if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay){
            const inSelected = onlyLink && (onlyLink === findAncestorLink(o, api.linkSet));
            o.visible = !!inSelected;
          }
        });
      }

      async function snapshotLink(link){
        const vis = [];
        api.robotModel.traverse(o=>{
          if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay){ vis.push([o, o.visible]); }
        });

        setOthersVisibility(link);
        const box = new THREE.Box3().setFromObject(link);
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x,size.y,size.z) || 1;

        const prevPos = camera.position.clone();
        const prevTarget = controls.target.clone();
        const dist = maxDim * 1.8;
        camera.position.copy(center.clone().add(new THREE.Vector3(dist, dist*0.9, dist)));
        controls.target.copy(center);
        controls.update();

        renderer.render(scene, camera);
        await new Promise(r=>setTimeout(r, 0));
        renderer.render(scene, camera);

        const url = renderer.domElement.toDataURL('image/png');

        vis.forEach(([o,v])=>{ o.visible = v; });
        camera.position.copy(prevPos);
        controls.target.copy(prevTarget);
        controls.update();
        renderer.render(scene, camera);

        return url;
      }

      for (const link of api.linkSet){
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'grid',
          gridTemplateColumns: '96px 1fr',
          gap: '10px',
          alignItems: 'center',
          padding: '8px',
          borderRadius: '12px',
          border: '1px solid #f0f0f0',
          marginBottom: '10px',
          background: '#fff'
        });

        const img = document.createElement('img');
        Object.assign(img.style, {
          width: '96px',
          height: '72px',
          objectFit: 'contain',
          background: '#fafafa',
          borderRadius: '10px',
          border: '1px solid #eee'
        });
        img.alt = link.name || 'component';

        const meta = document.createElement('div');
        const title = document.createElement('div');
        title.textContent = link.name || '(unnamed link)';
        Object.assign(title.style, { fontWeight: '700', fontSize: '14px' });

        const desc = document.createElement('div');
        desc.textContent = descriptions[link.name] || 'Hello world';
        Object.assign(desc.style, { color: '#555', fontSize: '12px', marginTop: '4px' });

        meta.appendChild(title);
        meta.appendChild(desc);

        row.appendChild(img);
        row.appendChild(meta);
        listEl.appendChild(row);

        (async ()=>{
          try{
            const url = await snapshotLink(link);
            img.src = url;
          }catch(_e){ /* ignore */ }
        })();
      }
    }
    // ---------- end UI ----------

    // Public state
    state = { scene, camera, renderer, controls, api, onResize, raf:null, ui: null };

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
