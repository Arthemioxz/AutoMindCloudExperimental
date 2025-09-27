// /viewer/ui/ToolsDock.js
// Floating tools dock: render modes, explode (robust), section plane, views (fixed distance), projection, scene toggles, snapshot.
/* global THREE */

export function createToolsDock(app, theme) {
  if (!app || !app.camera || !app.controls || !app.renderer)
    throw new Error('[ToolsDock] Missing app.camera/controls/renderer');

  // --- Normalize theme (compatible con Theme.js) ---
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
    fitBtn: document.createElement('button'),
    body: document.createElement('div'),
    toggleBtn: document.createElement('button')
  };

  // ---------- Helpers (con hover anims en botones) ----------
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

  // Root
  Object.assign(ui.root.style, {
    position: 'absolute',
    left: '0', top: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: 9998,
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial'
  });

  // Dock (A LA DERECHA)
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
  ui.title.textContent = 'View Tools';
  Object.assign(ui.title.style, { fontWeight: 800, color: theme.text || '#0d2022' });
  ui.fitBtn = mkButton('Fit');

  // Body
  Object.assign(ui.body.style, { padding: '10px 12px', overflow: 'auto', maxHeight: '60vh' });

  // Toggle btn (esquina inferior derecha)
  ui.toggleBtn = mkButton('Open Tools');
  Object.assign(ui.toggleBtn.style, {
    position: 'absolute',
    right: '14px', bottom: '14px',
    pointerEvents: 'auto'
  });

  ui.header.appendChild(ui.title);
  ui.header.appendChild(ui.fitBtn);
  ui.dock.appendChild(ui.header);
  ui.dock.appendChild(ui.body);
  ui.root.appendChild(ui.dock);
  ui.root.appendChild(ui.toggleBtn);

  // Mount
  const host = (app?.renderer?.domElement?.parentElement) || document.body;
  host.appendChild(ui.root);

  // ---------- Controls ----------
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
    Object.assign(box.style, { display: 'flex', gap: '8px', flexWrap: 'wrap' });
    elements.forEach(e => box.appendChild(e));
    wrap.appendChild(l);
    wrap.appendChild(box);
    return wrap;
  };

  // Views (distancia fija)
  const bIso = mkButton('Iso');
  const bTop = mkButton('Top');
  const bFront = mkButton('Front');
  const bRight = mkButton('Right');

  // Explode
  const rangeExpl = document.createElement('input');
  rangeExpl.type = 'range'; rangeExpl.min = '0'; rangeExpl.max = '1'; rangeExpl.step = '0.01'; rangeExpl.value = '0';
  Object.assign(rangeExpl.style, { width: '220px' });

  // Section plane toggle
  const bSection = mkButton('Section');

  // Projection
  const selProj = document.createElement('select');
  ['Perspective', 'Orthographic'].forEach(v => {
    const o = document.createElement('option'); o.value = v; o.textContent = v; selProj.appendChild(o);
  });
  Object.assign(selProj.style, {
    padding: '8px 10px', borderRadius: '12px', border: `1px solid ${theme.stroke || '#d5e6e6'}`, cursor: 'pointer'
  });

  // Scene toggles
  const cbGrid = document.createElement('input'); cbGrid.type = 'checkbox';
  const cbGround = document.createElement('input'); cbGround.type = 'checkbox';
  const cbAxes = document.createElement('input'); cbAxes.type = 'checkbox';

  // Compose body
  ui.body.appendChild(row('Views', bIso, bTop, bFront, bRight));
  ui.body.appendChild(row('Explode', rangeExpl));
  ui.body.appendChild(row('Section', bSection));
  ui.body.appendChild(row('Projection', selProj));
  ui.body.appendChild(row('Scene', mkLabel('Grid', cbGrid), mkLabel('Ground', cbGround), mkLabel('Axes', cbAxes)));

  function mkLabel(text, input) {
    const w = document.createElement('label');
    Object.assign(w.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' });
    const s = document.createElement('span'); s.textContent = text;
    w.appendChild(input); w.appendChild(s); return w;
  }

  // ---------- Fit ----------
  ui.fitBtn.addEventListener('click', () => { try { app.fit?.(); } catch(_) {} });

  // ---------- Camera tween helpers (distancia fija) ----------
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

  // ---------- Views click (Iso/Top/Front/Right con distancia fija) ----------
  bIso.addEventListener('click',   ()=>{ const {t,p}=targetAndPos(new THREE.Vector3(1,1,1)); tweenOrbits(p,t); });
  bTop.addEventListener('click',   ()=>{ const {t,p}=targetAndPos(new THREE.Vector3(0,1,0)); tweenOrbits(p,t); });
  bFront.addEventListener('click', ()=>{ const {t,p}=targetAndPos(new THREE.Vector3(0,0,1)); tweenOrbits(p,t); });
  bRight.addEventListener('click', ()=>{ const {t,p}=targetAndPos(new THREE.Vector3(1,0,0)); tweenOrbits(p,t); });

  // ---------- Projection ----------
  selProj.addEventListener('change', () => {
    const mode = selProj.value === 'Orthographic' ? 'Orthographic' : 'Perspective';
    try { app.setProjection?.(mode); } catch(_) {}
  });

  // ---------- Scene toggles ----------
  cbGrid.addEventListener('change', ()=> app.setSceneToggles?.({ grid: !!cbGrid.checked }));
  cbGround.addEventListener('change', ()=> app.setSceneToggles?.({ ground: !!cbGround.checked, shadows: !!cbGround.checked }));
  cbAxes.addEventListener('change', ()=> app.setSceneToggles?.({ axes: !!cbAxes.checked }));

  // ---------- Section plane (simple toggle visual) ----------
  let sectionOn = false, sectionPlanes = null, secHelper = null;
  bSection.addEventListener('click', ()=>{
    sectionOn = !sectionOn;
    if (sectionOn) {
      const p = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
      sectionPlanes = [p];
      app.renderer.localClippingEnabled = true;
      app.renderer.clippingPlanes = sectionPlanes;
      // helper
      const g = new THREE.PlaneGeometry(4,4);
      const m = new THREE.MeshBasicMaterial({ color: 0x0ea5a6, wireframe: true, transparent: true, opacity: .3 });
      secHelper = new THREE.Mesh(g,m); app.scene.add(secHelper);
    } else {
      app.renderer.localClippingEnabled = false;
      app.renderer.clippingPlanes = [];
      if (secHelper) app.scene.remove(secHelper), secHelper=null;
    }
  });

  // ---------- Explode (con baseline persistente, 0 = estado original real) ----------
  const explode = makeExplode(app);
  rangeExpl.addEventListener('input', ()=>{
    explode.setLevel(parseFloat(rangeExpl.value) || 0);
  });

  // ---------- Toggle dock (derecha) ----------
  function openDock(){
    if (ui.dock.style.display !== 'none') return;
    ui.dock.style.display = 'block';
    ui.dock.style.willChange = 'transform, opacity';
    ui.dock.style.transition = 'none';
    ui.dock.style.opacity = '0';
    ui.dock.style.transform = 'translateX(520px)'; // entra desde la derecha
    requestAnimationFrame(()=>{
      ui.toggleBtn.textContent = 'Close Tools';
      ui.dock.style.transition = 'transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease';
      ui.dock.style.opacity = '1';
      ui.dock.style.transform = 'translateX(0px)';
      setTimeout(()=>{ ui.dock.style.willChange = 'auto'; }, 300);
    });
  }
  function closeDock(){
    if (ui.dock.style.display === 'none') return;
    ui.dock.style.willChange = 'transform, opacity';
    ui.dock.style.transition = 'transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease';
    ui.dock.style.opacity = '0';
    ui.dock.style.transform = 'translateX(520px)';
    const onEnd = ()=>{
      ui.dock.style.display = 'none';
      ui.dock.style.willChange = 'auto';
      ui.toggleBtn.textContent = 'Open Tools';
      ui.dock.removeEventListener('transitionend', onEnd);
    };
    ui.dock.addEventListener('transitionend', onEnd);
  }
  function set(open){ open ? openDock() : closeDock(); }

  ui.toggleBtn.addEventListener('click', ()=>{
    const isOpen = ui.dock.style.display !== 'none';
    if (!isOpen) openDock(); else closeDock();
  });

  // Por defecto cerrado
  set(false);

  // ======== Hotkey 'h' (mantiene el tween) ========
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
  // ======== End hotkey ========

  // Public API
  return {
    open: openDock, close: closeDock, set,
    destroy(){
      try { document.removeEventListener('keydown', _onKeyDownToggleTools, true); } catch(_) {}
      try { ui.dock.remove(); } catch(_) {}
      try { ui.root.remove(); } catch(_) {}
      explode.destroy();
      app.renderer.localClippingEnabled = false;
      app.renderer.clippingPlanes = [];
      if (secHelper) app.scene.remove(secHelper);
    }
  };

  // ========= Explode impl (con baseline estable) =========
  function makeExplode(app){
    const robot = app.robot || app.scene;
    const parts = [];
    const origin = new Map(); // baseline original

    // recolecta nodos de primer nivel bajo el robot
    (robot?.children||[]).forEach(c=>{
      if (!c || !c.isObject3D) return;
      parts.push(c);
      origin.set(c, c.position.clone());
    });

    function setLevel(k){ // 0..1
      const { box } = getBounds();
      const center = box.getCenter(new THREE.Vector3());
      const diag = box.getSize(new THREE.Vector3()).length();
      const spread = 0.25 * diag; // factor suave
      parts.forEach((p, idx)=>{
        const dir = p.getWorldPosition(new THREE.Vector3()).sub(center).normalize();
        const base = origin.get(p) || new THREE.Vector3();
        p.position.copy(base.clone().add(dir.multiplyScalar(spread * k)));
      });
      robot.updateMatrixWorld(true);
    }

    function destroy(){
      // restaurar baseline original real
      parts.forEach(p=>{
        const base = origin.get(p); if (base) p.position.copy(base);
      });
      robot.updateMatrixWorld(true);
    }

    return { setLevel, destroy };
  }
}
