// /viewer/ui/ToolsDock.js
// Floating tools dock: render modes, explode, section plane, views, projection, scene toggles, snapshot.
/* global THREE */

export function createToolsDock(app, theme) {
  if (!app || !app.camera || !app.controls || !app.renderer)
    throw new Error('[ToolsDock] Missing app.camera/controls/renderer');

  // --- Normalize theme (works with your Theme.js nested shape) ---
  if (theme && theme.colors) {
    theme.teal       ??= theme.colors.teal;
    theme.tealSoft   ??= theme.colors.tealSoft;
    theme.tealFaint  ??= theme.colors.tealFaint;
    theme.bgPanel    ??= theme.colors.panelBg;
    theme.bgCanvas   ??= theme.colors.canvasBg;
    theme.stroke     ??= theme.colors.stroke;
    theme.text       ??= theme.colors.text;
    theme.textMuted  ??= theme.colors.textMuted;
  }
  if (theme && theme.shadows) {
    theme.shadow ??= (theme.shadows.lg || theme.shadows.md || theme.shadows.sm);
  }

  // ---------- DOM ----------
  const ui = {
    root: document.createElement('div'),
    dock: document.createElement('div'),
    header: document.createElement('div'),
    title: document.createElement('div'),
    fitBtn: document.createElement('button'),
    body: document.createElement('div'),
    toggleBtn: document.createElement('button')
  };

  // Helpers (with hover animations intact)
  const mkButton = (label) => {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      padding: '8px 12px',
      borderRadius: '12px',
      border: `1px solid ${theme.stroke}`,
      background: theme.bgPanel,
      color: theme.text,
      fontWeight: '700',
      cursor: 'pointer',
      pointerEvents: 'auto',
      boxShadow: theme.shadow,
      transition: 'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, border-color 120ms ease'
    });
    // Hover/active animations (do not remove)
    b.addEventListener('mouseenter', () => {
      b.style.transform = 'translateY(-1px) scale(1.02)';
      b.style.boxShadow = theme.shadow;
      b.style.background = theme.tealFaint;
      b.style.borderColor = theme.tealSoft ?? theme.teal;
    });
    b.addEventListener('mouseleave', () => {
      b.style.transform = 'none';
      b.style.boxShadow = theme.shadow;
      b.style.background = theme.bgPanel;
      b.style.borderColor = theme.stroke;
    });
    b.addEventListener('mousedown', () => {
      b.style.transform = 'translateY(0) scale(0.99)';
    });
    b.addEventListener('mouseup', () => {
      b.style.transform = 'translateY(-1px) scale(1.02)';
    });
    return b;
  };

  const mkRow = (label, child) => {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'grid',
      gridTemplateColumns: '120px 1fr',
      gap: '10px',
      alignItems: 'center',
      margin: '6px 0'
    });
    const l = document.createElement('div');
    l.textContent = label;
    Object.assign(l.style, { color: theme.textMuted, fontWeight: '700' });
    row.appendChild(l);
    row.appendChild(child);
    return row;
  };

  const mkSelect = (options, value) => {
    const sel = document.createElement('select');
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o; sel.appendChild(opt);
    });
    sel.value = value;
    Object.assign(sel.style, {
      padding: '8px',
      border: `1px solid ${theme.stroke}`,
      borderRadius: '10px',
      pointerEvents: 'auto',
      background: theme.bgPanel,
      color: theme.text,
      transition: 'border-color 120ms ease, box-shadow 120ms ease'
    });
    sel.addEventListener('focus', () => {
      sel.style.borderColor = theme.teal;
      sel.style.boxShadow = theme.shadow;
    });
    sel.addEventListener('blur', () => {
      sel.style.borderColor = theme.stroke;
      sel.style.boxShadow = 'none';
    });
    return sel;
  };

  const mkSlider = (min, max, step, value) => {
    const s = document.createElement('input');
    s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = value;
    s.style.width = '100%';
    s.style.accentColor = theme.teal;
    return s;
  };

  const mkToggle = (label) => {
    const wrap = document.createElement('label');
    const cb = document.createElement('input'); cb.type = 'checkbox';
    const span = document.createElement('span'); span.textContent = label;
    Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', pointerEvents: 'auto' });
    cb.style.accentColor = theme.teal;
    Object.assign(span.style, { fontWeight: '700', color: theme.text });
    wrap.appendChild(cb); wrap.appendChild(span);
    return { wrap, cb };
  };

  // Root overlay
  Object.assign(ui.root.style, {
    position: 'absolute',
    left: '0', top: '0',
    width: '100%', height: '100%',
    pointerEvents: 'none',
    zIndex: '9999',
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial'
  });

  // Dock
  Object.assign(ui.dock.style, {
    position: 'absolute',
    right: '14px',
    top: '14px',
    width: '440px',
    background: theme.bgPanel,
    border: `1px solid ${theme.stroke}`,
    borderRadius: '18px',
    boxShadow: theme.shadow,
    pointerEvents: 'auto',
    overflow: 'hidden',
    display: 'none'
  });

  Object.assign(ui.header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderBottom: `1px solid ${theme.stroke}`,
    background: theme.tealFaint
  });

  ui.title.textContent = 'Viewer Tools';
  Object.assign(ui.title.style, { fontWeight: '800', color: theme.text });

  Object.assign(ui.body.style, { padding: '10px 12px' });

  // Floating toggle button
  ui.toggleBtn.textContent = 'Open Tools';
  Object.assign(ui.toggleBtn.style, {
    position: 'absolute',
    right: '14px',
    top: '14px',
    padding: '8px 12px',
    borderRadius: '12px',
    border: `1px solid ${theme.stroke}`,
    background: theme.bgPanel,
    color: theme.text,
    fontWeight: '700',
    boxShadow: theme.shadow,
    pointerEvents: 'auto',
    zIndex: '10000',
    transition: 'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, border-color 120ms ease'
  });
  // Hover animation for the floating toggle
  ui.toggleBtn.addEventListener('mouseenter', () => {
    ui.toggleBtn.style.transform = 'translateY(-1px) scale(1.02)';
    ui.toggleBtn.style.background = theme.tealFaint;
    ui.toggleBtn.style.borderColor = theme.tealSoft ?? theme.teal;
  });
  ui.toggleBtn.addEventListener('mouseleave', () => {
    ui.toggleBtn.style.transform = 'none';
    ui.toggleBtn.style.background = theme.bgPanel;
    ui.toggleBtn.style.borderColor = theme.stroke;
  });

  // Header button (Snapshot)
  ui.fitBtn = mkButton('Snapshot');
  Object.assign(ui.fitBtn.style, { padding: '6px 10px', borderRadius: '10px' });

  ui.header.appendChild(ui.title);
  ui.header.appendChild(ui.fitBtn);
  ui.dock.appendChild(ui.header);
  ui.dock.appendChild(ui.body);
  ui.root.appendChild(ui.dock);
  ui.root.appendChild(ui.toggleBtn);

  // Attach
  const host = (app?.renderer?.domElement?.parentElement) || document.body;
  host.appendChild(ui.root);

  // ---------- Controls ----------
  const renderModeSel = mkSelect(['Solid', 'Wireframe', 'X-Ray', 'Ghost'], 'Solid');

  // Explode
  const explodeSlider = mkSlider(0, 1, 0.01, 0);

  // Section
  const axisSel = mkSelect(['X', 'Y', 'Z'], 'X');
  const secDist = mkSlider(-1, 1, 0.001, 0);
  const secEnable = mkToggle('Enable section');
  const secShowPlane = mkToggle('Show slice plane');

  // Views row (NO per-row Snapshot button)
  const rowCam = document.createElement('div');
  Object.assign(rowCam.style, { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', margin: '8px 0' });
  const bIso = mkButton('Iso'), bTop = mkButton('Top'), bFront = mkButton('Front'), bRight = mkButton('Right');
  [bIso, bTop, bFront, bRight].forEach(b => { b.style.padding = '8px'; b.style.borderRadius = '10px'; });

  // Projection + Scene toggles
  const projSel = mkSelect(['Perspective', 'Orthographic'], 'Perspective');
  const togGrid = mkToggle('Grid');
  const togGround = mkToggle('Ground & shadows');
  const togAxes = mkToggle('XYZ axes');

  // Assemble rows
  ui.body.appendChild(mkRow('Render mode', renderModeSel));
  ui.body.appendChild(mkRow('Explode', explodeSlider));
  ui.body.appendChild(mkRow('Section axis', axisSel));
  ui.body.appendChild(mkRow('Section dist', secDist));
  ui.body.appendChild(mkRow('', secEnable.wrap));
  ui.body.appendChild(mkRow('', secShowPlane.wrap));
  ui.body.appendChild(mkRow('Views', rowCam));
  rowCam.appendChild(bIso); rowCam.appendChild(bTop); rowCam.appendChild(bFront); rowCam.appendChild(bRight);
  ui.body.appendChild(mkRow('Projection', projSel));
  ui.body.appendChild(mkRow('', togGrid.wrap));
  ui.body.appendChild(mkRow('', togGround.wrap));
  ui.body.appendChild(mkRow('', togAxes.wrap));

  // ---------- Logic ----------

  // Open/close
  function set(open) {
    ui.dock.style.display = open ? 'block' : 'none';
    ui.toggleBtn.textContent = open ? 'Close Tools' : 'Open Tools';
    if (open) {
      styleDockLeft(ui.dock);
      prepareExplodeVectors(); // refresh when opening
    }
  }
  function openDock() { set(true); }
  function closeDock() { set(false); }
  ui.toggleBtn.addEventListener('click', () => set(ui.dock.style.display === 'none'));

  // Snapshot (header only)
  ui.fitBtn.addEventListener('click', () => {
    try {
      const url = app.renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a'); a.href = url; a.download = 'snapshot.png'; a.click();
    } catch (_) {}
  });

  // Render mode
  renderModeSel.addEventListener('change', () => setRenderMode(renderModeSel.value));
  function setRenderMode(mode) {
    const root = app.robot || app.scene;
    if (!root) return;
    root.traverse(o => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          m.wireframe = (mode === 'Wireframe');
          if (mode === 'X-Ray') {
            m.transparent = true; m.opacity = 0.35; m.depthWrite = false; m.depthTest = true;
          } else if (mode === 'Ghost') {
            m.transparent = true; m.opacity = 0.70; m.depthWrite = true; m.depthTest = true;
          } else {
            m.transparent = false; m.opacity = 1.0; m.depthWrite = true; m.depthTest = true;
          }
          m.needsUpdate = true;
        }
      }
    });
  }

  // ---------- Section plane ----------
  let secEnabled = false, secPlaneVisible = false, secAxis = 'X';
  let sectionPlane = null, secVisual = null;

  function ensureSectionVisual() {
    if (secVisual) return secVisual;
    secVisual = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: theme.teal,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        side: THREE.DoubleSide
      })
    );
    secVisual.visible = false;
    secVisual.renderOrder = 10000;
    app.scene.add(secVisual);
    return secVisual;
  }

  function refreshSectionVisual(maxDim, center) {
    if (!secVisual) return;
    const size = Math.max(1e-6, maxDim || 1);
    secVisual.scale.set(size * 1.2, size * 1.2, 1);
    if (center) secVisual.position.copy(center);
  }

  function updateSectionPlane() {
    const renderer = app.renderer;
    renderer.clippingPlanes = [];
    if (!secEnabled || !app.robot) {
      renderer.localClippingEnabled = false;
      if (secVisual) secVisual.visible = false;
      return;
    }

    const n = new THREE.Vector3(
      secAxis === 'X' ? 1 : 0,
      secAxis === 'Y' ? 1 : 0,
      secAxis === 'Z' ? 1 : 0
    );
    const box = new THREE.Box3().setFromObject(app.robot);
    if (box.isEmpty()) { renderer.localClippingEnabled = false; if (secVisual) secVisual.visible = false; return; }
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const center = box.getCenter(new THREE.Vector3());

    const dist = (Number(secDist.value) || 0) * maxDim * 0.5;
    const plane = new THREE.Plane(n, -center.dot(n) - dist);

    renderer.localClippingEnabled = true;
    renderer.clippingPlanes = [plane];
    sectionPlane = plane;

    ensureSectionVisual();
    refreshSectionVisual(maxDim, center);
    secVisual.visible = !!secPlaneVisible;

    // Orient the teal plane to match clipping plane normal
    const look = new THREE.Vector3().copy(n);
    const up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(look.dot(up)) > 0.999) up.set(1, 0, 0);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), look, up);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    secVisual.setRotationFromQuaternion(q);
    const p0 = n.clone().multiplyScalar(-plane.constant);
    secVisual.position.copy(p0);
  }

  axisSel.addEventListener('change', () => { secAxis = axisSel.value; updateSectionPlane(); });
  secDist.addEventListener('input', () => updateSectionPlane());
  secEnable.cb.addEventListener('change', () => { secEnabled = !!secEnable.cb.checked; updateSectionPlane(); });
  secShowPlane.cb.addEventListener('change', () => { secPlaneVisible = !!secShowPlane.cb.checked; updateSectionPlane(); });

  // ---------- Views (animated) ----------
  const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const dirFromAzEl = (az, el) => new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();

  function currentAzEl(cam, target) {
    const v = cam.position.clone().sub(target);
    const len = Math.max(1e-9, v.length());
    return { el: Math.asin(v.y / len), az: Math.atan2(v.z, v.x), r: len };
  }

  function tweenOrbits(cam, ctrl, toPos, toTarget = null, ms = 700) {
    const p0 = cam.position.clone(), t0 = ctrl.target.clone(), tStart = performance.now();
    ctrl.enabled = false; cam.up.set(0, 1, 0);
    const moveTarget = (toTarget !== null);
    function step(t) {
      const u = Math.min(1, (t - tStart) / ms), e = easeInOutCubic(u);
      cam.position.set(
        p0.x + (toPos.x - p0.x) * e,
        p0.y + (toPos.y - p0.y) * e,
        p0.z + (toPos.z - p0.z) * e
      );
      if (moveTarget) ctrl.target.set(
        t0.x + (toTarget.x - t0.x) * e,
        t0.y + (toTarget.y - t0.y) * e,
        t0.z + (toTarget.z - t0.z) * e
      );
      ctrl.update(); app.renderer.render(app.scene, cam);
      if (u < 1) requestAnimationFrame(step); else ctrl.enabled = true;
    }
    requestAnimationFrame(step);
  }

  function viewEndPosition(kind) {
    const cam = app.camera, ctrl = app.controls, t = ctrl.target.clone();
    const cur = currentAzEl(cam, t);
    let az = cur.az, el = cur.el;
    const topEps = 1e-3;
    if (kind === 'iso')   { az = Math.PI * 0.25; el = Math.PI * 0.2; }
    if (kind === 'top')   { az = Math.round(cur.az / (Math.PI / 2)) * (Math.PI / 2); el = Math.PI / 2 - topEps; }
    if (kind === 'front') { az = Math.PI / 2; el = 0; }
    if (kind === 'right') { az = 0; el = 0; }
    const pos = t.clone().add(dirFromAzEl(az, el).multiplyScalar(cur.r));
    return pos;
  }

  const bIsoEl = rowCam.children[0], bTopEl = rowCam.children[1], bFrontEl = rowCam.children[2], bRightEl = rowCam.children[3];
  bIsoEl.addEventListener('click', () => { tweenOrbits(app.camera, app.controls, viewEndPosition('iso'), null, 750); });
  bTopEl.addEventListener('click', () => { tweenOrbits(app.camera, app.controls, viewEndPosition('top'), null, 750); });
  bFrontEl.addEventListener('click', () => { tweenOrbits(app.camera, app.controls, viewEndPosition('front'), null, 750); });
  bRightEl.addEventListener('click', () => { tweenOrbits(app.camera, app.controls, viewEndPosition('right'), null, 750); });

  // ---------- Projection ----------
  projSel.addEventListener('change', () => {
    const mode = projSel.value === 'Orthographic' ? 'Orthographic' : 'Perspective';
    try { app.setProjection?.(mode); } catch (_) {}
  });

  // ---------- Scene toggles ----------
  togGrid.cb.addEventListener('change', () => app.setSceneToggles?.({ grid: !!togGrid.cb.checked }));
  togGround.cb.addEventListener('change', () => app.setSceneToggles?.({ ground: !!togGround.cb.checked, shadows: !!togGround.cb.checked }));
  togAxes.cb.addEventListener('change', () => app.setSceneToggles?.({ axes: !!togAxes.cb.checked }));

  // ---------- Explode ----------
  // Prefer EXACT explode from ComponentSelection.js if available.
  // Supported discovery (any of these may exist):
  //   1) app.explode.prepareExplodeVectors() / app.explode.applyExplode(amount)
  //   2) app.componentSelection.explode.prepareExplodeVectors() / .applyExplode(amount)
  //   3) window.ComponentSelection?.explode?.prepareExplodeVectors() / .applyExplode(amount)
  function getExternalExplode() {
    const ex1 = app?.explode;
    if (ex1?.prepareExplodeVectors && ex1?.applyExplode) return { prep: ex1.prepareExplodeVectors.bind(ex1), apply: ex1.applyExplode.bind(ex1) };

    const ex2 = app?.componentSelection?.explode;
    if (ex2?.prepareExplodeVectors && ex2?.applyExplode) return { prep: ex2.prepareExplodeVectors.bind(ex2), apply: ex2.applyExplode.bind(ex2) };

    const ex3 = (typeof window !== 'undefined') ? (window.ComponentSelection?.explode) : null;
    if (ex3?.prepareExplodeVectors && ex3?.applyExplode) return { prep: ex3.prepareExplodeVectors.bind(ex3), apply: ex3.applyExplode.bind(ex3) };

    return null;
  }

  const externalExplode = getExternalExplode();

  // Built-in fallback (only used if external one not found)
  const __explode = {
    prepared: false,
    baseByObj: new WeakMap(),
    dirByObj:  new WeakMap(),
    maxDim: 1
  };

  function computeRobotBounds() {
    if (!app?.robot) return null;
    const box = new THREE.Box3().setFromObject(app.robot);
    if (box.isEmpty()) return null;
    return { box, center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
  }

  function prepareExplodeVectors() {
    if (externalExplode) { try { externalExplode.prep(); } catch(_){} return; }

    const R = computeRobotBounds();
    if (!R) { __explode.prepared = false; return; }
    __explode.baseByObj = new WeakMap();
    __explode.dirByObj  = new WeakMap();
    __explode.maxDim = Math.max(R.size.x, R.size.y, R.size.z) || 1;

    const rootCenter = R.center.clone();
    const candidates = new Set();
    app.robot.traverse((o) => {
      if (o.isMesh && o.geometry && o.visible) {
        candidates.add(o.parent || o);
      }
    });

    candidates.forEach((node) => {
      __explode.baseByObj.set(node, node.position.clone());
      const b = new THREE.Box3().setFromObject(node);
      if (!b.isEmpty()) {
        const c = b.getCenter(new THREE.Vector3());
        const v = c.sub(rootCenter);
        if (v.lengthSq() < 1e-10) v.set((Math.random()*2-1)*0.01, (Math.random()*2-1)*0.01, (Math.random()*2-1)*0.01);
        v.normalize();
        __explode.dirByObj.set(node, v);
      }
    });

    __explode.prepared = true;
  }

  function setExplode(amount01) {
    if (externalExplode) {
      try { externalExplode.apply(Number(amount01) || 0); } catch(_) {}
      updateSectionPlane?.();
      return;
    }

    if (!app?.robot) return;
    if (!__explode.prepared) prepareExplodeVectors();

    const f = Math.max(0, Math.min(1, Number(amount01)||0));
    const maxOffset = __explode.maxDim * 0.6;

    app.robot.traverse((o) => {
      if (!__explode.baseByObj.has(o) || !__explode.dirByObj.has(o)) return;
      const base = __explode.baseByObj.get(o);
      const dir  = __explode.dirByObj.get(o);
      o.position.copy(base).addScaledVector(dir, f * maxOffset);
    });

    updateSectionPlane?.();
  }

  // Fast, snappy tween (more velocity)
  let explodeTween = null, explodeCurrent = 0;
  function tweenExplode(to, ms = 90) {
    const from = explodeCurrent;
    const t0 = performance.now();
    cancelAnimationFrame(explodeTween);
    function step(t) {
      const u = Math.min(1, (t - t0) / ms);
      const ease = 1 - Math.pow(1 - u, 3); // ease-out cubic
      const v = from + (to - from) * ease;
      setExplode(v);
      explodeCurrent = v;
      if (u < 1) explodeTween = requestAnimationFrame(step);
    }
    explodeTween = requestAnimationFrame(step);
  }

  explodeSlider.addEventListener('input', () => {
    const target = Number(explodeSlider.value) || 0;
    tweenExplode(target, 90);
  });

  // ---------- Utilities ----------
  function styleDockLeft(dockEl) {
    dockEl.classList.add('viewer-dock-fix');
    Object.assign(dockEl.style, { right: 'auto', left: '16px', top: '16px' });
  }

  // Defaults
  togGrid.cb.checked = false;
  togGround.cb.checked = false;
  togAxes.cb.checked = false;

  // Start closed
  set(false);

  // Public API
  function destroy() {
    try { ui.toggleBtn.remove(); } catch (_) {}
    try { ui.dock.remove(); } catch (_) {}
    try { ui.root.remove(); } catch (_) {}
    try {
      app.renderer.localClippingEnabled = false;
      app.renderer.clippingPlanes = [];
      if (secVisual) app.scene.remove(secVisual);
    } catch (_) {}
  }

  return { open: openDock, close: closeDock, set, destroy };
}
