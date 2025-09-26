// SelectionAndDrag.js — hover/selección, wheel target, teclas i/c/t/r (sin 'f')

export function attachInteraction({ scene, camera, controls, renderer, robot, ui, coreAPI }) {
  const THREE = window.THREE;
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let hovered = null;
  let selected = null;
  let isoToggle = false; // estado del toggle de 'i'
  let fixedDistance = null;

  function setCursor(v) { renderer.domElement.style.cursor = v || 'auto'; }

  function computeFixedDistance(targetObj) {
    const L = coreAPI.boxMax(targetObj);
    const fov = (camera.fov || 60) * Math.PI / 180;
    fixedDistance = (L * 0.8) / Math.tan(fov / 2);
    return fixedDistance;
  }

  function pick(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObject(robot, true);
    return hits.length ? hits[0].object : null;
  }

  function highlight(o, on) {
    if (!o) return;
    if (!o.userData) o.userData = {};
    if (on) {
      if (!o.userData.__origMat) o.userData.__origMat = o.material;
      o.material = o.material.clone();
      o.material.color = new THREE.Color(0x0ea5a6);
      o.material.transparent = true; o.material.opacity = 0.28;
    } else {
      if (o.userData.__origMat) { o.material = o.userData.__origMat; o.userData.__origMat = null; }
      if (o.material && o.material.userData) {
        o.material.transparent = Boolean(o.material.userData.__wasTransparent);
        o.material.opacity = o.material.userData.__wasOpacity ?? 1.0;
      }
    }
  }

  function setSelected(obj) {
    if (selected && selected !== hovered) highlight(selected, false);
    selected = obj;
    if (selected) highlight(selected, true);
    ui?.components?.markSelected?.(selected?.name || selected?.userData?.linkName || '');
  }

  function onMouseMove(ev) {
    const obj = pick(ev);
    if (obj !== hovered) {
      if (hovered && hovered !== selected) highlight(hovered, false);
      hovered = obj;
      if (hovered && hovered !== selected) highlight(hovered, true);
    }
    setCursor(hovered ? 'pointer' : 'auto');
  }

  function onClick(ev) {
    const obj = pick(ev);
    if (obj) setSelected(obj);
  }

  // — Wheel zoom debe usar el centro de la selección como target
  function focusTargetToSelection() {
    const obj = selected || robot;
    const c = coreAPI.boxCenter(obj);
    if (!c) return;
    controls.target.copy(c); controls.update();
  }
  const wheelTargeter = () => focusTargetToSelection();
  renderer.domElement.addEventListener('wheel', wheelTargeter, true);
  renderer.domElement.addEventListener('gesturechange', wheelTargeter, true);

  // — Tecla 'i': toggle focus seleccionado <-> ISO (animado, desde la pose actual)
  function navigateToView(view) {
    const obj = selected || robot;
    const center = coreAPI.boxCenter(obj) || coreAPI.boxCenter(robot);
    if (!fixedDistance) computeFixedDistance(robot);

    let az, el;
    switch (view) {
      case 'iso': az = 45 * Math.PI/180; el = 25 * Math.PI/180; break;
      case 'top': az = 0; el = Math.PI/2 - 1e-3; break;
      case 'front': az = Math.PI/2; el = 0; break;
      case 'right': az = 0; el = 0; break;
      default: az = 45 * Math.PI/180; el = 25 * Math.PI/180;
    }
    const dir = new THREE.Vector3(Math.cos(el)*Math.cos(az), Math.sin(el), Math.cos(el)*Math.sin(az)).normalize();
    const toPos = center.clone().add(dir.multiplyScalar(fixedDistance));
    coreAPI.tweenOrbits(camera, controls, { toPos, toTarget: center, ms: 750 });
  }

  function handleKey(e) {
    const k = (e.key || '').toLowerCase();
    if (k === 'i') {
      e.preventDefault();
      const obj = selected || robot;
      const center = coreAPI.boxCenter(obj) || coreAPI.boxCenter(robot);
      if (!center) return;
      if (!fixedDistance) computeFixedDistance(robot);
      if (!isoToggle) {
        // mantener az/el actuales y trasladar hasta el centro de la selección
        const v = camera.position.clone().sub(controls.target);
        const r = Math.max(v.length(), 1e-6);
        const el = Math.asin(v.y / r);
        const az = Math.atan2(v.z, v.x);
        const dir = new THREE.Vector3(Math.cos(el)*Math.cos(az), Math.sin(el), Math.cos(el)*Math.sin(az)).normalize();
        const toPos = center.clone().add(dir.multiplyScalar(fixedDistance));
        coreAPI.tweenOrbits(camera, controls, { toPos, toTarget: center, ms: 750 });
      } else {
        navigateToView('iso');
      }
      isoToggle = !isoToggle;
    }
    else if (k === 'c') { e.preventDefault(); ui?.components?.toggle?.(); }
    else if (k === 't') { e.preventDefault(); ui?.tools?.toggle?.(); }
    else if (k === 'r') {
      e.preventDefault();
      // joints=0
      try {
        if (robot.setJointValue && robot.joints) Object.keys(robot.joints).forEach(n => robot.setJointValue(n, 0));
        else if (robot.joints) Object.values(robot.joints).forEach(j => { if ('angle' in j) j.angle = 0; if ('position' in j) j.position = 0; });
      } catch {}
      // restore transforms
      try { coreAPI.restoreInitialPose(robot); } catch {}
      // volver a ISO
      fixedDistance = null;
      navigateToView('iso');
    }
  }

  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('click', onClick);
  renderer.domElement.addEventListener('keydown', handleKey, true);

  return {
    getSelection: () => selected,
    setSelection: (o) => { setSelected(o); focusTargetToSelection(); },
    onDestroy: () => {
      try { renderer.domElement.removeEventListener('mousemove', onMouseMove); } catch {}
      try { renderer.domElement.removeEventListener('click', onClick); } catch {}
      try { renderer.domElement.removeEventListener('keydown', handleKey, true); } catch {}
      try { renderer.domElement.removeEventListener('wheel', wheelTargeter, true); } catch {}
      try { renderer.domElement.removeEventListener('gesturechange', wheelTargeter, true); } catch {}
    }
  };
}
