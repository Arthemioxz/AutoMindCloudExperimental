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
  theme = theme || {};
  const SHADOW = theme.shadow || '0 8px 24px rgba(0,0,0,.15)';

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

  // ---------- Helpers (hover anims in buttons) ----------
  const mkButton = (label) => {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      padding: '8px 12px',
      borderRadius: '12px',
      border: `1px solid ${theme.stroke || '#d5e6e6'}`,
      background: theme.bgPanel || '#fff',
      color: theme.text || '#0d2022',
      fontWeight: '700',
      cursor: 'pointer',
      pointerEvents: 'auto',
      boxShadow: SHADOW,
      transition: 'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, border-color 120ms ease'
    });
    b.addEventListener('mouseenter', () => {
      b.style.transform = 'translateY(-1px) scale(1.02)';
      b.style.boxShadow = '0 10px 26px rgba(0,0,0,.18)';
      b.style.background = theme.tealFaint || '#e8fbfc';
      b.style.borderColor = theme.tealSoft || '#8ef5f7';
    });
    b.addEventListener('mouseleave', () => {
      b.style.transform = 'none';
      b.style.boxShadow = SHADOW;
      b.style.background = theme.bgPanel || '#fff';
      b.style.borderColor = theme.stroke || '#d5e6e6';
    });
    return b;
  };

  const mkSelect = () => {
    const s = document.createElement('select');
    Object.assign(s.style, {
      padding: '8px 10px',
      borderRadius: '12px',
      border: `1px solid ${theme.stroke || '#d5e6e6'}`,
      cursor: 'pointer',
      background: theme.bgPanel || '#fff',
      color: theme.text || '#0d2022',
      fontWeight: 700,
      boxShadow: SHADOW
    });
    s.addEventListener('mouseenter', () => {
      s.style.boxShadow = '0 10px 26px rgba(0,0,0,.18)';
      s.style.borderColor = theme.tealSoft || '#8ef5f7';
      s.style.background = theme.tealFaint || '#e8fbfc';
    });
    s.addEventListener('mouseleave', () => {
      s.style.boxShadow = SHADOW;
      s.style.borderColor = theme.stroke || '#d5e6e6';
      s.style.background = theme.bgPanel || '#fff';
    });
    return s;
  };

  const mkRange = () => {
    const r = document.createElement('input');
    r.type = 'range';
    r.min = '0'; r.max = '1'; r.step = '0.01'; r.value = '0';
    Object.assign(r.style, { width: '100%' });
    return r;
  };

  const mkCheck = () => {
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.style.cursor = 'pointer';
    return c;
  };

  // Root
  Object.assign(ui.root.style, {
    position: 'absolute',
    left: '0', top: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: 9998,
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial'
  });

  // Dock (RIGHT)
  Object.assign(ui.dock.style, {
    position: 'absolute',
    right: '14px',
    bottom: '14px',
    width: '420px',
    maxHeight: '75%',
    background: theme.bgPanel || '#fff',
    border: `1px solid ${theme.stroke || '#d5e6e6'}`,
    borderRadius: '18px',
    overflow: 'hidden',
    display: 'none',
    pointerEvents: 'auto',
    boxShadow: SHADOW
  });

  // Header
  Object.assign(ui.header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: '8px', padding: '10px 12px',
    borderBottom: `1px solid ${theme.stroke || '#d5e6e6'}`,
    background: theme.tealFaint || '#e8fbfc'
  });
  ui.title.textContent = 'Viewer Tools';
  Object.assign(ui.title.style, { fontWeight: 800, color: theme.text || '#0d2022' });
  ui.snapshotBtn = mkButton('Snapshot');

  // Body
  Object.assign(ui.body.style, { padding: '10px 12px', overflow: 'auto', maxHeight: '60vh' });

  // Toggle (bottom-right)
  ui.toggleBtn = mkButton('Open Tools');
  Object.assign(ui.toggleBtn.style, {
    position: 'absolute',
    right: '14px', bottom: '14px',
    pointerEvents: 'auto'
  });

  ui.header.appendChild(ui.title);
  ui.header.appendChild(ui.snapshotBtn);
  ui.dock.appendChild(ui.header);
  ui.dock.appendChild(ui.body);
  ui.root.appendChild(ui.dock);
  ui.root.appendChild(ui.toggleBtn);

  const host = (app?.renderer?.domElement?.parentElement) || document.body;
  host.appendChild(ui.root);

  // ---------- Rows ----------
  const row = (label, ...elements) => {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      display: 'grid',
      gridTemplateColumns: '140px 1fr',
      gap: '8px', alignItems: 'center', margin: '8px 0'
    });
    const l = document.createElement('div');
    l.textContent = label;
    Object.assign(l.style, { color: theme.textMuted || '#577071', fontWeight: 700 });
    const box = document.createElement('div');
    Object.assign(box.style, { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' });
    elements.forEach(e => box.appendChild(e));
    wrap.appendChild(l);
    wrap.appendChild(box);
    return wrap;
  };

  // Controls
  const selRender = mkSelect();
  ['Solid', 'Wireframe', 'Shaded'].forEach(v => {
    const o = document.createElement('option'); o.value = v; o.textContent = v; selRender.appendChild(o);
  });

  const rangeExpl = mkRange();
  const selSectionAxis = mkSelect();
  ['X', 'Y', 'Z'].forEach(v => {
    const o = document.createElement('option'); o.value = v; o.textContent = v; selSectionAxis.appendChild(o);
  });
  const rangeSection = mkRange();

  const bIso   = mkButton('Iso');
  const bTop   = mkButton('Top');
  const bFront = mkButton('Front');
  const bRight = mkButton('Right');

  const selProj = mkSelect();
  ['Perspective', 'Orthographic'].forEach(v => {
    const o = document.createElement('option'); o.value = v; o.textContent = v; selProj.appendChild(o);
  });

  const cbGrid   = mkCheck();
  const cbGround = mkCheck();
  const cbAxes   = mkCheck();

  ui.body.appendChild(row('Render mode', selRender));
  ui.body.appendChild(row('Explode', rangeExpl));
  ui.body.appendChild(row('Section axis', selSectionAxis));
  ui.body.appendChild(row('Section dist', rangeSection));
  ui.body.appendChild(row('Views', bIso, bTop, bFront, bRight));
  ui.body.appendChild(row('Projection', selProj));
  ui.body.appendChild(row('Scene', mkLabel('Grid', cbGrid), mkLabel('Ground & shadows', cbGround), mkLabel('XYZ axes', cbAxes)));

  function mkLabel(text, input) {
    const w = document.createElement('label');
    Object.assign(w.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' });
    const s = document.createElement('span'); s.textContent = text;
    w.appendChild(input); w.appendChild(s); return w;
  }

  // ---------- Snapshot ----------
  ui.snapshotBtn.addEventListener('click', () => {
    try {
      const link = document.createElement('a');
      link.download = 'viewer.png';
      link.href = app.renderer.domElement.toDataURL('image/png');
      link.click();
    } catch (_) {}
  });

  // ---------- Camera tween helpers (fixed distance) ----------
  function getBounds() {
    const box = new THREE.Box3().setFromObject(app.robot || app.scene);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    return { box, sphere };
  }
  const FIX_DIST = 2.2; // multiplicador del radio
  function targetAndPos(dir) {
    const { sphere } = getBounds();
    const t = sphere.center.clone();
    const r = Math.max(1e-3, sphere.radius);
    const d = FIX_DIST * r;
    const p = t.clone().add(dir.clone().normalize().multiplyScalar(d));
    return { t, p };
  }
  function tweenOrbits(toPos, toTarget, ms = 750) {
    const cam = app.camera, ctr = app.controls;
    const p0 = cam.position.clone();
    const t0 = ctr.target.clone();
    const p1 = toPos.clone();
    const t1 = toTarget.clone();
    const tStart = performance.now();
    const ease = (x)=>1-Math.pow(1-x,5);
    function step(now){
      const k = Math.min(1,(now-tStart)/ms), e=ease(k);
      cam.position.lerpVectors(p0,p1,e);
      ctr.target.lerpVectors(t0,t1,e);
      cam.updateProjectionMatrix?.(); ctr.update?.();
      if(k<1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ---------- View buttons (fixed distance) ----------
  bIso.addEventListener('click',   ()=>{ const {t,p}=targetAndPos(new THREE.Vector3(1,1,1)); tweenOrbits(p,t); });
  bTop.addEventListener('click',   ()=>{ const {t,p}=targetAndPos(new THREE.Vector3(0,1,0)); tweenOrbits(p,t); });
  bFront.addEventListener('click', ()=>{ const {t,p}=targetAndPos(new THREE.Vector3(0,0,1)); tweenOrbits(p,t); });
  bRight.addEventListener('click', ()=>{ const {t,p}=targetAndPos(new THREE.Vector3(1,0,0)); tweenOrbits(p,t); });

  // ---------- Render mode ----------
  selRender.addEventListener('change', () => {
    const mode = selRender.value;
    try { app.setRenderMode?.(mode); } catch (_) {}
  });

  // ---------- Projection ----------
  selProj.addEventListener('change', () => {
    const mode = selProj.value === 'Orthographic' ? 'Orthographic' : 'Perspective';
    try { app.setProjection?.(mode); } catch (_) {}
  });

  // ---------- Scene toggles ----------
  cbGrid.addEventListener('change', ()=> app.setSceneToggles?.({ grid: !!cbGrid.checked }));
  cbGround.addEventListener('change', ()=> app.setSceneToggles?.({ ground: !!cbGround.checked, shadows: !!cbGround.checked }));
  cbAxes.addEventListener('change', ()=> app.setSceneToggles?.({ axes: !!cbAxes.checked }));

  // ---------- Section plane controls (preserve original behavior) ----------
  selSectionAxis.addEventListener('change', ()=>{
    try { app.setSectionAxis?.(selSectionAxis.value); } catch (_) {}
  });
  rangeSection.addEventListener('input', ()=>{
    try { app.setSectionDist?.(parseFloat(rangeSection.value)||0); } catch (_) {}
  });

  // ---------- Explode (spring tween + stable baseline) ----------
  const explode = makeExplodeManager();
  rangeExpl.addEventListener('input', ()=>{
    explode.setTarget(parseFloat(rangeExpl.value) || 0);
  });

  // ---------- Toggle dock (right) with tween (hotkey 'h') ----------
  const CLOSED_TX = 520;
  function set(open){
    if (open) {
      if (ui.dock.style.display !== 'none') return;
      ui.dock.style.display = 'block';
      ui.dock.style.willChange = 'transform, opacity';
      ui.dock.style.transition = 'none';
      ui.dock.style.opacity = '0';
      ui.dock.style.transform = `translateX(${CLOSED_TX}px)`;
      requestAnimationFrame(() => {
        try { explode.prepare(); } catch(_) {}
        ui.dock.style.transition = 'transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease';
        ui.dock.style.opacity = '1';
        ui.dock.style.transform = 'translateX(0px)';
        setTimeout(() => { ui.dock.style.willChange = 'auto'; }, 300);
      });
    } else {
      ui.dock.style.willChange = 'transform, opacity';
      ui.dock.style.transition = 'transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease';
      ui.dock.style.opacity = '0';
      ui.dock.style.transform = `translateX(${CLOSED_TX}px)`;
      const onEnd = () => {
        ui.dock.style.display = 'none';
        ui.dock.style.willChange = 'auto';
        ui.dock.removeEventListener('transitionend', onEnd);
      };
      ui.dock.addEventListener('transitionend', onEnd);
    }
  }

  function openDock(){ set(true);  ui.toggleBtn.textContent = 'Close Tools'; }
  function closeDock(){ set(false); ui.toggleBtn.textContent = 'Open Tools'; }

  ui.toggleBtn.addEventListener('click', ()=>{
    const isOpen = ui.dock.style.display !== 'none';
    if (!isOpen) openDock(); else closeDock();
  });

  // Hotkey 'h'
  const _onKeyDownToggleTools = (e)=>{
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.isComposing) return;
    if (e.key === 'h' || e.key === 'H' || e.code === 'KeyH') {
      e.preventDefault();
      try { console.log('pressed h'); } catch {}
      const isOpen = ui.dock.style.display !== 'none';
      if (!isOpen) openDock(); else closeDock();
    }
  };
  document.addEventListener('keydown', _onKeyDownToggleTools, true);

  // Public API
  return {
    open: openDock, close: closeDock, set,
    destroy(){
      try { ui.dock.remove(); } catch (_) {}
      try { ui.root.remove(); } catch (_) {}
      try {
        app.renderer.localClippingEnabled = false;
        app.renderer.clippingPlanes = [];
      } catch (_) {}
      try { document.removeEventListener('keydown', _onKeyDownToggleTools, true); } catch (_) {}
      explode.destroy();
    }
  };

  // ========= Explode manager (spring tween, baseline stable, 0 always original) =========
  function makeExplodeManager() {
    // Internals
    const registry = []; // { node, parent, baseLocal:Vector3, dirLocal:Vector3 }
    const marker = new WeakSet(); // chosen top parts
    let maxDim = 1;
    let prepared = false;

    // spring state
    let current = 0;            // current explode amount [0..1]
    let target = 0;             // target explode amount [0..1]
    let vel = 0;                // velocity in "amount units / s"
    let raf = null;
    let lastT = 0;
    const stiffness = 18;       // rad/s
    const damping   = 2 * Math.sqrt(stiffness); // critical

    let zeroSince = null;

    function worldDirToParentLocal(parent, dirWorld) {
      const m = parent.matrixWorld.clone().invert();
      const n = new THREE.Matrix3().setFromMatrix4(m);
      return dirWorld.clone().applyMatrix3(n).normalize();
    }

    function computeBounds() {
      const box = new THREE.Box3().setFromObject(app.robot);
      if (box.isEmpty()) return null;
      return { center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
    }

    function chooseTopPartFor(mesh) {
      let n = mesh;
      while (n && n !== app.robot) {
        if (marker.has(n)) return n;
        if (n.parent === app.robot) return n;
        n = n.parent;
      }
      return mesh?.parent || app.robot;
    }

    function prepare() {
      registry.length = 0;
      if (!app.robot) { prepared = false; return; }

      const R = computeBounds();
      if (!R) { prepared = false; return; }
      maxDim = Math.max(R.size.x, R.size.y, R.size.z) || 1;

      const parts = new Set();
      const seen = new WeakSet();

      // BFS through robot; select top-level meaningful nodes
      const stack = (app.robot.children || []).slice();
      while (stack.length) {
        const node = stack.pop();
        if (!node || seen.has(node)) continue;
        seen.add(node);

        // Take meshes or group parents of meshes
        let add = false;
        if (node.isMesh) add = true;
        else {
          for (const ch of (node.children || [])) {
            if (ch.isMesh) { add = true; break; }
          }
        }
        if (add) parts.add(chooseTopPartFor(node));
        for (const ch of (node.children || [])) stack.push(ch);
      }

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
        node.position.copy(baseLocal).addScaledVector(dirLocal, maxOffset * f);
      }
      app.robot.updateMatrixWorld(true);
    }

    function tickSpring(now) {
      if (!lastT) lastT = now;
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      const x = current - target;
      const acc = -stiffness* x - damping * vel;
      vel += acc * dt;
      current += vel * dt;

      if (Math.abs(current - target) < 1e-3 && Math.abs(vel) < 1e-3) {
        current = target; vel = 0;
      }
      applyAmount(current);

      if (current === 0) {
        if (!zeroSince) {
          // snap perfectly to baseline at rest
          for (const rec of registry) rec.node.position.copy(rec.baseLocal);
          app.robot.updateMatrixWorld(true);
          zeroSince = now;
        }
      } else {
        zeroSince = null;
      }

      if (current !== target || vel !== 0) {
        raf = requestAnimationFrame(tickSpring);
      } else {
        raf = null;
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

    function recalibrate() { prepare(); applyAmount(current); }
    function destroy() { if (raf) cancelAnimationFrame(raf); raf = null; }

    return { prepare, setTarget, immediate, recalibrate, destroy };
  }
}
