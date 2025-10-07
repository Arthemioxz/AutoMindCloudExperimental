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
  if (core.robot) {
    core.robot.traverse(o => { if (o.isMesh && o.geometry) o.visible = true; });
    core.fitAndCenter(core.robot, 1.06);
  }
}

function frameMeshes(core, meshes) {
  if (!meshes || meshes.length === 0) return;
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let has = false;
  meshes.forEach(m => {
    if (!m) return;
    tmp.setFromObject(m);
    if (!has) { box.copy(tmp); has = true; } else box.union(tmp);
  });
  if (!has) return;
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  const cam = core.camera, ctrl = core.controls;
  if (cam.isPerspectiveCamera) {
    const fov = (cam.fov || 60) * Math.PI / 180;
    const dist = maxDim / Math.tan(Math.max(1e-6, fov / 2));
    cam.near = Math.max(maxDim / 1000, 0.001);
    cam.far = Math.max(maxDim * 1500, 1500);
    cam.updateProjectionMatrix();
    const dir = new THREE.Vector3(1, 0.7, 1).normalize();
    cam.position.copy(center.clone().add(dir.multiplyScalar(dist)));
  } else {
    cam.left = -maxDim; cam.right = maxDim; cam.top = maxDim; cam.bottom = -maxDim;
    cam.near = Math.max(maxDim / 1000, 0.001); cam.far = Math.max(maxDim * 1500, 1500);
    cam.updateProjectionMatrix();
    cam.position.copy(center.clone().add(new THREE.Vector3(maxDim, maxDim * 0.9, maxDim)));
  }
  ctrl.target.copy(center);
  ctrl.update();
}

/* --------------------- Offscreen thumbnails --------------------- */
















/* -------------------- Offscreen thumbnails (camera kept unchanged) --------------------- */
function buildOffscreenForThumbnails(core, assetToMeshes) {
  if (!core || !core.robot) return null;

  const OFF_W = 640, OFF_H = 480;

  const canvas = document.createElement('canvas');
  canvas.width = OFF_W; canvas.height = OFF_H;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(OFF_W, OFF_H, false);

  // Color/tone (safe across three versions)
  if ('outputColorSpace' in renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else if ('sRGBEncoding' in THREE) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.physicallyCorrectLights = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xE9EEF3); // not pure white so light parts pop

  // Try to reuse viewer's env; if missing, add soft lights
  if (core.scene && core.scene.environment) {
    scene.environment = core.scene.environment;
  } else {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8fa3b5, 0.9);
    const key  = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 4, 2);
    const rim  = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(-2, 3, -3);
    scene.add(hemi, key, rim);
  }

  const camera = new THREE.PerspectiveCamera(60, OFF_W / OFF_H, 0.01, 10000);

  // Clone the robot (so we can toggle & swap materials safely)
  const robotClone = core.robot.clone(true);
  scene.add(robotClone);

  // Build assetKey → meshes[] map in the clone
  const cloneAssetToMeshes = new Map();
  robotClone.traverse(o => {
    const k = o?.userData?.__assetKey;
    if (k && o.isMesh && o.geometry) {
      (cloneAssetToMeshes.get(k) || cloneAssetToMeshes.set(k, []).get(k)).push(o);
    }
  });

  // ---------- Material swap fallback ----------
  // If no env-map, PBR metals go black. For the snapshot we can swap to MeshBasicMaterial,
  // preserving color/texture so thumbnails are clearly visible.
  function swapToBasic(meshes) {
    if (scene.environment) return () => {}; // no need if env-map exists
    const restores = [];
    for (const m of meshes) {
      if (!m || !m.material) continue;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const newMats = [];
      let changed = false;

      for (let i = 0; i < mats.length; i++) {
        const mat = mats[i];
        if (!mat || !mat.isMaterial) { newMats.push(mat); continue; }

        // Only swap common shaded mats
        const pbr = mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial;
        const phong = mat.isMeshPhongMaterial || mat.type === 'MeshPhongMaterial';
        if (pbr || phong) {
          const basic = new THREE.MeshBasicMaterial({
            map: mat.map ?? null,
            color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
            transparent: !!mat.transparent,
            opacity: (typeof mat.opacity === 'number') ? mat.opacity : 1.0,
            side: mat.side ?? THREE.FrontSide
          });
          newMats.push(basic);
          restores.push({ mesh: m, index: i, original: mat });
          changed = true;
        } else {
          newMats.push(mat);
        }
      }

      if (changed) {
        m.material = Array.isArray(m.material) ? newMats : newMats[0];
      }
    }

    return () => {
      // put originals back
      for (const r of restores) {
        if (!r.mesh) continue;
        if (Array.isArray(r.mesh.material)) {
          r.mesh.material[r.index] = r.original;
        } else {
          r.mesh.material = r.original;
        }
      }
    };
  }

  function snapshotAsset(assetKey) {
    const meshes = cloneAssetToMeshes.get(assetKey) || [];
    if (!meshes.length) return null;

    // Hide everything then show only target asset
    const vis = [];
    robotClone.traverse(o => {
      if (o.isMesh && o.geometry) vis.push([o, o.visible]);
    });
    for (const [m] of vis) m.visible = false;
    for (const m of meshes) m.visible = true;

    // ---- Camera fit (UNCHANGED) ----
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let has = false;
    for (const m of meshes) {
      m.updateWorldMatrix(true, false);
      tmp.setFromObject(m);
      if (!has) { box.copy(tmp); has = true; } else box.union(tmp);
    }
    if (!has) { vis.forEach(([o, v]) => o.visible = v); return null; }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.0;

    camera.near = Math.max(maxDim / 1000, 0.001);
    camera.far = Math.max(maxDim * 1000, 1000);
    camera.updateProjectionMatrix();

    const az = Math.PI * 0.25, el = Math.PI * 0.18;
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).multiplyScalar(dist);
    camera.position.copy(center.clone().add(dir));
    camera.lookAt(center);

    // Swap to Basic if needed (guaranteed visible)
    const restoreBasic = swapToBasic(meshes);

    // Render and read URL
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');

    // Restore materials & visibility
    restoreBasic();
    for (const [o, v] of vis) o.visible = v;

    return url;
  }

  return {
    thumbnail: async (assetKey) => {
      try { return snapshotAsset(assetKey); } catch (e) { console.warn('[thumbs] snapshot error', e); return null; }
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
