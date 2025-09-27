# Write a self-contained `urdf_viewer_main.js` that DEFINES `createToolsDock` and `createComponentsPanel`
# *before* they are used, matching your snippet. No imports for those two,
# so they cannot be undefined. No changes to lighting/camera behavior.

from pathlib import Path

code = """\
// /viewer/urdf_viewer_main.js — self-contained; defines createToolsDock & createComponentsPanel locally
// Keeps your system's behavior; only ensures functions exist before they're called.

import { THEME as theme } from './Theme.js';
import { createViewer } from './core/ViewerCore.js';
import { buildAssetDB, createLoadMeshCb } from './core/AssetDB.js';
import { attachInteraction } from './interaction/SelectionAndDrag.js';

/* ---------------- Local definition: createToolsDock (to avoid undefined) ---------------- */
function createToolsDock(app, theme){
  // Hotkeys 'h' (toggle dock) and 'i' (isolate selected from dock)
  function handleKey(e){
    const k = (e.key || '').toLowerCase();
    if(k === 'i'){ e.preventDefault(); (app.isolateSelectedComponent||app.isolate?.selected||function(){})(); }
    if(k === 'h'){
      e.preventDefault();
      const dock = document.querySelector('.viewer-dock-fix');
      if (dock) dock.classList.toggle('collapsed');
    }
  }
  (app.renderer?.domElement||document).addEventListener('keydown', handleKey, true);

  // MutationObserver to tag your "Viewer Tools" dock & remove Fit & dup Snapshot
  function enhanceUI(root){
    root = root || document;
    const btns = root.querySelectorAll('button'); btns.forEach(b => b.classList.add('am-btn'));
    const sels = root.querySelectorAll('select, input[type="text"]'); sels.forEach(el => el.classList.add('am-input'));
  }
  const mo = new MutationObserver((muts)=>{
    for(const m of muts){
      (m.addedNodes||[]).forEach(n => {
        if(n.nodeType!==1) return;
        enhanceUI(n);
        if((n.textContent||'').includes('Viewer Tools')){
          n.classList.add('viewer-dock-fix');
          const killers = Array.from(n.querySelectorAll('button')).filter(b => (b.textContent||'').trim() === 'Fit');
          killers.forEach(b => b.remove());
          const snapButtons = Array.from(n.querySelectorAll('button')).filter(b => (b.textContent||'').toLowerCase().includes('snapshot'));
          if(snapButtons.length > 1) snapButtons.slice(1).forEach(b => b.remove());
        }
      });
    }
  });
  mo.observe(document.body, { childList:true, subtree:true });

  // Override ISO/TOP/FRONT/RIGHT to call your fixed-distance navigator if present
  document.addEventListener('click', (ev)=>{
    const b = ev.target.closest && ev.target.closest('button'); if(!b) return;
    const label = (b.textContent || '').trim().toLowerCase();
    if(!/^(iso|top|front|right)$/i.test(label)) return;
    (app.navigateToViewFixedDistance||function(){ })(label, 750);
    ev.preventDefault(); ev.stopPropagation();
  }, true);

  // Adapter API expected by your snippet
  function open(){ set(true); }
  function close(){ set(false); }
  function set(open){
    const dock = document.querySelector('.viewer-dock-fix');
    if (!dock) return;
    dock.classList.toggle('collapsed', !open);
  }
  function destroy(){ try{ mo.disconnect(); }catch(_){} }
  return { open, close, set, destroy };
}

/* ---------------- Local definition: createComponentsPanel (to avoid undefined) ---------------- */
function createComponentsPanel(app, theme, adapter){
  // This assumes your Components panel is already rendered by your UI.
  // We only provide open/close/set so your snippet can call them safely.
  function open(){ set(true); }
  function close(){ set(false); }
  function set(open){
    // If your panel is inside the same dock, we reuse the same collapsed class.
    const dock = document.querySelector('.viewer-dock-fix');
    if (!dock) return;
    dock.classList.toggle('collapsed', !open);
  }
  function destroy(){ /* no-op placeholder */ }
  return { open, close, set, destroy };
}

/* ---------------- Public entry: render ---------------- */
export function render(opts = {}){
  const {
    container,
    urdfContent = '',
    meshDB = {},
    selectMode = 'link',
    background = theme.bgCanvas || 0xffffff,
    clickAudioDataURL = null
  } = opts;

  // 1) Core viewer
  const core = createViewer({ container, background });

  // 2) Asset DB + mesh loader
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map();
  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey){
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse(o=>{ if(o?.isMesh && o.geometry) list.push(o); });
      assetToMeshes.set(assetKey, list);
    }
  });

  // 3) Load URDF
  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // 4) Interaction
  const inter = attachInteraction({
    scene: core.scene, camera: core.camera, renderer: core.renderer, controls: core.controls, robot, selectMode
  });

  // 5) App facade
  const app = {
    ...core, robot,
    // minimal isolate & showAll to match existing UI expectations
    isolate: {
      asset: (assetKey) => {
        const meshes = assetToMeshes.get(assetKey) || [];
        if (!meshes.length) return;
        if (core.robot) core.robot.traverse(o=>{ if(o.isMesh && o.geometry) o.visible=false; });
        meshes.forEach(m=>m.visible=true);
      },
      clear: () => { if (core.robot) core.robot.traverse(o=>{ if(o.isMesh && o.geometry) o.visible=true; }); }
    },
    showAll: () => { if (core.robot) core.robot.traverse(o=>{ if(o.isMesh && o.geometry) o.visible=true; }); }
  };

  /* ---------------- 5) UI panels (safe) ---------------- */
  let toolsDock = null;
  if (createToolsDock) {
    try { toolsDock = createToolsDock(app, theme) || null; toolsDock?.open?.(); toolsDock && (toolsDock._open = true); } catch (e) { console.warn('[ToolsDock] init failed:', e); }
  }

  let componentsPanel = null;
  if (createComponentsPanel) {
    try {
      // Build adapter as in your snippet logic (safe fallbacks)
      const adapter = {
        listLinks: () => {
          if (typeof app.listLinks === 'function') return app.listLinks();
          if (typeof app.getLinks === 'function') return app.getLinks();
          const names = [];
          try {
            app.robot?.traverse?.((o) => {
              const nm = o.userData?.linkName || o.name;
              if (nm && !names.includes(nm)) names.push(nm);
            });
          } catch (_) {}
          return names;
        },
        focusLink: (name) => {
          if (typeof app.focusLink === 'function') return app.focusLink(name);
          if (typeof app.frameLink === 'function') return app.frameLink(name);
          try {
            let target = null;
            app.robot?.traverse?.((o) => {
              const nm = o.userData?.linkName || o.name;
              if (nm === name) target = o;
            });
            if (!target) return;
            const cam = app.camera, ctrl = app.controls;
            const box = new THREE.Box3().setFromObject(target);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const fov = (cam.fov || 60) * Math.PI / 180;
            const dist = (maxDim * 1.2) / Math.tan(fov / 2);
            const p0 = cam.position.clone(), t0 = ctrl.target.clone();
            const dir = p0.clone().sub(t0).normalize();
            const toPos = center.clone().add(dir.multiplyScalar(dist));
            const tStart = performance.now(), ms = 650;
            const ease = (t)=> (t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2);
            function step(now){
              const u = Math.min(1,(now - tStart)/ms), e = ease(u);
              cam.position.lerpVectors(p0, toPos, e);
              ctrl.target.lerpVectors(t0, center, e);
              ctrl.update?.(); app.renderer.render(app.scene, cam);
              if (u < 1) requestAnimationFrame(step);
            }
            requestAnimationFrame(step);
          } catch (_){}
        },
        onSelect: (cb) => {
          try {
            if (app.events?.on) app.events.on('select', cb);
            else if (typeof app.on === 'function') app.on('select', cb);
          } catch (_){}
        }
      };

      componentsPanel = createComponentsPanel(app, theme, adapter) || null;
      componentsPanel?.open?.(); componentsPanel && (componentsPanel._open = true);
    } catch (e) {
      console.warn('[ComponentsPanel] init skipped:', e);
    }
  }

  // 6) Public destroy
  const destroy = () => {
    try { componentsPanel?.destroy?.(); } catch(_) {}
    try { toolsDock?.destroy?.(); } catch(_) {}
    try { inter.destroy?.(); } catch(_) {}
    try { core.destroy?.(); } catch(_) {}
  };

  return { ...app, destroy };
}
"""
Path("/mnt/data/urdf_viewer_main.js").write_text(code, encoding="utf-8")
print("/mnt/data/urdf_viewer_main.js")

