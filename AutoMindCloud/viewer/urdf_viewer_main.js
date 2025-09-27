// /viewer/urdf_viewer_main.js
// Entrypoint that composes ViewerCore + AssetDB + Selection & Drag + UI (Tools & Components)

/* global THREE */

import { THEME } from './Theme.js';
import { createViewer, calculateFixedDistance, directionFromAzEl, currentAzimuthElevation, easeInOutCubic } from './core/ViewerCore.js';
import { buildAssetDB, createLoadMeshCb } from './core/AssetDB.js';
import { attachInteraction, buildMeshCache, bulkSetVisible, setVisibleSubtree, frameObjectAnimated } from './interaction/SelectionAndDrag.js';

// IMPORTANT: import UI modules as namespaces to avoid unbound identifiers
import * as ToolsDock from './ui/ToolsDock.js';
import * as ComponentsPanel from './ui/ComponentsPanel.js';

/**
 * Public entry: render the URDF viewer.
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {string} opts.urdfContent              — URDF string
 * @param {Object.<string,string>} opts.meshDB   — key → base64
 * @param {'link'|'mesh'} [opts.selectMode='link']
 * @param {number|null} [opts.background=THEME.bgCanvas]
 * @param {string|null} [opts.clickAudioDataURL] — optional UI SFX (not required)
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

  // Early guard: give feedback if no URDF content
  if (!urdfContent || typeof urdfContent !== 'string' || !urdfContent.trim()) {
    const msg = '[URDF Viewer] Model not found: urdfContent is empty.';
    console.error(msg);
    try {
      container.innerHTML = `<div style="color:#f55;padding:12px;font:14px/1.4 monospace">${msg}</div>`;
    } catch (_) {}
    throw new Error('Model not found');
  }

  // 1) Core viewer
  const core = createViewer({ container, background, initAzDeg, initElDeg, initZoomOut });

  // Prefer the global installed by ViewerCore
  const _THREE = (typeof THREE !== 'undefined' ? THREE : (typeof window !== 'undefined' ? window.THREE : null));

  // 2) Asset DB + loadMeshCb with onMeshTag hook to index meshes by assetKey
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map(); // assetKey -> Mesh[]
  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      // Collect every mesh produced under this assetKey
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse((o) => {
        if (o && o.isMesh && o.geometry) list.push(o);
      });
      assetToMeshes.set(assetKey, list);
      // tag on userData to help offscreen clone map
      obj.userData = obj.userData || {};
      obj.userData.__assetKey = assetKey;
    }
  });

  // 3) Load URDF (this triggers tagging via `onMeshTag`)
  let robot;
  try {
    robot = core.loadURDF(urdfContent, { loadMeshCb });
  } catch (e) {
    const msg = `[URDF Viewer] Failed to parse URDF: ${e?.message || e}`;
    console.error(msg);
    try {
      container.innerHTML = `<div style="color:#f55;padding:12px;font:14px/1.4 monospace">${msg}</div>`;
    } catch (_) {}
    throw e;
  }
  if (!robot) {
    const msg = '[URDF Viewer] Robot not created from URDF.';
    console.error(msg);
    try { container.innerHTML = `<div style="color:#f55;padding:12px;font:14px/1.4 monospace">${msg}</div>`; } catch (_){}
    throw new Error('Model not found');
  }

  // 4) Build an offscreen renderer for thumbnails (after robot exists)
  const off = buildOffscreenForThumbnails(core, assetToMeshes, _THREE);

  // 5) Interaction (hover, select, drag joints, key 'i')
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode
  });

  // 6) Enhanced view manager
  const viewManager = createViewManager(core, robot, _THREE);

  // 7) Facade "app" that is passed to UI components
  const app = {
    // Expose core bits
    ...core,
    robot,

    // --- Assets adapter for ComponentsPanel ---
    assets: {
      list: () => listAssets(assetToMeshes),
      thumbnail: (assetKey) => off?.thumbnail(assetKey)
    },

    // --- Isolate / restore ---
    isolate: {
      asset: (assetKey) => isolateAsset(core, assetToMeshes, assetKey, _THREE),
      clear: () => showAll(core, _THREE)
    },

    // --- Show all ---
    showAll: () => showAll(core, _THREE),

    // --- View Manager ---
    viewManager,

    // Optional: open tools externally
    openTools(open = true) { tools.set(!!open); }
  };

  // 8) UI modules with safe fallbacks
  const makeToolsDock = ToolsDock?.createToolsDock;
  const makeCompsPanel = ComponentsPanel?.createComponentsPanel;

  const tools = (typeof makeToolsDock === 'function')
    ? makeToolsDock(app, THEME)
    : (console.warn('[viewer] ToolsDock.createToolsDock not found; using no-op.'), { set(){}, open(){}, close(){}, destroy(){} });

  const comps = (typeof makeCompsPanel === 'function')
    ? makeCompsPanel(app, THEME)
    : (console.warn('[viewer] ComponentsPanel.createComponentsPanel not found; using no-op.'), { destroy(){} });

  // Optional click SFX for UI (kept minimal; UI modules do not depend on it)
  if (clickAudioDataURL) {
    try { installClickSound(clickAudioDataURL); } catch (_) {}
  }

  // Enhanced keyboard shortcuts
  function setupEnhancedShortcuts() {
    function handleEnhancedKeys(e) {
      const key = (e.key || '').toLowerCase();

      // 'i' for isolation
      if (key === 'i') {
        e.preventDefault();
        viewManager.isolateSelectedComponent();
      }

      // 'h' for toggle dock
      if (key === 'h') {
        e.preventDefault();
        const dock = document.querySelector('.viewer-dock-fix');
        if (dock) dock.classList.toggle('collapsed');
      }
    }

    container.addEventListener('keydown', handleEnhancedKeys, true);
    core.renderer.domElement.addEventListener('keydown', handleEnhancedKeys, true);
  }

  // Override view buttons to use fixed distance
  function setupEnhancedViewButtons() {
    document.addEventListener('click', (ev) => {
      const button = ev.target.closest('button');
      if (!button) return;

      const label = (button.textContent || '').trim().toLowerCase();
      if (['iso', 'top', 'front', 'right'].includes(label)) {
        ev.preventDefault();
        ev.stopPropagation();
        viewManager.navigateToView(label);
      }
    }, true);
  }

  // Initialize enhanced features
  setTimeout(() => {
    if (robot) {
      viewManager.initialize();
      setupEnhancedShortcuts();
      setupEnhancedViewButtons();

      // Initial navigation to ISO view
      setTimeout(() => {
        viewManager.navigateToView('iso');
      }, 300);
    }
  }, 200);

  // Public destroy
  const destroy = () => {
    try { comps.destroy(); } catch (_) {}
    try { tools.destroy(); } catch (_) {}
    try { inter.destroy(); } catch (_) {}
    try { off?.destroy?.(); } catch (_) {}
    try { core.destroy(); } catch (_) {}
    try { viewManager.destroy(); } catch (_) {}
  };

  return { ...app, destroy };
}

/* ---------------------------- Enhanced View Manager ---------------------------- */

/**
 * Create enhanced view management with fixed distance and isolation
 */
function createViewManager(app, robot, THREEref) {
  const THREEok = THREEref || (typeof THREE !== 'undefined' ? THREE : (typeof window !== 'undefined' ? window.THREE : null));
  let fixedDistance = null;
  let allMeshes = [];
  let isolating = false;
  let originalCameraState = null;
  let isolatedComponent = null;

  // ToolsDock helpers (with fallbacks)
  const navigateToFixedDistanceView =
    (ToolsDock && ToolsDock.navigateToFixedDistanceView) ||
    function (viewType, appRef, dist, ms) {
      console.warn('[viewer] ToolsDock.navigateToFixedDistanceView not found; falling back to fitAndCenter.');
      appRef.fitAndCenter(appRef.robot, 1.06);
    };

  const tweenOrbits =
    (ToolsDock && ToolsDock.tweenOrbits) ||
    function (cam, ctrls, pos, tgt /*, ms*/) {
      cam.position.copy(pos);
      ctrls.target.copy(tgt);
      ctrls.update();
    };

  function initialize() {
    if (robot) {
      allMeshes = buildMeshCache(robot);
      fixedDistance = calculateFixedDistance(robot, app.camera, 1.9);
    }
  }

  function navigateToView(viewType) {
    if (!fixedDistance) initialize();
    navigateToFixedDistanceView(viewType, app, fixedDistance, 750);
  }

  function isolateComponent(component) {
    if (isolating) return restoreView();

    if (!component) {
      console.warn('No component provided for isolation');
      return;
    }

    originalCameraState = {
      position: app.camera.position.clone(),
      target: app.controls.target.clone()
    };

    bulkSetVisible(allMeshes, false);
    setVisibleSubtree(component, true);
    frameObjectAnimated(component, app, 1.3, 800);

    isolating = true;
    isolatedComponent = component;
  }

  function restoreView() {
    if (!isolating || !originalCameraState) return;

    bulkSetVisible(allMeshes, true);
    tweenOrbits(app.camera, app.controls, originalCameraState.position, originalCameraState.target, 800);

    isolating = false;
    isolatedComponent = null;
  }

  function getSelectedComponent() {
    // Example lookup via components table selection
    const selectedRows = document.querySelectorAll('.viewer-dock-fix tr.selected');
    if (selectedRows.length === 0) return null;

    const row = selectedRows[0];
    const linkName = row.cells[0]?.textContent?.trim();
    if (!linkName) return null;

    let targetComponent = null;
    robot.traverse(obj => {
      if (obj.name === linkName || obj.userData?.linkName === linkName) {
        targetComponent = obj;
      }
    });

    return targetComponent;
  }

  function isolateSelectedComponent() {
    if (isolating) return restoreView();

    const selectedComp = getSelectedComponent();
    if (!selectedComp) {
      console.log('No component selected');
      return;
    }

    isolateComponent(selectedComp);
  }

  function destroy() {
    // Cleanup if needed
    allMeshes = [];
    isolating = false;
    originalCameraState = null;
    isolatedComponent = null;
  }

  // Initialize when robot is loaded
  if (robot) {
    setTimeout(initialize, 100);
  }

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

/* ---------------------------- Original Helpers ---------------------------- */

function listAssets(assetToMeshes) {
  // Returns: [{ assetKey, base, ext, count }]
  const items = [];
  assetToMeshes.forEach((meshes, assetKey) => {
    if (!meshes || meshes.length === 0) return;
    const { base, ext } = splitName(assetKey);
    items.push({ assetKey, base, ext, count: meshes.length });
  });
  // Sort by base name, naturally
  items.sort((a, b) => a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: 'base' }));
  return items;
}

function splitName(key) {
  const clean = String(key || '').split('?')[0].split('#')[0];
  const base = clean.split('/').pop();
  const dot = base.lastIndexOf('.');
  return {
    base: dot >= 0 ? base.slice(0, dot) : base,
    ext: dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
  };
}

function isolateAsset(core, assetToMeshes, assetKey, THREEref) {
  const meshes = assetToMeshes.get(assetKey) || [];
  // Hide everything
  if (core.robot) {
    core.robot.traverse(o => { if (o.isMesh && o.geometry) o.visible = false; });
  }
  // Show only these meshes
  meshes.forEach(m => { m.visible = true; });

  // Frame selection
  frameMeshes(core, meshes, THREEref);
}

function showAll(core /*, THREEref */) {
  if (core.robot) {
    core.robot.traverse(o => { if (o.isMesh && o.geometry) o.visible = true; });
    core.fitAndCenter(core.robot, 1.06);
  }
}

function frameMeshes(core, meshes, THREEref) {
  const THREEok = THREEref || (typeof THREE !== 'undefined' ? THREE : (typeof window !== 'undefined' ? window.THREE : null));
  if (!THREEok) {
    console.warn('[viewer] THREE not available for frameMeshes.');
    return;
  }
  if (!meshes || meshes.length === 0) return;

  const box = new THREEok.Box3();
  const tmp = new THREEok.Box3();
  let has = false;
  meshes.forEach(m => {
    if (!m) return;
    tmp.setFromObject(m);
    if (!has) { box.copy(tmp); has = true; } else box.union(tmp);
  });
  if (!has) return;
  const center = box.getCenter(new THREEok.Vector3());
  const size   = box.getSize(new THREEok.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  const cam = core.camera, ctrl = core.controls;
  if (cam.isPerspectiveCamera) {
    const fov = (cam.fov || 60) * Math.PI / 180;
    const dist = maxDim / Math.tan(Math.max(1e-6, fov / 2));
    cam.near = Math.max(maxDim / 1000, 0.001);
    cam.far = Math.max(maxDim * 1500, 1500);
    cam.updateProjectionMatrix();
    const dir = new THREEok.Vector3(1, 0.7, 1).normalize();
    cam.position.copy(center.clone().add(dir.multiplyScalar(dist)));
  } else {
    cam.left = -maxDim; cam.right = maxDim; cam.top = maxDim; cam.bottom = -maxDim;
    cam.near = Math.max(maxDim / 1000, 0.001); cam.far = Math.max(maxDim * 1500, 1500);
    cam.updateProjectionMatrix();
    cam.position.copy(center.clone().add(new THREEok.Vector3(maxDim, maxDim * 0.9, maxDim)));
  }
  ctrl.target.copy(center);
  ctrl.update();
}

/* --------------------- Offscreen thumbnails --------------------- */

function buildOffscreenForThumbnails(core, assetToMeshes, THREEref) {
  const THREEok = THREEref || (typeof THREE !== 'undefined' ? THREE : (typeof window !== 'undefined' ? window.THREE : null));
  if (!core.robot || !THREEok) return null;

  // Offscreen renderer & scene
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

  // Clone the whole robot to isolate assets per snapshot
  const robotClone = core.robot.clone(true);
  scene.add(robotClone);

  // Map assetKey → meshes[] in the clone (using __assetKey tags copied by clone)
  const cloneAssetToMeshes = new Map();
  robotClone.traverse(o => {
    const k = o?.userData?.__assetKey;
    if (k && o.isMesh && o.geometry) {
      const arr = cloneAssetToMeshes.get(k) || [];
      arr.push(o); cloneAssetToMeshes.set(k, arr);
    }
  });

  function snapshotAsset(assetKey) {
    const meshes = cloneAssetToMeshes.get(assetKey) || [];
    if (!meshes.length) return null;

    // Toggle visibility: only keep target asset
    const vis = [];
    robotClone.traverse(o => {
      if (o.isMesh && o.geometry) vis.push([o, o.visible]);
    });
    for (const [m] of vis) m.visible = false;
    for (const m of meshes) m.visible = true;

    // Fit camera to these meshes
    const box = new THREEok.Box3();
    const tmp = new THREEok.Box3();
    let has = false;
    for (const m of meshes) {
      tmp.setFromObject(m);
      if (!has) { box.copy(tmp); has = true; } else box.union(tmp);
    }
    if (!has) { vis.forEach(([o, v]) => o.visible = v); return null; }

    const center = box.getCenter(new THREEok.Vector3());
    const size = box.getSize(new THREEok.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.0;

    camera.near = Math.max(maxDim / 1000, 0.001);
    camera.far = Math.max(maxDim * 1000, 1000);
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

    // Restore visibility
    for (const [o, v] of vis) o.visible = v;

    return url;
  }

  return {
    thumbnail: async (assetKey) => {
      try { return snapshotAsset(assetKey); } catch (_) { return null; }
    },
    destroy: () => {
      try { renderer.dispose(); } catch (_) {}
      try { scene.clear(); } catch (_) {}
    }
  };
}

/* ------------------------- Click Sound ------------------------- */

function installClickSound(dataURL) {
  if (!dataURL || typeof dataURL !== 'string') return;
  let ctx = null, buf = null;
  async function ensure() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (!buf) {
      const resp = await fetch(dataURL);
      const arr = await resp.arrayBuffer();
      buf = await ctx.decodeAudioData(arr);
    }
  }
  function play() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    if (!buf) { ensure().then(play).catch(() => {}); return; }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    try { src.start(); } catch (_) {}
  }
  // Minimal global hook you can call from UI buttons if you want SFX
  window.__urdf_click__ = play;
}

/* --------------------- Global UMD-style hook -------------------- */

if (typeof window !== 'undefined') {
  window.URDFViewer = { render };
}

// Re-export utility functions for external use
export {
  createViewManager,
  calculateFixedDistance,
  directionFromAzEl,
  currentAzimuthElevation,
  easeInOutCubic
};

// Also forward out the tween/navigation helpers if present (keeps API stable)
export const navigateToFixedDistanceView =
  (ToolsDock && ToolsDock.navigateToFixedDistanceView) ? ToolsDock.navigateToFixedDistanceView :
  function () { console.warn('[viewer] navigateToFixedDistanceView not available'); };

export const tweenOrbits =
  (ToolsDock && ToolsDock.tweenOrbits) ? ToolsDock.tweenOrbits :
  function () { console.warn('[viewer] tweenOrbits not available'); };
