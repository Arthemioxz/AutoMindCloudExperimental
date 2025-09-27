# Overwrite /mnt/data/urdf_viewer_main.js with the ESM version that imports createToolsDock.
from pathlib import Path
esm = """\
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

  // 6) Facade “app” that is passed to UI components
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

function isolateAsset(core, assetToMeshes, assetKey) {
  const meshes = assetToMeshes.get(assetKey) || [];
  // Hide everything
  if (core.robot) {
    core.robot.traverse(o => { if (o.isMesh && o.geometry) o.visible = false; });
  }
  // Show only these meshes
  meshes.forEach(m => { m.visible = true; });

  // Frame selection
  frameMeshes(core, meshes);
}

function showAll(core) {
  if (!core.robot) return;
  core.robot.traverse(o => { if (o.isMesh && o.geometry) o.visible = true; });
}

function frameMeshes(core, meshes) {
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const m of meshes) tmp.setFromObject(m), box.union(tmp);
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (core.camera.fov || 60) * Math.PI / 180;
    const dist = (maxDim * 1.2) / Math.tan(fov / 2);
    const dir = core.camera.position.clone().sub(core.controls.target).normalize();
    const pos = center.clone().add(dir.multiplyScalar(dist));
    core.controls.target.copy(center);
    core.camera.position.copy(pos);
    core.camera.updateProjectionMatrix();
  }
}

/* ---------- Offscreen thumbnails ---------- */
function buildOffscreenForThumbnails(core, assetToMeshes) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1e7);
  const scene = new THREE.Scene();

  function thumbnail(assetKey) {
    const meshes = assetToMeshes.get(assetKey) || [];
    scene.clear();
    const group = new THREE.Group();
    for (const m of meshes) {
      const clone = m.clone(true);
      group.add(clone);
    }
    scene.add(group);

    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (camera.fov || 60) * Math.PI / 180;
    const dist = (maxDim * 1.1) / Math.tan(fov / 2);
    const pos = center.clone().add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(dist));
    camera.position.copy(pos);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    renderer.setSize(256, 256);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }

  function destroy() {
    try { renderer.dispose(); } catch (_) {}
  }

  return { thumbnail, destroy };
}

/* ---------- Optional click sound ---------- */
function installClickSound(dataURL) {
  try {
    const audio = new Audio(dataURL);
    document.addEventListener('click', () => { try { audio.currentTime = 0; audio.play(); } catch (_) {} }, true);
  } catch (_) {}
}
"""
Path("/mnt/data/urdf_viewer_main.js").write_text(esm, encoding="utf-8")
print("/mnt/data/urdf_viewer_main.js written")
