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



/* ===========================================================
   ToolsDock.js  — classic script build (no ES modules)
   Exposes: window.createToolsDock, window.buildOffscreenForThumbnails
   Requires global THREE and your existing `core` (scene, renderer, robot)
   =========================================================== */
(function (global) {
  'use strict';

  // -------------------- Utilities --------------------
  function normalizeTheme(theme) {
    if (!theme) theme = {};
    const t = theme;
    if (t.colors) {
      t.teal       ??= t.colors.teal;
      t.tealSoft   ??= t.colors.tealSoft;
      t.tealFaint  ??= t.colors.tealFaint;
      t.bgPanel    ??= t.colors.panelBg;
      t.bgCanvas   ??= t.colors.canvasBg;
      t.stroke     ??= t.colors.stroke;
      t.text       ??= t.colors.text;
      t.textMuted  ??= t.colors.textMuted;
    }
    if (t.shadows) {
      t.shadow ??= (t.shadows.lg || t.shadows.md || '0 6px 16px rgba(0,0,0,.12)');
    }
    // sensible defaults
    t.teal       ??= '#10b7b1';
    t.tealSoft   ??= '#74d9d6';
    t.tealFaint  ??= '#e5fbfa';
    t.bgPanel    ??= '#ffffff';
    t.bgCanvas   ??= '#f3f7fb';
    t.stroke     ??= '#d8e2ea';
    t.text       ??= '#0b2537';
    t.textMuted  ??= '#5b6c79';
    t.shadow     ??= '0 6px 16px rgba(0,0,0,.12)';
    return t;
  }

  // -------------------- Offscreen thumbnails ---------------------
  // NOTE: camera math is kept EXACTLY as your version. Only lighting/env fixed.
  function buildOffscreenForThumbnails(core/*, assetToMeshes (unused here, we clone) */) {
    if (!core || !core.robot) return null;

    const OFF_W = 640, OFF_H = 480;

    const canvas = document.createElement('canvas');
    canvas.width = OFF_W; canvas.height = OFF_H;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true
    });
    renderer.setSize(OFF_W, OFF_H, false);

    // Modern color/tone settings (support old three too)
    if ('outputColorSpace' in renderer) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.physicallyCorrectLights = true;

    const scene = new THREE.Scene();
    // Slightly off-white so light parts aren’t lost
    scene.background = new THREE.Color(0xEEF3F7);

    // Reuse main env if present; else neutral PMREM if available
    if (core.scene && core.scene.environment) {
      scene.environment = core.scene.environment;
    } else {
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envRT = pmrem.fromScene(new THREE.RoomEnvironment(renderer), 0.04);
        scene.environment = envRT.texture;
      } catch (_) { /* ok if not available */ }
    }

    // Soft light rig (helps even when env exists)
    const hemi = new THREE.HemisphereLight(0xffffff, 0x92a1b1, 0.75);
    const key  = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(3, 4, 2);
    const rim  = new THREE.DirectionalLight(0xffffff, 0.35); rim.position.set(-2, 3, -3);
    scene.add(hemi, key, rim);

    const camera = new THREE.PerspectiveCamera(60, OFF_W / OFF_H, 0.01, 10000);

    // Clone robot so we can toggle visibility safely per asset
    const robotClone = core.robot.clone(true);
    scene.add(robotClone);

    // Map assetKey → meshes[] (based on userData.__assetKey)
    const cloneAssetToMeshes = new Map();
    robotClone.traverse(o => {
      const k = o && o.userData && o.userData.__assetKey;
      if (k && o.isMesh && o.geometry) {
        const arr = cloneAssetToMeshes.get(k) || [];
        arr.push(o); cloneAssetToMeshes.set(k, arr);
      }
    });

    function softenPBRIfNoEnv(meshes) {
      if (scene.environment) return () => {};
      const stash = [];
      for (const m of meshes) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          if (!mat || !mat.isMaterial) continue;
          const isStd  = mat.isMeshStandardMaterial || mat.type === 'MeshStandardMaterial';
          const isPhys = mat.isMeshPhysicalMaterial || mat.type === 'MeshPhysicalMaterial';
          if (isStd || isPhys) {
            stash.push([mat, mat.metalness, mat.roughness]);
            if (typeof mat.metalness === 'number') mat.metalness = 0.0;
            if (typeof mat.roughness === 'number') mat.roughness = Math.max(0.6, mat.roughness ?? 0.6);
            mat.needsUpdate = true;
          }
        }
      }
      return () => {
        for (const [mat, met, rou] of stash) {
          mat.metalness = met;
          mat.roughness = rou;
          mat.needsUpdate = true;
        }
      };
    }

    function snapshotAsset(assetKey) {
      const meshes = cloneAssetToMeshes.get(assetKey) || [];
      if (!meshes.length) return null;

      // Hide all, show only target meshes
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
        m.updateWorldMatrix(true, false); // ensure transforms
        tmp.setFromObject(m);
        if (!has) { box.copy(tmp); has = true; } else box.union(tmp);
      }
      if (!has) { vis.forEach(([o, v]) => o.visible = v); return null; }

      const center = box.getCenter(new THREE.Vector3());
      const size   = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const dist   = maxDim * 2.0;

      camera.near = Math.max(maxDim / 1000, 0.001);
      camera.far  = Math.max(maxDim * 1000, 1000);
      camera.updateProjectionMatrix();

      const az = Math.PI * 0.25, el = Math.PI * 0.18;
      const dir = new THREE.Vector3(
        Math.cos(el) * Math.cos(az),
        Math.sin(el),
        Math.cos(el) * Math.sin(az)
      ).multiplyScalar(dist);
      camera.position.copy(center.clone().add(dir));
      camera.lookAt(center);

      // PBR soften (only if no env)
      const restoreMats = softenPBRIfNoEnv(meshes);

      // Render & grab data URL
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/png');

      restoreMats();

      // Restore visibilities
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

  // -------------------- Tools Dock (minimal shell) --------------------
  // This keeps your app working without ES modules. Extend as needed.
  function createToolsDock(app, theme) {
    if (!app || !app.camera || !app.controls || !app.renderer) {
      throw new Error('[ToolsDock] Missing app.camera/controls/renderer');
    }
    const t = normalizeTheme(theme);

    // Example: build a minimal floating container (kept tiny here)
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed','top:16px','left:16px','z-index:1000',
      'background:'+t.bgPanel,'border:1px solid '+t.stroke,
      'border-radius:12px','box-shadow:'+t.shadow,'padding:10px',
      'font:14px/1.2 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif',
      'color:'+t.text
    ].join(';');
    el.innerHTML = `<strong style="color:${t.teal}">Tools</strong>`;
    document.body.appendChild(el);

    // Return a small API so your other code can call it safely
    return {
      el,
      open(){ el.style.display='block'; },
      close(){ el.style.display='none'; },
      set(v){ el.style.display = v ? 'block' : 'none'; },
      destroy(){ el.remove(); }
    };
  }

  // -------------------- Expose globals --------------------
  global.buildOffscreenForThumbnails = buildOffscreenForThumbnails;
  global.createToolsDock = createToolsDock;

})(window);






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
