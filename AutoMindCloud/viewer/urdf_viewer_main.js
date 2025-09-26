// AutoMindCloud/viewer/urdf_viewer_main.js
// Entrypoint (ESM). Composes core viewer, asset DB, interaction, tools dock, and components panel.
// Exports: render(opts) -> returns the app object from ViewerCore, with .toolsDock/.components/.dispose()

/* global THREE */ // Three is loaded UMD by Python shell before importing this module.

///////////////////////////
// 1) IMPORTS (defensive) //
///////////////////////////
import * as Core from './core/ViewerCore.js';
import * as Assets from './core/AssetDB.js';
import * as Interact from './interaction/SelectionAndDrag.js';
import * as Tools from './ui/ToolsDock.js';
import * as Comp from './ui/ComponentsPanel.js';
import * as ThemeMod from './Theme.js';

// Resolve export names defensively
const createViewerCore =
  Core.createViewerCore || Core.initCore || Core.default;

const createAssetDB =
  Assets.createAssetDB || Assets.AssetDB || Assets.default;

const attachSelection =
  Interact.attachSelection || Interact.initSelection || Interact.default;

const createToolsDock =
  Tools.createToolsDock || Tools.initToolsDock || Tools.default;

const createComponentsPanel =
  Comp.createComponentsPanel || Comp.createComponents || Comp.default;

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

/////////////////////////////////
// 2) SMALL INTERNAL UTILITIES //
/////////////////////////////////

function box3Of(obj) {
  const box = new THREE.Box3();
  try { box.setFromObject(obj); } catch (_) {}
  return box;
}

function fixedDistance(camera, object, pad = 1.0) {
  const size = box3Of(object).getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fov = ((camera && camera.fov) ? camera.fov : 60) * Math.PI / 180;
  return (maxDim * pad) / Math.tan(fov / 2);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function setupKeyHandlers(app, toolsDockRef, interactionsRef) {
  // Keep a single listener bound to the canvas root (or document as fallback)
  const targetEl =
    (app && app.renderer && app.renderer.domElement) ||
    (app && app.container) ||
    window;

  function onKey(e) {
    const k = (e.key || '').toLowerCase();
    if (k === 'h') {
      // Toggle tools dock (if present)
      try {
        if (toolsDockRef && typeof toolsDockRef.set === 'function') {
          // If it has state, toggle by reading CSS class or flipping flag (best-effort)
          const root = toolsDockRef.root || document.querySelector('.viewer-dock-fix');
          const hidden = root && root.classList.contains('collapsed');
          toolsDockRef.set(hidden); // set(open)
        } else if (toolsDockRef && typeof toolsDockRef.open === 'function') {
          // simple toggle using open/close
          if (toolsDockRef._open) { toolsDockRef.close?.(); toolsDockRef._open = false; }
          else { toolsDockRef.open?.(); toolsDockRef._open = true; }
        }
      } catch (_) {}
      e.preventDefault();
      e.stopPropagation();
    }
    if (k === 'i') {
      // Delegate to SelectionAndDrag isolate toggle if it exposed one
      try {
        if (interactionsRef && typeof interactionsRef.toggleIsolateSelected === 'function') {
          interactionsRef.toggleIsolateSelected();
          e.preventDefault();
          e.stopPropagation();
        }
      } catch (_) {}
    }
  }

  targetEl.addEventListener('keydown', onKey, true);

  // return disposer
  return () => {
    targetEl.removeEventListener('keydown', onKey, true);
  };
}

/////////////////////////////////////
// 3) THE ONLY PUBLIC API: render() //
/////////////////////////////////////

/**
 * @typedef {Object} RenderOptions
 * @property {HTMLElement} container
 * @property {string}      urdfContent
 * @property {Object}      meshDB                 // { key -> base64 data }
 * @property {string}      selectMode             // "link" | "visual" | ...
 * @property {number|null} background             // hex number, or null to keep default
 * @property {string?}     clickAudioDataURL      // optional data:audio/... for click
 *
 * render(opts) bootstraps the viewer and returns the app object from ViewerCore, extended with:
 *   - app.toolsDock
 *   - app.components
 *   - app.dispose()   // disposes key handlers + sub-uis (best effort)
 */
export async function render(opts = {}) {
  if (!createViewerCore) throw new Error('[urdf_viewer_main] ViewerCore not found');
  if (!createAssetDB) throw new Error('[urdf_viewer_main] AssetDB not found');

  // Defaults
  const {
    container = document.getElementById('app'),
    urdfContent = '',
    meshDB = {},
    selectMode = 'link',
    background = 0xffffff,
    clickAudioDataURL = null,
  } = opts;

  if (!container) throw new Error('[urdf_viewer_main] Missing container');

  // 1) Core viewer (camera, controls, scene, renderer, helpers)
  const app = await (async () => {
    const maybe = createViewerCore(opts, theme);
    // allow createViewerCore to be async or sync
    return (maybe && typeof maybe.then === 'function') ? await maybe : maybe;
  })();

  // Optional background
  try {
    const bgOK = (background === null || typeof background === 'number');
    if (bgOK && app && app.renderer) {
      if (background === null) {
        app.renderer.setClearColor(0x000000);
        app.renderer.setClearAlpha(0.0);
      } else {
        app.renderer.setClearColor(background);
      }
    }
  } catch (_) {}

  // 2) Assets (mesh/texture DB -> loader callback)
  const assetDB = createAssetDB(meshDB);

  // 3) Load URDF, then attach interaction + UI
  //    Expect app.loadURDF(urdfContent, loadMeshCb) to resolve when robot is in scene.
  const loadResult = app.loadURDF?.(urdfContent, assetDB.loadMeshCb);
  if (loadResult && typeof loadResult.then === 'function') {
    await loadResult;
  }

  // 3a) Interactions (hover, select, drag joints, 'i' isolate)
  let interactionsRef = null;
  if (attachSelection) {
    interactionsRef = attachSelection(app, theme, {
      selectMode,
      clickAudioDataURL,
    }) || null;
  }

  // 3b) Tools dock (views tween, section, explode, snapshot, etc.)
  let toolsDock = null;
  if (createToolsDock) {
    toolsDock = createToolsDock(app, theme) || null;
    // Open by default if possible; store open-state flag for simple toggle fallback
    try { toolsDock?.open?.(); toolsDock && (toolsDock._open = true); } catch (_) {}
  }

  // 3c) Components panel (list of links; optional thumbnails; click to focus)
  let componentsPanel = null;
  if (createComponentsPanel) {
    componentsPanel = createComponentsPanel(app, theme) || null;
  }

  // 4) Initial view fitting: prefer a stable ISO with fixed distance if tools expose it,
  //    otherwise fall back to a generic fit on the whole robot.
  try {
    // If ToolsDock installed a navigation helper, use it
    if (toolsDock && typeof toolsDock.navigateToView === 'function') {
      toolsDock.navigateToView('iso', 650);
    } else if (app.robot && app.camera && app.controls) {
      // simple fit: keep current az/el, move along that ray to a fixed distance
      const box = box3Of(app.robot);
      const center = box.getCenter(new THREE.Vector3());
      const dist = fixedDistance(app.camera, app.robot, 1.0);
      const p = app.camera.position.clone();
      const dir = p.clone().sub(app.controls.target || new THREE.Vector3()).normalize();
      const targetPos = center.clone().add(dir.multiplyScalar(dist));
      // tween (minimal)
      const start = performance.now();
      const p0 = app.camera.position.clone();
      const t0 = (app.controls.target || new THREE.Vector3()).clone();
      const ms = 600;
      const ease = (t) => (t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2);
      const animate = (now) => {
        const u = clamp((now - start) / ms, 0, 1);
        const e = ease(u);
        app.camera.position.set(
          p0.x + (targetPos.x - p0.x) * e,
          p0.y + (targetPos.y - p0.y) * e,
          p0.z + (targetPos.z - p0.z) * e
        );
        app.controls.target.set(
          t0.x + (center.x - t0.x) * e,
          t0.y + (center.y - t0.y) * e,
          t0.z + (center.z - t0.z) * e
        );
        app.controls.update?.();
        app.renderer.render(app.scene, app.camera);
        if (u < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }
  } catch (_) {}

  // 5) Keyboard shortcuts: 'h' toggles tools dock; 'i' delegates to Selection module isolate
  const disposeKeys = setupKeyHandlers(app, toolsDock, interactionsRef);

  ///////////////////////
  // 6) DISPOSE HANDLE //
  ///////////////////////
  const originalDispose = app.dispose?.bind(app);
  app.dispose = () => {
    try { disposeKeys?.(); } catch (_) {}
    try { toolsDock?.destroy?.(); } catch (_) {}
    try { componentsPanel?.destroy?.(); } catch (_) {}
    try { originalDispose?.(); } catch (_) {}
  };

  // Expose references for external scripts if needed
  app.toolsDock = toolsDock;
  app.components = componentsPanel;

  return app;
}
