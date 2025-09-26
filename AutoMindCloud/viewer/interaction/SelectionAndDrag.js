// /viewer/interaction/SelectionAndDrag.js
// Hover + selection + joint dragging + 'i' tween zoom to selected, toggle back to ISO
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
      j.userData ??= {};
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

// ---------- Camera tween helpers ----------
function easeInOutQuad(t) { return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2)/2; }

function tweenCamera({ camera, controls, toPos, toTarget, ms = 800, onDone }) {
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const t0 = performance.now();
  let raf = 0;

  function step(now) {
    const u = Math.min(1, (now - t0) / Math.max(1, ms));
    const k = easeInOutQuad(u);

    camera.position.lerpVectors(startPos, toPos, k);
    controls.target.lerpVectors(startTarget, toTarget, k);
    controls.update();

    if (u < 1) { raf = requestAnimationFrame(step); }
    else { onDone && onDone(); }
  }
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(step);
}

function fitDistanceForBox(box, camera, fit = 1.2) {
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  if (camera.isPerspectiveCamera) {
    const fov = (camera.fov || 60) * Math.PI / 180;
    return (maxDim * fit) / (2 * Math.tan(Math.max(1e-6, fov / 2)));
  }
  // Orthographic: keep current distance; view size handled by zoom/frustum elsewhere
  const dirLen = camera.position.clone().sub(new THREE.Vector3()).length();
  return dirLen || (maxDim * fit);
}

function boxCenter(box) {
  return box.getCenter(new THREE.Vector3());
}

// ---------- Main attachment ----------
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

  // Mesh cache for picking (center pick fallback if needed)
  let allMeshes = [];
  function rebuildMeshCache() {
    allMeshes.length = 0;
    robotModel?.traverse(o => { if (o.isMesh && o.geometry) allMeshes.push(o); });
  }
  rebuildMeshCache();

  // ---------- ISO Default pose (computed from robot bounds) ----------
  let isoTarget = new THREE.Vector3();
  let isoPosition = new THREE.Vector3();
  function computeRobotBox() {
    if (!robotModel) return null;
    const box = new THREE.Box3().setFromObject(robotModel);
    if (!isFinite(box.min.x) || !isFinite(box.max.x)) return null;
    return box;
  }
  function computeIsoPose() {
    const box = computeRobotBox();
    if (!box) return;
    const c = boxCenter(box);
    const dist = fitDistanceForBox(box, camera, 1.25);
    const isoDir = new THREE.Vector3(1, 0.8, 1).normalize(); // Autodesk-ish ISO
    isoTarget.copy(c);
    isoPosition.copy(c).add(isoDir.multiplyScalar(dist));
  }
  computeIsoPose();

  // Update ISO when robot changes size (public method also exposed)
  function refreshIsoForRobot() {
    computeIsoPose();
  }

  // ---------- Tween to selection / ISO toggle ----------
  let zoomedToSelection = false;

  function tweenToSelection(ms = 800) {
    if (!selectedMeshes.length) return false;

    const box = computeUnionBox(selectedMeshes);
    if (!box) return false;

    const c = boxCenter(box);
    const currentDir = camera.position.clone().sub(controls.target).normalize();
    const dist = fitDistanceForBox(box, camera, 1.25);

    const toTarget = c;
    const toPos = c.clone().add(currentDir.multiplyScalar(dist));

    tweenCamera({ camera, controls, toPos, toTarget, ms });
    zoomedToSelection = true;
    return true;
  }

  function tweenToIso(ms = 800) {
    // Recompute ISO in case geometry moved (keeps default direction)
    computeIsoPose();
    tweenCamera({ camera, controls, toPos: isoPosition.clone(), toTarget: isoTarget.clone(), ms });
    zoomedToSelection = false;
    return true;
  }

  // Events
  function onPointerMove(e) {
    lastMoveEvt = e;
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
    // Selection (link mode groups by link)
    if (selectMode === 'link') {
      const link = findAncestorLink(meshHit, linkSet);
      const meshes = link ? collectMeshesInLink(link) : [meshHit];
      setSelectedMeshes(meshes);
    } else {
      setSelectedMeshes([meshHit]);
    }

    // Start drag if joint present
    const joint = findAncestorJoint(meshHit);
    if (joint && isMovable(joint)) startJointDrag(joint, e);
  }

  // Keyboard 'i' = toggle tween: selection <-> ISO
  function onKeyDown(e) {
    const k = (e.key || '').toLowerCase();
    if (k === 'i') {
      e.preventDefault();
      if (zoomedToSelection) tweenToIso(850);
      else tweenToSelection(850);
    }
  }

  renderer.domElement.tabIndex = renderer.domElement.tabIndex || 0; // ensure focusable
  renderer.domElement.addEventListener('pointermove', onPointerMove, { passive: true });
  renderer.domElement.addEventListener('pointerdown', onPointerDown, { passive: false });
  renderer.domElement.addEventListener('pointerup', endJointDrag);
  renderer.domElement.addEventListener('pointerleave', endJointDrag);
  renderer.domElement.addEventListener('pointercancel', endJointDrag);
  renderer.domElement.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keydown', onKeyDown, true);

  function setRobot(newRobot) {
    robotModel = newRobot || null;
    linkSet = robotModel ? markLinksAndJoints(robotModel) : new Set();
    setSelectedMeshes([]);
    rebuildMeshCache();
    refreshIsoForRobot();
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
    // selection API
    setRobot,
    setSelectMode,
    clearSelection,
    selectFromHit,

    // camera tweens
    tweenToSelection,
    tweenToIso,
    refreshIsoForRobot,

    destroy
  };
}
