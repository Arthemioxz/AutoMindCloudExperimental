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













function buildOffscreenForThumbnails(core) {
  console.log('[thumbs] init');
  if (!core?.robot || !core?.renderer) return null;

  const OFF_W = 512, OFF_H = 384; // a bit smaller = faster, still crisp
  const renderer = core.renderer;  // ← reuse main renderer & GL context

  // Small render target for thumbnails
  const rt = new THREE.WebGLRenderTarget(OFF_W, OFF_H, { depthBuffer: true });
  rt.texture.colorSpace = ('SRGBColorSpace' in THREE) ? THREE.SRGBColorSpace : undefined;

  // Scene & camera dedicated to thumbnails
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf7f9fb);
  const camera = new THREE.PerspectiveCamera(60, OFF_W / OFF_H, 0.01, 10000);

  // Reuse main environment if present; otherwise make a neutral one on THIS renderer
  if (core.scene?.environment) {
    scene.environment = core.scene.environment;
  } else {
    const pmrem = new THREE.PMREMGenerator(renderer);
    // RoomEnvironment is available in three/examples/jsm/environments/RoomEnvironment.js
    // If you don't import it, comment next two lines and keep lights below.
    try {
      const envRT = pmrem.fromScene(new THREE.RoomEnvironment(renderer), 0.04);
      scene.environment = envRT.texture;
    } catch (_) { /* ignore if RoomEnvironment not available */ }
  }

  // Soft lights (help even when env exists)
  const hemi = new THREE.HemisphereLight(0xffffff, 0x92a1b1, 0.7);
  const key  = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(3, 4, 2);
  const rim  = new THREE.DirectionalLight(0xffffff, 0.35); rim.position.set(-2, 3, -3);
  scene.add(hemi, key, rim);

  // Clone robot into the thumb scene
  const robotClone = core.robot.clone(true);
  scene.add(robotClone);
  robotClone.updateMatrixWorld(true);

  // Map assetKey -> meshes inside clone
  const cloneAssetToMeshes = new Map();
  robotClone.traverse(o => {
    const k = o?.userData?.__assetKey;
    if (k && o.isMesh && o.geometry) {
      const arr = cloneAssetToMeshes.get(k) || [];
      arr.push(o); cloneAssetToMeshes.set(k, arr);
    }
  });

  function softenPBRForNoEnv(meshes, willRestore) {
    const hasEnv = !!scene.environment;
    if (hasEnv) return;
    for (const m of meshes) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!mat || !mat.isMaterial) continue;
        const isStd  = mat.isMeshStandardMaterial || mat.type === 'MeshStandardMaterial';
        const isPhys = mat.isMeshPhysicalMaterial || mat.type === 'MeshPhysicalMaterial';
        const isPhong= mat.isMeshPhongMaterial    || mat.type === 'MeshPhongMaterial';
        if (isStd || isPhys || isPhong) {
          const backup = {
            metalness: mat.metalness,
            roughness: mat.roughness,
            emissive: mat.emissive?.clone?.(),
            emissiveIntensity: mat.emissiveIntensity,
            envMap: mat.envMap
          };
          willRestore.push({ mat, backup });
          if (isStd || isPhys) {
            // Soften *any* metallic (not only >0.6) because some assets use 0.5
            if (typeof mat.metalness === 'number') mat.metalness = 0.0;
            if (typeof mat.roughness === 'number') mat.roughness = Math.max(0.6, mat.roughness ?? 0.6);
          }
          if (isPhong) {
            // Give Phong a tiny emissive so it’s never pitch black
            if (mat.emissive) mat.emissive.offsetHSL(0, 0, 0); // force clone alloc above
            mat.emissiveIntensity = Math.max(0.15, mat.emissiveIntensity || 0);
          }
          mat.needsUpdate = true;
        }
      }
    }
  }

  function restoreMaterials(list) {
    for (const { mat, backup } of list) {
      if (!mat) continue;
      if ('metalness' in backup && typeof backup.metalness === 'number') mat.metalness = backup.metalness;
      if ('roughness' in backup && typeof backup.roughness === 'number') mat.roughness = backup.roughness;
      if (backup.emissive && mat.emissive) mat.emissive.copy(backup.emissive);
      if ('emissiveIntensity' in backup) mat.emissiveIntensity = backup.emissiveIntensity;
      mat.envMap = backup.envMap;
      mat.needsUpdate = true;
    }
  }

  function fitCameraTo(meshes) {
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let has = false;

    // ensure world matrices are current
    for (const m of meshes) m.updateWorldMatrix(true, false);

    for (const m of meshes) {
      tmp.setFromObject(m);
      if (!has) { box.copy(tmp); has = true; } else box.union(tmp);
    }
    if (!has) return false;

    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist   = maxDim * 2.0;

    camera.aspect = OFF_W / OFF_H;
    camera.near   = Math.max(maxDim / 1000, 0.001);
    camera.far    = Math.max(maxDim * 1000, 1000);
    camera.updateProjectionMatrix();

    const az = Math.PI * 0.25, el = Math.PI * 0.20;
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).multiplyScalar(dist);

    camera.position.copy(center).add(dir);
    camera.lookAt(center);
    camera.updateMatrixWorld(true);

    return true;
  }

  function snapshotAsset(assetKey) {
    const meshes = cloneAssetToMeshes.get(assetKey) || [];
    if (!meshes.length) return null;

    // Show only the target meshes
    const vis = [];
    robotClone.traverse(o => { if (o.isMesh && o.geometry) vis.push([o, o.visible]); });
    for (const [m] of vis) m.visible = false;
    for (const m of meshes) m.visible = true;

    if (!fitCameraTo(meshes)) { for (const [o,v] of vis) o.visible = v; return null; }

    // Temporary PBR tweaks if no env
    const restoreList = [];
    softenPBRForNoEnv(meshes, restoreList);

    // Save renderer state
    const prevTarget   = renderer.getRenderTarget();
    const prevAutoCl   = renderer.autoClear;
    const prevTone     = renderer.toneMapping;
    const prevExposure = renderer.toneMappingExposure;

    renderer.autoClear = true;
    // (we keep toneMapping/exposure as-is to match main viewer)

    // Render to our RT
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);

    // Readback pixels → 2D canvas → dataURL
    const pixels = new Uint8Array(OFF_W * OFF_H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, OFF_W, OFF_H, pixels);

    const can2d = document.createElement('canvas');
    can2d.width = OFF_W; can2d.height = OFF_H;
    const ctx = can2d.getContext('2d');
    const imgData = ctx.createImageData(OFF_W, OFF_H);

    // Flip Y because WebGL origin is bottom-left
    for (let y = 0; y < OFF_H; y++) {
      const srcY = OFF_H - 1 - y;
      imgData.data.set(
        pixels.subarray(srcY * OFF_W * 4, (srcY + 1) * OFF_W * 4),
        y * OFF_W * 4
      );
    }
    ctx.putImageData(imgData, 0, 0);
    const url = can2d.toDataURL('image/png');

    // Restore materials & visibility
    restoreMaterials(restoreList);
    for (const [o, v] of vis) o.visible = v;

    // Restore renderer state
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoCl;
    renderer.toneMapping = prevTone;
    renderer.toneMappingExposure = prevExposure;

    return url;
  }

  return {
    thumbnail: async (assetKey) => {
      try { return snapshotAsset(assetKey); }
      catch (e) { console.warn('[thumbs] snapshot error', e); return null; }
    },
    destroy: () => { try { rt.dispose(); } catch (_) {} try { scene.clear(); } catch (_) {} }
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
