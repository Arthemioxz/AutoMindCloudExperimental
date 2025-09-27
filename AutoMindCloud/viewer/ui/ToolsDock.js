// /viewer/ui/ToolsDock.js
// Floating tools dock: render modes, explode (simple), section plane, views, projection, scene toggles, snapshot.
// Adds tweened open/close animation and global "h" hotkey to toggle the dock.
/* global THREE */

export function createToolsDock(app, theme = {}) {
  if (!app || !app.camera || !app.controls || !app.renderer)
    throw new Error('[ToolsDock] Missing app.camera/controls/renderer');

  // --- Normalize theme (compatible with nested Theme.js shape) ---
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
  // Fallbacks
  theme.teal       ??= '#0ea5a6';
  theme.tealSoft   ??= '#14b8b9';
  theme.tealFaint  ??= 'rgba(20,184,185,0.12)';
  theme.bgPanel    ??= '#ffffff';
  theme.bgCanvas   ??= 0xffffff;
  theme.stroke     ??= '#d7e7e7';
  theme.text       ??= '#0b3b3c';
  theme.textMuted  ??= '#577e7f';
  theme.shadow     ??= '0 12px 36px rgba(0,0,0,0.14)';

  // ---------- DOM ----------
  const ui = {
    root: document.createElement('div'),
    dock: document.createElement('div'),
    header: document.createElement('div'),
    title: document.createElement('div'),
    snapshotBtn: document.createElement('button'),
    body: document.createElement('div'),
    toggleBtn: document.createElement('button')
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

  // Dock (panel) — animated with CSS transitions
  Object.assign(ui.dock.style, {
    position: 'absolute',
    right: '14px',
    top: '14px',
    width: '440px',
    maxHeight: 'calc(100% - 28px)',
    background: theme.bgPanel,
    border: `1px solid ${theme.stroke}`,
    borderRadius: '18px',
    boxShadow: theme.shadow,
    pointerEvents: 'auto',
    overflow: 'hidden',
    display: 'none',
    transform: 'translateX(110%)',
    transition: 'transform 320ms cubic-bezier(.4,0,.2,1)'
  });

  // Header
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

  // Snapshot button
  ui.snapshotBtn.textContent = 'Snapshot';
  styleButton(ui.snapshotBtn, theme);
  Object.assign(ui.snapshotBtn.style, { padding: '6px 10px', borderRadius: '10px' });

  // Body
  Object.assign(ui.body.style, { padding: '10px 12px', overflowY: 'auto', maxHeight: 'calc(100% - 52px)' });

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
  addHoverFX(ui.toggleBtn, theme);

  // Compose DOM
  ui.header.appendChild(ui.title);
  ui.header.appendChild(ui.snapshotBtn);
  ui.dock.appendChild(ui.header);
  ui.dock.appendChild(ui.body);
  ui.root.appendChild(ui.dock);
  ui.root.appendChild(ui.toggleBtn);

  // Attach to same host as renderer canvas
  const host = (app?.renderer?.domElement?.parentElement) || document.body;
  host.appendChild(ui.root);

  // ---------- Controls & Rows ----------
  const renderModeSel = mkSelect(['Solid', 'Wireframe', 'X-Ray', 'Ghost'], 'Solid', theme);
  const explodeSlider = mkSlider(0, 1, 0.01, 0, theme);

  const axisSel = mkSelect(['X', 'Y', 'Z'], 'X', theme);
  const secDist = mkSlider(-1, 1, 0.001, 0, theme);
  const secEnable = mkToggle('Enable section', theme);
  const secShowPlane = mkToggle('Show slice plane', theme);

  const projSel = mkSelect(['Perspective', 'Orthographic'], 'Perspective', theme);
  const togGrid   = mkToggle('Grid', theme);
  const togGround = mkToggle('Ground & shadows', theme);
  const togAxes   = mkToggle('XYZ axes', theme);

  // Views row with buttons
  const rowCam = document.createElement('div');
  Object.assign(rowCam.style, { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', margin: '8px 0' });
  const bIso = mkButton('Iso', theme), bTop = mkButton('Top', theme),
        bFront = mkButton('Front', theme), bRight = mkButton('Right', theme);
  [bIso, bTop, bFront, bRight].forEach(b => { b.style.padding = '8px'; b.style.borderRadius = '10px'; });

  // Build rows
  ui.body.appendChild(mkRow('Render mode', renderModeSel, theme));
  ui.body.appendChild(mkRow('Explode', explodeSlider, theme));
  ui.body.appendChild(mkRow('Section axis', axisSel, theme));
  ui.body.appendChild(mkRow('Section dist', secDist, theme));
  ui.body.appendChild(mkRow('', secEnable.wrap, theme));
  ui.body.appendChild(mkRow('', secShowPlane.wrap, theme));
  ui.body.appendChild(mkRow('Views', rowCam, theme));
  rowCam.appendChild(bIso); rowCam.appendChild(bTop); rowCam.appendChild(bFront); rowCam.appendChild(bRight);
  ui.body.appendChild(mkRow('Projection', projSel, theme));
  ui.body.appendChild(mkRow('', togGrid.wrap, theme));
  ui.body.appendChild(mkRow('', togGround.wrap, theme));
  ui.body.appendChild(mkRow('', togAxes.wrap, theme));

  // ---------- Animated open/close ----------
  let _isOpen = false;
  let hideTimer = null;

  function set(open) {
    clearTimeout(hideTimer);
    if (open) {
      ui.dock.style.display = 'block';          // make it visible
      // small frame to ensure transition kicks
      requestAnimationFrame(() => {
        ui.dock.style.transform = 'translateX(0%)';
      });
    } else {
      ui.dock.style.transform = 'translateX(110%)';
      // hide after animation ends
      hideTimer = setTimeout(() => { ui.dock.style.display = 'none'; }, 330);
    }
    _isOpen = !!open;
    ui.toggleBtn.textContent = _isOpen ? 'Close Tools' : 'Open Tools';
    // Recalculate explode vectors when opening (guard if explode exists)
    try { if (_isOpen) explode.prepare?.(); } catch (_) {}
    // Some builds used styleDockLeft; guard it to avoid ReferenceError
    try { /* optional */ if (typeof styleDockLeft === 'function') styleDockLeft(ui.dock); } catch (_) {}
  }
  function openDock() { set(true); }
  function closeDock() { set(false); }
  function toggleDock() { set(!_isOpen); }

  ui.toggleBtn.addEventListener('click', toggleDock);

  // Global "h" hotkey
  const keyHandler = (e) => {
    if (String(e.key || '').toLowerCase() === 'h') {
      e.preventDefault();
      toggleDock();
    }
  };
  window.addEventListener('keydown', keyHandler);

  // ---------- Snapshot ----------
  ui.snapshotBtn.addEventListener('click', () => {
    try {
      const url = app.renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a'); a.href = url; a.download = 'snapshot.png'; a.click();
    } catch (_) {}
  });

  // ---------- Render mode ----------
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

    // Orient teal plane to match clipping plane normal
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
  const dirFromAzEl = (az, el) => new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az)
  ).normalize();
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
  bIso.addEventListener('click',   () => tweenOrbits(app.camera, app.controls, viewEndPosition('iso'),   null, 750));
  bTop.addEventListener('click',   () => tweenOrbits(app.camera, app.controls, viewEndPosition('top'),   null, 750));
  bFront.addEventListener('click', () => tweenOrbits(app.camera, app.controls, viewEndPosition('front'), null, 750));
  bRight.addEventListener('click', () => tweenOrbits(app.camera, app.controls, viewEndPosition('right'), null, 750));

  // ---------- Projection ----------
  projSel.addEventListener('change', () => {
    const mode = projSel.value === 'Orthographic' ? 'Orthographic' : 'Perspective';
    try { app.setProjection?.(mode); } catch (_) {}
  });

  // ---------- Scene toggles ----------
  togGrid.cb.addEventListener('change',   () => app.setSceneToggles?.({ grid: !!togGrid.cb.checked }));
  togGround.cb.addEventListener('change', () => app.setSceneToggles?.({ ground: !!togGround.cb.checked, shadows: !!togGround.cb.checked }));
  togAxes.cb.addEventListener('change',   () => app.setSceneToggles?.({ axes: !!togAxes.cb.checked }));

  // ---------- Explode (simple, stable) ----------
  const explode = (() => {
    const items = []; // { group, basePos, vec }
    let max = 0;

    function calibrate(root) {
      items.length = 0;
      if (!root) return;
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) { max = 0; return; }
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      max = Math.max(size.x, size.y, size.z) || 1;

      // group meshes by their immediate parent to avoid double-translation
      const groups = new Set();
      root.traverse(o => {
        if (!o?.isMesh || !o.geometry) return;
        groups.add(o.parent || root);
      });
      groups.forEach(parentGroup => {
        const p = parentGroup.getWorldPosition(new THREE.Vector3());
        const v = p.clone().sub(center).normalize();
        if (!isFinite(v.lengthSq()) || v.lengthSq() < 1e-12) v.set(1, 0, 0);
        items.push({ group: parentGroup, basePos: parentGroup.position.clone(), vec: v });
      });
    }

    function set(amount01) {
      const a = Math.max(0, Math.min(1, Number(amount01) || 0));
      const d = a * (max * 0.6);
      for (const it of items) {
        const tgt = it.basePos.clone().add(it.vec.clone().multiplyScalar(d));
        it.group.position.copy(tgt);
      }
      app.renderer.render(app.scene, app.camera);
    }

    function prepare() { calibrate(app.robot || app.scene); }
    return { prepare, set, get max() { return max; } };
  })();

  explodeSlider.addEventListener('input', () => {
    explode.set(Number(explodeSlider.value) || 0);
  });

  // ---------- Public API ----------
  function destroy() {
    clearTimeout(hideTimer);
    window.removeEventListener('keydown', keyHandler);
    try { ui.root.remove(); } catch (_) {}
  }

  // Start closed
  set(false);

  return {
    open: openDock,
    close: closeDock,
    set,
    toggle: toggleDock,
    destroy
  };

  // ===== helpers (UI builders) =====
  function mkRow(label, child, theme) {
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
  }

  function mkSelect(options, value, theme) {
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
  }

  function mkSlider(min, max, step, value, theme) {
    const s = document.createElement('input');
    s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = value;
    s.style.width = '100%';
    s.style.accentColor = theme.teal;
    s.style.pointerEvents = 'auto';
    return s;
  }

  function mkToggle(label, theme) {
    const wrap = document.createElement('label');
    const cb = document.createElement('input'); cb.type = 'checkbox';
    const span = document.createElement('span'); span.textContent = label;
    Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', pointerEvents: 'auto' });
    cb.style.accentColor = theme.teal;
    Object.assign(span.style, { fontWeight: '700', color: theme.text });
    wrap.appendChild(cb); wrap.appendChild(span);
    return { wrap, cb };
  }

  function mkButton(label, theme) {
    const b = document.createElement('button');
    b.textContent = label;
    styleButton(b, theme);
    return b;
  }

  function styleButton(b, theme) {
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
    addHoverFX(b, theme);
  }

  function addHoverFX(b, theme) {
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
  }
}
