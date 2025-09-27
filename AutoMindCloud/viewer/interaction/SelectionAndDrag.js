// /viewer/interaction/SelectionAndDrag.js
// Hover + selection + joint dragging + 'i' isolate/restore
/* global THREE */

const HOVER_COLOR = 0x0ea5a6;
const HOVER_OPACITY = 0.28;

function isMovable(j) {
  const t = (j?.jointType || '').toString().toLowerCase();
  return !!t && t !== 'fixed';
}
function isPrismatic(j) {
  return (j?.jointType || '').toString().toLowerCase() === 'prismatic';
}
function getJointValue(j) {
  return isPrismatic(j) ? (typeof j.position === 'number' ? j.position : 0)
                        : (typeof j.angle === 'number' ? j.angle : 0);
}
function setJointValue(robot, j, v) {
  if (!j) return;
  const t = (j.jointType || '').toString().toLowerCase();
  const lim = j.limit || {};
  if (t !== 'continuous') {
    if (typeof lim.lower === 'number') v = Math.max(v, lim.lower);
    if (typeof lim.upper === 'number') v = Math.min(v, lim.upper);
  }
  if (typeof j.setJointValue === 'function') j.setJointValue(v);
  else if (robot && j.name) robot.setJointValue(j.name, v);
  robot?.updateMatrixWorld(true);
}

function computeUnionBox(meshes) {
  const box = new THREE.Box3();
  let has = false;
  const tmp = new THREE.Box3();
  for (const m of meshes || []) {
    if (!m) continue;
    tmp.setFromObject(m);
    if (!has) { box.copy(tmp); has = true; }
    else box.union(tmp);
  }
  return has ? box : null;
}

function collectMeshesInLink(linkObj) {
  const t = [], stack = [linkObj];
  while (stack.length) {
    const n = stack.pop(); if (!n) continue;
    if (n.isMesh && n.geometry && !n.userData.__isHoverOverlay) t.push(n);
    const kids = n.children ? n.children.slice() : [];
    for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
  }
  return t;
}

function buildHoverOverlay({ color = HOVER_COLOR, opacity = HOVER_OPACITY } = {}) {
  const overlays = [];
  function clear() {
    for (const o of overlays) { if (o?.parent) o.parent.remove(o); }
    overlays.length = 0;
  }
  function overlayFor(mesh) {
    if (!mesh || !mesh.isMesh || !mesh.geometry) return null;
    const m = new THREE.Mesh(
      mesh.geometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: 1
      })
    );
    m.renderOrder = 999; m.userData.__isHoverOverlay = true; return m;
  }
  function showMesh(mesh) {
    const ov = overlayFor(mesh);
    if (ov) { mesh.add(ov); overlays.push(ov); }
  }
  function showLink(link) {
    const arr = collectMeshesInLink(link);
    for (const m of arr) {
      const ov = overlayFor(m);
      if (ov) { m.add(ov); overlays.push(ov); }
    }
  }
  return { clear, showMesh, showLink };
}

function findAncestorJoint(o) {
  while (o) {
    if (o.jointType && isMovable(o)) return o;
    if (o.userData && o.userData.__joint && isMovable(o.userData.__joint)) return o.userData.__joint;
    o = o.parent;
  }
  return null;
}
function markLinksAndJoints(robot) {
  // Build a Set of link Object3Ds and propagate child-link joint references
  const linkSet = new Set(Object.values(robot.links || {}));
  const joints = Object.values(robot.joints || {});
  const linkBy = robot.links || {};
  joints.forEach(j => {
    try {
      j.userData.__isURDFJoint = true;
      let childLinkObj = j.child && j.child.isObject3D ? j.child : null;
      const childName =
        (typeof j.childLink === 'string' && j.childLink) ||
        (j.child && typeof j.child.name === 'string' && j.child.name) ||
        (typeof j.child === 'string' && j.child) ||
        (typeof j.child_link === 'string' && j.child_link) || null;
      if (!childLinkObj && childName && linkBy[childName]) childLinkObj = linkBy[childName];
      if (!childLinkObj && childName && j.children && j.children.length) {
        const stack = j.children.slice();
        while (stack.length) {
          const n = stack.pop(); if (!n) continue;
          if (n.name === childName) { childLinkObj = n; break; }
          const kids = n.children ? n.children.slice() : [];
          for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
        }
      }
      if (childLinkObj && isMovable(j)) childLinkObj.userData.__joint = j;
    } catch (_) {}
  });
  return linkSet;
}
function findAncestorLink(o, linkSet) {
  while (o) {
    if (linkSet && linkSet.has(o)) return o;
    o = o.parent;
  }
  return null;
}

export function attachInteraction({
  scene,
  camera,
  renderer,
  controls,
  robot,
  selectMode = 'link' // 'link'|'mesh'
}) {
  if (!scene || !camera || !renderer || !controls)
    throw new Error('[SelectionAndDrag] Missing required core objects');

  // Current robot & link set
  let robotModel = robot || null;
  let linkSet = robotModel ? markLinksAndJoints(robotModel) : new Set();

  // Ray + pointer
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // Hover overlay
  const hover = buildHoverOverlay();
  let lastHoverKey = null;

  // Selection
  let selectedMeshes = [];
  let selectionHelper = null;
  function ensureSelectionHelper() {
    if (!selectionHelper) {
      const box = new THREE.Box3(
        new THREE.Vector3(-0.5, -0.5, -0.5),
        new THREE.Vector3(0.5, 0.5, 0.5)
      );
      selectionHelper = new THREE.Box3Helper(box, new THREE.Color(HOVER_COLOR));
      selectionHelper.visible = false;
      selectionHelper.renderOrder = 10001;
      scene.add(selectionHelper);
    }
    return selectionHelper;
  }
  function refreshSelectionMarker() {
    ensureSelectionHelper();
    if (!robotModel || !selectedMeshes.length) {
      selectionHelper.visible = false; return;
    }
    const box = computeUnionBox(selectedMeshes);
    if (!box) { selectionHelper.visible = false; return; }
    selectionHelper.box.copy(box);
    selectionHelper.updateMatrixWorld(true);
    selectionHelper.visible = true;
  }
  function setSelectedMeshes(meshes) {
    selectedMeshes = (meshes || []).filter(Boolean);
    refreshSelectionMarker();
  }
  function selectFromHit(meshHit) {
    if (!meshHit) { setSelectedMeshes([]); return; }
    if (selectMode === 'link') {
      const link = findAncestorLink(meshHit, linkSet);
      const meshes = link ? collectMeshesInLink(link) : [meshHit];
      setSelectedMeshes(meshes);
    } else {
      setSelectedMeshes([meshHit]);
    }
  }

  // Joint dragging
  let dragState = null;
  const ROT_PER_PIXEL = 0.01, PRISM_PER_PIXEL = 0.003;

  function getPointerFromEvent(e) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  function startJointDrag(joint, ev) {
    const originW = joint.getWorldPosition(new THREE.Vector3());
    const qWorld = joint.getWorldQuaternion(new THREE.Quaternion());
    const axisW = (joint.axis || new THREE.Vector3(1, 0, 0)).clone().normalize().applyQuaternion(qWorld).normalize();
    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisW.clone(), originW);

    raycaster.setFromCamera(pointer, camera);
    const p0 = new THREE.Vector3();
    let r0 = null;
    if (raycaster.ray.intersectPlane(dragPlane, p0)) {
      r0 = p0.clone().sub(originW);
      if (r0.lengthSq() > 1e-12) r0.normalize(); else r0 = null;
    }

    dragState = {
      joint, originW, axisW, dragPlane, r0,
      value: getJointValue(joint),
      lastClientX: ev.clientX, lastClientY: ev.clientY
    };
    controls.enabled = false;
    renderer.domElement.style.cursor = 'grabbing';
    renderer.domElement.setPointerCapture?.(ev.pointerId);
  }

  function updateJointDrag(ev) {
    const ds = dragState; if (!ds) return;
    const fine = ev.shiftKey ? 0.35 : 1.0;
    getPointerFromEvent(ev); raycaster.setFromCamera(pointer, camera);

    const dX = (ev.clientX - (ds.lastClientX ?? ev.clientX));
    const dY = (ev.clientY - (ds.lastClientY ?? ev.clientY));
    ds.lastClientX = ev.clientX; ds.lastClientY = ev.clientY;

    if (isPrismatic(ds.joint)) {
      const hit = new THREE.Vector3(); let delta = 0;
      if (raycaster.ray.intersectPlane(ds.dragPlane, hit)) {
        const t1 = hit.clone().sub(ds.originW).dot(ds.axisW);
        delta = (t1 - (ds.lastT ?? t1)); ds.lastT = t1;
      } else {
        delta = -(dY * PRISM_PER_PIXEL);
      }
      ds.value += delta * fine; setJointValue(robotModel, ds.joint, ds.value); refreshSelectionMarker(); return;
    }

    // revolute
    let applied = false; const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(ds.dragPlane, hit)) {
      let r1 = hit.clone().sub(ds.originW);
      if (r1.lengthSq() >= 1e-12) {
        r1.normalize(); if (!ds.r0) ds.r0 = r1.clone();
        const cross = new THREE.Vector3().crossVectors(ds.r0, r1);
        const dot = THREE.MathUtils.clamp(ds.r0.dot(r1), -1, 1);
        const sign = Math.sign(ds.axisW.dot(cross)) || 1;
        const delta = Math.atan2(cross.length(), dot) * sign;
        ds.value += (delta * fine); ds.r0 = r1;
        setJointValue(robotModel, ds.joint, ds.value); applied = true; refreshSelectionMarker();
      }
    }
    if (!applied) {
      const delta = (dX * ROT_PER_PIXEL) * fine;
      ds.value += delta; setJointValue(robotModel, ds.joint, ds.value); refreshSelectionMarker();
    }
  }

  function endJointDrag(ev) {
    if (dragState) { renderer.domElement.releasePointerCapture?.(ev.pointerId); }
    dragState = null; controls.enabled = true; renderer.domElement.style.cursor = 'auto';
  }

  // Hover processing (throttled via RAF)
  let hoverRafPending = false, lastMoveEvt = null;
  function scheduleHover() {
    if (hoverRafPending) return;
    hoverRafPending = true;
    requestAnimationFrame(() => {
      hoverRafPending = false;
      if (!lastMoveEvt) return;
      processHover(lastMoveEvt);
    });
  }
  function hoverKeyFor(meshHit) {
    if (!meshHit) return null;
    if (selectMode === 'link') {
      const link = findAncestorLink(meshHit, linkSet);
      return link ? ('link#' + link.id) : ('mesh#' + meshHit.id);
    }
    return 'mesh#' + meshHit.id;
  }
  function processHover(e) {
    if (!robotModel) {
      hover.clear();
      renderer.domElement.style.cursor = 'auto';
      return;
    }
    getPointerFromEvent(e);
    if (dragState) { updateJointDrag(e); return; }

    raycaster.setFromCamera(pointer, camera);
    const pickables = [];
    robotModel.traverse(o => { if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay && o.visible) pickables.push(o); });
    const hits = raycaster.intersectObjects(pickables, true);

    let newKey = null;
    let meshHit = null;
    if (hits.length) {
      meshHit = hits[0].object;
      newKey = hoverKeyFor(meshHit);
    }

    if (newKey !== lastHoverKey) {
      hover.clear();
      if (newKey && meshHit) {
        if (selectMode === 'link') {
          const link = findAncestorLink(meshHit, linkSet);
          if (link) hover.showLink(link); else hover.showMesh(meshHit);
        } else hover.showMesh(meshHit);
      }
      lastHoverKey = newKey;
    }

    const joint = meshHit ? findAncestorJoint(meshHit) : null;
    renderer.domElement.style.cursor = (joint && isMovable(joint)) ? 'grab' : 'auto';
  }

  // Isolation (key 'i')
  const ray = new THREE.Raycaster();
  const centerPointer = new THREE.Vector2(0, 0);
  let allMeshes = [];
  function rebuildMeshCache() {
    allMeshes.length = 0;
    robotModel?.traverse(o => { if (o.isMesh && o.geometry) allMeshes.push(o); });
  }
  rebuildMeshCache();

  let lastHoverMesh = null, isolating = false, isolatedRoot = null;
  let savedPos = null, savedTarget = null;

  function centerPick() {
    if (!robotModel) return null;
    ray.setFromCamera(centerPointer, camera);
    const hits = ray.intersectObjects(allMeshes, true);
    return hits.length ? hits[0].object : null;
  }
  function getLinkRoot(mesh) {
    if (!mesh) return null; let n = mesh;
    while (n && n !== robotModel) { if ((n.children || []).some(ch => ch.isMesh)) return n; n = n.parent; }
    return mesh || robotModel;
  }
  function bulkSetVisible(v) {
    if (!allMeshes.length) rebuildMeshCache();
    for (let i = 0; i < allMeshes.length; i++) allMeshes[i].visible = v;
  }
  function setVisibleSubtree(root, v) {
    root?.traverse(o => { if (o.isMesh) o.visible = v; });
  }

  function isolateCurrent() {
    const target = getLinkRoot(lastHoverMesh || centerPick());
    if (!target) return false;

    if (!isolating) {
      savedPos = camera.position.clone();
      savedTarget = controls.target.clone();
    }

    bulkSetVisible(false);
    setVisibleSubtree(target, true);

    // Quick frame (no custom tween here; delegate to upper UI tween if needed)
    const box = new THREE.Box3().setFromObject(target);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(s.x, s.y, s.z) || 1;
    if (camera.isPerspectiveCamera) {
      const fov = (camera.fov || 60) * Math.PI / 180;
      const dist = maxDim / Math.tan(Math.max(1e-6, fov / 2));
      camera.position.copy(c.clone().add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(dist)));
    } else {
      camera.left = -maxDim; camera.right = maxDim; camera.top = maxDim; camera.bottom = -maxDim;
      camera.near = Math.max(maxDim / 1000, 0.001); camera.far = Math.max(maxDim * 1500, 1500);
      camera.updateProjectionMatrix();
      camera.position.copy(c.clone().add(new THREE.Vector3(maxDim, maxDim * 0.9, maxDim)));
    }
    controls.target.copy(c); controls.update();

    isolating = true; isolatedRoot = target;
    return true;
  }

  function restoreAll() {
    bulkSetVisible(true);
    if (savedPos && savedTarget) {
      camera.position.copy(savedPos);
      controls.target.copy(savedTarget);
      controls.update();
    }
    isolating = false; isolatedRoot = null;
  }

  // Events
  function onPointerMove(e) {
    lastMoveEvt = e;
    // track last hover mesh for isolation
    // (reuse raycaster path – separate quick pass for cursor pos)
    try {
      getPointerFromEvent(e);
      raycaster.setFromCamera(pointer, camera);
      const pickables = [];
      robotModel?.traverse(o => { if (o.isMesh && o.geometry && o.visible) pickables.push(o); });
      const hits = raycaster.intersectObjects(pickables, true);
      lastHoverMesh = hits.length ? hits[0].object : null;
    } catch (_) {}
    scheduleHover();
  }

  function onPointerDown(e) {
    if (!robotModel || e.button !== 0) return;
    getPointerFromEvent(e);
    raycaster.setFromCamera(pointer, camera);

    const pickables = [];
    robotModel.traverse(o => { if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay && o.visible) pickables.push(o); });
    const hits = raycaster.intersectObjects(pickables, true);

    if (!hits.length) {
      // Clicked empty space → clear selection
      setSelectedMeshes([]);
      return;
    }

    const meshHit = hits[0].object;
    selectFromHit(meshHit);

    // Start drag if joint present
    const joint = findAncestorJoint(meshHit);
    if (joint && isMovable(joint)) startJointDrag(joint, e);
  }

  // Keyboard 'i' to isolate/restore (listen on canvas + container owner)
  function onKeyDown(e) {
    const k = (e.key || '').toLowerCase();
    if (k === 'i') {
      e.preventDefault();
      if (isolating) restoreAll();
      else isolateCurrent();
    }
  }

  renderer.domElement.addEventListener('pointermove', onPointerMove, { passive: true });
  renderer.domElement.addEventListener('pointerdown', onPointerDown, { passive: false });
  renderer.domElement.addEventListener('pointerup', endJointDrag);
  renderer.domElement.addEventListener('pointerleave', endJointDrag);
  renderer.domElement.addEventListener('pointercancel', endJointDrag);
  renderer.domElement.addEventListener('keydown', onKeyDown, true);
  // try also the document (useful if canvas doesn't keep focus)
  document.addEventListener('keydown', onKeyDown, true);

  function setRobot(newRobot) {
    robotModel = newRobot || null;
    linkSet = robotModel ? markLinksAndJoints(robotModel) : new Set();
    setSelectedMeshes([]);
    rebuildMeshCache();
  }
  function setSelectMode(mode) {
    selectMode = (mode === 'mesh') ? 'mesh' : 'link';
    refreshSelectionMarker();
  }
  function clearSelection() {
    setSelectedMeshes([]);
  }

  function destroy() {
    try {
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', endJointDrag);
      renderer.domElement.removeEventListener('pointerleave', endJointDrag);
      renderer.domElement.removeEventListener('pointercancel', endJointDrag);
      renderer.domElement.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    } catch (_) {}
    try { hover.clear(); } catch (_) {}
    try { if (selectionHelper) scene.remove(selectionHelper); } catch (_) {}
  }

  return {
    setRobot,
    setSelectMode,
    clearSelection,
    selectFromHit,
    isolateCurrent,
    restoreAll,
    destroy
  };
}

// --- Injected from .py (behavior kept identical): Fixed-distance views + isolation by dock selection ---
export function installFixedDistanceAndIsolation(app){
  function easeInOutCubic(t){ return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; }
  function dirFromAzEl(az, el){ return new THREE.Vector3(Math.cos(el)*Math.cos(az), Math.sin(el), Math.cos(el)*Math.sin(az)).normalize(); }
  function currentAzEl(cam, target){ const v=cam.position.clone().sub(target); const len=Math.max(1e-9, v.length()); return { el: Math.asin(v.y/len), az: Math.atan2(v.z, v.x), r: len }; }
  function tweenOrbits(cam,ctrl,toPos,toTarget=null,ms=700){
    const p0=cam.position.clone(), t0=ctrl.target.clone(), tStart=performance.now(); ctrl.enabled=false; cam.up.set(0,1,0);
    const moveTarget = (toTarget!==null);
    function step(t){ const u=Math.min(1,(t-tStart)/ms), e=easeInOutCubic(u);
      cam.position.set(p0.x+(toPos.x-p0.x)*e, p0.y+(toPos.y-p0.y)*e, p0.z+(toPos.z-p0.z)*e);
      if(moveTarget) ctrl.target.set(t0.x+(toTarget.x-t0.x)*e, t0.y+(toTarget.y-t0.y)*e, t0.z+(toTarget.z-t0.z)*e);
      ctrl.update(); app.renderer.render(app.scene, cam);
      if(u<1) requestAnimationFrame(step); else ctrl.enabled=true; }
    requestAnimationFrame(step);
  }

  let FIXED_DISTANCE = null;
  const INIT = app.__INIT || { az: Math.PI*0.25, el: Math.PI*0.138, topEps:1e-3 };

  function calculateFixedDistance(robot){
    const box = new THREE.Box3().setFromObject(robot);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (app.camera.fov || 60) * Math.PI / 180;
    FIXED_DISTANCE = (maxDim * 0.8) / Math.tan(fov / 2);
    return FIXED_DISTANCE;
  }

  function navigateToViewFixedDistance(viewType, ms=700){
    const cam = app.camera, ctrl = app.controls;
    const box = new THREE.Box3().setFromObject(app.robot);
    const center = box.getCenter(new THREE.Vector3());
    if (!FIXED_DISTANCE) calculateFixedDistance(app.robot);

    let targetAz, targetEl;
    switch(String(viewType||'').toLowerCase()){
      case 'iso': targetAz = INIT.az; targetEl = INIT.el; break;
      case 'top': targetAz = 0; targetEl = Math.PI/2 - INIT.topEps; break;
      case 'front': targetAz = Math.PI/2; targetEl = 0; break;
      case 'right': targetAz = 0; targetEl = 0; break;
      default: targetAz = INIT.az; targetEl = INIT.el;
    }

    const direction = dirFromAzEl(targetAz, targetEl);
    const targetPos = center.clone().add(direction.multiplyScalar(FIXED_DISTANCE));
    tweenOrbits(cam, ctrl, targetPos, center, ms);
  }

  let isolating = false;
  let originalCameraState = null;
  let isolatedComponent = null;
  let allMeshes = [];

  function buildMeshCache(){
    allMeshes = [];
    app.robot.traverse(o => { if(o.isMesh && o.geometry) allMeshes.push(o); });
  }

  function getSelectedComponent(){
    const selectedRows = document.querySelectorAll('.viewer-dock-fix tr.selected, .viewer-dock-fix tr[style*="background"]');
    if(selectedRows.length === 0) return null;
    const row = selectedRows[0];
    const linkName = row.cells[0]?.textContent?.trim();
    if(!linkName) return null;
    let targetComponent = null;
    app.robot.traverse(obj => { if(obj.name === linkName || obj.userData.linkName === linkName){ targetComponent = obj; } });
    return targetComponent;
  }

  function bulkSetVisible(visible){
    if(!allMeshes.length) buildMeshCache();
    for(let i=0; i<allMeshes.length; i++) allMeshes[i].visible = visible;
  }

  function setVisibleSubtree(root, visible){ root.traverse(o => { if(o.isMesh) o.visible = visible; }); }

  function frameObjectAnimatedSmooth(obj, pad=1.2, ms=700){
    const cam = app.camera, ctrl = app.controls;
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (cam.fov || 60) * Math.PI / 180;
    const distance = (maxDim * pad) / Math.tan(fov / 2);
    const v=cam.position.clone().sub(ctrl.target.clone()); const dir=v.lengthSq()>1e-12?v.clone().normalize():new THREE.Vector3(1,0.7,1).normalize();
    const targetPos = center.clone().add(dir.multiplyScalar(distance));
    (function tween(){ tweenOrbits(cam, ctrl, targetPos, center, ms); })();
  }

  function isolateSelectedComponent(){
    if(isolating) return restoreView();
    const selectedComp = getSelectedComponent();
    if(!selectedComp){ console.log('No hay componente seleccionado'); return; }

    originalCameraState = { position: app.camera.position.clone(), target: app.controls.target.clone() };
    bulkSetVisible(false);
    setVisibleSubtree(selectedComp, true);
    frameObjectAnimatedSmooth(selectedComp, 1.3, 800);
    isolating = true;
    isolatedComponent = selectedComp;
  }

  function restoreView(){
    if(!isolating || !originalCameraState) return;
    bulkSetVisible(true);
    const cam=app.camera, ctrl=app.controls;
    const pos=originalCameraState.position, tgt=originalCameraState.target;
    originalCameraState=null; isolating=false; isolatedComponent=null;
    (function tween(){ // same tween back
      const p0=cam.position.clone(), t0=ctrl.target.clone(); const tStart=performance.now();
      function ease(t){ return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; }
      ctrl.enabled=false;
      (function step(ts){ const u=Math.min(1,(ts-tStart)/800), e=ease(u);
        cam.position.set(p0.x+(pos.x-p0.x)*e, p0.y+(pos.y-p0.y)*e, p0.z+(pos.z-p0.z)*e);
        ctrl.target.set(t0.x+(tgt.x-t0.x)*e, t0.y+(tgt.y-t0.y)*e, t0.z+(tgt.z-t0.z)*e);
        ctrl.update(); if(u<1) requestAnimationFrame(step); else ctrl.enabled=true; })(performance.now());
    })();
  }

  // expose on app (used by other modules)
  app.calculateFixedDistance = calculateFixedDistance;
  app.navigateToViewFixedDistance = navigateToViewFixedDistance;
  app.isolateSelectedComponent = isolateSelectedComponent;
  app.restoreView = restoreView;

  // init like the original .py
  setTimeout(()=>{ if(app.robot){ try{ calculateFixedDistance(app.robot); navigateToViewFixedDistance('iso', 650); }catch(_){ } } }, 260);
}
