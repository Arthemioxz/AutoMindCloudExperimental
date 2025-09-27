# Write a self-contained ESM entry that **defines createToolsDock inside the file**,
# so it never depends on a missing global/import. No behavioral changes beyond wiring.
from pathlib import Path

code = """\
// /viewer/urdf_viewer_main.js
// Self-contained entry: defines createToolsDock here to avoid missing import issues.

import { THEME } from './Theme.js';
import { createViewer } from './core/ViewerCore.js';
import { buildAssetDB, createLoadMeshCb } from './core/AssetDB.js';
import { attachInteraction } from './interaction/SelectionAndDrag.js';
import { createComponentsPanel } from './ui/ComponentsPanel.js';

/* ---------------- createToolsDock (inline, same behavior) ---------------- */
function createToolsDock(app, theme){
  // Hotkeys: 'h' toggle dock, 'i' isolation trigger
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

  // Enhance UI and tag the dock when it shows up; remove Fit and duplicate Snapshot (as in your .py)
  function enhanceUI(root){
    root = root || document;
    const btns = root.querySelectorAll('button');
    btns.forEach(b => b.classList.add('am-btn'));
    const sels = root.querySelectorAll('select, input[type="text"]');
    sels.forEach(el => el.classList.add('am-input'));
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

  // Override camera view buttons to use fixed-distance navigator
  document.addEventListener('click', (ev)=>{
    const b = ev.target.closest && ev.target.closest('button'); if(!b) return;
    const label = (b.textContent || '').trim().toLowerCase();
    if(!/^(iso|top|front|right)$/i.test(label)) return;
    (app.navigateToViewFixedDistance||function(){ })(label, 750);
    ev.preventDefault();
    ev.stopPropagation();
  }, true);

  function set(open){
    const dock = document.querySelector('.viewer-dock-fix');
    if (!dock) return;
    dock.classList.toggle('collapsed', !open);
  }

  function destroy(){ try{ mo.disconnect(); }catch(_){} }
  return { set, destroy };
}

/* ---------------- Public entry ---------------- */
export function render(opts = {}){
  const {
    container,
    urdfContent = '',
    meshDB = {},
    selectMode = 'link',
    background = THEME.bgCanvas || 0xffffff,
    clickAudioDataURL = null
  } = opts;

  // Core viewer
  const core = createViewer({ container, background });

  // Assets
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map();
  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey){
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse(o=>{ if(o?.isMesh && o.geometry) list.push(o); });
      assetToMeshes.set(assetKey, list);
    }
  });

  // Load URDF
  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // Interaction
  const inter = attachInteraction({
    scene: core.scene, camera: core.camera, renderer: core.renderer, controls: core.controls, robot, selectMode
  });

  // App facade
  const app = {
    ...core, robot,
    assets: {
      list: () => {
        const items=[]; assetToMeshes.forEach((arr, key)=>{ if(!arr?.length) return;
          const clean=String(key||'').split('?')[0].split('#')[0]; const base=clean.split('/').pop(); const dot=base.lastIndexOf('.');
          items.push({ assetKey:key, base: dot>=0?base.slice(0,dot):base, ext: dot>=0?base.slice(dot+1).toLowerCase():'', count:arr.length });
        });
        items.sort((a,b)=>a.base.localeCompare(b.base, undefined, { numeric:true, sensitivity:'base' }));
        return items;
      },
      thumbnail: async (assetKey) => null
    },
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

  // Tools dock (inline implementation above) and components panel
  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);

  // Destroy helper
  const destroy = () => {
    try { comps.destroy(); } catch(_) {}
    try { tools.destroy(); } catch(_) {}
    try { inter.destroy?.(); } catch(_) {}
    try { core.destroy(); } catch(_) {}
  };

  return { ...app, destroy };
}
"""
Path("/mnt/data/urdf_viewer_main.js").write_text(code, encoding="utf-8")

# Provide paths back so the user can download everything together
files = [
    "/mnt/data/urdf_viewer_main.js",
    "/mnt/data/Theme.js",
    "/mnt/data/ViewerCore.js",
    "/mnt/data/AssetDB.js",
    "/mnt/data/SelectionAndDrag.js",
    "/mnt/data/ComponentsPanel.js",
    "/mnt/data/ToolsDock.js",
    "/mnt/data/urdf_render_fixed_UPDATED.py",
]
files
