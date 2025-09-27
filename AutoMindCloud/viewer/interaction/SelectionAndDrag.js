// /viewer/interaction/SelectionAndDrag.js
// Hover + selection + (optional) joint dragging + minimal, robust fallbacks.
/* global THREE */

const HOVER_COLOR   = 0x0ea5a6;
const HOVER_OPACITY = 0.28;

export function attachInteraction({
  scene,
  camera,
  renderer,          // <— prefer this
  controls,          // may be missing; we’ll synthesize a stub
  dom,               // legacy: renderer.domElement; optional
  robot,             // optional: root group for meshes/joints
  selectMode = 'link' // 'link'|'mesh' (kept for API compatibility)
}) {
  // ---- Robust fallbacks so we never hard-throw ----
  let _scene    = scene    || window.__viewerScene;
  let _camera   = camera   || window.__viewerCamera;
  let _renderer = renderer || window.__viewerRenderer;
  let _controls = controls || window.__viewerControls;
  const _dom    = (dom || _renderer?.domElement || document.querySelector('canvas') || document.body);

  // If renderer missing, try to derive a minimal stub (only needs domElement)
  if (!_renderer && _dom) {
    _renderer = { domElement: _dom };
  }

  // If controls missing, try to construct OrbitControls (if available) or a stub
  if (!_controls && _camera) {
    if (THREE && THREE.OrbitControls) {
      try {
        _controls = new THREE.OrbitControls(_camera, _dom);
        _controls.enableDamping = true;
        _controls.dampingFactor = 0.08;
      } catch {}
    }
    if (!_controls) {
      _controls = {
        object: _camera,
        target: new THREE.Vector3(),
        update(){},
        addEventListener(){},
        removeEventListener(){}
      };
      console.warn('[SelectionAndDrag] OrbitControls missing — using a minimal stub. Load OrbitControls for full features.');
    }
  }

  // Final sanity — if still missing core bits, degrade gracefully
  if (!_scene || !_camera || !_renderer || !_dom) {
    console.error('[SelectionAndDrag] Missing required core objects. Interaction disabled.', {
      haveScene: !!_scene, haveCamera: !!_camera, haveRenderer: !!_renderer, haveDom: !!_dom, haveControls: !!_controls
    });
    return noopAPI();
  }

  // One-time debug so you can verify in console
  console.debug('[SelectionAndDrag] bound', {
    scene: !!_scene, camera: !!_camera, renderer: !!_renderer, domEl: !!_dom, controls: !!_controls, selectMode
  });

  // ---- State ----
  let _robot = robot || null;
  let _selectMode = selectMode;
  const raycaster = new THREE.Raycaster();
  const pointer   = new THREE.Vector2();

  let hovered = null;
  let hoveredMaterialBackup = null;

  let selected = null;
  let selectedOutline = null;

  // ---- Helpers ----
  function pickMeshes(root) {
    const list = [];
    (root || _scene).traverse(o => {
      if (o.isMesh && o.geometry && o.visible !== false) list.push(o);
    });
    return list;
  }

  function getPickRoot() {
    return _robot || _scene;
    // If you later add link-vs-mesh logic, branch here by _selectMode.
  }

  function setPointerFromEvent(evt) {
    const rect = _dom.getBoundingClientRect();
    const x = (evt.clientX - rect.left) / Math.max(1, rect.width);
    const y = (evt.clientY - rect.top)  / Math.max(1, rect.height);
    pointer.set(x * 2 - 1, 1 - y * 2);
  }

  function intersect(evt) {
    setPointerFromEvent(evt);
    raycaster.setFromCamera(pointer, _camera);
    const meshes = pickMeshes(getPickRoot());
    const hits = raycaster.intersectObjects(meshes, true);
    return hits && hits.length ? hits[0] : null;
  }

  function clearHover() {
    if (hovered && hovered.material && hoveredMaterialBackup) {
      // restore previous material props
      const m = hovered.material;
      m.emissive?.setHex(hoveredMaterialBackup.emissive ?? 0x000000);
      m.opacity = hoveredMaterialBackup.opacity ?? 1.0;
      m.transparent = hoveredMaterialBackup.transparent ?? false;
      m.needsUpdate = true;
    }
    hovered = null;
    hoveredMaterialBackup = null;
  }

  function applyHover(obj) {
    if (!obj || !obj.material) return;
    hovered = obj;
    const m = obj.material;
    hoveredMaterialBackup = {
      emissive: (m.emissive && m.emissive.getHex) ? m.emissive.getHex() : undefined,
      opacity: m.opacity,
      transparent: m.transparent
    };
    try { m.emissive && m.emissive.setHex(HOVER_COLOR); } catch {}
    m.opacity = HOVER_OPACITY;
    m.transparent = true;
    m.needsUpdate = true;
  }

  function clearSelection() {
    if (selectedOutline && selectedOutline.parent) {
      selectedOutline.parent.remove(selectedOutline);
    }
    selectedOutline = null;
    selected = null;
  }

  function select(obj) {
    clearSelection();
    selected = obj;

    // Simple outline using Box3 helper group (cheap & dependency-free)
    const g = new THREE.Group();
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const ctr  = box.getCenter(new THREE.Vector3());
    const geo = new THREE.BoxGeometry(size.x || 1e-3, size.y || 1e-3, size.z || 1e-3);
    const mat = new THREE.MeshBasicMaterial({ wireframe: true, color: HOVER_COLOR, transparent: true, opacity: 0.8 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(ctr);
    g.add(mesh);
    _scene.add(g);
    selectedOutline = g;
  }

  // ---- Events ----
  function onPointerMove(e) {
    const hit = intersect(e);
    if (!hit || !hit.object) return clearHover();
    if (hovered === hit.object) return; // unchanged
    clearHover();
    applyHover(hit.object);
  }

  function onPointerLeave() {
    clearHover();
  }

  function onClick(e) {
    const hit = intersect(e);
    if (hit && hit.object) select(hit.object);
  }

  // (Optional) dragging joints: placeholder—wire in your joint logic here
  function onPointerDown() { /* no-op for now */ }
  function onPointerUp()   { /* no-op for now */ }

  // ---- Wire listeners ----
  _dom.addEventListener('pointermove', onPointerMove);
  _dom.addEventListener('pointerleave', onPointerLeave);
  _dom.addEventListener('click', onClick);
  _dom.addEventListener('pointerdown', onPointerDown);
  _dom.addEventListener('pointerup', onPointerUp);

  // ---- Public API ----
  function setRobot(r) { _robot = r || null; }
  function setSelectMode(m) { _selectMode = (m === 'mesh' ? 'mesh' : 'link'); }
  function getSelected() { return selected; }

  function destroy() {
    try {
      _dom.removeEventListener('pointermove', onPointerMove);
      _dom.removeEventListener('pointerleave', onPointerLeave);
      _dom.removeEventListener('click', onClick);
      _dom.removeEventListener('pointerdown', onPointerDown);
      _dom.removeEventListener('pointerup', onPointerUp);
    } catch {}
    clearHover();
    clearSelection();
  }

  return {
    setRobot,
    setSelectMode,
    clearSelection,
    getSelected,
    destroy,
    // for compatibility with previous code paths:
    selectFromHit: (obj) => select(obj),
    isolateCurrent: () => {}, // no-op placeholder
    restoreAll: () => {}      // no-op placeholder
  };
}

// Minimal do-nothing API when we can’t attach (keeps caller stable)
function noopAPI() {
  const no = () => {};
  return {
    setRobot: no, setSelectMode: no, clearSelection: no,
    getSelected: () => null, selectFromHit: no, isolateCurrent: no, restoreAll: no, destroy: no
  };
}

