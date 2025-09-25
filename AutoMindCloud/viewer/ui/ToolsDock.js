// /viewer/ui/ToolsDock.js
// Floating tools dock: render modes, section plane, views, projection, scene toggles, snapshot.
/* global THREE */

/**
 * @typedef {Object} Theme
 * @property {string} teal
 * @property {string} tealSoft
 * @property {string} tealFaint
 * @property {string} bgPanel
 * @property {number|string} bgCanvas
 * @property {string} stroke
 * @property {string} text
 * @property {string} textMuted
 * @property {string} shadow
 */

/**
 * Create the tools dock UI and wire it to the viewer app.
 * @param {Object} app
 * @param {Theme} theme
 * @returns {{ open:()=>void, close:()=>void, set:(open:boolean)=>void, destroy:()=>void }}
 */
export function createToolsDock(app, theme) {
  if (!app || !app.camera || !app.controls || !app.renderer)
    throw new Error('[ToolsDock] Missing app.camera/controls/renderer');

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

  // Helpers (UI builders)
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
      pointerEvents: 'auto'
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
      padding: '8px', border: `1px solid ${theme.stroke}`,
      borderRadius: '10px', pointerEvents: 'auto'
    });
    return sel;
  };
  const mkSlider = (min, max, step, value) => {
    const s = document.createElement('input');
    s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = value;
    s.style.width = '100%'; s.style.accentColor = theme.teal;
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
    zIndex: '10000'
  });

  // Header "Fit" (we keep it as a convenience to upper layers; optional)
  ui.fitBtn = mkButton('Snapshot'); // repurpose header button as Snapshot for utilidad
  Object.assign(ui.fitBtn.style, { padding: '6px 10px', borderRadius: '10px' });

  ui.header.appendChild(ui.title);
  ui.header.appendChild(ui.fitBtn);
  ui.dock.appendChild(ui.header);
  ui.dock.appendChild(ui.body);
  ui.root.appendChild(ui.dock);
  ui.root.appendChild(ui.toggleBtn);

  // Attach to viewer host
  const host = (app?.renderer?.domElement?.parentElement) || document.body;
  host.appendChild(ui.root);

  // ---------- Controls inside the dock ----------

  // Render mode
  const renderModeSel = mkSelect(['Solid', 'Wireframe', 'X-Ray', 'Ghost'], 'Solid');

  // Section plane
  const axisSel = mkSelect(['X', 'Y', 'Z'], 'X');
  const secDist = mkSlider(-1, 1, 0.001, 0);
  const secEnable = mkToggle('Enable section');
  const secShowPlane = mkToggle('Show slice plane');

  // Views
  const rowCam = document.createElement('div');
  Object.assign(rowCam.style, { display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '8px', margin: '8px 0' });
  const bIso = mkButton('Iso'), bTop = mkButton('Top'), bFront = mkButton('Front'), bRight = mkButton('Right'), bSnap = mkButton('Snapshot');
  [bIso, bTop, bFront, bRight, bSnap].forEach(b => { b.style.padding = '8px'; b.style.borderRadius = '10px'; });

  // Projection + Scene toggles
  const projSel = mkSelect(['Perspective', 'Orthographic'], 'Perspective');
  const togGrid = mkToggle('Grid');
  const togGround = mkToggle('Ground & shadows');
  const togAxes = mkToggle('XYZ axes');

  // Assemble rows
  ui.body.appendChild(mkRow('Render mode', renderModeSel));
  ui.body.appendChild(mkRow('Section axis', axisSel));
  ui.body.appendChild(mkRow('Section dist', secDist));
  ui.body.appendChild(mkRow('', secEnable.wrap));
  ui.body.appendChild(mkRow('', secShowPlane.wrap));
  ui.body.appendChild(mkRow('Views', rowCam));
  rowCam.appendChild(bIso); rowCam.appendChild(bTop); rowCam.appendChild(bFront); rowCam.appendChild(bRight); rowCam.appendChild(bSnap);
  ui.body.appendChild(mkRow('Projection', projSel));
  ui.body.appendChild(mkRow('', togGrid.wrap));
  ui.body.appendChild(mkRow('', togGround.wrap));
  ui.body.appendChild(mkRow('', togAxes.wrap));

  // ---------- Logic wiring ----------

  // Open/close
  function set(open) {
    ui.dock.style.display = open ? 'block' : 'none';
    ui.toggleBtn.textContent = open ? 'Close Tools' : 'Open Tools';
    // Move the dock to left when it is opened (usability on small screens)
    if (open) styleDockLeft(ui.dock);
  }
  function openDock() { set(true); }
  function closeDock() { set(false); }
  ui.toggleBtn.addEventListener('click', () => set(ui.dock.style.display === 'none'));

  // Snapshot (header button) → triggers same as dedicated button
  ui.fitBtn.addEventListener('click', () => doSnapshot());
  bSnap.addEventListener('click', () => doSnapshot());

  function doSnapshot() {
    try {
      const url = app.renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a'); a.href = url; a.download = 'snapshot.png'; a.click();
    } catch (_) {}
  }

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
            m.transparent = true;
            m.opacity = 0.35;
            m.depthWrite = false;
            m.depthTest = true;
          } else if (mode === 'Ghost') {
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

  // Section plane (renderer local clipping)
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
    const plane = new THREE.Plane(n, -center.dot(n) - dist); // n·x + d = 0

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

  // Views (animated from current camera)
  const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const dirFromAzEl = (az, el) => new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();

  function currentAzEl(cam, target) {
    const v = cam.position.clone().sub(target);
    const len = Math.max(1e-9, v.length());
    return { el: Math.asin(v.y / len), az: Math.atan2(v.z, v.x), r: len };
    // az: angle from +X towards +Z; el: from XZ plane upwards
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
    // Slight epsilon to avoid gimbal-ish top
    const topEps = 1e-3;
    if (kind === 'iso') { az = Math.PI * 0.25; el = Math.PI * 0.2; }
    if (kind === 'top') { az = Math.round(cur.az / (Math.PI / 2)) * (Math.PI / 2); el = Math.PI / 2 - topEps; }
    if (kind === 'front') { az = Math.PI / 2; el = 0; }
    if (kind === 'right') { az = 0; el = 0; }
    const pos = t.clone().add(dirFromAzEl(az, el).multiplyScalar(cur.r));
    return pos;
  }

  bIso.addEventListener('click', () => { tweenOrbits(app.camera, app.controls, viewEndPosition('iso'), null, 750); });
  bTop.addEventListener('click', () => { tweenOrbits(app.camera, app.controls, viewEndPosition('top'), null, 750); });
  bFront.addEventListener('click', () => { tweenOrbits(app.camera, app.controls, viewEndPosition('front'), null, 750); });
  bRight.addEventListener('click', () => { tweenOrbits(app.camera, app.controls, viewEndPosition('right'), null, 750); });

  // Projection
  projSel.addEventListener('change', () => {
    const mode = projSel.value === 'Orthographic' ? 'Orthographic' : 'Perspective';
    try { app.setProjection?.(mode); } catch (_) {}
  });

  // Scene toggles
  togGrid.cb.addEventListener('change', () => app.setSceneToggles?.({ grid: !!togGrid.cb.checked }));
  togGround.cb.addEventListener('change', () => app.setSceneToggles?.({ ground: !!togGround.cb.checked, shadows: !!togGround.cb.checked }));
  togAxes.cb.addEventListener('change', () => app.setSceneToggles?.({ axes: !!togAxes.cb.checked }));

  // ---------- Utilities ----------
  function styleDockLeft(dockEl) {
    // Add a CSS adjustment class to place the dock to the left if desired
    dockEl.classList.add('viewer-dock-fix');
    Object.assign(dockEl.style, {
      right: 'auto',
      left: '16px',
      top: '16px'
    });
    // Minimal CSS baked-in; tweak in your global stylesheet if needed
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
    // Remove clipping plane artifacts
    try {
      app.renderer.localClippingEnabled = false;
      app.renderer.clippingPlanes = [];
      if (secVisual) app.scene.remove(secVisual);
    } catch (_) {}
  }

  return { open: openDock, close: closeDock, set, destroy };
}

