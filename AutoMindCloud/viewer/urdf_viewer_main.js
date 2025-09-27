// /viewer/urdf_viewer_main.js
/* global THREE */

// ──────────────────────────────────────────────────────────────────────────────
// Core imports
// ──────────────────────────────────────────────────────────────────────────────
import { THEME } from './Theme.js';
import {
  createViewer,
  calculateFixedDistance,
  directionFromAzEl,
  currentAzimuthElevation,
  easeInOutCubic
} from './core/ViewerCore.js';
import { buildAssetDB, createLoadMeshCb } from './core/AssetDB.js';
import {
  attachInteraction,
  buildMeshCache,
  bulkSetVisible,
  setVisibleSubtree,
  frameObjectAnimated
} from './interaction/SelectionAndDrag.js';

// UI imports as NAMESPACES ONLY (no named imports to avoid hard failures)
import * as ToolsDock from './ui/ToolsDock.js';
import * as ComponentsPanel from './ui/ComponentsPanel.js';

// ──────────────────────────────────────────────────────────────────────────────
// Render entrypoint
// ──────────────────────────────────────────────────────────────────────────────
/**
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {string} opts.urdfContent
 * @param {Object<string,string>} opts.meshDB
 * @param {'link'|'mesh'} [opts.selectMode='link']
 * @param {number|null} [opts.background=THEME.bgCanvas]
 * @param {string|null} [opts.clickAudioDataURL]
 * @param {number} [opts.initAzDeg]
 * @param {number} [opts.initElDeg]
 * @param {number} [opts.initZoomOut]
 */
export function render(opts = {}) {
  const {
    container,
    urdfContent = '',
    meshDB = {},
    selectMode = 'link',
    background = THEME.bgCanvas || 0xffffff,
    clickAudioDataURL = null,
    initAzDeg,
    initElDeg,
    initZoomOut
  } = opts;

  if (!container) throw new Error('[render] container is required');
  if (!urdfContent?.trim()) {
    const msg = '[URDF Viewer] Model not found: urdfContent is empty.';
    console.error(msg);
    try { container.innerHTML = `<div style="color:#f55;padding:12px;font:14px/1.4 monospace">${msg}</div>`; } catch {}
    throw new Error('Model not found');
  }

  // 1) Core viewer
  const core = createViewer({ container, background, initAzDeg, initElDeg, initZoomOut });
  const _THREE = (typeof THREE !== 'undefined' ? THREE : (typeof window !== 'undefined' ? window.THREE : null));

  // 2) Asset DB + loadMeshCb (tag meshes with assetKey)
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map();
  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse(o => { if (o?.isMesh && o.geometry) list.push(o); });
      assetToMeshes.set(assetKey, list);
      obj.userData = obj.userData || {};
      obj.userData.__assetKey = assetKey;
    }
  });

  // 3) Load URDF
  let robot;
  try {
    robot = core.loadURDF(urdfContent, { loadMeshCb });
  } catch (e) {
    const msg = `[URDF Viewer] Failed to parse URDF: ${e?.message || e}`;
    console.error(msg);
    try { container.innerHTML = `<div style="color:#f55;padding:12px;font:14px/1.4 monospace">${msg}</div>`; } catch {}
    throw e;
  }
  if (!robot) {
    const msg = '[URDF Viewer] Robot not created from URDF.';
    console.error(msg);
    try { container.innerHTML = `<div style="color:#f55;padding:12px;font:14px/1.4 monospace">${msg}</div>`; } catch {}
    throw new Error('Model not found');
  }

  // 4) Offscreen thumbnails
  const off = buildOffscreenForThumbnails(core, assetToMeshes, _THREE);

  // 5) Interaction
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode
  });

  // 6) View manager
  const viewManager = createViewManager(core, robot, _THREE);

  // 7) App facade
  const app = {
    ...core,
    robot,
    assets: {
      list: () => listAssets(assetToMeshes),
      thumbnail: (assetKey) => off?.thumbnail(assetKey)
    },
    isolate: {
      asset: (assetKey) => isolateAsset(core, assetToMeshes, assetKey, _THREE),
      clear: () => showAll(core, _THREE)
    },
    showAll: () => showAll(core, _THREE),
    viewManager,
    openTools(open = true) { tools.set(!!open); }
  };

  // 8) UI panels (namespaced, with safe fallbacks)
  const makeToolsDock = (ToolsDock && typeof ToolsDock.createToolsDock === 'function') ? ToolsDock.createToolsDock : null;
  const tools = makeToolsDock
    ? (function() { try { return makeToolsDock(app, THEME) || { set(){}, open(){}, close(){}, destroy(){} }; }
                    catch (e) { console.warn('[ToolsDock] init failed:', e); return { set(){}, open(){}, close(){}, destroy(){} }; } })()
    : (console.warn('[ToolsDock] createToolsDock not found; using no-op.'), { set(){}, open(){}, close(){}, destroy(){} });

  const makeCompsPanel = (ComponentsPanel && typeof ComponentsPanel.createComponentsPanel === 'function') ? ComponentsPanel.createComponentsPanel : null;
  const comps = makeCompsPanel
    ? (function() { try { return makeCompsPanel(app, THEME) || { destroy(){} }; }
                    catch (e) { console.warn('[ComponentsPanel] init failed:', e); return { destroy(){} }; } })()
    : (console.warn('[ComponentsPanel] createComponentsPanel not found; using no-op.'), { destroy(){} });

  // 9) Optional click SFX
  if (clickAudioDataURL) { try { installClickSound(clickAudioDataURL); } catch {} }

  // 10) Shortcuts & view buttons
  function setupEnhancedShortcuts() {
    function handle(e) {
      const key = (e.key || '').toLowerCase();
      if (key === 'i') { e.preventDefault(); viewManager.isolateSelectedComponent(); }
      if (key === 'h') {
        e.preventDefault();
        const dock = document.querySelector('.viewer-dock-fix');
        if (dock) dock.classList.toggle('collapsed');
      }
    }
    container.addEventListener('keydown', handle, true);
    core.renderer.domElement.addEventListener('keydown', handle, true);
  }

  function setupEnhancedViewButtons() {
    document.addEventListener('click', (ev) => {
      const button = ev.target.closest('button');
      if (!button) return;
      const label = (button.textContent || '').trim().toLowerCase();
      if (['iso', 'top', 'front', 'right'].includes(label)) {
        ev.preventDefault(); ev.stopPropagation();
        viewManager.navigateToView(label);
      }
    }, true);
  }

  // 11) Init enhanced features
  setTimeout(() => {
    if (robot) {
      viewManager.initialize();
      setupEnhancedShortcuts();
      setupEnhancedViewButtons();
      setTimeout(() => viewManager.navigateToView('iso'), 300);
    }
  }, 200);

  // 12) Destroy
  const destroy = () => {
    try { comps.destroy(); } catch {}
    try { tools.destroy(); } catch {}
    try { inter.destroy(); } catch {}
    try { off?.destroy?.(); } catch {}
    try { core.destroy(); } catch {}
    try { viewManager.destroy(); } catch {}
  };

  return { ...app, destroy };
}

// ──────────────────────────────────────────────────────────────────────────────
// View Manager
// ──────────────────────────────────────────────────────────────────────────────
function createViewManager(app, robot, THREEref) {
  const THREEok = THREEref || (typeof THREE !== 'undefined' ? THREE : (typeof window !== 'undefined' ? window.THREE : null));
  let fixedDistance = null;
  let allMeshes = [];
  let isolating = false;
  let originalCameraState = null;

  const navToView = (viewType, dist, ms) => {
    const nav = (ToolsDock && typeof ToolsDock.navigateToFixedDistanceView === 'function')
      ? ToolsDock.navigateToFixedDistanceView
      : null;
    if (nav) {
      nav(viewType, app, dist, ms);
    } else {
      console.warn('[viewer] navigateToFixedDistanceView not available; using fitAndCenter.');
      app.fitAndCenter(app.robot, 1.06);
    }
  };

  const tween = (pos, tgt, ms) => {
    const tweenFn = (ToolsDock && typeof ToolsDock.tweenOrbits === 'function')
      ? ToolsDock.tweenOrbits
      : null;
    if (tweenFn) return tweenFn(app.camera, app.controls, pos, tgt, ms);
    // Fallback: snap
    app.camera.position.copy(pos);
    app.controls.target.copy(tgt);
    app.controls.update();
  };

  function initialize() {
    if (robot) {
      allMeshes = buildMeshCache(robot);
      fixedDistance = calculateFixedDistance(robot, app.camera, 1.9);
    }
  }

  function navigateToView(viewType) {
    if (!fixedDistance) initialize();
    navToView(viewType, fixedDistance, 750);
  }

  function isolateComponent(component) {
    if (isolating) return restoreView();
    if (!component) return console.warn('No component provided for isolation');

    originalCameraState = {
      position: app.camera.position.clone(),
      target: app.controls.target.clone()
    };

    bulkSetVisible(allMeshes, false);
    setVisibleSubtree(component, true);
    frameObjectAnimated(component, app, 1.3, 800);

    isolating = true;
  }

  function restoreView() {
    if (!isolating || !originalCameraState) return;

    bulkSetVisible(allMeshes, true);
    tween(originalCameraState.position, originalCameraState.target, 800);

    isolating = false;
  }

  function getSelectedComponent() {
    const row = document.querySelector('.viewer-dock-fix tr.selected');
    if (!row) return null;
    const linkName = row.cells?.[0]?.textContent?.trim();
    if (!linkName) return null;

    let target = null;
    robot.traverse(o => {
      if (o.name === linkName || o.userData?.linkName === linkName) targ
