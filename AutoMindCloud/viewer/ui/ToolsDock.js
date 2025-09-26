// /viewer/ui/ToolsDock.js
/* global THREE */

// Floating tools dock: render modes, explode (smoothed), section plane,
// views, projection, scene toggles, snapshot.
// Incluye hotkey 'h' con el MISMO esquema de detección que usas en SelectionAndDrag.js

export function createToolsDock(app, theme) {
  if (!app || !app.camera || !app.controls || !app.renderer) {
    throw new Error('[ToolsDock] Missing app.camera/controls/renderer');
  }

  // --- Normaliza theme (compat con Theme.js anidado) ---
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
  theme = Object.assign({
    teal: '#0ea5a6',
    tealSoft: '#14b8a6',
    tealFaint: 'rgba(20,184,166,0.10)',
    bgPanel: '#ffffff',
    stroke: '#dfe7ea',
    text: '#0b3b3c',
    textMuted: '#3b5b5c',
    shadow: '0 6px 18px rgba(0,0,0,0.10)'
  }, theme || {});

  // ---------- Helpers UI ----------
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
    b.addEventListener('mouseenter', () => {
      b.style.transform = 'translateY(-1px) scale(1.02)';
      b.style.background = theme.tealFaint;
      b.style.borderColor = theme.tealSoft ?? theme.teal;
    });
    b.addEventListener('mouseleave', () => {
      b.style.transform = 'none';
      b.style.background = theme.bgPanel;
      b.style.borderColor = theme.stroke;
    });
    b.addEventListener('mousedown', () => { b.style.transform = 'translateY(0) scale(0.99)'; });
    b.addEventListener('mouseup',   () => { b.style.transform = 'translateY(-1px) scale(1.02)'; });
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
    options.forEach(o => { const opt = document.createElement('option'); opt.value = o; opt.textContent = o; sel.appendChild(opt); });
    sel.value = value;
    Object.assign(sel.style, {
      padding: '8px',
      border: `1px solid ${theme.stroke}`,
      borderRadius: '10px',
      pointerEvents: 'auto',
      background: theme.bgPanel,
      color: theme.text
    });
    return sel;
  };

  const mkSlider = (min, max, step, value) => {
    const s = document.createElement('input');
    s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = value;
    s.style.width = '100%';
    s.style.accentColor = theme.teal;
    s.style.pointerEvents = 'auto';
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

  // ---------- DOM ----------
  const ui = {
    root: document.createElement('div'),
    dock: document.createElement('div'),
    header: document.createElement('div'),
    title: document.createElement('div'),
    body: document.createElement('div'),
    toggleBtn: document.createElement('button'),
    headerSnapshotBtn: null
  };

  Object.assign(ui.root.style, {
    position: 'absolute',
    left: '0', top: '0',
    width: '100%', height: '100%',
    pointerEvents: 'none',
    zIndex: '9999',
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial'
  });

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
    display: 'none',
    opacity: '0',
    transform: 'translateX(-110%)',
    transition: 'transform 260ms ease, opacity 260ms ease'
  });
  ui.dock.setAttribute('data-tools-dock', '1');
  ui.dock.classList.add('viewer-dock-fix');

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

  // Compose
  ui.headerSnapshotBtn = mkButton('Snapshot');
  Object.assign(ui.headerSnapshotBtn.style, { padding: '6px 10px', borderRadius: '10px' });

  ui.header.appendChild(ui.title);
  ui.header.appendChild(ui.headerSnapshotBtn);
  ui.dock.appendChild(ui.header);
  ui.dock.appendChild(ui.body);
  ui.root.appendChild(ui.dock);
  ui.root.appendChild(ui.toggleBtn);

  const host = (app?.renderer?.domElement?.parentElement) || document.body;
  host.appendChild(ui.root);

  // ---------- Controles del panel ----------
  const renderModeSel = mkSelect(['Solid', 'Wireframe', 'X-Ray', 'Ghost'], 'Solid');
  const explodeSlider = mkSlider(0, 1, 0.01, 0);

  const axisSel = mkSelect(['X', 'Y', 'Z'], 'X');
  const secDist = mkSlider(-1, 1, 0.001, 0);
  const secEnable = mkToggle('Enable section');
  const secShowPlane = mkToggle('Show slice plane');

  const rowCam = document.createElement('div');
  Object.assign(rowCam.style, { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', margin: '8px 0' });
  const bIso   = mkButton('Iso');
  const bTop   = mkButton('Top');
  const bFront = mkButton('Front');
  const bRight = mkButton('Right');
  [bIso, bTop, bFront, bRight].forEach(b => { b.style.padding = '8px'; b.style.borderRadius = '10px'; });

  const projSel = mkSelect(['Perspective', 'Orthographic'], 'Perspective');
  const togGrid   = mkToggle('Grid');
  const togGround = mkToggle('Ground & shadows');
  const togAxes   = mkToggle('XYZ axes');

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

  // ---------- Open/close con animación ----------
  function set(open) {
    if (open) {
      ui.dock.style.display = 'block';
      requestAnimationFrame(() => {
        ui.dock.style.transform = 'translateX(0)';
        ui.dock.style.opacity = '1';
      });
      ui.toggleBtn.textContent = 'Close Tools';
      explode.prepare();
    } else {
      ui.dock.style.transform = 'translateX(-110%)';
      ui.dock.style.opacity = '0';
      const onEnd = () => {
        if (ui.dock.style.transform.includes('-110%')) ui.dock.style.display = 'none';
        ui.dock.removeEventListener('transitionend', onEnd);
      };
      ui.dock.addEventListener('transitionend', onEnd);
      ui.toggleBtn.textContent = 'Open Tools';
    }
  }
  function openDock() { set(true); }
  function closeDock() { set(false); }
  ui.toggleBtn.addEventListener('click', () => set(ui.dock.style.display === 'none'));

  // ---------- Snapshot ----------
  ui.headerSnapshotBtn.addEventListener('click', () => {
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

    // Orientar el plano visual
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

  // ---------- Vistas (animadas) ----------
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
    return t.clone().add(dirFromAzEl(az, el).multiplyScalar(cur.r));
  }

  bIso.addEventListener('click',   () => tweenOrbits(app.camera, app.controls, viewEndPosition('iso'),   null, 750));
  bTop.addEventListener('click',   () => tweenOrbits(app.camera, app.controls, viewEndPosition('top'),   null, 750));
  bFront.addEventListener('click', () => tweenOrbits(app.camera, app.controls, viewEndPosition('front'), null, 750));
  bRight.addEventListener('click', () => tweenOrbits(app.camera, app.controls, viewEndPosition('right'), null, 750));

  // ---------- Proyección ----------
  projSel.addEventListener('change', () => {
    const mode = projSel.value === 'Orthographic' ? 'Orthographic' : 'Perspective';
    try { app.setProjection?.(mode); } catch (_) {}
  });

  // ---------- Toggles de escena ----------
  togGrid.cb.addEventListener('change',   () => app.setSceneToggles?.({ grid: !!togGrid.cb.checked }));
  togGround.cb.addEventListener('change', () => app.setSceneToggles?.({ ground: !!togGround.cb.checked, shadows: !!togGround.cb.checked }));
  togAxes.cb.addEventListener('change',   () => app.setSceneToggles?.({ axes: !!togAxes.cb.checked }));

  // ============================================================
  //                  EXPLODE (tween con resorte suave)
  // ============================================================
  function makeExplodeManager() {
    const registry = []; // { node, parent, baseLocal:Vector3, dirLocal:Vector3 }
    const marker = new WeakSet();
    let maxDim = 1;
    let prepared = false;

    // spring state
    let current = 0, target = 0, vel = 0, raf = null, lastT = 0;
    const stiffness = 18;
    const damping   = 2 * Math.sqrt(stiffness);
    let zeroSince = null;

    function worldDirToParentLocal(parent, dirWorld) {
      const m = new THREE.Matrix4().copy(parent.matrixWorld).invert();
      const n = new THREE.Matrix3().setFromMatrix4(m);
      return dirWorld.clone().applyMatrix3(n).normalize();
    }

    function chooseTopPartFor(mesh) {
      let n = mesh;
      while (n && n !== app.robot) {
        if (marker.has(n)) return n;
        if (n.parent === app.robot) return n;
        n = n.parent;
      }
      return mesh.parent || mesh;
    }

    function computeBounds() {
      const box = new THREE.Box3().setFromObject(app.robot);
      if (box.isEmpty()) return null;
      return { center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
    }

    function prepare() {
      registry.length = 0;
      if (!app.robot) { prepared = false; return; }

      const R = computeBounds();
      if (!R) { prepared = false; return; }
      maxDim = Math.max(R.size.x, R.size.y, R.size.z) || 1;

      const parts = new Set();
      const seen = new WeakSet();
      app.robot.traverse((o) => {
        if (o.isMesh && o.geometry && o.visible && !o.userData.__isHoverOverlay) {
          const top = chooseTopPartFor(o);
          if (!seen.has(top)) { parts.add(top); seen.add(top); marker.add(top); }
        }
      });

      parts.forEach((node) => {
        const parent = node.parent || app.robot;
        const baseLocal = node.position.clone();

        const box = new THREE.Box3().setFromObject(node);
        if (box.isEmpty()) return;
        const cWorld = box.getCenter(new THREE.Vector3());
        const dirWorld = cWorld.sub(R.center).normalize();
        if (!isFinite(dirWorld.x + dirWorld.y + dirWorld.z)) return;

        const dirLocal = worldDirToParentLocal(parent, dirWorld);
        if (!isFinite(dirLocal.x + dirLocal.y + dirLocal.z) || dirLocal.lengthSq() < 1e-12) {
          dirLocal.set((Math.random()*2-1), (Math.random()*2-1), (Math.random()*2-1)).normalize();
        }

        registry.push({ node, parent, baseLocal, dirLocal });
      });

      prepared = true;
      zeroSince = performance.now();
    }

    function applyAmount(a01) {
      if (!prepared) prepare();
      const f = Math.max(0, Math.min(1, a01 || 0));
      const maxOffset = maxDim * 0.6;

      for (const rec of registry) {
        const { node, baseLocal, dirLocal } = rec;
        node.position.copy(baseLocal).addScaledVector(dirLocal, f * maxOffset);
      }
      updateSectionPlane?.();
      try { app.controls?.update?.(); app.renderer?.render?.(app.scene, app.camera); } catch(_) {}
    }

    function tickSpring(now) {
      if (!lastT) lastT = now;
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      const x = current, v = vel, xT = target;
      const a = stiffness * (xT - x) - damping * v;
      vel = v + a * dt;
      current = x + vel * dt;

      if (Math.abs(current - target) < 0.0005 && Math.abs(vel) < 0.0005) {
        current = target; vel = 0;
      }

      applyAmount(current);

      if (current === 0) {
        zeroSince ??= now;
        if (now - zeroSince > 300) {
          const keepTarget = target;
          prepare();
          applyAmount(current);
          target = keepTarget;
          zeroSince = now;
        }
      } else {
        zeroSince = null;
      }

      if (current !== target || vel !== 0) raf = requestAnimationFrame(tickSpring);
      else raf = null;
    }

    function setTarget(a01) {
      target = Math.max(0, Math.min(1, Number(a01) || 0));
      if (!prepared) prepare();
      if (!raf) { lastT = 0; raf = requestAnimationFrame(tickSpring); }
    }

    function immediate(a01) {
      target = current = Math.max(0, Math.min(1, Number(a01) || 0));
      vel = 0;
      if (!prepared) prepare();
      applyAmount(current);
    }

    function recalibrate() { prepare(); applyAmount(current); }
    function destroy() { if (raf) cancelAnimationFrame(raf); raf = null; }

    return { prepare, setTarget, immediate, recalibrate, destroy };
  }
  const explode = makeExplodeManager();
  try { app.explodeRecalibrate = () => explode.recalibrate(); } catch(_) {}
  explodeSlider.addEventListener('input', () => explode.setTarget(Number(explodeSlider.value) || 0));

  // ---------- Defaults ----------
  const togGrid = togGrid ?? null; // quiet lint
  const togGround = togGround ?? null;
  const togAxes = togAxes ?? null;
  set(false); // arranca cerrado

  // ---------- Hotkey 'h' (MISMO sistema que SelectionAndDrag.js) ----------
  // Escucha en canvas y en document, fase de captura = true, compara e.key en minúsculas.
  const onKeyDown = (e) => {
    const k = (e.key || '').toLowerCase();
    if (k === 'h') {
      console.log('[ToolsDock] h pressed');
      const isClosed = (ui.dock.style.display === 'none') || (ui.dock.style.opacity === '0');
      set(isClosed);
      e.preventDefault();
      e.stopPropagation();
    }
  };
  app.renderer.domElement.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keydown', onKeyDown, true);

  // ---------- Proyección / Scene toggles (después de defaults para evitar hoist warnings) ----------
  projSel.addEventListener('change', () => {
    const mode = projSel.value === 'Orthographic' ? 'Orthographic' : 'Perspective';
    try { app.setProjection?.(mode); } catch (_) {}
  });
  togGrid.cb.addEventListener('change',   () => app.setSceneToggles?.({ grid: !!togGrid.cb.checked }));
  togGround.cb.addEventListener('change', () => app.setSceneToggles?.({ ground: !!togGround.cb.checked, shadows: !!togGround.cb.checked }));
  togAxes.cb.addEventListener('change',   () => app.setSceneToggles?.({ axes: !!togAxes.cb.checked }));

  // ---------- API pública ----------
  function destroy() {
    try { app.renderer.domElement.removeEventListener('keydown', onKeyDown, true); } catch(_) {}
    try { document.removeEventListener('keydown', onKeyDown, true); } catch(_) {}
    try { ui.toggleBtn.remove(); } catch (_) {}
    try { ui.dock.remove(); } catch (_) {}
    try { ui.root.remove(); } catch (_) {}
    try {
      app.renderer.localClippingEnabled = false;
      app.renderer.clippingPlanes = [];
      // quitar visual del plano si existe
      const children = app.scene?.children || [];
      for (let i = children.length - 1; i >= 0; i--) {
        if (children[i] === secVisual) {
          app.scene.remove(secVisual);
          break;
        }
      }
    } catch (_) {}
    explode.destroy();
  }

  return { open: openDock, close: closeDock, set, destroy };
}

