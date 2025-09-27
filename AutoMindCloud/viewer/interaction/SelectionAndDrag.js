// /viewer/interaction/SelectionAndDrag.js
// Hover + selection + joint dragging + 'i' focus/iso (selected), fixed-distance tween
/* global THREE */

const HOVER_COLOR = 0x0ea5a6;
const HOVER_OPACITY = 0.28;

// ===== Utils =====
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
  const box = new THREE.Box3(); let has = false; const tmp = new THREE.Box3();
  for (const m of meshes || []) {
    if (!m) continue;
    tmp.setFromObject(m);
    if (!has) { box.copy(tmp); has = true; } else box.union(tmp);
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
  function clear() { for (const o of overlays) { if (o?.parent) o.parent.remove(o); } overlays.length = 0; }
  function overlayFor(mesh) {
    if (!mesh || !mesh.isMesh || !mesh.geometry) return null;
    const m = new THREE.Mesh(
      mesh.geometry,
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity,
        depthTest: false, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: 1
      })
    );
    m.renderOrder = 999; m.userData.__isHoverOverlay = true; return m;
  }
  function showMesh(mesh) { const ov = overlayFor(mesh); if (ov) { mesh.add(ov); overlays.push(ov); } }
  function showLink(link) { for (const m of collectMeshesInLink(link)) { const ov = overlayFor(m); if (ov) { m.add(ov); overlays.push(ov); } } }
  return { clear, showMesh, showLink };
}

function markLinksAndJoints(robot) {
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
      if (childLinkObj && (j.jointType || '').toLowerCase() !== 'fixed') childLinkObj.userData.__joint = j;
    } catch (_) {}
  });
  return linkSet;
}
function findAncestorLink(o, linkSet) { while (o) { if (linkSet && linkSet.has(o)) return o; o = o.parent; } return null; }
function findAncestorJoint(o) {
  while (o) {
    if (o.jointType && (o.jointType || '').toLowerCase() !== 'fixed') return o;
    if (o.userData && o.userData.__joint && (o.userData.__joint.jointType || '').toLowerCase() !== 'fixed') return o.userData.__joint;
    o = o.parent;
  }
  return null;
}

// ===== Camera tween helpers (fixed distance) =====
function tweenOrbits(camera, controls, toPos, toTarget, ms = 700) {
  const start = performance.now();
  const p0 = camera.position.clone();
  const t0 = (controls?.target?.clone ? controls.target.clone() : new THREE.Vector3());
  const t1 = toTarget ? toTarget.clone() : t0.clone();
  const p1 = toPos ? toPos.clone() : p0.clone();

  function easeOutQuint(x){ return 1 - Math.pow(1 - x, 5); }
  function step(now) {
    const k = Math.min(1, (now - start) / ms);
    const e = easeOutQuint(k);
    camera.position.lerpVectors(p0, p1, e);
    if (controls?.target) controls.target.lerpVectors(t0, t1, e);
    camera.updateProjectionMatrix?.();
    controls?.update?.();
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function getRobotBounds(robot) {
  const box = new THREE.Box3().setFromObject(robot);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  return { box, sphere };
}
function viewFrom(dir, robot, FIX_DIST = 2.2) {
  const { sphere } = getRobotBounds(robot);
  const target = sphere.center.clone();
  const radius = sphere.radius > 1e-6 ? sphere.radius : 1.0;
  // Distancia fija proporcional al tamaño del robot
  const dist = FIX_DIST * radius;
  const n = dir.clone().normalize();
  const pos = target.clone().add(n.multiplyScalar(dist));
  return { pos, target };
}
function isoDir() { return new THREE.Vector3(1,1,1).normalize(); }
function frontDir() { return new THREE.Vector3(0,0,1); }
function rightDir() { return new THREE.Vector3(1,0,0); }
function topDir() { return new THREE.Vector3(0,1,0); }

// ===== Main attach =====
export function attachInteraction({
  scene, camera, renderer, controls, robot, selectMode = 'link'
}) {
  if (!scene || !camera || !renderer || !controls) throw new Error('[SelectionAndDrag] Missing required core objects');

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
      const box = new THREE.Box3(new THREE.Vector3(-0.5,-0.5,-0.5), new THREE.Vector3(0.5,0.5,0.5));
      selectionHelper = new THREE.Box3Helper(box, new THREE.Color(HOVER_COLOR));
      selectionHelper.visible = false; selectionHelper.renderOrder = 10001; scene.add(selectionHelper);
    }
    return selectionHelper;
  }
  function refreshSelectionMarker() {
    ensureSelectionHelper();
    if (!robotModel || !selectedMeshes.length) { selectionHelper.visible = false; return; }
    const box = computeUnionBox(selectedMeshes);
    if (!box) { selectionHelper.visible = false; return; }
    selectionHelper.box.copy(box); selectionHelper.updateMatrixWorld(true); selectionHelper.visible = true;
  }
  function setSelectedMeshes(meshes) { selectedMeshes = (meshes || []).filter(Boolean); refreshSelectionMarker(); }
  function selectFromHit(meshHit) {
    if (!meshHit) { setSelectedMeshes([]); return; }
    if (selectMode === 'link') {
      const link = findAncestorLink(meshHit, linkSet);
      const meshes = link ? collectMeshesInLink(link) : [meshHit];
      setSelectedMeshes(meshes);
    } else setSelectedMeshes([meshHit]);
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
    const axisW = (joint.axis || new THREE.Vector3(1,0,0)).clone().normalize().applyQuaternion(qWorld).normalize();
    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisW.clone(), originW);

    raycaster.setFromCamera(pointer, camera);
    const p0 = new THREE.Vector3(); let r0 = null;
    if (raycaster.ray.intersectPlane(dragPlane, p0)) {
      r0 = p0.clone().sub(originW); if (r0.lengthSq() > 1e-12) r0.normalize(); else r0 = null;
    }

    dragState = { joint, originW, axisW, dragPlane, r0, value: getJointValue(joint), lastClientX: ev.clientX, lastClientY: ev.clientY };
    controls.enabled = false; renderer.domElement.style.cursor = 'grabbing'; renderer.domElement.setPointerCapture?.(ev.pointerId);
  }
  function updateJointDrag(ev) {
    const ds = dragState; if (!ds) return;
    const fine = ev.shiftKey ? 0.35 : 1.0; getPointerFromEvent(ev); raycaster.setFromCamera(pointer, camera);
    const dX = (ev.clientX - (ds.lastClientX ?? ev.clientX));
    const dY = (ev.clientY - (ds.lastClientY ?? ev.clientY));
    ds.lastClientX = ev.clientX; ds.lastClientY = ev.clientY;

    if (isPrismatic(ds.joint)) {
      const hit = new THREE.Vector3(); let delta = 0;
      if (raycaster.ray.intersectPlane(ds.dragPlane, hit)) {
        const t1 = hit.clone().sub(ds.originW).dot(ds.axisW);
        delta = (t1 - (ds.lastT ?? t1)); ds.lastT = t1;
      } else delta = -(dY * PRISM_PER_PIXEL);
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
    if (!applied) { const delta = (dX * ROT_PER_PIXEL) * fine; ds.value += delta; setJointValue(robotModel, ds.joint, ds.value); refreshSelectionMarker(); }
  }
  function endJointDrag() {
    if (!dragState) return;
    controls.enabled = true; renderer.domElement.style.cursor = '';
    dragState = null;
  }

  // Picking
  function hitTest(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([robotModel], true);
    return (hits && hits[0] && hits[0].object) || null;
  }

  renderer.domElement.addEventListener('pointermove', (ev) => {
    const mesh = hitTest(ev);
    const link = mesh ? findAncestorLink(mesh, linkSet) : null;
    const key = link || mesh;
    if (key !== lastHoverKey) {
      hover.clear();
      if (link) hover.showLink(link);
      else if (mesh) hover.showMesh(mesh);
      lastHoverKey = key;
    }
  });

  renderer.domElement.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const hit = hitTest(ev);
    const joint = hit ? findAncestorJoint(hit) : null;
    if (joint && isMovable(joint)) {
      getPointerFromEvent(ev); startJointDrag(joint, ev);
    } else {
      // Selection by click
      if (hit) selectFromHit(hit);
      else setSelectedMeshes([]);
    }
  });
  renderer.domElement.addEventListener('pointermove', (ev) => { if (dragState) updateJointDrag(ev); });
  renderer.domElement.addEventListener('pointerup', endJointDrag);
  renderer.domElement.addEventListener('pointerleave', endJointDrag);

  // ===== 'i' key: focus selected (first press) / back to ISO (second press) =====
  let focusToggled = false;
  const FIX_DIST = 2.2; // distancia fija (multiplicador del radio del robot)
  function getSelectionCenter() {
    const box = computeUnionBox(selectedMeshes);
    if (!box) return null;
    return box.getCenter(new THREE.Vector3());
  }
  function goIso() {
    const { pos, target } = viewFrom(isoDir(), robotModel, FIX_DIST);
    tweenOrbits(camera, controls, pos, target, 750);
  }
  function goFocusSelected() {
    const center = getSelectionCenter();
    if (!center) { goIso(); return; }
    const { sphere } = getRobotBounds(robotModel);
    const radius = Math.max(1e-3, sphere.radius);
    const dist = FIX_DIST * radius;
    // Mira desde la dirección actual de la cámara, manteniendo distancia fija a la selección
    const dir = center.clone().sub(camera.position).normalize().multiplyScalar(-1);
    const pos = center.clone().add(dir.multiplyScalar(dist));
    tweenOrbits(camera, controls, pos, center, 750);
  }

  const onKeyDownI = (e) => {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.isComposing) return;
    if (e.key === 'i' || e.key === 'I' || e.code === 'KeyI') {
      e.preventDefault();
      try { console.log('pressed i'); } catch {}
      if (!focusToggled) { goFocusSelected(); focusToggled = true; }
      else { goIso(); focusToggled = false; }
    }
  };
  document.addEventListener('keydown', onKeyDownI, true);

  // Public small API (if needed elsewhere)
  return {
    setSelectedMeshes,
    destroy() {
      try { hover.clear(); } catch (_) {}
      try { document.removeEventListener('keydown', onKeyDownI, true); } catch (_) {}
    }
  };
}
