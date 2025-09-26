// AutoMindCloud/viewer/urdf_viewer_main.js
/* global THREE */

import * as Core from './core/ViewerCore.js';
import * as Assets from './core/AssetDB.js';
import * as Interact from './interaction/SelectionAndDrag.js';
import * as Tools from './ui/ToolsDock.js';
import * as Comp from './ui/ComponentsPanel.js';
import * as ThemeMod from './Theme.js';

// ---- Robust resolver for factory functions/objects ----
function resolveFactory(mod, names) {
  for (const n of names) {
    const v = mod && mod[n];
    if (typeof v === 'function') return v;
  }
  // check default export cases
  const d = mod && mod.default;
  if (typeof d === 'function') return d;
  if (d && typeof d === 'object') {
    for (const n of names) {
      const v = d[n];
      if (typeof v === 'function') return v;
    }
  }
  return null;
}

const createViewerCore = resolveFactory(Core, [
  'createViewerCore', 'initCore', 'createApp', 'makeViewer', 'bootstrap',
  'ViewerCore' // sometimes a constructor function
]);
const createAssetDB = resolveFactory(Assets, [
  'createAssetDB', 'AssetDB', 'makeAssetDB', 'initAssetDB'
]);
const attachSelection = resolveFactory(Interact, [
  'attachSelection', 'initSelection', 'wireSelection', 'enableSelection'
]);
const createToolsDock = resolveFactory(Tools, [
  'createToolsDock', 'initToolsDock', 'makeToolsDock'
]);
const createComponentsPanel = resolveFactory(Comp, [
  'createComponentsPanel', 'createComponents', 'initComponentsPanel', 'makeComponentsPanel'
]);

const theme =
  ThemeMod.theme || ThemeMod.default || {
    teal: '#0ea5a6',
    tealSoft: '#2dd4bf',
    tealFaint: '#ccfbf1',
    bgPanel: 'rgba(255,255,255,0.95)',
    bgCanvas: 0xffffff,
    stroke: '#d7e7e7',
    text: '#0b3b3c',
    textMuted: '#6b7280',
    shadow: '0 4px 12px rgba(0,0,0,0.08)',
  };

// ---------- helpers ----------
function box3Of(obj) { const b = new THREE.Box3(); try { b.setFromObject(obj); } catch (_) {} return b; }
function fixedDistance(camera, object, pad = 1.0) {
  const size = box3Of(object).getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fov = ((camera && camera.fov) ? camera.fov : 60) * Math.PI / 180;
  return (maxDim * pad) / Math.tan(fov / 2);
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ease = (t)=> (t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2);

// ---------- key bindings: i= isolate, h= components, u= tools ----------
function setupKeyHandlers(app, toolsDockRef, componentsRef, interactionsRef) {
  const targetEl =
    (app && app.renderer && app.renderer.domElement) ||
    (app && app.container) ||
    window;

  function toggleByApiOrDom(ref, preferClass, cls) {
    // 1) API
    if (ref) {
      if (typeof ref.set === 'function' && 'isOpen' in ref) { ref.set(!ref.isOpen); return; }
      if (typeof ref.open === 'function' && typeof ref.close === 'function') {
        ref._open = !ref._open;
        if (ref._open) ref.open(); else ref.close();
        return;
      }
    }
    // 2) DOM fallback
    const root = preferClass ? document.querySelector(preferClass) : (ref && ref.root);
    if (root) root.classList.toggle(cls || 'collapsed');
  }

  function onKey(e) {
    const k = (e.key || '').toLowerCase();
    if (k === 'i') {
      try { interactionsRef?.toggleIsolateSelected?.(); } catch(_) {}
      e.preventDefault(); e.stopPropagation();
    }
    if (k === 'h') { // user asked for 'h' to tween/toggle Components panel
      toggleByApiOrDom(componentsRef, '.components-panel', 'collapsed');
      e.preventDefault(); e.stopPropagation();
    }
    if (k === 'u') { // keep tools toggle on a separate key to avoid conflicts
      toggleByApiOrDom(toolsDockRef, '.viewer-dock-fix', 'collapsed');
      e.preventDefault(); e.stopPropagation();
    }
  }
  targetEl.addEventListener('keydown', onKey, true);
  return () => targetEl.removeEventListener('keydown', onKey, true);
}

/**
 * Public API
 * opts:
 *  - container, urdfContent, meshDB, selectMode ('link'...), background (hex|null), clickAudioDataURL
 * returns: app (augmented with .toolsDock, .components, .dispose())
 */
export async function render(opts = {}) {
  if (!createViewerCore) throw new Error('[urdf_viewer_main] ViewerCore not found');
  if (!createAssetDB) throw new Error('[urdf_viewer_main] AssetDB not found');

  const {
    container = document.getElementById('app'),
    urdfContent = '',
    meshDB = {},
    selectMode = 'link',
    background = 0xffffff,
    clickAudioDataURL = null,
  } = opts;

  if (!container) throw new Error('[urdf_viewer_main] Missing container');

  // 1) Core app
  const maybeApp = createViewerCore(opts, theme);
  const app = (maybeApp && typeof maybeApp.then === 'function') ? await maybeApp : maybeApp;

  // background
  try {
    if (background === null) { app.renderer.setClearAlpha(0); }
    else if (typeof background === 'number') { app.renderer.setClearColor(background); }
  } catch(_) {}

  // 2) Assets
  const assetDB = createAssetDB(meshDB);

  // 3) Load URDF
  const p = app.loadURDF?.(urdfContent, assetDB.loadMeshCb);
  if (p && typeof p.then === 'function') await p;

  // 4) Interactions
  const interactionsRef = attachSelection
    ? (attachSelection(app, theme, { selectMode, clickAudioDataURL }) || null)
    : null;

  // 5) UI panels
  const toolsDock = createToolsDock ? (createToolsDock(app, theme) || null) : null;
  const componentsPanel = createComponentsPanel ? (createComponentsPanel(app, theme) || null) : null;

  try { toolsDock?.open?.(); toolsDock && (toolsDock._open = true); } catch(_) {}
  try { componentsPanel?.open?.(); componentsPanel && (componentsPanel._open = true); } catch(_) {}

  // 6) Initial view
  try {
    if (toolsDock && typeof toolsDock.navigateToView === 'function') {
      toolsDock.navigateToView('iso', 650);
    } else if (app.robot && app.camera && app.controls) {
      const box = box3Of(app.robot);
      const center = box.getCenter(new THREE.Vector3());
      const dist = fixedDistance(app.camera, app.robot, 1.0);
      const p0 = app.camera.position.clone();
      const t0 = app.controls.target.clone ? app.controls.target.clone() : new THREE.Vector3();
      const dir = p0.clone().sub(t0).normalize();
      const targetPos = center.clone().add(dir.multiplyScalar(dist));
      const start = performance.now(), ms = 600;
      const step = (now) => {
        const u = clamp((now - start)/ms, 0, 1); const e = ease(u);
        app.camera.position.set(
          p0.x + (targetPos.x - p0.x)*e,
          p0.y + (targetPos.y - p0.y)*e,
          p0.z + (targetPos.z - p0.z)*e
        );
        app.controls.target.set(
          t0.x + (center.x - t0.x)*e,
          t0.y + (center.y - t0.y)*e,
          t0.z + (center.z - t0.z)*e
        );
        app.controls.update?.(); app.renderer.render(app.scene, app.camera);
        if (u < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  } catch(_) {}

  // 7) Keys
  const disposeKeys = setupKeyHandlers(app, toolsDock, componentsPanel, interactionsRef);

  // augment and return
  const originalDispose = app.dispose?.bind(app);
  app.dispose = () => {
    try { disposeKeys?.(); } catch(_) {}
    try { toolsDock?.destroy?.(); } catch(_) {}
    try { componentsPanel?.destroy?.(); } catch(_) {}
    try { originalDispose?.(); } catch(_) {}
  };
  app.toolsDock = toolsDock;
  app.components = componentsPanel;

  return app;
}
