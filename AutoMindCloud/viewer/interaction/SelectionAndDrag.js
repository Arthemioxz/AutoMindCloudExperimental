// /viewer/interaction/SelectionAndDrag.js
// Hover + selection + joint dragging + 'i' isolate/restore
/* global THREE */

const HOVER_COLOR = 0x0ea5a6;
const HOVER_OPACITY = 0.28;

let global_target = false;

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

  console.log("2");
  
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
    console.log("6");
    //global_target = selectionHelper
    const box = new THREE.Box3(
      new THREE.Vector3(-0.5, -0.5, -0.5),
      new THREE.Vector3(0.5, 0.5, 0.5)
    );
    selectionHelper = new THREE.Box3Helper(box, new THREE.Color(HOVER_COLOR));
    selectionHelper.visible = false;
    selectionHelper.renderOrder = 10001;
    scene.add(selectionHelper);
  } else {
    //console.log("5");
    //global_target = null
  }
  return selectionHelper;
}


  
  
  function refreshSelectionMarker() {
    ensureSelectionHelper();
    if (!robotModel || !selectedMeshes.length) {
      console.log("7");
      global_target = false
      selectionHelper.visible = false; return;
    }
    const box = computeUnionBox(selectedMeshes);

    console.log("3");
    
    if (!box) { selectionHelper.visible = false
      ; return; }

    console.log("4");
    
    selectionHelper.box.copy(box);
    selectionHelper.updateMatrixWorld(true);
    selectionHelper.visible = true;
  }

function setSelectedMeshes(meshes, root = null) {
  selectedMeshes = (meshes || []).filter(Boolean);

  // If a root was provided (e.g., the link object), use it
  if (root && typeof root.traverse === 'function') {
    global_target = root;
    refreshSelectionMarker();
    return;
  }

  // Otherwise, compute a stable root: lowest common ancestor of all selected meshes
  function ancestry(n) {
    const path = [];
    while (n) { path.push(n); if (n === robotModel) break; n = n.parent; }
    return path; // nearest -> ... -> robotModel
  }
  function commonRoot(objs) {
    if (!objs.length) return null;
    let common = ancestry(objs[0]);
    for (let i = 1; i < objs.length; i++) {
      const set = new Set(ancestry(objs[i]));
      common = common.filter(n => set.has(n));
      if (!common.length) return null;
    }
    return common[0] || null; // nearest common ancestor
  }

  const computed = commonRoot(selectedMeshes) || (selectedMeshes[0] ? getLinkRoot(selectedMeshes[0]) : null);
  global_target = (computed && typeof computed.traverse === 'function') ? computed : null;

  refreshSelectionMarker();
}




 function selectFromHit(meshHit) {
  if (!meshHit) { setSelectedMeshes([]); return; }

  if (selectMode === 'link') {
    const link = findAncestorLink(meshHit, linkSet);
    const meshes = link ? collectMeshesInLink(link) : [meshHit];
    setSelectedMeshes(meshes, link || getLinkRoot(meshHit)); // <-- pass root here
  } else {
    setSelectedMeshes([meshHit], getLinkRoot(meshHit)); // <-- and here
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



























// -------- tiny tween system (no deps) --------
let _activeTweens = [];

function easeInOutCubic(t){ return t<0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; }

function tweenVec3(start, end, ms, onUpdate, onComplete, ease=easeInOutCubic){
  const s = start.clone(), e = end.clone();
  const st = performance.now();
  let stopped = false;

  function step(now){
    if (stopped) return;
    const t = Math.min(1, (now - st) / ms);
    const k = ease(t);
    const v = s.clone().lerp(e, k);
    onUpdate(v, t);
    if (t < 1) requestAnimationFrame(step);
    else { if (onComplete) onComplete(); }
  }
  const h = { stop(){ stopped = true; } };
  _activeTweens.push(h);
  requestAnimationFrame(step);
  return h;
}

function stopAllTweens(){
  _activeTweens.forEach(t => t.stop && t.stop());
  _activeTweens.length = 0;
}

// Tween camera+target together; disables orbit during animation
function tweenCameraTo(camera, controls, newPos, newTarget, ms=420){
  stopAllTweens();
  const oldEnabled = controls.enabled;
  controls.enabled = false;

  const startPos = camera.position.clone();
  const startTgt = controls.target.clone();

  // update during tween
  const upd = () => {
    camera.updateProjectionMatrix?.();
    controls.update?.();
  };

  const t1 = tweenVec3(startPos, newPos, ms, (v)=>{ camera.position.copy(v); upd(); });
  const t2 = tweenVec3(startTgt, newTarget, ms, (v)=>{ controls.target.copy(v); upd(); }, ()=>{
    controls.enabled = oldEnabled;
  });

  return [t1, t2];
}

function isolateCurrent() {
  const target = global_target || getLinkRoot(lastHoverMesh || centerPick());
  if (!target) return false;

  if (!isolating) {
    savedPos = camera.position.clone();
    savedTarget = controls.target.clone();
  }

  // preserve current orientation
  let viewDir = camera.position.clone().sub(controls.target).normalize();
  if (!isFinite(viewDir.lengthSq()) || viewDir.lengthSq() < 1e-6) {
    viewDir.set(1, 0.7, 1).normalize();
  }

  // show only the selected subtree
  bulkSetVisible(false);
  setVisibleSubtree(target, true);

  // refresh matrices & bounds
  target.updateWorldMatrix(true, true);
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(target);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const sphere = new THREE.Sphere(); box.getBoundingSphere(sphere);
  const r = Math.max(sphere.radius, 1e-6);

  // compute destination camera position (keep orientation)
  let destPos;
  if (camera.isPerspectiveCamera) {
    const vFov = THREE.MathUtils.degToRad(camera.fov || 60);
    const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * (camera.aspect || 1));
    const distV = r / Math.sin(vFov * 0.5);
    const distH = r / Math.sin(hFov * 0.5);
    const dist  = Math.max(distV, distH) * 1.05;  // padding
    destPos = center.clone().add(viewDir.clone().multiplyScalar(dist));

    // widen clip just in case during tween
    const curDist = camera.position.distanceTo(controls.target);
    const maxDist = Math.max(curDist, dist);
    camera.near = Math.max(0.01, maxDist - r * 3);
    camera.far  = Math.max(camera.near + 1, maxDist + r * 6);
    camera.updateProjectionMatrix();

  } else {
    // Ortho: adjust frustum to fit, keep direction, set a reasonable distance
    const pad = 1.10;
    const halfW = (size.x * 0.5) * pad;
    const halfH = (size.y * 0.5) * pad;

    const maxHalfW = Math.max(halfW, halfH * camera.aspect);
    const maxHalfH = Math.max(halfH, halfW / camera.aspect);

    camera.left   = -maxHalfW;
    camera.right  =  maxHalfW;
    camera.top    =  maxHalfH;
    camera.bottom = -maxHalfH;

    const dist = Math.max(size.length(), r) * 1.2;
    destPos = center.clone().add(viewDir.clone().multiplyScalar(dist));

    camera.near = Math.max(0.001, dist - r * 3);
    camera.far  = Math.max(camera.near + 1, dist + r * 6);
    camera.updateProjectionMatrix();
  }

  // tween to the new framing (position + target)
  tweenCameraTo(camera, controls, destPos, center, 450); // 450ms feels nice

  isolating = true;
  isolatedRoot = target;
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

