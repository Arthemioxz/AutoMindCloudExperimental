// /viewer/urdf_viewer_main.js
// Entrypoint that composes ViewerCore + AssetDB + Selection & Drag + UI (Tools & Components)

import { THEME } from './Theme.js';
import { createViewer } from './core/ViewerCore.js';
import { buildAssetDB, createLoadMeshCb } from './core/AssetDB.js';
import { attachInteraction } from './interaction/SelectionAndDrag.js';
import { createToolsDock } from './ui/ToolsDock.js';
import { createComponentsPanel } from './ui/ComponentsPanel.js';

/**
 * Public entry: render the URDF viewer.
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {string} opts.urdfContent              — URDF string
 * @param {Object.<string,string>} opts.meshDB   — key → base64
 * @param {'link'|'mesh'} [opts.selectMode='link']
 * @param {number|null} [opts.background=THEME.bgCanvas]
 * @param {string|null} [opts.clickAudioDataURL] — optional UI SFX (not required)
 */
export function render(opts = {}) {
  const {
    container,
    urdfContent = '',
    meshDB = {},
    selectMode = 'link',
    background = THEME.bgCanvas || 0xffffff,
    clickAudioDataURL = null
  } = opts;

  // 1) Core viewer
  const core = createViewer({ container, background });

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
    }
  });

  // 3) Load URDF (this triggers tagging via `onMeshTag`)
  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // 4) Build an offscreen renderer for thumbnails (after robot exists)
  const off = buildOffscreenForThumbnails(core, assetToMeshes);

  // 5) Interaction (hover, select, drag joints, key 'i')
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode
  });

  // 6) Facade "app" that is passed to UI components
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
      asset: (assetKey) => isolateAsset(core, assetToMeshes, assetKey),
      clear: () => showAll(core)
    },

    // --- Show all ---
    showAll: () => showAll(core),

    // Optional: open tools externally
    openTools(open = true) { tools.set(!!open); }
  };

  // 7) UI modules
  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);

  // Optional click SFX for UI (kept minimal; UI modules do not depend on it)
  if (clickAudioDataURL) {
    try { installClickSound(clickAudioDataURL); } catch (_) {}
  }

  // Public destroy
  const destroy = () => {
    try { comps.destroy(); } catch (_) {}
    try { tools.destroy(); } catch (_) {}
    try { inter.destroy(); } catch (_) {}
    try { off?.destroy?.(); } catch (_) {}
    try { core.destroy(); } catch (_) {}
  };

  return { ...app, destroy };
}

/* ---------------------------- Helpers ---------------------------- */

function listAssets(assetToMeshes) {
  const arr = [];
  for (const [k, v] of assetToMeshes.entries()) arr.push({ key: k, count: v.length });
  arr.sort((a,b) => a.key.localeCompare(b.key));
  return arr;
}

function splitName(s) {
  if (!s) return { folder:'', base:'' };
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  const folder = (i >= 0) ? s.slice(0, i) : '';
  const base = (i >= 0) ? s.slice(i + 1) : s;
  return { folder, base };
}

function isolateAsset(core, assetToMeshes, assetKey) {
  const meshes = assetToMeshes.get(assetKey) || [];
  if (core.robot) core.robot.traverse(o => { if (o.isMesh && o.geometry) o.visible = false; });
  meshes.forEach(m => { m.visible = true; });
  frameMeshes(core, meshes);
}

function frameMeshes(core, meshes) {
  if (!meshes || meshes.length === 0) return;
  const bb = new THREE.Box3();
  meshes.forEach(m => bb.expandByObject(m));
  const center = bb.getCenter(new THREE.Vector3());
  const size = bb.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim * 2.0;

  core.camera.near = Math.max(maxDim / 1000, 0.001);
  core.camera.far = Math.max(maxDim * 1000, 1000);
  core.camera.updateProjectionMatrix();

  const az = Math.PI * 0.25, el = Math.PI * 0.18;
  const dir = new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az)
  ).multiplyScalar(dist);
  const toPos = center.clone().add(dir);
  tweenCamera(core, core.camera.position.clone(), toPos, core.controls.target.clone(), center, 600);
}

function showAll(core) {
  if (core.robot) core.robot.traverse(o => { if (o.isMesh && o.geometry) o.visible = true; });
}

function tweenCamera(core, fromPos, toPos, fromTarget, toTarget, ms = 420) {
  const cam = core.camera;
  const ctl = core.controls;
  if (!cam || !ctl) return;

  const start = performance.now();
  const ease = (t) => (t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2);

  function step(t) {
    const u = Math.min(1, (t - start) / ms);
    const e = ease(u);
    cam.position.set(
      fromPos.x + (toPos.x - fromPos.x) * e,
      fromPos.y + (toPos.y - fromPos.y) * e,
      fromPos.z + (toPos.z - fromPos.z) * e
    );
    const tx = fromTarget.x + (toTarget.x - fromTarget.x) * e;
    const ty = fromTarget.y + (toTarget.y - fromTarget.y) * e;
    const tz = fromTarget.z + (toTarget.z - fromTarget.z) * e;
    ctl.target.set(tx, ty, tz);
    cam.lookAt(ctl.target);
    ctl.update();
    if (u < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ------------------- Offscreen thumbnails ------------------- */

function buildOffscreenForThumbnails(core, assetToMeshes) {
  if (!core.robot) return null;

  // Offscreen renderer & scene
  const OFF_W = 640, OFF_H = 480;

  const canvas = document.createElement('canvas');
  canvas.width = OFF_W; canvas.height = OFF_H;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(OFF_W, OFF_H, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  const camera = new THREE.PerspectiveCamera(40, OFF_W / OFF_H, 0.01, 1e6);
  camera.up.set(0, 1, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(1, 1.2, 1.4);
  scene.add(dir);

  // Clone robot for offscreen thumbnails
  const robotClone = core.robot.clone(true);
  scene.add(robotClone);

  // Map asset -> cloned meshes (so we can toggle visibility per asset)
  const cloneAssetToMeshes = new Map();
  robotClone.traverse((o) => {
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
      if (o.isMesh && o.geometry) {
        vis.push([o, o.visible]);
        o.visible = meshes.includes(o);
      }
    });

    // Frame the visible subset
    const bb = new THREE.Box3().setFromObject(robotClone);
    if (bb.isEmpty()) return null;
    const center = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.0;

    camera.near = Math.max(maxDim / 1000, 0.001);
    camera.far = Math.max(maxDim * 1000, 1000);
    camera.updateProjectionMatrix();

    const az = Math.PI * 0.25, el = Math.PI * 0.18;
    const d = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).multiplyScalar(dist);
    camera.position.copy(center.clone().add(d));
    camera.lookAt(center);

    renderer.setSize(OFF_W, OFF_H, false);
    renderer.render(scene, camera);

    // Restore visibilities
    vis.forEach(([o, v]) => (o.visible = v));

    return canvas.toDataURL('image/png');
  }

  return {
    thumbnail(assetKey) { try { return snapshotAsset(assetKey); } catch { return null; } },
    destroy() { try { renderer.dispose(); } catch {} }
  };
}

/* --------------------- optional click SFX -------------------- */

function installClickSound(dataUrl) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  fetch(dataUrl).then(r => r.arrayBuffer()).then(buf => ctx.decodeAudioData(buf)).then((buf) => {
    window.__urdf_click__ = () => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      try { src.start(); } catch (_) {}
    };
  }).catch(() => {
    window.__urdf_click__ = () => {};
  });
}

/* --------------------- Global UMD-style hook -------------------- */

if (typeof window !== 'undefined') {
  window.URDFViewer = { render };
}
