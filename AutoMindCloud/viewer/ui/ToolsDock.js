// /viewer/ui/ToolsDock.js
// Floating "Viewer Tools" dock (left) + toggle button (top-right)
// - Solid/Wireframe/X-Ray/Ghost render
// - Section plane on whole robot
// - Iso/Top/Front/Right tween views
// - Projection switch
// - Grid / Ground+Shadows / Axes toggles
// - Snapshot button
// - Hotkeys: 't' or 'c' toggle tools

/* global THREE */

export function createToolsDock(app, theme) {
  if (!app || !app.scene || !app.renderer || !app.camera || !app.controls) {
    throw new Error('[ToolsDock] Missing required viewer APIs');
  }

  // Theme defaults
  theme = theme || {};
  theme.colors = theme.colors || {};
  const TEAL = theme.colors.teal ?? '#0ea5a6';
  const BORDER = theme.colors.border ?? '#e6e6e6';
  const TEXT = theme.colors.text ?? '#0b3b3c';
  const MUTED = theme.colors.muted ?? '#577e7f';
  const SHADOW = theme.colors.shadow ?? 'rgba(0,0,0,.14)';
  const PANEL_BG = theme.colors.panelBg ?? '#ffffff';
  const HDR_BG = theme.colors.hdrBg ?? TEAL;
  const HDR_TEXT = theme.colors.hdrText ?? '#ffffff';

  if (theme && theme.shadows) {
    // keep (used by other modules if needed)
  }

  // UI scale (50% more tiny)
  const UI_SCALE = 0.5;

  const renderer = app.renderer;
  const scene = app.scene;

  const persp = app.camera; // main
  const ortho = app.orthoCamera || null;
  let camera = app.camera;
  const controls = app.controls;

  // Helpers
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const easeInOutCubic = (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  // UI root
  const ui = {
    root: document.createElement('div'),
    dock: document.createElement('div'),
    toggleBtn: document.createElement('button'),
  };

  Object.assign(ui.root.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '9999',
    fontFamily:
      '"Computer Modern","CMU Serif",Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial',
  });

  // Panel base
  Object.assign(ui.dock.style, {
    position: 'absolute',
    top: '54px',
    left: '14px',
    width: '440px',
    borderRadius: '18px',
    border: `1px solid ${BORDER}`,
    background: PANEL_BG,
    boxShadow: `0 12px 36px ${SHADOW}`,
    overflow: 'hidden',
    pointerEvents: 'auto',

    // IMPORTANT: include scale inside same transform used for open/close
    willChange: 'transform, opacity',
    transformOrigin: 'top left',
    transform: `translateX(-520px) scale(${UI_SCALE})`,
    opacity: '0',
    transition:
      'transform 260ms cubic-bezier(.2,.7,.2,1), opacity 180ms ease',
  });

  // Toggle button (top-right floating)
  Object.assign(ui.toggleBtn.style, {
    position: 'absolute',
    right: '14px',
    top: '14px',
    pointerEvents: 'auto',
    padding: '8px 12px',
    borderRadius: '999px',
    border: `1px solid ${BORDER}`,
    background: '#ffffff',
    color: TEXT,
    fontWeight: '700',
    cursor: 'pointer',
    boxShadow: `0 12px 36px ${SHADOW}`,
    zIndex: '10000',
    transition: 'transform 120ms ease, box-shadow 160ms ease, background 160ms ease, border-color 160ms ease',
  });

  // Apply scale to floating toggle button (keeps hover animations)
  ui.toggleBtn.style.transformOrigin = 'top right';
  ui.toggleBtn.style.transform = `scale(${UI_SCALE})`;

  ui.toggleBtn.addEventListener('mouseenter', () => {
    ui.toggleBtn.style.transform = `translateY(-1px) scale(${UI_SCALE * 1.02})`;
    ui.toggleBtn.style.background = '#ecfeff';
    ui.toggleBtn.style.borderColor = TEAL;
    ui.toggleBtn.style.boxShadow = '0 16px 40px rgba(0,0,0,.18)';
  });
  ui.toggleBtn.addEventListener('mouseleave', () => {
    ui.toggleBtn.style.transform = `scale(${UI_SCALE})`;
    ui.toggleBtn.style.background = '#ffffff';
    ui.toggleBtn.style.borderColor = BORDER;
    ui.toggleBtn.style.boxShadow = `0 12px 36px ${SHADOW}`;
  });

  // Header
  const hdr = document.createElement('div');
  Object.assign(hdr.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '10px 12px',
    borderBottom: `1px solid ${BORDER}`,
    background: HDR_BG,
  });

  const hdrLeft = document.createElement('div');
  hdrLeft.textContent = 'Viewer Tools';
  Object.assign(hdrLeft.style, { fontWeight: '800', color: HDR_TEXT });

  const hdrRight = document.createElement('div');
  Object.assign(hdrRight.style, { display: 'flex', gap: '6px', alignItems: 'center' });

  const mkButton = (text) => {
    const b = document.createElement('button');
    b.textContent = text;
    Object.assign(b.style, {
      padding: '8px 12px',
      borderRadius: '12px',
      border: `1px solid ${BORDER}`,
      background: '#ffffff',
      color: TEXT,
      fontWeight: '700',
      cursor: 'pointer',
      boxShadow: '0 10px 24px rgba(0,0,0,.12)',
      transition: 'transform 120ms ease, box-shadow 160ms ease, background 160ms ease, border-color 160ms ease',
      userSelect: 'none',
    });
    b.addEventListener('mouseenter', () => {
      b.style.transform = 'translateY(-1px) scale(1.02)';
      b.style.background = '#ecfeff';
      b.style.borderColor = TEAL;
      b.style.boxShadow = '0 16px 40px rgba(0,0,0,.16)';
    });
    b.addEventListener('mouseleave', () => {
      b.style.transform = 'none';
      b.style.background = '#ffffff';
      b.style.borderColor = BORDER;
      b.style.boxShadow = '0 10px 24px rgba(0,0,0,.12)';
    });
    return b;
  };

  const snapBtn = mkButton('Snapshot');
  snapBtn.style.padding = '6px 12px';
  snapBtn.style.borderRadius = '999px';
  hdrRight.appendChild(snapBtn);

  hdr.appendChild(hdrLeft);
  hdr.appendChild(hdrRight);

  // Body
  const body = document.createElement('div');
  Object.assign(body.style, { padding: '10px 12px' });

  const row = (label, child) => {
    const r = document.createElement('div');
    Object.assign(r.style, {
      display: 'grid',
      gridTemplateColumns: '120px 1fr',
      gap: '10px',
      alignItems: 'center',
      margin: '6px 0',
    });
    const l = document.createElement('div');
    l.textContent = label;
    Object.assign(l.style, { color: MUTED, fontWeight: '700' });
    r.appendChild(l);
    r.appendChild(child);
    return r;
  };

  const mkSelect = (opts, val) => {
    const s = document.createElement('select');
    Object.assign(s.style, {
      padding: '8px',
      border: `1px solid ${BORDER}`,
      borderRadius: '10px',
      accentColor: TEAL,
    });
    opts.forEach((o) => {
      const op = document.createElement('option');
      op.value = o;
      op.textContent = o;
      s.appendChild(op);
    });
    s.value = val;
    return s;
  };

  const mkSlider = (min, max, step, val) => {
    const s = document.createElement('input');
    s.type = 'range';
    s.min = String(min);
    s.max = String(max);
    s.step = String(step);
    s.value = String(val);
    Object.assign(s.style, { padding: '8px', accentColor: TEAL });
    return s;
  };

  const mkToggle = (label, init = false) => {
    const wrap = document.createElement('label');
    Object.assign(wrap.style, {
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
      cursor: 'pointer',
    });
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = init;
    cb.style.accentColor = TEAL;
    const sp = document.createElement('span');
    sp.textContent = label;
    Object.assign(sp.style, { fontWeight: '700', color: TEXT });
    wrap.appendChild(cb);
    wrap.appendChild(sp);
    return { wrap, cb };
  };

  const renderModeSel = mkSelect(['Solid', 'Wireframe', 'X-Ray', 'Ghost'], 'Solid');

  const axisSel = mkSelect(['X', 'Y', 'Z'], 'X');
  const secDist = mkSlider(-1, 1, 0.001, 0);
  const secToggle = mkToggle('Enable section', false);
  const secPlaneToggle = mkToggle('Show slice plane', false);

  const viewsRow = document.createElement('div');
  Object.assign(viewsRow.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(4,1fr)',
    gap: '8px',
    margin: '8px 0',
  });

  const bIso = mkButton('Iso');
  const bTop = mkButton('Top');
  const bFront = mkButton('Front');
  const bRight = mkButton('Right');
  [bIso, bTop, bFront, bRight].forEach((b) => {
    b.style.padding = '8px';
    b.style.borderRadius = '10px';
    b.style.boxShadow = '0 10px 24px rgba(0,0,0,.10)';
  });
  viewsRow.appendChild(bIso);
  viewsRow.appendChild(bTop);
  viewsRow.appendChild(bFront);
  viewsRow.appendChild(bRight);

  const projSel = mkSelect(['Perspective', 'Orthographic'], 'Perspective');

  const togGrid = mkToggle('Grid', false);
  const togGround = mkToggle('Ground & shadows', false);
  const togAxes = mkToggle('XYZ axes', false);

  body.appendChild(row('Render mode', renderModeSel));
  body.appendChild(row('Section axis', axisSel));
  body.appendChild(row('Section dist', secDist));
  body.appendChild(row('', secToggle.wrap));
  body.appendChild(row('', secPlaneToggle.wrap));
  body.appendChild(row('Views', viewsRow));
  body.appendChild(row('Projection', projSel));
  body.appendChild(row('', togGrid.wrap));
  body.appendChild(row('', togGround.wrap));
  body.appendChild(row('', togAxes.wrap));

  ui.dock.appendChild(hdr);
  ui.dock.appendChild(body);

  ui.toggleBtn.textContent = 'Open Tools';

  // Mount
  const container = app.container || app.domElement?.parentElement || document.body;
  container.style.position = container.style.position || 'relative';
  container.appendChild(ui.root);
  ui.root.appendChild(ui.dock);
  ui.root.appendChild(ui.toggleBtn);

  // State
  const CLOSED_TX = -520;
  let dockOpen = false;

  function setDock(open) {
    dockOpen = !!open;
    if (dockOpen) {
      ui.dock.style.transform = `translateX(0) scale(${UI_SCALE})`;
      ui.dock.style.opacity = '1';
      ui.toggleBtn.textContent = 'Close Tools';
      ui.dock.style.pointerEvents = 'auto';
    } else {
      ui.dock.style.transform = `translateX(${CLOSED_TX}px) scale(${UI_SCALE})`;
      ui.dock.style.opacity = '0';
      ui.toggleBtn.textContent = 'Open Tools';
      ui.dock.style.pointerEvents = 'none';
    }
  }

  setDock(false);

  ui.toggleBtn.addEventListener('click', () => setDock(!dockOpen));

  // Hotkeys: t / c
  document.addEventListener(
    'keydown',
    (e) => {
      const tag = ((e.target && e.target.tagName) || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.isComposing)
        return;

      if (e.key === 't' || e.key === 'T' || e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setDock(!dockOpen);
      }
    },
    true,
  );

  // Snapshot
  snapBtn.addEventListener('click', () => {
    try {
      const url = renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'snapshot.png';
      a.click();
    } catch (e) {}
  });

  // -------- Scene helpers (Grid/Ground/Axes) ----------
  // Reuse if already created by app; otherwise create minimal ones
  const grid = app.gridHelper || (() => {
    const g = new THREE.GridHelper(10, 20, 0x0ea5a6, 0x0ea5a6);
    g.visible = false;
    scene.add(g);
    app.gridHelper = g;
    return g;
  })();

  const axesHelper = app.axesHelper || (() => {
    const a = new THREE.AxesHelper(1);
    a.visible = false;
    scene.add(a);
    app.axesHelper = a;
    return a;
  })();

  const dirLight = app.dirLight || (() => {
    // Try find a directional light; if none, create one
    let dl = null;
    scene.traverse((n) => {
      if (!dl && n && n.isDirectionalLight) dl = n;
    });
    if (!dl) {
      dl = new THREE.DirectionalLight(0xffffff, 1.05);
      dl.position.set(3, 4, 2);
      scene.add(dl);
    }
    app.dirLight = dl;
    return dl;
  })();

  const ground = app.groundPlane || (() => {
    const mat = new THREE.ShadowMaterial({ opacity: 0.22 });
    mat.transparent = true;
    mat.depthWrite = false;
    const g = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat);
    g.rotation.x = -Math.PI / 2;
    g.position.y = -0.0001;
    g.receiveShadow = true;
    g.visible = false;
    scene.add(g);
    app.groundPlane = g;
    return g;
  })();

  // Shadows default OFF
  renderer.shadowMap.enabled = renderer.shadowMap.enabled || false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  dirLight.castShadow = dirLight.castShadow || false;

  // Model access
  const getModelRoot = () => app.robot || app.model || app.sceneModel || null;

  // Render modes
  function setRenderMode(mode) {
    const root = getModelRoot();
    if (!root) return;
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (!m) return;
        m.wireframe = false;
        m.transparent = false;
        m.opacity = 1.0;
        m.depthWrite = true;
        m.depthTest = true;

        if (mode === 'Wireframe') {
          m.wireframe = true;
        } else if (mode === 'X-Ray') {
          m.transparent = true;
          m.opacity = 0.25;
          m.depthWrite = false;
        } else if (mode === 'Ghost') {
          m.transparent = true;
          m.opacity = 0.6;
          m.depthWrite = false;
        }
        m.needsUpdate = true;
      });
    });
  }

  // Section clipping
  let secEnabled = false;
  let secAxis = 'X';
  let secPlaneVisible = false;
  let secVisual = null;

  function clearSectionClipping() {
    const root = getModelRoot();
    if (!root) return;
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (!m) return;
        m.clippingPlanes = null;
        m.needsUpdate = true;
      });
    });
  }

  function applySectionPlaneToModel(plane) {
    const root = getModelRoot();
    if (!root) return;
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (!m) return;
        m.clippingPlanes = [plane];
        m.needsUpdate = true;
      });
    });
  }

  function ensureSectionVisual() {
    if (!secVisual) {
      const geom = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x0ea5a6,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      secVisual = new THREE.Mesh(geom, mat);
      secVisual.visible = false;
      secVisual.renderOrder = 9999;
      scene.add(secVisual);
    }
    return secVisual;
  }

  function updateSectionPlane(distNorm) {
    const root = getModelRoot();
    if (!secEnabled || !root) {
      renderer.localClippingEnabled = false;
      clearSectionClipping();
      if (secVisual) secVisual.visible = false;
      return;
    }

    const n = new THREE.Vector3(
      secAxis === 'X' ? 1 : 0,
      secAxis === 'Y' ? 1 : 0,
      secAxis === 'Z' ? 1 : 0,
    );

    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) {
      renderer.localClippingEnabled = false;
      clearSectionClipping();
      if (secVisual) secVisual.visible = false;
      return;
    }

    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = distNorm * maxDim * 0.5;
    const plane = new THREE.Plane(n, -dist);

    renderer.localClippingEnabled = true;
    clearSectionClipping();
    applySectionPlaneToModel(plane);

    ensureSectionVisual();

    const thickness = maxDim * 0.004;
    const dim = maxDim * 1.2;

    const look = n.clone();
    const up = Math.abs(look.dot(new THREE.Vector3(0, 1, 0))) > 0.999
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);

    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), look, up);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    secVisual.setRotationFromQuaternion(q);

    secVisual.scale.set(dim, dim, thickness);
    const p0 = n.clone().multiplyScalar(-plane.constant);
    secVisual.position.copy(p0);
    secVisual.visible = !!secPlaneVisible;
  }

  // Bounds for view tween
  let boundsInfo = null;

  function computeBounds() {
    const root = getModelRoot();
    if (!root) return null;
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    return { center, radius: Math.max(1e-8, sphere.radius), box };
  }

  function viewEndPose(kind) {
    if (!boundsInfo) boundsInfo = computeBounds();
    if (!boundsInfo) return null;

    const target = boundsInfo.center.clone();
    const pad = 1.18;
    const effectiveRadius = boundsInfo.radius * pad;

    // get aspect safely
    const w = app.container?.clientWidth || renderer.domElement.clientWidth || 800;
    const h = app.container?.clientHeight || renderer.domElement.clientHeight || 600;
    const aspect = w / h;

    let r;
    if (camera.isPerspectiveCamera) {
      const vFOV = THREE.MathUtils.degToRad(camera.fov);
      const hFOV = 2 * Math.atan(Math.tan(vFOV / 2) * aspect);
      const distV = effectiveRadius / Math.sin(Math.max(1e-6, vFOV / 2));
      const distH = effectiveRadius / Math.sin(Math.max(1e-6, hFOV / 2));
      r = Math.max(distV, distH);
    } else {
      r = effectiveRadius * 2.6;
    }

    let dir = new THREE.Vector3(1, 1, 1);
    if (kind === 'front') dir.set(0, 0, 1);
    if (kind === 'right') dir.set(1, 0, 0);
    if (kind === 'top') dir.set(0.001, 1, 0).normalize();

    dir.normalize();
    const pos = target.clone().add(dir.multiplyScalar(r));
    return { pos, target };
  }

  function tweenCameraToPose(endPos, endTarget, duration = 750) {
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const t0 = performance.now();

    camera.up.set(0, 1, 0);

    function anim() {
      const now = performance.now();
      const t = clamp01((now - t0) / duration);
      const k = easeInOutCubic(t);

      camera.position.lerpVectors(startPos, endPos, k);
      controls.target.lerpVectors(startTarget, endTarget, k);
      camera.lookAt(controls.target);
      controls.update();

      if (t < 1) requestAnimationFrame(anim);
    }
    requestAnimationFrame(anim);
  }

  function viewIso() {
    const v = viewEndPose('iso');
    if (v) tweenCameraToPose(v.pos, v.target, 750);
  }
  function viewFront() {
    const v = viewEndPose('front');
    if (v) tweenCameraToPose(v.pos, v.target, 750);
  }
  function viewRight() {
    const v = viewEndPose('right');
    if (v) tweenCameraToPose(v.pos, v.target, 750);
  }
  function viewTop() {
    const v = viewEndPose('top');
    if (v) tweenCameraToPose(v.pos, v.target, 900);
  }

  // Wire UI actions
  renderModeSel.addEventListener('change', () => setRenderMode(renderModeSel.value));

  axisSel.addEventListener('change', () => {
    secAxis = axisSel.value;
    updateSectionPlane(parseFloat(secDist.value) || 0);
  });

  secDist.addEventListener('input', () => {
    updateSectionPlane(parseFloat(secDist.value) || 0);
  });

  secToggle.cb.addEventListener('change', () => {
    secEnabled = !!secToggle.cb.checked;
    updateSectionPlane(parseFloat(secDist.value) || 0);
  });

  secPlaneToggle.cb.addEventListener('change', () => {
    secPlaneVisible = !!secPlaneToggle.cb.checked;
    updateSectionPlane(parseFloat(secDist.value) || 0);
  });

  bIso.addEventListener('click', viewIso);
  bTop.addEventListener('click', viewTop);
  bFront.addEventListener('click', viewFront);
  bRight.addEventListener('click', viewRight);

  projSel.addEventListener('change', () => {
    const wantOrtho = projSel.value === 'Orthographic';

    if (!ortho) {
      // No orthographic camera available
      projSel.value = 'Perspective';
      return;
    }

    // temporarily disable section (same logic as before)
    const wasSectionEnabled = secEnabled;
    if (secEnabled) {
      secEnabled = false;
      secToggle.cb.checked = false;
      updateSectionPlane(parseFloat(secDist.value) || 0);
    }

    boundsInfo = computeBounds();
    const b = boundsInfo;
    const target = b ? b.center.clone() : controls.target.clone();

    const w = app.container?.clientWidth || renderer.domElement.clientWidth || 800;
    const h = app.container?.clientHeight || renderer.domElement.clientHeight || 600;
    const aspect = w / h;

    if (wantOrtho && camera.isPerspectiveCamera) {
      const dir = camera.position.clone().sub(target).normalize();
      const span = b ? Math.max(b.box.getSize(new THREE.Vector3()).length(), 1) : 1;
      ortho.left = -span * aspect;
      ortho.right = span * aspect;
      ortho.top = span;
      ortho.bottom = -span;
      ortho.position.copy(target).add(dir.multiplyScalar(span * 2));
      ortho.up.copy(camera.up);
      ortho.lookAt(target);
      ortho.updateProjectionMatrix();

      camera = ortho;
      app.camera = ortho;
      controls.object = ortho;
    } else if (!wantOrtho && camera.isOrthographicCamera) {
      const dir = camera.position.clone().sub(target).normalize();
      persp.position.copy(target).add(dir.multiplyScalar(5));
      persp.up.copy(camera.up);
      persp.lookAt(target);
      persp.updateProjectionMatrix();

      camera = persp;
      app.camera = persp;
      controls.object = persp;
    }

    controls.target.copy(target);
    controls.update();

    if (wasSectionEnabled) {
      setTimeout(() => {
        secEnabled = true;
        secToggle.cb.checked = true;
        updateSectionPlane(parseFloat(secDist.value) || 0);
      }, 100);
    }
  });

  togGrid.cb.addEventListener('change', () => {
    grid.visible = !!togGrid.cb.checked;
  });

  togGround.cb.addEventListener('change', () => {
    const on = !!togGround.cb.checked;

    ground.visible = on;
    renderer.shadowMap.enabled = on;
    dirLight.castShadow = on;

    const root = getModelRoot();
    if (root) {
      root.traverse((n) => {
        if (n.isMesh) {
          n.castShadow = on;
          n.receiveShadow = on;
        }
      });
    }

    renderer.render(scene, camera);
  });

  togAxes.cb.addEventListener('change', () => {
    axesHelper.visible = !!togAxes.cb.checked;
  });

  // Public API (optional)
  return {
    setOpen: setDock,
    isOpen: () => dockOpen,
    root: ui.root,
    dock: ui.dock,
    toggleBtn: ui.toggleBtn,
  };
}
