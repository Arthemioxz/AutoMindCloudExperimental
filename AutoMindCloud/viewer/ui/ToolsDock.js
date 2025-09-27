// /viewer/ui/ToolsDock.js
// Viewer Tools (completo): render mode, explode (tween suave con baseline), section (enable/axis/dist + slice plane), views (distancia fija), projection, scene toggles, snapshot.
// Dock a la derecha. Hotkey 'h' con tween. Sin botón "Fit".
/* global THREE */

export function createToolsDock(app, theme) {
  if (!app || !app.camera || !app.controls || !app.renderer)
    throw new Error('[ToolsDock] Missing app.camera/controls/renderer');

  // Normalizar theme
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
  theme = {
    teal: '#0ea5a6',
    tealSoft: '#8ef5f7',
    tealFaint: '#e8fbfc',
    bgPanel: '#ffffff',
    bgCanvas: 0xf6fbfb,
    stroke: '#d5e6e6',
    text: '#0d2022',
    textMuted: '#577071',
    shadow: '0 8px 24px rgba(0,0,0,.15)',
    ...(theme||{})
  };

  // --------- UI ---------
  const ui = {
    root: document.createElement('div'),
    dock: document.createElement('div'),
    header: document.createElement('div'),
    title: document.createElement('div'),
    body: document.createElement('div'),
    toggleBtn: document.createElement('button')
  };

  const mkButton = (label) => {
    const b = document.createElement('button'); b.textContent = label;
    Object.assign(b.style, {
      padding: '8px 12px', borderRadius: '12px',
      border: `1px solid ${theme.stroke}`, background: theme.bgPanel,
      color: theme.text, fontWeight: '700', cursor: 'pointer',
      pointerEvents: 'auto', boxShadow: theme.shadow,
      transition: 'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, border-color 120ms ease'
    });
    b.addEventListener('mouseenter', ()=>{ b.style.transform='translateY(-1px) scale(1.02)'; b.style.background=theme.tealFaint; b.style.borderColor=theme.tealSoft; });
    b.addEventListener('mouseleave', ()=>{ b.style.transform='none'; b.style.background=theme.bgPanel; b.style.borderColor=theme.stroke; });
    b.addEventListener('mousedown', ()=>{ b.style.transform='translateY(0) scale(0.99)'; });
    b.addEventListener('mouseup', ()=>{ b.style.transform='translateY(-1px) scale(1.02)'; });
    return b;
  };
  const mkSelect = (options = [], value) => {
    const sel = document.createElement('select');
    for (const op of options) { const o=document.createElement('option'); o.value=op; o.textContent=op; sel.appendChild(o); }
    if (value) sel.value=value;
    Object.assign(sel.style, {
      padding:'8px 10px', borderRadius:'12px', border:`1px solid ${theme.stroke}`,
      cursor:'pointer', pointerEvents:'auto', boxShadow:'none',
      transition:'transform 120ms ease, box-shadow 120ms ease'
    });
    sel.addEventListener('mouseenter', ()=>{ sel.style.boxShadow=theme.shadow; });
    sel.addEventListener('mouseleave', ()=>{ sel.style.boxShadow='none'; });
    return sel;
  };
  const mkSlider = (min, max, step, value) => {
    const s = document.createElement('input');
    s.type='range'; s.min=min; s.max=max; s.step=step; s.value=value;
    s.style.width='100%'; s.style.accentColor=theme.teal; return s;
  };
  const mkToggle = (label) => {
    const wrap=document.createElement('label'); const cb=document.createElement('input'); cb.type='checkbox';
    const span=document.createElement('span'); span.textContent=label;
    Object.assign(wrap.style,{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',pointerEvents:'auto'});
    cb.style.accentColor=theme.teal; Object.assign(span.style,{fontWeight:'700',color:theme.text});
    wrap.appendChild(cb); wrap.appendChild(span); return {wrap,cb};
  };
  const mkRow = (label, ...els) => {
    const row=document.createElement('div');
    Object.assign(row.style,{display:'grid',gridTemplateColumns:'140px 1fr',gap:'8px',alignItems:'center',margin:'8px 0'});
    const l=document.createElement('div'); l.textContent=label; Object.assign(l.style,{color:theme.textMuted,fontWeight:'700'});
    const box=document.createElement('div'); Object.assign(box.style,{display:'flex',gap:'8px',flexWrap:'wrap'}); els.forEach(e=>box.appendChild(e));
    row.appendChild(l); row.appendChild(box); return row;
  };

  Object.assign(ui.root.style,{position:'absolute',left:0,top:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:9999,fontFamily:'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial'});
  Object.assign(ui.dock.style,{position:'absolute',right:'14px',top:'14px',width:'440px',background:theme.bgPanel,border:`1px solid ${theme.stroke}`,borderRadius:'18px',boxShadow:theme.shadow,pointerEvents:'auto',overflow:'hidden',display:'none'});
  Object.assign(ui.header.style,{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px',borderBottom:`1px solid ${theme.stroke}`,background:theme.tealFaint});
  ui.title.textContent='Viewer Tools'; Object.assign(ui.title.style,{fontWeight:800,color:theme.text});
  Object.assign(ui.body.style,{padding:'10px 12px'});
  ui.toggleBtn.textContent='Open Tools';
  Object.assign(ui.toggleBtn.style,{position:'absolute',right:'14px',top:'14px',padding:'8px 12px',borderRadius:'12px',border:`1px solid ${theme.stroke}`,background:theme.bgPanel,color:theme.text,fontWeight:'700',boxShadow:theme.shadow,pointerEvents:'auto',zIndex:10000,transition:'transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, border-color 120ms ease'});
  ui.toggleBtn.addEventListener('mouseenter',()=>{ ui.toggleBtn.style.transform='translateY(-1px) scale(1.02)'; ui.toggleBtn.style.background=theme.tealFaint; ui.toggleBtn.style.borderColor=theme.tealSoft; });
  ui.toggleBtn.addEventListener('mouseleave',()=>{ ui.toggleBtn.style.transform='none'; ui.toggleBtn.style.background=theme.bgPanel; ui.toggleBtn.style.borderColor=theme.stroke; });

  ui.header.appendChild(ui.title);
  ui.dock.appendChild(ui.header);
  ui.dock.appendChild(ui.body);
  ui.root.appendChild(ui.dock);
  ui.root.appendChild(ui.toggleBtn);
  (app?.renderer?.domElement?.parentElement || document.body).appendChild(ui.root);

  // --------- Controles (todos los de tu panel original) ---------
  const renderModeSel = mkSelect(['Solid','Wireframe','X-Ray','Ghost'],'Solid');
  const explodeSlider  = mkSlider(0,1,0.01,0);
  const axisSel        = mkSelect(['X','Y','Z'],'X');
  const secDist        = mkSlider(-1,1,0.001,0);
  const secEnable      = mkToggle('Enable section');
  const secShowPlane   = mkToggle('Show slice plane');

  const rowCam = document.createElement('div');
  Object.assign(rowCam.style,{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px',margin:'8px 0'});
  const bIso = mkButton('Iso'), bTop = mkButton('Top'), bFront = mkButton('Front'), bRight = mkButton('Right');
  [bIso,bTop,bFront,bRight].forEach(b=>{ b.style.padding='8px'; b.style.borderRadius='10px'; });

  const projSel = mkSelect(['Perspective','Orthographic'],'Perspective');
  const togGrid   = mkToggle('Grid');
  const togGround = mkToggle('Ground & shadows');
  const togAxes   = mkToggle('XYZ axes');

  ui.body.appendChild(mkRow('Render mode', renderModeSel));
  ui.body.appendChild(mkRow('Explode', explodeSlider));
  ui.body.appendChild(mkRow('Section axis', axisSel));
  ui.body.appendChild(mkRow('Section dist', secDist));
  ui.body.appendChild(mkRow('', secEnable.wrap, secShowPlane.wrap));
  rowCam.appendChild(bIso); rowCam.appendChild(bTop); rowCam.appendChild(bFront); rowCam.appendChild(bRight);
  ui.body.appendChild(mkRow('Views', rowCam));
  ui.body.appendChild(mkRow('Projection', projSel));
  ui.body.appendChild(mkRow('', togGrid.wrap, togGround.wrap, togAxes.wrap));

  // --------- Cámara: vistas con distancia fija (según radio del robot) ---------
  const FIX_DIST = 2.2;
  const getBounds = () => {
    const box = new THREE.Box3().setFromObject(app.robot || app.scene);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    return { box, sphere };
  };
  const targetAndPos = (dir) => {
    const { sphere } = getBounds(); const t = sphere.center.clone();
    const r = Math.max(1e-3, sphere.radius); const d = FIX_DIST * r;
    const p = t.clone().add(dir.clone().normalize().multiplyScalar(d));
    return { t, p };
  };
  const tweenOrbits = (toPos, toTarget, ms=750) => {
    const cam=app.camera, ctr=app.controls;
    const p0=cam.position.clone(), t0=ctr.target.clone(), p1=toPos.clone(), t1=toTarget.clone();
    const tStart=performance.now(); const ease=(x)=>1-Math.pow(1-x,5);
    const step=(now)=>{ const k=Math.min(1,(now-tStart)/ms), e=ease(k);
      cam.position.lerpVectors(p0,p1,e); ctr.target.lerpVectors(t0,t1,e);
      cam.updateProjectionMatrix?.(); ctr.update?.(); if(k<1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  bIso.addEventListener('click',  ()=>{ const {t,p}=targetAndPos(new THREE.Vector3(1,1,1)); tweenOrbits(p,t); });
  bTop.addEventListener('click',  ()=>{ const {t,p}=targetAndPos(new THREE.Vector3(0,1,0)); tweenOrbits(p,t); });
  bFront.addEventListener('click',()=>{ const {t,p}=targetAndPos(new THREE.Vector3(0,0,1)); tweenOrbits(p,t); });
  bRight.addEventListener('click',()=>{ const {t,p}=targetAndPos(new THREE.Vector3(1,0,0)); tweenOrbits(p,t); });

  // --------- Render mode ---------
  renderModeSel.addEventListener('change', ()=>{
    const mode = renderModeSel.value;
    try { app.setRenderMode?.(mode); } catch(_){}
  });

  // --------- Projection ---------
  projSel.addEventListener('change', ()=>{
    const mode = projSel.value === 'Orthographic' ? 'Orthographic' : 'Perspective';
    try { app.setProjection?.(mode); } catch(_){}
  });

  // --------- Scene toggles ---------
  togGrid.cb.addEventListener('change', ()=> app.setSceneToggles?.({ grid: !!togGrid.cb.checked }));
  togGround.cb.addEventListener('change', ()=> app.setSceneToggles?.({ ground: !!togGround.cb.checked, shadows: !!togGround.cb.checked }));
  togAxes.cb.addEventListener('change', ()=> app.setSceneToggles?.({ axes: !!togAxes.cb.checked }));

  // --------- Section ---------
  let sectionOn = false, sectionPlanes = [], planeMesh=null;
  const planeNormal = ()=> axisSel.value==='X' ? new THREE.Vector3(1,0,0) : axisSel.value==='Y' ? new THREE.Vector3(0,1,0) : new THREE.Vector3(0,0,1);
  function applySection() {
    if (!sectionOn) { app.renderer.localClippingEnabled=false; app.renderer.clippingPlanes=[]; if (planeMesh) app.scene.remove(planeMesh), planeMesh=null; return; }
    const n = planeNormal();
    const { sphere } = getBounds();
    const dist = Number(secDist.value)||0;
    const plane = new THREE.Plane(n, -sphere.center.clone().dot(n) - dist * sphere.radius);
    sectionPlanes = [plane];
    app.renderer.localClippingEnabled = true;
    app.renderer.clippingPlanes = sectionPlanes;
    if (secShowPlane.cb.checked) {
      if (!planeMesh) {
        const g=new THREE.PlaneGeometry(4,4);
        const m=new THREE.MeshBasicMaterial({ color:0x0ea5a6, wireframe:true, transparent:true, opacity:.35 });
        planeMesh=new THREE.Mesh(g,m); app.scene.add(planeMesh);
      }
      const t = sphere.center.clone().add(n.clone().multiplyScalar(dist * sphere.radius));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), n.clone().normalize());
      planeMesh.position.copy(t); planeMesh.quaternion.copy(q); planeMesh.updateMatrixWorld(true);
    } else if (planeMesh) { app.scene.remove(planeMesh); planeMesh=null; }
  }
  secEnable.cb.addEventListener('change', ()=>{ sectionOn = !!secEnable.cb.checked; applySection(); });
  axisSel.addEventListener('change', applySection);
  secDist.addEventListener('input', applySection);
  secShowPlane.cb.addEventListener('change', applySection);

  // --------- Explode (spring tween + baseline estable; 0 siempre es original) ---------
  const explode = makeExplodeManager();
  explodeSlider.addEventListener('input', ()=> explode.setTarget(Number(explodeSlider.value) || 0));

  function makeExplodeManager(){
    const robot = app.robot || app.scene;
    const parts=[]; const baseline = new Map();
    (robot?.children||[]).forEach(c=>{ if (!c || !c.isObject3D) return; parts.push(c); baseline.set(c, c.position.clone()); });

    let current=0, target=0, vel=0, raf=null, lastT=0, prepared=false, zeroSince=null;
    const K=180, D=24; // muelle críticamente amortiguado-ish
    let center=null, diag=1;

    function prepare(){
      const box = new THREE.Box3().setFromObject(robot);
      const size = box.getSize(new THREE.Vector3()); diag = size.length() || 1;
      center = box.getCenter(new THREE.Vector3());
      prepared = true;
    }
    function applyAmount(a){
      const spread = 0.25 * diag;
      for (const p of parts) {
        const base = baseline.get(p) || new THREE.Vector3();
        const dir = p.getWorldPosition(new THREE.Vector3()).sub(center).normalize();
        p.position.copy(base.clone().add(dir.multiplyScalar(spread * a)));
      }
      robot.updateMatrixWorld(true);
    }
    function tick(now){
      if (!lastT) lastT = now; const dt = Math.min(0.05, (now-lastT)/1000); lastT=now;
      const acc = K*(target-current) - D*vel; vel += acc*dt; current += vel*dt;
      if (Math.abs(current-target)<0.0005 && Math.abs(vel)<0.0005) { current=target; vel=0; }
      applyAmount(current);

      // Si estamos en 0, re-aplicar baseline por si se reabrió el dock
      if (current===0) {
        zeroSince ??= now;
        if (now - zeroSince > 300) { parts.forEach(p=>{ const base=baseline.get(p); if (base) p.position.copy(base); }); robot.updateMatrixWorld(true); zeroSince=now; }
      } else zeroSince=null;

      if (current!==target || vel!==0) raf=requestAnimationFrame(tick); else raf=null;
    }
    return {
      setTarget(a01){ target=Math.max(0,Math.min(1,Number(a01)||0)); if(!prepared) prepare(); if(!raf) requestAnimationFrame(tick); },
      immediate(a01){ target=current=Math.max(0,Math.min(1,Number(a01)||0)); vel=0; if(!prepared) prepare(); applyAmount(current); },
      recalibrate(){ prepared=false; prepare(); applyAmount(current); },
      destroy(){ if (raf) cancelAnimationFrame(raf); raf=null; }
    };
  }

  // --------- Toggle dock (tween) + hotkey 'h' ---------
  function openDock(){
    if (ui.dock.style.display!=='none') return;
    ui.dock.style.display='block';
    ui.dock.style.willChange='transform, opacity';
    ui.dock.style.transition='none';
    ui.dock.style.opacity='0';
    ui.dock.style.transform='translateX(520px)';
    requestAnimationFrame(()=>{
      ui.dock.style.transition='transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease';
      ui.dock.style.opacity='1';
      ui.dock.style.transform='translateX(0px)';
      setTimeout(()=>{ ui.dock.style.willChange='auto'; }, 300);
    });
  }
  function closeDock(){
    if (ui.dock.style.display==='none') return;
    ui.dock.style.willChange='transform, opacity';
    ui.dock.style.transition='transform 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease';
    ui.dock.style.opacity='0';
    ui.dock.style.transform='translateX(520px)';
    const onEnd=()=>{ ui.dock.style.display='none'; ui.dock.style.willChange='auto'; ui.dock.removeEventListener('transitionend',onEnd); };
    ui.dock.addEventListener('transitionend',onEnd);
  }
  function set(open){ open?openDock():closeDock(); }
  ui.toggleBtn.addEventListener('click', ()=>{ const isOpen = ui.dock.style.display!=='none'; if(!isOpen) openDock(); else closeDock(); });
  document.addEventListener('keydown', (e)=>{ const tag=(e.target?.tagName||'').toLowerCase(); if(tag==='input'||tag==='textarea'||tag==='select'||e.isComposing) return; if (e.code==='KeyH' || e.key==='h' || e.key==='H'){ e.preventDefault(); const isOpen=ui.dock.style.display!=='none'; if(!isOpen) openDock(); else closeDock(); } }, true);

  // API pública
  return { open: openDock, close: closeDock, set, destroy(){ explode?.destroy?.(); try{ui.root.remove();}catch{} } };
}
