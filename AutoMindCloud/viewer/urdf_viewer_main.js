// AutoMindCloud/viewer/urdf_viewer_main.js
/* global THREE */

// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------
import * as Core from './core/ViewerCore.js';
import * as Assets from './core/AssetDB.js';
import * as Interact from './interaction/SelectionAndDrag.js';
import * as Tools from './ui/ToolsDock.js';
import * as Comp from './ui/ComponentsPanel.js';
import * as ThemeMod from './Theme.js';

// -----------------------------------------------------------------------------
// Resolvers
// -----------------------------------------------------------------------------
function resolveFactory(mod, names) {
  for (const n of names) {
    const v = mod && mod[n];
    if (typeof v === 'function') return v;
  }
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

function moduleKeys(mod) {
  try {
    const named = Object.keys(mod || {});
    const def = mod && mod.default && typeof mod.default === 'object'
      ? Object.keys(mod.default)
      : [];
    return { named, def };
  } catch {
    return { named: [], def: [] };
  }
}

const createViewerCore = resolveFactory(Core, [
  'createViewer',
  'createViewerCore',
  'initCore',
  'createApp',
  'makeViewer',
  'bootstrap',
  'ViewerCore'
]);

let createAssetDB = resolveFactory(Assets, [
  'createAssetDB',
  'AssetDB',
  'makeAssetDB',
  'initAssetDB',
  'buildAssetDB'
]);

const attachSelection = resolveFactory(Interact, [
  'attachSelection',
  'initSelection',
  'wireSelection',
  'enableSelection'
]);

const createToolsDock = resolveFactory(Tools, [
  'createToolsDock',
  'initToolsDock',
  'makeToolsDock'
]);

const createComponentsPanel = resolveFactory(Comp, [
  'createComponentsPanel',
  'createComponents',
  'initComponentsPanel',
  'makeComponentsPanel'
]);

// -----------------------------------------------------------------------------
// Theme fallback
// -----------------------------------------------------------------------------
const theme =
  ThemeMod.theme ||
  ThemeMod.default || {
    teal: '#0ea5a6',
    tealSoft: '#2dd4bf',
    tealFaint: '#ccfbf1',
    bgPanel: 'rgba(255,255,255,0.95)',
    bgCanvas: 0xffffff,
    stroke: '#d7e7e7',
    text: '#0b3b3c',
    textMuted: '#6b7280',
    shadow: '0 4px 12px rgba(0,0,0,0.08)'
  };

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function box3Of(obj) {
  const b = new THREE.Box3();
  try {
    b.setFromObject(obj);
  } catch {}
  return b;
}

function fixedDistance(camera, object, pad = 1.0) {
  const size = box3Of(object).getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fov = ((camera && camera.fov) ? camera.fov : 60) * Math.PI / 180;
  return (maxDim * pad) / Math.tan(fov / 2);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// -----------------------------------------------------------------------------
// AssetDB shim (if module missing) – maps meshDB -> data: URLs + URL modifier
// -----------------------------------------------------------------------------
function createAssetDBShim(meshDB) {
  const normalizeKey = (k) =>
    String(k)
      .replace(/^package:\/\//i, '')
      .replace(/^\.\//, '')
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/')
      .toLowerCase();

  const guessMime = (k) => {
    const s = String(k).toLowerCase();
    if (s.endsWith('.stl')) return 'model/stl';
    if (s.endsWith('.dae') || s.endsWith('.xml')) return 'model/vnd.collada+xml';
    if (s.endsWith('.png')) return 'image/png';
    if (s.endsWith('.jpg') || s.endsWith('.jpeg')) return 'image/jpeg';
    return 'application/octet-stream';
  };

  const byRel = Object.create(null);
  const byBase = Object.create(null);

  for (const raw of Object.keys(meshDB)) {
    const k = normalizeKey(raw);
    const b = k.split('/').pop();
    byRel[k] = meshDB[raw];
    if (!(b in byBase)) byBase[b] = meshDB[raw];
  }

  function toDataURL(key) {
    const k = normalizeKey(key);
    const base = k.split('/').pop();
    const b64 = byRel[k] ?? byRel[base] ?? byBase[base];
    if (!b64) return null;
    return `data:${guessMime(k)};base64,${b64}`;
  }

  try {
    const mgr = THREE.DefaultLoadingManager || THREE.LoadingManager?.prototype;
    if (mgr && typeof mgr.setURLModifier === 'function') {
      mgr.setURLModifier((url) => toDataURL(url) || url);
    }
  } catch {}

  return {
    loadMeshCb(url) {
      return toDataURL(url) || url;
    }
  };
}

// -----------------------------------------------------------------------------
// Key bindings: i (isolate), h (components), u (tools)
// -----------------------------------------------------------------------------
function setupKeyHandlers(app, toolsDockRef, componentsRef, interactionsRef) {
  const targetEl =
    (app && app.renderer && app.renderer.domElement) ||
    (app && app.container) ||
    window;

  function toggleByApiOrDom(ref, preferSel, cls) {
    if (ref) {
      if (typeof ref.set === 'function' && 'isOpen' in ref) {
        ref.set(!ref.isOpen);
        return;
      }
      if (typeof ref.open === 'function' && typeof ref.close === 'function') {
        ref._open = !ref._open;
        if (ref._open) ref.open();
        else ref.close();
        return;
      }
    }
    const root = preferSel ? document.querySelector(preferSel) : (ref && ref.root);
    if (root) {
      root.classList.add('am-slide');
      root.classList.toggle(cls || 'collapsed');
    }
  }

  function onKey(e) {
    const k = (e.key || '').toLowerCase();
    if (k === 'i') {
      try {
        interactionsRef?.toggleIsolateSelected?.();
      } catch {}
      e.preventDefault();
      e.stopPropagation();
    }
    if (k === 'h') {
      toggleByApiOrDom(componentsRef, '.components-panel', 'collapsed');
      e.preventDefault();
      e.stopPropagation();
    }
    if (k === 'u') {
      toggleByApiOrDom(toolsDockRef, '.viewer-dock-fix', 'collapsed');
      e.preventDefault();
      e.stopPropagation();
    }
  }

  targetEl.addEventListener('keydown', onKey, true);
  return () => targetEl.removeEventListener('keydown', onKey, true);
}

// -----------------------------------------------------------------------------
// Public API: render
// -----------------------------------------------------------------------------
/**
 * opts: {
 *   container, urdfContent, meshDB,
 *   selectMode ('link'|'joint'|...), background (hex|null),
 *   clickAudioDataURL
 * }
 * returns: app (augmented with .toolsDock, .components, .dispose())
 */
export async function render(opts = {}) {
  if (!createViewerCore) {
    console.error('[urdf_viewer_main] ViewerCore exports:', moduleKeys(Core));
    throw new Error('[urdf_viewer_main] ViewerCore not found');
  }
  if (!createAssetDB) {
    console.warn('[urdf_viewer_main] AssetDB factory not found; module keys:', moduleKeys(Assets));
  }

  const {
    container = document.getElementById('app'),
    urdfContent = '',
    meshDB = {},
    selectMode = 'link',
    background = 0xffffff,
    clickAudioDataURL = null
  } = opts;

  if (!container) throw new Error('[urdf_viewer_main] Missing container');

  // 1) Core app
  const maybeApp = createViewerCore({ container, background });
  const app = (maybeApp && typeof maybeApp.then === 'function') ? await maybeApp : maybeApp;

  // 2) AssetDB (or shim) BEFORE loadURDF (so URL modifier is active)
  const assetDB = createAssetDB ? createAssetDB(meshDB) : createAssetDBShim(meshDB);

  // 3) Load URDF with mesh callback
  const p = app.loadURDF?.(urdfContent, assetDB.loadMeshCb);
  if (p && typeof p.then === 'function') await p;

  // 4) Background override
  try {
    if (background === null) {
      app.renderer.setClearAlpha(0);
    } else if (typeof background === 'number') {
      app.renderer.setClearColor(background);
    }
  } catch {}

  // 5) Interactions
  const interactionsRef = attachSelection
    ? (attachSelection(app, theme, { selectMode, clickAudioDataURL }) || null)
    : null;

  // 6) Tools Dock
  let toolsDock = null;
  if (createToolsDock) {
    try {
      toolsDock = createToolsDock(app, theme) || null;
      toolsDock?.open?.();
      if (toolsDock) toolsDock._open = true;
    } catch (e) {
      console.warn('[ToolsDock] init failed:', e);
    }
  }

  // 7) Components Panel (guard + adapter so it never hard-crashes)
  let componentsPanel = null;
  if (createComponentsPanel) {
    try {
      const adapter = {
        listLinks: () => {
          if (typeof app.listLinks === 'function') return app.listLinks();
          if (typeof app.getLinks === 'function') return app.getLinks();
          const names = [];
          try {
            app.robot?.traverse?.((o) => {
              const nm = o?.userData?.linkName || o?.name;
              if (nm && !names.includes(nm)) names.push(nm);
            });
          } catch {}
          return names;
        },
        focusLink: (name) => {
          if (typeof app.focusLink === 'function') return app.focusLink(name);
          if (typeof app.frameLink === 'function') return app.frameLink(name);
          try {
            let target = null;
            app.robot?.traverse?.((o) => {
              const nm = o?.userData?.linkName || o?.name;
              if (nm === name) target = o;
            });
            if (!target) return;
            const cam = app.camera;
            const ctrl = app.controls;
            const box = new THREE.Box3().setFromObject(target);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const fov = (cam.fov || 60) * Math.PI / 180;
            const dist = (maxDim * 1.2) / Math.tan(fov / 2);
            const p0 = cam.position.clone();
            const t0 = ctrl.target.clone();
            const dir = p0.clone().sub(t0).normalize();
            const toPos = center.clone().add(dir.multiplyScalar(dist));
            const tStart = performance.now();
            const ms = 650;
            function step(now) {
              const u = Math.min(1, (now - tStart) / ms);
              const e = ease(u);
              cam.position.lerpVectors(p0, toPos, e);
              ctrl.target.lerpVectors(t0, center, e);
              ctrl.update?.();
              app.renderer.render(app.scene, cam);
              if (u < 1) requestAnimationFrame(step);
            }
            requestAnimationFrame(step);
          } catch {}
        },
        onSelect: (cb) => {
          try {
            if (app.events?.on) app.events.on('select', cb);
            else if (typeof app.on === 'function') app.on('select', cb);
          } catch {}
        }
      };

      componentsPanel = createComponentsPanel(app, theme, adapter) || null;
      componentsPanel?.open?.();
      if (componentsPanel) componentsPanel._open = true;
    } catch (e) {
      console.warn('[ComponentsPanel] init skipped:', e);
    }
  }

  // 8) Initial ISO view
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
      const start = performance.now();
      const ms = 600;
      const step = (now) => {
        const u = clamp((now - start) / ms, 0, 1);
        const e2 = ease(u);
        app.camera.position.set(
          p0.x + (targetPos.x - p0.x) * e2,
          p0.y + (targetPos.y - p0.y) * e2,
          p0.z + (targetPos.z - p0.z) * e2
        );
        app.controls.target.set(
          t0.x + (center.x - t0.x) * e2,
          t0.y + (center.y - t0.y) * e2,
          t0.z + (center.z - t0.z) * e2
        );
        app.controls.update?.();
        app.renderer.render(app.scene, app.camera);
        if (u < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  } catch {}

  // 9) Keyboard
  const disposeKeys = setupKeyHandlers(app, toolsDock, componentsPanel, interactionsRef);

  // 10) Slide CSS for DOM fallbacks
  try {
    const css =
      `.am-slide{transition:transform .28s ease,opacity .28s ease}
       .am-slide.collapsed{transform:translateX(18px);opacity:0;pointer-events:none}`;
    const tag = document.createElement('style');
    tag.textContent = css;
    document.head.appendChild(tag);
  } catch {}

  // 11) Dispose & return
  const originalDispose = app.dispose?.bind(app);
  app.dispose = () => {
    try { disposeKeys?.(); } catch {}
    try { toolsDock?.destroy?.(); } catch {}
    try { componentsPanel?.destroy?.(); } catch {}
    try { originalDispose?.(); } catch {}
  };
  app.toolsDock = toolsDock;
  app.components = componentsPanel;

  return app;
}

export default { render };
