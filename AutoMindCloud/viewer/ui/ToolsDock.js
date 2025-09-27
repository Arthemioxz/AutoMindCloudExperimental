// /viewer/ui/ToolsDock.js
// Floating tools dock: render modes, explode (smoothed & robust), section plane, views, projection, scene toggles, snapshot.
/* global THREE */

export function createToolsDock(app, theme) {
  if (!app || !app.camera || !app.controls || !app.renderer)
    throw new Error('[ToolsDock] Missing app.camera/controls/renderer');

  // --- Normalize theme to flat keys (works with your Theme.js nested shape) ---
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

  // ---------- Helpers (with hover animations intact) ----------
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
    // Hover/active animations (KEEP)
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

  // Floating toggle button (with hover)
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

  // Explode (slider drives a smoothed spring tween; see ExplodeManager below)
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

// ------------------ CONFIG ------------------
const CLOSED_TX = -520; // px, off-screen to the left
let isOpen = false;

// Prepare dock styles once
Object.assign(ui.dock.style, {
  display: 'block',
  willChange: 'transform, opacity',
  transition: 'transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease',
  transform: `translateX(${CLOSED_TX}px)`,
  opacity: '0',
  pointerEvents: 'none'
});

// ------------------ TWEEN LOGIC ------------------
function set(open) {
  isOpen = open;

  if (open) {
    // OPEN tween
    ui.dock.style.opacity = '1';
    ui.dock.style.transform = 'translateX(0)';
    ui.dock.style.pointerEvents = 'auto';
    ui.toggleBtn.textContent = 'Close Tools';
    try { styleDockLeft(ui.dock); } catch(_) {}
    try { explode.prepare(); } catch(_) {}
  } else {
    // CLOSE tween
    ui.dock.style.opacity = '0';
    ui.dock.style.transform = `translateX(${CLOSED_TX}px)`;
    ui.dock.style.pointerEvents = 'none';
    ui.toggleBtn.textContent = 'Open Tools';
  }
}

// Wrappers
function openDock()  { set(true);  }
function closeDock() { set(false); }

// ------------------ EVENT ------------------
ui.toggleBtn.addEventListener('click', () => set(!isOpen));


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

  // ============================================================
  //                       EXPLODE MANAGER
  //  Smooth, spring-tweened explode with robust calibration
  //  - Stable per-part vectors in **parent local space**
  //  - No double-application on nested meshes
  //  - Recalibrates baseline when amount≈0 or on demand
  // ============================================================
  function makeExplodeManager() {
    // Internals
    const registry = []; // { node, baseLocal:Vector3, dirLocal:Vector3 }
    const marker = new WeakSet(); // mark chosen top parts to avoid nesting
    let maxDim = 1;
    let prepared = false;

    // spring state
    let current = 0;            // current explode amount [0..1]
    let target = 0;             // target explode amount [0..1]
    let vel = 0;                // velocity in "amount units / s"
    let raf = null;
    let lastT = 0;
    const stiffness = 18;       // rad/s (ω) — higher snappier
    const damping   = 2 * Math.sqrt(stiffness); // critical damping

    // recalibration timer when at zero
    let zeroSince = null;

    function worldDirToParentLocal(parent, dirWorld) {
      // Convert direction vector from world to parent's local (ignore translation)
      const m = new THREE.Matrix4().copy(parent.matrixWorld).invert();
      const n = new THREE.Matrix3().setFromMatrix4(m); // normal matrix
      return dirWorld.clone().applyMatrix3(n).normalize();
    }

    function chooseTopPartFor(mesh) {
      // climb up until we reach a node whose parent either is the robot root
      // or has already been selected as a part
      let n = mesh;
      while (n && n !== app.robot) {
        if (marker.has(n)) return n; // already chosen
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
      markClear();
      if (!app.robot) { prepared = false; return; }

      const R = computeBounds();
      if (!R) { prepared = false; return; }
      maxDim = Math.max(R.size.x, R.size.y, R.size.z) || 1;

      // collect parts (top-most parents with geometry)
      const parts = new Set();
      const seen = new WeakSet();
      app.robot.traverse((o) => {
        if (o.isMesh && o.geometry && o.visible && !o.userData.__isHoverOverlay) {
          const top = chooseTopPartFor(o);
          if (!seen.has(top)) { parts.add(top); seen.add(top); marker.add(top); }
        }
      });

      // capture base & dir in parent local space
      parts.forEach((node) => {
        const parent = node.parent || app.robot;
        const baseLocal = node.position.clone();

        const box = new THREE.Box3().setFromObject(node);
        if (box.isEmpty()) return;
        const cWorld = box.getCenter(new THREE.Vector3());
        const dirWorld = cWorld.sub(R.center).normalize();
        if (!isFinite(dirWorld.x + dirWorld.y + dirWorld.z)) return;

        const dirLocal = worldDirToParentLocal(parent, dirWorld);
        // if degenerate, jitter slightly
        if (!isFinite(dirLocal.x + dirLocal.y + dirLocal.z) || dirLocal.lengthSq() < 1e-12) {
          dirLocal.set((Math.random()*2-1), (Math.random()*2-1), (Math.random()*2-1)).normalize();
        }

        registry.push({ node, parent, baseLocal, dirLocal });
      });

      prepared = true;
      zeroSince = performance.now(); // fresh baseline considered "zero"
    }

    function markClear() {
      // (no-op now, we simply let WeakSets be GC'd)
    }

    function applyAmount(a01) {
      if (!prepared) prepare();
      const f = Math.max(0, Math.min(1, a01 || 0));
      const maxOffset = maxDim * 0.6;

      for (const rec of registry) {
        const { node, baseLocal, dirLocal } = rec;
        node.position.copy(baseLocal).addScaledVector(dirLocal, f * maxOffset);
      }

      // keep section visuals and other helpers in sync
      updateSectionPlane?.();
      // render one frame so it feels responsive even if main loop is paused
      try { app.controls?.update?.(); app.renderer?.render?.(app.scene, app.camera); } catch(_) {}
    }

    function tickSpring(now) {
      if (!lastT) lastT = now;
      const dt = Math.min(0.05, (now - lastT) / 1000); // clamp 50ms for stability
      lastT = now;

      // critically damped spring to target
      const x = current, v = vel, xT = target;
      const a = stiffness * (xT - x) - damping * v;
      vel = v + a * dt;
      current = x + vel * dt;

      // snap when close
      if (Math.abs(current - target) < 0.0005 && Math.abs(vel) < 0.0005) {
        current = target; vel = 0;
      }

      applyAmount(current);

      // auto-recalibrate baseline if user keeps it at ~0 for a moment
      if (current === 0) {
        zeroSince ??= now;
        if (now - zeroSince > 300) { // 300ms stable at zero → recapture as new baseline
          const keepTarget = target; // preserve intent
          prepare();                 // new base from current joint pose
          applyAmount(current);      // re-apply exact zero after recalibration
          target = keepTarget;
          zeroSince = now;
        }
      } else {
        zeroSince = null;
      }

      if (current !== target || vel !== 0) {
        raf = requestAnimationFrame(tickSpring);
      } else {
        raf = null; // stop when settled
      }
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

    function recalibrate() {
      // public: recalc baseline to current (useful after big joint moves)
      prepare();
      applyAmount(current);
    }

    function destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    }

    return { prepare, setTarget, immediate, recalibrate, destroy };
  }

  const explode = makeExplodeManager();

  // Expose a hook so other parts (e.g., joint-drag code) can request recalibration:
  try { app.explodeRecalibrate = () => explode.recalibrate(); } catch(_) {}

  // Drive explode from slider (smooth spring tween)
  explodeSlider.addEventListener('input', () => {
    explode.setTarget(Number(explodeSlider.value) || 0);
  });

  // Double-click label area to recalibrate baseline instantly (optional UX)
  // (Assumes the row label is the first child of the row grid)
  // You can comment this if unwanted.
  // ui.body.querySelectorAll('div').forEach(div => {
  //   if (div.textContent === 'Explode') {
  //     div.addEventListener('dblclick', () => explode.recalibrate());
  //   }
  // });

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

  //

  // 1) Hotkey handler: ONLY detects "h" and calls the tween
function onHotkeyH(e) {
  const tag = (e.target && e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.isComposing) return;

  if (e.key === 'h' || e.key === 'H' || e.code === 'KeyH') {
    e.preventDefault();
    try { console.log('pressed h'); } catch {}

    // Call the tween function (pass your own elements/params)
    toggleDockTween({
      dock: ui.dock,                 // REQUIRED: your dock element
      toggleBtn: ui.toggleBtn,       // optional
      side: 'left',                  // 'left' | 'right'
      distance: 520,                 // px off-screen distance
      labelOpen: 'Open Tools',
      labelClose: 'Close Tools',
      onOpenPrepare: () => { try { explode.prepare(); } catch(_) {} }
    });
  }
}

// 2) Tween executor: ONLY performs the open/close animation
function toggleDockTween({
  dock,
  toggleBtn = null,
  side = 'left',
  distance = 520,
  labelOpen = 'Open Tools',
  labelClose = 'Close Tools',
  onOpenPrepare
}) {
  if (!dock) throw new Error('[toggleDockTween] "dock" is required');

  const CLOSED_TX = side === 'left' ? -distance : distance;
  const isVisible = (dock.style.display || getComputedStyle(dock).display) !== 'none';

  // Base styles (idempotent)
  dock.style.willChange = 'transform, opacity';
  dock.style.transition = 'transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease';

  const setLabel = (txt) => { if (toggleBtn) toggleBtn.textContent = txt; };

  if (!isVisible) {
    // OPEN
    dock.style.display = 'block';
    dock.style.pointerEvents = 'none';
    dock.style.transition = 'none';
    dock.style.opacity = '0';
    dock.style.transform = `translateX(${CLOSED_TX}px)`;

    try { onOpenPrepare && onOpenPrepare(); } catch {}

    requestAnimationFrame(() => {
      if (side === 'left') { dock.style.left = '0'; dock.style.right = ''; }
      else { dock.style.right = '0'; dock.style.left = ''; }

      dock.style.transition = 'transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease';
      dock.style.opacity = '1';
      dock.style.transform = 'translateX(0px)';

      const onEnd = () => {
        dock.style.willChange = 'auto';
        dock.style.pointerEvents = 'auto';
        dock.removeEventListener('transitionend', onEnd);
      };
      dock.addEventListener('transitionend', onEnd);

      setLabel(labelClose);
    });
  } else {
    // CLOSE
    dock.style.pointerEvents = 'none';
    dock.style.opacity = '0';
    dock.style.transform = `translateX(${CLOSED_TX}px)`;

    const onEnd = () => {
      dock.style.display = 'none';
      dock.style.willChange = 'auto';
      dock.style.pointerEvents = 'auto';
      dock.removeEventListener('transitionend', onEnd);
    };
    dock.addEventListener('transitionend', onEnd);

    setLabel(labelOpen);
  }
}

// Wire the hotkey:
document.addEventListener('keydown', onHotkeyH, true);
  
  //
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
    explode.destroy();
  }

  return { open: openDock, close: closeDock, set, destroy };
}









