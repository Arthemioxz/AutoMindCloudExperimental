// /viewer/urdf_viewer_main.js
/* global THREE */

// ──────────────────────────────────────────────────────────────────────────────
// Core imports (stable)
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

// IMPORTANT: No static imports from ./ui/*. We’ll dynamic-import them in render().

// ──────────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────────
function haveTHREE() {
  return (typeof THREE !== 'undefined') ? THREE :
         ((typeof window !== 'undefined' && window.THREE) ? window.THREE : null);
}

// Safe no-op UI objects if dynamic imports fail or exports are missing
function noopToolsDock() {
  return { set(){}, open(){}, close(){}, destroy(){} };
}
function noopComponentsPanel() {
  return { destroy(){} };
}

// ──────────────────────────────────────────────────────────────────────────────
// Public entry
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
  const _THREE = haveTHREE();

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

  // 8) Dynamically import UI modules (no crash if missing)
  // We try relative to this file. If you host elsewhere, you can change to absolute URLs.
  let toolsFactory = null;
  let compsFactory = null;
  let navToFixedDistanceView = null;
  let tweenOrbitsFn = null;

  // We’ll kick off dynamic imports, but we DO NOT block viewer init on them.
  // If they fail, the viewer still works without the panels.
  (async () => {
    try {
      const ToolsDock = await import('./ui/ToolsDock.js');
      if (typeof ToolsDock.createToolsDock === 'function') toolsFactory = ToolsDock.createToolsDock;
      if (typeof ToolsDock.navigateToFixedDistanceView === 'function') navToFixedDistanceView = ToolsDock.navigateToFixedDistanceView;
      if (typeof ToolsDock.tweenOrbits === 'function') tweenOrbitsFn = ToolsDock.tweenOrbits;
    } catch (e) {
      console.warn('[URDF] ToolsDock dynamic import failed:', e);
    }
    try {
      const ComponentsPanel = await import('./ui/ComponentsPanel.js');
      if (typeof ComponentsPanel.createComponentsPanel === 'function') compsFactory = ComponentsPanel.createComponentsPanel;
    } catch (e) {
      console.warn('[URDF] ComponentsPanel dynamic import failed:', e);
    }

    // initialize panels if available
    try {
      if (toolsFactory) tools = toolsFactory(app, THEME) || noopToolsDock();
      tools?.open?.();
    } catch (e) {
      console.warn('[ToolsDock] init failed:', e);
    }
    try {
      if (compsFactory) comps = compsFactory(app, THEME) || noopComponentsPanel();
    } catch (e) {
      console.warn('[ComponentsPanel] init failed:', e);
    }

    // now that we might have nav helpers, hook the enhanced stuff
    setupEnhancedShortcuts();
    setupEnhancedViewButtons();
    setTimeout(() => app.viewManager?.navigateToView?.('iso'), 300);
  })();

  // Pre-create no-ops; dynamic import above may replace them later
  let tools = noopToolsDock();
  let comps = noopComponentsPanel();

  // 9) Optional click SFX
  if (clickAudioDataURL) { try { installClickSound(clickAudioDataURL); } catch {} }

  // 10) Shortcuts & view buttons (use whatever nav helpers we have)
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
        app.viewManager?.navigateToView?.(label);
      }
    }, true);
  }

  // 11) Initialize minimal features immediately (without waiting UI imports)
  setTimeout(() => {
    if (robot) {
      viewManager.initialize();
      // We’ll re-run buttons/shortcuts once UI loads (above)
    }
  }, 0);

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

  // ────────────────────────────────────────────────────────────────────────────
  // Nested: View Manager uses dynamic nav helpers if they appear
  function createViewManager(app, robot, THREEref) {
    const THREEok = THREEref || haveTHREE();
    let fixedDistance = null;
    let allMeshes = [];
    let isolating = false;
    let originalCameraState = null;

    function initialize() {
      if (robot) {
        allMeshes = buildMeshCache(robot);
        fixedDistance = calculateFixedDistance(robot, app.camera, 1.9);
      }
    }

    function navigateToView(viewType) {
      if (!fixedDistance) initialize();
      // Use dynamic helper if available, else fit
      if (typeof navToFixedDistanceView === 'function') {
        navToFixedDistanceView(viewType, app, fixedDistance, 750);
      } else {
        app.fitAndCenter(app.robot, 1.06);
      }
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
      if (typeof tweenOrbitsFn === 'function') {
        tweenOrbitsFn(app.camera, app.controls, originalCameraState.position, originalCameraState.target, 800);
      } else {
        // fallback snap
        app.camera.position.copy(originalCameraState.position);
        app.controls.target.copy(originalCameraState.target);
        app.controls.update();
      }
      isolating = false;
    }

    function getSelectedComponent() {
      const row = document.querySelector('.viewer-dock-fix tr.selected');
      if (!row) return null;
      const linkName = row.cells?.[0]?.textContent?.trim();
      if (!linkName) return null;

      let target = null;
      robot.traverse(o => {
        if (o.name === linkName || o.userData?.linkName === linkName) target = o;
      });
      return target;
    }

    function isolateSelectedComponent() {
      if (isolating) return restoreView();
      const sel = getSelectedComponent();
      if (!sel) return console.log('No component selected');
      isolateComponent(sel);
    }

    function destroy() {
      allMeshes = [];
      isolating = false;
      originalCameraState = null;
    }

    if (robot) setTimeout(initialize, 0);

    return {
      initialize,
      navigateToView,
      isolateComponent,
      isolateSelectedComponent,
      restoreView,
      getSelectedComponent,
      destroy,
      get isIsolating() { return isolating; },
      get fixedDistance() { return fixedDistance; }
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers (unchanged)
// ──────────────────────────────────────────────────────────────────────────────
function listAssets(assetToMeshes) {
  const items = [];
  assetToMeshes.forEach((meshes, assetKey) => {
    if (!meshes?.length) return;
    const { base, ext } = splitName(assetKey);
    items.push({ assetKey, base, ext, count: meshes.length });
  });
  items.sort((a, b) => a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: 'base' }));
  return items;
}

function splitName(key) {
  const clean = String(key || '').split('?')[0].split('#')[0];
  const base = clean.split('/').pop();
  const dot = base.lastIndexOf('.');
  return { base: dot >= 0 ? base.slice(0, dot) : base, ext: dot >= 0 ? base.slice(dot + 1).toLowerCase() : '' };
}

function isolateAsset(core, assetToMeshes, assetKey, THREEref) {
  const meshes = assetToMeshes.get(assetKey) || [];
  if (core.robot) core.robot.traverse(o => { if (o.isMesh && o.geometry) o.visible = false; });
  meshes.forEach(m => { m.visible = true; });
  frameMeshes(core, meshes, THREEref);
}

function showAll(core) {
  if (core.robot) {
    core.robot.traverse(o => { if (o.isMesh && o.geometry) o.visible = true; });
    core.fitAndCenter(core.robot, 1.06);
  }
}

function frameMeshes(core, meshes, THREEref) {
  const THREEok = THREEref || haveTHREE();
  if (!THREEok || !meshes?.length) return;

  const box = new THREEok.Box3(), tmp = new THREEok.Box3();
  let has = false;
  for (const m of meshes) {
    tmp.setFromObject(m);
    if (!has) { box.copy(tmp); has = true; } else box.union(tmp);
  }
  if (!has) return;
  const center = box.getCenter(new THREEok.Vector3());
  const size   = box.getSize(new THREEok.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  const cam = core.camera, ctrl = core.controls;
  if (cam.isPerspectiveCamera) {
    const fov = (cam.fov || 60) * Math.PI / 180;
    const dist = maxDim / Math.tan(Math.max(1e-6, fov / 2));
    cam.near = Math.max(maxDim / 1000, 0.001);
    cam.far  = Math.max(maxDim * 1500, 1500);
    cam.updateProjectionMatrix();
    const dir = new THREEok.Vector3(1, 0.7, 1).normalize();
    cam.position.copy(center.clone().add(dir.multiplyScalar(dist)));
  } else {
    cam.left = -maxDim; cam.right = maxDim; cam.top = maxDim; cam.bottom = -maxDim;
    cam.near = Math.max(maxDim / 1000, 0.001);
    cam.far  = Math.max(maxDim * 1500, 1500);
    cam.updateProjectionMatrix();
    cam.position.copy(center.clone().add(new THREEok.Vector3(maxDim, maxDim * 0.9, maxDim)));
  }
  ctrl.target.copy(center);
  ctrl.update();
}

// ──────────────────────────────────────────────────────────────────────────────
function buildOffscreenForThumbnails(core, assetToMeshes, THREEref) {
  const THREEok = THREEref || haveTHREE();
  if (!core.robot || !THREEok) return null;

  const OFF_W = 640, OFF_H = 480;
  const canvas = document.createElement('canvas');
  canvas.width = OFF_W; canvas.height = OFF_H;

  const renderer = new THREEok.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(OFF_W, OFF_H, false);

  const scene = new THREEok.Scene();
  scene.background = new THREEok.Color(0xffffff);

  const amb = new THREEok.AmbientLight(0xffffff, 0.95);
  const d = new THREEok.DirectionalLight(0xffffff, 1.1); d.position.set(2.5, 2.5, 2.5);
  scene.add(amb); scene.add(d);

  const camera = new THREEok.PerspectiveCamera(60, OFF_W / OFF_H, 0.01, 10000);
  const robotClone = core.robot.clone(true);
  scene.add(robotClone);

  const map = new Map();
  robotClone.traverse(o => {
    const k = o?.userData?.__assetKey;
    if (k && o.isMesh && o.geometry) {
      let arr = map.get(k);
      if (!arr) { arr = []; map.set(k, arr); }
      arr.push(o);
    }
  });

  function snapshotAsset(assetKey) {
    const meshes = map.get(assetKey) || [];
    if (!meshes.length) return null;

    const vis = [];
    robotClone.traverse(o => { if (o.isMesh && o.geometry) vis.push([o, o.visible]); });
    for (const [m] of vis) m.visible = false;
    for (const m of meshes) m.visible = true;

    const box = new THREEok.Box3(), tmp = new THREEok.Box3();
    let ok = false;
    for (const m of meshes) { tmp.setFromObject(m); if (!ok) { box.copy(tmp); ok = true; } else box.union(tmp); }
    if (!ok) { for (const [o, v] of vis) o.visible = v; return null; }

    const center = box.getCenter(new THREEok.Vector3());
    const size = box.getSize(new THREEok.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.0;

    camera.near = Math.max(maxDim / 1000, 0.001);
    camera.far  = Math.max(maxDim * 1000, 1000);
    camera.updateProjectionMatrix();

    const az = Math.PI * 0.25, el = Math.PI * 0.18;
    const dir = new THREEok.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).multiplyScalar(dist);
    camera.position.copy(center.clone().add(dir));
    camera.lookAt(center);

    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');

    for (const [o, v] of vis) o.visible = v;
    return url;
  }

  return {
    thumbnail: async (assetKey) => { try { return snapshotAsset(assetKey); } catch { return null; } },
    destroy: () => { try { renderer.dispose(); } catch {} try { scene.clear(); } catch {} }
  };
}

// ──────────────────────────────────────────────────────────────────────────────
function installClickSound(dataURL) {
  if (!dataURL || typeof dataURL !== 'string') return;
  let ctx = null, buf = null;
  async function ensure() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (!buf) { const arr = await (await fetch(dataURL)).arrayBuffer(); buf = await ctx.decodeAudioData(arr); }
  }
  function play() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    if (!buf) { ensure().then(play).catch(() => {}); return; }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    try { src.start(); } catch {}
  }
  window.__urdf_click__ = play;
}

// ──────────────────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.URDFViewer = { render };
}

// Stable re-exports for callers that expect them
export {
  // Note: createViewManager is intentionally nested in render; we don’t re-export it
  calculateFixedDistance,
  directionFromAzEl,
  currentAzimuthElevation,
  easeInOutCubic
};
