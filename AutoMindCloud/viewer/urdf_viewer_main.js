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



















// Render thumbnails using the main scene & renderer (no clone).
function buildOffscreenForThumbnails(core, assetToMeshes) {
  console.log('[thumbs] init(main-scene)');
  if (!core?.robot || !core?.renderer || !core?.scene) return null;

  const OFF_W = 512, OFF_H = 384;
  const renderer = core.renderer;
  const scene = core.scene;

  // One RT reused for all thumbs
  const rt = new THREE.WebGLRenderTarget(OFF_W, OFF_H, { depthBuffer: true });
  if ('colorSpace' in rt.texture && 'SRGBColorSpace' in THREE) {
    rt.texture.colorSpace = THREE.SRGBColorSpace;
  }

  // Prepare a dedicated camera for thumbs
  const cam = new THREE.PerspectiveCamera(60, OFF_W / OFF_H, 0.01, 1e6);

  // Ensure we have a neutral env if the scene lacks one
  if (!scene.environment) {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envRT = pmrem.fromScene(new THREE.RoomEnvironment(renderer), 0.04);
      scene.environment = envRT.texture;
    } catch (_) {
      // fine: lighting from the main scene will still apply
    }
  }

  // Utility: compute world AABB of a list of meshes
  const _box = new THREE.Box3();
  const _tmp = new THREE.Box3();
  const _v3  = new THREE.Vector3();
  function computeBounds(meshes) {
    let has = false;
    _box.makeEmpty();
    for (const m of meshes) {
      if (!m || !m.isObject3D) continue;
      m.updateWorldMatrix(true, false);
      _tmp.setFromObject(m);
      if (_tmp.isEmpty()) continue;
      if (!has) { _box.copy(_tmp); has = true; } else _box.union(_tmp);
    }
    return has ? _box.clone() : null;
  }

  // Utility: show only target meshes (keep ancestors visible), restore later
  function showOnly(meshes) {
    const vis = [];
    core.robot.traverse(o => { if (o.isObject3D) vis.push([o, o.visible]); o.visible = false; });
    // make target meshes and their parents visible
    for (const m of meshes) {
      let p = m;
      while (p && p !== scene) { p.visible = true; p = p.parent; }
    }
    return () => { for (const [o, v] of vis) o.visible = v; };
  }

  // Optional: soften PBR a touch if there’s still no env
  function softenPBR(meshes) {
    if (scene.environment) return () => {};
    const stash = [];
    for (const m of meshes) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!mat || !mat.isMaterial) continue;
        const isStd = mat.isMeshStandardMaterial || mat.type === 'MeshStandardMaterial';
        const isPhys= mat.isMeshPhysicalMaterial || mat.type === 'MeshPhysicalMaterial';
        if (isStd || isPhys) {
          stash.push([mat, mat.metalness, mat.roughness]);
          if (typeof mat.metalness === 'number') mat.metalness = 0.0;
          if (typeof mat.roughness === 'number') mat.roughness = Math.max(0.6, mat.roughness ?? 0.6);
          mat.needsUpdate = true;
        }
      }
    }
    return () => { for (const [mat, met, rou] of stash) { mat.metalness = met; mat.roughness = rou; mat.needsUpdate = true; } };
  }

  function fitCameraTo(box) {
    const center = box.getCenter(_v3.set(0,0,0).clone());
    const size   = box.getSize(_v3.set(0,0,0));
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist   = maxDim * 2.0;

    cam.aspect = OFF_W / OFF_H;
    cam.near   = Math.max(maxDim / 1000, 0.001);
    cam.far    = Math.max(maxDim * 1000, 1000);
    cam.updateProjectionMatrix();

    const az = Math.PI * 0.25, el = Math.PI * 0.20;
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).multiplyScalar(dist);

    cam.position.copy(center).add(dir);
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
  }

  function snapshotAsset(assetKey) {
    const meshes = assetToMeshes?.get(assetKey) || [];
    if (!meshes.length) return null;

    // Isolate
    const restoreVis = showOnly(meshes);
    const restoreMats = softenPBR(meshes);

    // Bounds & camera
    const box = computeBounds(meshes);
    if (!box) { restoreMats(); restoreVis(); return null; }
    fitCameraTo(box);

    // Save & set renderer state
    const prevTarget   = renderer.getRenderTarget();
    const prevAuto     = renderer.autoClear;
    const prevClearCol = renderer.getClearColor(new THREE.Color());
    const prevClearA   = renderer.getClearAlpha();

    renderer.setRenderTarget(rt);
    renderer.setClearColor(0xf7f9fb, 1); // light card bg
    renderer.autoClear = true;
    renderer.clear();
    renderer.render(scene, cam);

    // Read back → 2D canvas → data URL
    const pixels = new Uint8Array(OFF_W * OFF_H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, OFF_W, OFF_H, pixels);

    const can2d = document.createElement('canvas');
    can2d.width = OFF_W; can2d.height = OFF_H;
    const ctx = can2d.getContext('2d');
    const imgData = ctx.createImageData(OFF_W, OFF_H);
    for (let y = 0; y < OFF_H; y++) {
      const srcY = OFF_H - 1 - y; // flip Y
      imgData.data.set(
        pixels.subarray(srcY * OFF_W * 4, (srcY + 1) * OFF_W * 4),
        y * OFF_W * 4
      );
    }
    ctx.putImageData(imgData, 0, 0);
    const url = can2d.toDataURL('image/png');

    // Restore
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClearCol, prevClearA);
    renderer.autoClear = prevAuto;
    restoreMats();
    restoreVis();

    return url;
  }

  return {
    thumbnail: async (assetKey) => {
      try { return snapshotAsset(assetKey); }
      catch (e) { console.warn('[thumbs] snapshot error', e); return null; }
    },
    destroy: () => { try { rt.dispose(); } catch (_) {} }
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
