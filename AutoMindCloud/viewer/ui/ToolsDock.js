// /viewer/ui/ToolsDock.js
// Floating tools dock with tweened open/close + robust host resolution.
/* global THREE */

export function createToolsDock(app, theme = {}) {
  if (!app || !app.camera || !app.controls || !app.renderer) {
    console.warn('[ToolsDock] Missing app.camera/controls/renderer — continuing, but some features may be limited.');
  }

  // --------- Resolve a safe host to attach UI ---------
  // Prefer app.container; otherwise try renderer's parent; otherwise body.
  const host =
    app?.container ||
    app?.renderer?.domElement?.closest?.('.viewer-host') ||
    app?.renderer?.domElement?.parentElement ||
    document.body;

  const attachedToBody = host === document.body;

  // --------- Normalize theme (safe defaults) ---------
  const colors = theme.colors || {};
  const shadows = theme.shadows || {};
  const T = {
    teal:       theme.teal       ?? colors.teal       ?? '#14b8a6',
    tealSoft:   theme.tealSoft   ?? colors.tealSoft   ?? 'rgba(20,184,166,0.12)',
    tealFaint:  theme.tealFaint  ?? colors.tealFaint  ?? 'rgba(20,184,166,0.06)',
    bgPanel:    theme.bgPanel    ?? colors.panelBg    ?? 'rgba(255,255,255,0.98)',
    bgCanvas:   theme.bgCanvas   ?? colors.canvasBg   ?? '#0b1220',
    stroke:     theme.stroke     ?? colors.stroke     ?? 'rgba(0,0,0,0.12)',
    text:       theme.text       ?? colors.text       ?? '#0f172a',
    textMuted:  theme.textMuted  ?? colors.textMuted  ?? 'rgba(15,23,42,0.7)'
  };
  const SHADOW = theme.shadow ?? shadows.lg ?? '0 10px 20px rgba(0,0,0,0.15)';

  // --------- Root styles if attaching to <body> ---------
  if (attachedToBody) {
    // ensure positioning does not break layout
    document.body.style.position = document.body.style.position || 'relative';
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

  ui.root.className = 'tools-root';
  ui.dock.className = 'tools-dock';
  ui.body.className = 'tools-body';
  ui.toggleBtn.className = 'tools-toggle';

  Object.assign(ui.root.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    zIndex: 20
  });

  Object.assign(ui.dock.style, {
    position: 'absolute',
    right: '14px',
    top: '14px',
    width: '440px',
    background: T.bgPanel,
    border: `1px solid ${T.stroke}`,
    borderRadius: '16px',
    boxShadow: SHADOW,
    overflow: 'hidden',
    pointerEvents: 'auto',
    transformOrigin: '100% 0%',
    willChange: 'transform, opacity'
  });
  // initial hidden position for tween
  ui.dock.style.transform = 'translateX(480px)';
  ui.dock.style.opacity = '0';
  ui.dock.style.display = 'none';

  Object.assign(ui.header.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    borderBottom: `1px solid ${T.stroke}`,
    background: T.bgPanel
  });

  Object.assign(ui.title.style, {
    fontSize: '14px',
    fontWeight: '700',
    color: T.text,
    flex: '1'
  });
  ui.title.textContent = 'Viewer Tools';

  Object.assign(ui.fitBtn.style, {
    fontSize: '12px',
    padding: '6px 10px',
    borderRadius: '10px',
    background: T.tealSoft,
    border: `1px solid ${T.teal}`,
    color: T.text,
    cursor: 'pointer'
  });
  ui.fitBtn.textContent = 'Snapshot';

  Object.assign(ui.body.style, {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '8px',
    padding: '12px'
  });

  Object.assign(ui.toggleBtn.style, {
    position: 'absolute',
    right: '16px',
    top: '16px',
    padding: '8px 12px',
    borderRadius: '12px',
    border: `1px solid ${T.stroke}`,
    background: T.bgPanel,
    color: T.text,
    fontWeight: '700',
    cursor: 'pointer',
    pointerEvents: 'auto',
    boxShadow: SHADOW,
    transition: 'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, border-color 120ms ease'
  });
  // Hover/active animations
  ui.toggleBtn.addEventListener('mouseenter', () => {
    ui.toggleBtn.style.transform = 'translateY(-1px)';
  });
  ui.toggleBtn.addEventListener('mouseleave', () => {
    ui.toggleBtn.style.transform = 'translateY(0)';
  });

  ui.header.appendChild(ui.title);
  ui.header.appendChild(ui.fitBtn);
  ui.dock.appendChild(ui.header);
  ui.dock.appendChild(ui.body);
  ui.root.appendChild(ui.dock);
  ui.root.appendChild(ui.toggleBtn);

  // Attach to resolved host
  host.appendChild(ui.root);

  // ---------- Helpers ----------
  function mkSection(label) {
    const wrap = document.createElement('div');
    const h = document.createElement('div');
    Object.assign(h.style, {
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: T.textMuted,
      padding: '4px 2px'
    });
    h.textContent = label;
    wrap.appendChild(h);
    return { wrap, header: h };
  }

  function mkRow(label, content) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px'
    });
    if (label) {
      const l = document.createElement('div');
      l.textContent = label;
      Object.assign(l.style, { fontSize: '13px', color: T.text });
      row.appendChild(l);
    }
    row.appendChild(content);
    return row;
  }

  function mkToggle(label, onChange) {
    const wrap = document.createElement('div');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const lab = document.createElement('label');
    lab.textContent = label;
    Object.assign(lab.style, { fontSize: '13px', color: T.text });
    Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '8px' });
    cb.addEventListener('change', () => onChange(!!cb.checked));
    wrap.appendChild(cb);
    wrap.appendChild(lab);
    return { wrap, cb };
  }

  function mkButton(label, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      padding: '8px 12px',
      borderRadius: '12px',
      border: `1px solid ${T.stroke}`,
      background: T.bgPanel,
      color: T.text,
      fontWeight: '700',
      cursor: 'pointer',
      pointerEvents: 'auto',
      boxShadow: SHADOW,
      transition: 'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, border-color 120ms ease'
    });
    b.addEventListener('mouseenter', () => {
      b.style.transform = 'translateY(-1px)';
      b.style.boxShadow = '0 6px 16px rgba(0,0,0,0.12)';
    });
    b.addEventListener('mouseleave', () => {
      b.style.transform = 'translateY(0)';
      b.style.boxShadow = SHADOW;
    });
    b.addEventListener('click', onClick);
    return b;
  }

  // ---------- Sections ----------
  const secModes = mkSection('Render');
  const secExpl  = mkSection('Explode');
  const secClip  = mkSection('Section');
  const secView  = mkSection('Views');
  const secProj  = mkSection('Projection');
  const secScene = mkSection('Scene');

  ui.body.appendChild(secModes.wrap);
  ui.body.appendChild(secExpl.wrap);
  ui.body.appendChild(secClip.wrap);
  ui.body.appendChild(secView.wrap);
  ui.body.appendChild(secProj.wrap);
  ui.body.appendChild(secScene.wrap);

  // ----- Render modes -----
  const btnSolid = mkButton('Solid', () => setWire(false));
  const btnWire  = mkButton('Wireframe', () => setWire(true));
  secModes.wrap.appendChild(mkRow('', (()=>{
    const co = document.createElement('div');
    Object.assign(co.style, { display:'flex', gap:'8px' });
    co.appendChild(btnSolid); co.appendChild(btnWire);
    return co;
  })()));
  function setWire(wire) {
    (app?.scene || {}).traverse?.(o => {
      if (o.isMesh && o.material) {
        o.material.wireframe = !!wire;
        o.material.needsUpdate = true;
      }
    });
  }

  // ----- Explode -----
  const explWrap = document.createElement('div');
  Object.assign(explWrap.style, { display: 'grid', gap: '6px' });
  const explSlider = document.createElement('input');
  explSlider.type = 'range'; explSlider.min = '0'; explSlider.max = '1'; explSlider.step = '0.001'; explSlider.value = '0';
  const explLabel = document.createElement('div');
  Object.assign(explLabel.style, { fontSize: '12px', color: T.textMuted });
  explLabel.textContent = '0%';
  explWrap.appendChild(explSlider);
  explWrap.appendChild(explLabel);
  secExpl.wrap.appendChild(explWrap);

  const explode = (function(){
    const saved = new Map(); // mesh -> { pos: Vector3 }
    const base  = new Map(); // mesh -> { dir: Vector3, dist: number }

    function prepare() {
      saved.clear(); base.clear();
      const root = app?.robot || app?.scene;
      if (!root) return;
      root.updateMatrixWorld?.(true);
      const bb = new THREE.Box3().setFromObject(root);
      const center = bb.getCenter(new THREE.Vector3());
      const diag = bb.getSize(new THREE.Vector3()).length() || 1;

      root.traverse?.(o => {
        if (o.isMesh && o.geometry) {
          saved.set(o, { pos: o.position.clone() });
          const obb = new THREE.Box3().setFromObject(o);
          const c   = obb.getCenter(new THREE.Vector3());
          const dir = c.clone().sub(center);
          if (dir.lengthSq() < 1e-6) dir.set(1,0,0);
          dir.normalize();
          const dist = 0.25 * diag;
          base.set(o, { dir, dist });
        }
      });
    }

    function apply(k) {
      if (base.size === 0) prepare();
      base.forEach((info, m) => {
        const target = info.dir.clone().multiplyScalar(info.dist * k);
        const src = saved.get(m)?.pos || new THREE.Vector3();
        m.position.copy(src.clone().add(target));
      });
      app?.renderer?.render?.(app.scene, app.camera);
    }

    function destroy() {
      base.forEach((info, m) => {
        const src = saved.get(m)?.pos || new THREE.Vector3();
        m.position.copy(src);
      });
      saved.clear(); base.clear();
    }
    return { prepare, apply, destroy };
  })();

  explSlider.addEventListener('input', () => {
    const k = parseFloat(explSlider.value || '0') || 0;
    explLabel.textContent = Math.round(k * 100) + '%';
    explode.apply(k);
  });

  // ----- Section plane -----
  const secWrap = document.createElement('div');
  Object.assign(secWrap.style, { display: 'grid', gap: '6px' });
  const secChk = mkToggle('Enable Section (Y plane)', (on) => setSection(on));
  const secSlider = document.createElement('input');
  secSlider.type = 'range'; secSlider.min = '-1'; secSlider.max = '1'; secSlider.step = '0.001'; secSlider.value = '0';
  secWrap.appendChild(secChk.wrap);
  secWrap.appendChild(secSlider);
  secClip.wrap.appendChild(secWrap);

  let secPlane = null;
  let secVisual = null;

  function setSection(on) {
    const r = app?.renderer;
    const sc = app?.scene;
    if (!r || !sc || !app?.camera) return;

    if (on && !secPlane) {
      secPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      r.localClippingEnabled = true;
      r.clippingPlanes = [secPlane];

      const geo = new THREE.PlaneGeometry(10, 10, 1, 1);
      const mat = new THREE.MeshBasicMaterial({ color: T.teal, opacity: 0.08, transparent: true, side: THREE.DoubleSide });
      secVisual = new THREE.Mesh(geo, mat);
      sc.add(secVisual);
    }
    if (!on && secPlane) {
      r.localClippingEnabled = false;
      r.clippingPlanes = [];
      if (secVisual) sc.remove(secVisual);
      secPlane = null; secVisual = null;
    }
  }

  secSlider.addEventListener('input', () => {
    if (!secPlane) return;
    const k = parseFloat(secSlider.value || '0') || 0;
    secPlane.constant = -k * 2.0;
    if (secVisual) {
      secVisual.position.set(0, k * 2.0, 0);
      secVisual.rotation.x = Math.PI / 2;
      secVisual.scale.set(5, 5, 1);
    }
    app?.renderer?.render?.(app.scene, app.camera);
  });

  // ----- Views -----
  const btnIso = mkButton('ISO', () => setView('iso'));
  const btnTop = mkButton('Top', () => setView('top'));
  const btnFront = mkButton('Front', () => setView('front'));
  const btnRight = mkButton('Right', () => setView('right'));
  secView.wrap.appendChild(mkRow('', (()=>{
    const co = document.createElement('div');
    Object.assign(co.style, { display:'flex', gap:'8px', flexWrap: 'wrap' });
    co.appendChild(btnIso); co.appendChild(btnTop); co.appendChild(btnFront); co.appendChild(btnRight);
    return co;
  })()));

  function setView(which) {
    const cam = app?.camera;
    const ctl = app?.controls;
    if (!cam || !ctl) return;
    const r = 2.2 * (ctl.target.length() + 1);
    const pos = new THREE.Vector3();
    if (which === 'top')    pos.set(0,  r, 0);
    if (which === 'front')  pos.set(0,  0,  r);
    if (which === 'right')  pos.set(r,  0,  0);
    if (which === 'iso')    pos.set(r,  r*0.7, r);
    tweenCamera(cam.position.clone(), pos, ctl.target.clone(), ctl.target.clone(), 420);
  }

  // ----- Projection -----
  const togOrtho = mkToggle('Orthographic', (on) => setOrtho(on));
  secProj.wrap.appendChild(mkRow('', togOrtho.wrap));

  function setOrtho(on) {
    const { camera, renderer, controls, scene } = app || {};
    if (!camera || !renderer || !controls || !scene) return;

    if (on && camera.isPerspectiveCamera) {
      const aspect = renderer.domElement.clientWidth / Math.max(1, renderer.domElement.clientHeight);
      const size = controls.target.length() + 2;
      const oc = new THREE.OrthographicCamera(-size*aspect, size*aspect, size, -size, 0.1, 1e5);
      oc.position.copy(camera.position);
      oc.up.copy(camera.up);
      oc.lookAt(controls.target);
      app.camera = oc;
      app.controls.object = oc;
      scene.add(oc);
    }
    if (!on && app.camera.isOrthographicCamera) {
      const pc = new THREE.PerspectiveCamera(45, renderer.domElement.clientWidth / Math.max(1, renderer.domElement.clientHeight), 0.01, 1e5);
      pc.position.copy(app.camera.position);
      pc.up.copy(app.camera.up);
      pc.lookAt(app.controls.target);
      app.camera = pc;
      app.controls.object = pc;
      scene.add(pc);
    }
  }

  // ----- Scene toggles -----
  const togGrid   = mkToggle('Grid',    (on) => setHelper('grid', on));
  const togGround = mkToggle('Ground',  (on) => setHelper('ground', on));
  const togAxes   = mkToggle('Axes',    (on) => setHelper('axes', on));
  secScene.wrap.appendChild(mkRow('', togGrid.wrap));
  secScene.wrap.appendChild(mkRow('', togGround.wrap));
  secScene.wrap.appendChild(mkRow('', togAxes.wrap));

  function setHelper(which, on) {
    console.debug('[ToolsDock] helper', which, on);
    // hook your helpers here if you have them in app.*
  }

  // ---------- Utilities ----------
  function tweenCamera(fromPos, toPos, fromTarget, toTarget, ms = 420) {
    const cam = app?.camera;
    const ctl = app?.controls;
    if (!cam || !ctl) return;

    const start = performance.now();
    const ease = (t) => (t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2);

    function step(t) {
      const u = Math.min(1, (t - start) / ms);
      const e = ease(u);
      cam.position.set(
        fromPos.x + (toPos.x - fromPos.x) * e,
        fromPos.y + (toPos.y - fromPos.y) * e,
        fromPos.z + (toPos.z - fromPos.z) * e
      );
      const tx = fromTarget.x + (toTarget.x - fromTarget.x) * e;
      const ty = fromTarget.y + (toTarget.y - fromTarget.y) * e;
      const tz = fromTarget.z + (toTarget.z - fromTarget.z) * e;
      ctl.target.set(tx, ty, tz);
      cam.lookAt(ctl.target);
      ctl.update();
      if (u < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function styleDockLeft(dockEl) {
    dockEl.classList.add('viewer-dock-fix');
    Object.assign(dockEl.style, { right: 'auto', left: '16px', top: '16px' });
  }

  // ---------- Open/close (tweened) ----------
  let isOpen = false;
  let animId = null;
  const ANIM_MS = 320;

  function animateDock(targetOpen) {
    if (!ui || !ui.dock) return;
    if (animId) cancelAnimationFrame(animId);

    ui.dock.style.display = 'block';
    ui.dock.style.willChange = 'transform, opacity';
    ui.dock.style.pointerEvents = targetOpen ? 'auto' : 'none';

    const start = performance.now();
    const from = isOpen ? 1 : 0;
    const to   = targetOpen ? 1 : 0;
    const CLOSED_TX = 480;
    const ease = (t) => (t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2);

    function step(t) {
      const u = Math.min(1, (t - start) / ANIM_MS);
      const e = ease(u);
      const k = from + (to - from) * e;
      const tx = (1 - k) * CLOSED_TX;
      ui.dock.style.transform = `translateX(${tx}px)`;
      ui.dock.style.opacity = String(k);
      animId = (u < 1) ? requestAnimationFrame(step) : null;

      if (!animId) {
        isOpen = !!targetOpen;
        ui.dock.style.willChange = 'auto';
        ui.dock.style.pointerEvents = isOpen ? 'auto' : 'none';
        if (!isOpen) ui.dock.style.display = 'none';
        ui.toggleBtn.textContent = isOpen ? 'Close Tools' : 'Open Tools';
        if (isOpen) styleDockLeft(ui.dock);
      }
    }
    requestAnimationFrame(step);
  }

  function set(open) { animateDock(!!open); }
  function openDock() { set(true); }
  function closeDock() { set(false); }
  function toggleDock() { set(!isOpen); }

  ui.toggleBtn.textContent = 'Open Tools';
  ui.toggleBtn.addEventListener('click', () => toggleDock());

  // Snapshot (header only)
  ui.fitBtn.addEventListener('click', () => {
    try {
      const url = app?.renderer?.domElement?.toDataURL?.('image/png');
      if (!url) return;
      const a = document.createElement('a');
      a.href = url; a.download = 'snapshot.png';
      a.click();
    } catch (e) {
      console.warn('[ToolsDock] Snapshot failed:', e);
    }
  });

  // Start closed
  set(false);

  // Public API
  function destroy() {
    try { ui.toggleBtn.remove(); } catch (_) {}
    try { ui.dock.remove(); } catch (_) {}
    try { ui.root.remove(); } catch (_) {}
  }

  return { open: openDock, close: closeDock, set, toggle: toggleDock, destroy };
}

