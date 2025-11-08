// urdf_viewer_main.js
// URDF viewer + thumbnails + IA integration + auto-save descriptions.
// Usa meshDB embebido (sin pedir .dae por HTTP) y guarda SOLO descripciones IA.

import { THEME } from './Theme.js';
import { createViewer } from './core/ViewerCore.js';
import { buildAssetDB, createLoadMeshCb } from './core/AssetDB.js';
import { attachInteraction } from './interaction/SelectionAndDrag.js';
import { createToolsDock } from './ui/ToolsDock.js';
import { createComponentsPanel } from './ui/ComponentsPanel.js';

export let Base64Images = [];

function debugLog(...args) {
  try { console.log('[URDF_DEBUG]', ...args); } catch (_) {}
  try {
    if (typeof window !== 'undefined') {
      window.URDF_DEBUG_LOGS = window.URDF_DEBUG_LOGS || [];
      window.URDF_DEBUG_LOGS.push(args);
    }
  } catch (_) {}
}

export function render(opts = {}) {
  const {
    container,
    urdfContent = '',
    meshDB = {},
    selectMode = 'link',
    background = THEME.bgCanvas || 0xffffff,
    clickAudioDataURL = null,
    IA_Widgets = false,
    saveCallbackName = null, // ej: "persist.saveURDFDescriptions"
  } = opts;

  debugLog('render() init', { selectMode, background, IA_Widgets, saveCallbackName });

  // 1) Viewer base
  const core = createViewer({ container, background });

  // 2) AssetDB + loadMeshCb + mapeo assetKey -> meshes
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map();

  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse((o) => {
        if (o && o.isMesh && o.geometry) {
          list.push(o);
          o.userData = o.userData || {};
          o.userData.__assetKey = assetKey;
        }
      });
      assetToMeshes.set(assetKey, list);
    },
  });

  // 3) Cargar URDF usando loadMeshCb (IMPORTANTE)
  const robot = core.loadURDF(urdfContent, { loadMeshCb });
  debugLog('Robot loaded', { hasRobot: !!robot });

  // Si por alguna razón no se llenó assetToMeshes, intentamos reconstruir
  if (robot && !assetToMeshes.size) {
    rebuildAssetMapFromRobot(robot, assetToMeshes);
    debugLog('assetToMeshes rebuilt', Array.from(assetToMeshes.keys()));
  }

  // 4) Thumbnails offscreen
  const off = buildOffscreenForThumbnails(core);
  if (!off) debugLog('Offscreen thumbnails not available');

  // 5) Interacción selección / orbit
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode,
  });

  // 6) API pública del viewer
  const app = {
    ...core,
    robot,
    IA_Widgets,
    saveCallbackName: saveCallbackName || null,

    assets: {
      list: () => listAssets(assetToMeshes),
      thumbnail: (assetKey) => off?.thumbnail(assetKey),
    },

    isolate: {
      asset: (assetKey) => isolateAsset(core, assetToMeshes, assetKey),
      clear: () => showAll(core),
    },

    showAll: () => showAll(core),

    openTools(open = true) {
      tools.set(!!open);
    },

    componentDescriptions: {},

    getComponentDescription(assetKey, index) {
      const src = app.componentDescriptions || {};
      if (!src) return '';

      if (assetKey && src[assetKey]) return src[assetKey];

      const baseFull = (assetKey || '').split(/[\\/]/).pop();
      if (baseFull && src[baseFull]) return src[baseFull];

      const base = baseFull ? baseFull.split('.')[0] : '';
      if (base && src[base]) return src[base];

      if (Array.isArray(src) && typeof index === 'number') {
        return src[index] || '';
      }
      return '';
    },

    async collectAllThumbnails() {
      const items = app.assets.list();
      Base64Images.length = 0;

      for (const it of items) {
        try {
          const url = await app.assets.thumbnail(it.assetKey);
          if (!url || typeof url !== 'string') continue;
          const base64 = url.split(',')[1] || '';
          if (base64) Base64Images.push(base64);
        } catch (e) {
          debugLog('collectAllThumbnails error', it.assetKey, String(e));
        }
      }

      if (typeof window !== 'undefined') {
        window.Base64Images = Base64Images;
      }

      debugLog('collectAllThumbnails done', { count: Base64Images.length });
      return Base64Images;
    },
  };

  // 7) UI
  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);

  // 8) Click SFX opcional
  if (clickAudioDataURL) {
    try { installClickSound(clickAudioDataURL); }
    catch (e) { debugLog('installClickSound error', String(e)); }
  }

  // 9) IA: describir componentes + autosave
  if (IA_Widgets) {
    debugLog('[IA] IA_Widgets=true → bootstrap IA');
    bootstrapComponentDescriptions(app, assetToMeshes, off);
  } else {
    debugLog('[IA] IA_Widgets=false → IA disabled');
  }

  // 10) Exponer en window para debugging
  if (typeof window !== 'undefined') {
    window.URDFViewer = window.URDFViewer || {};
    try { window.URDFViewer.__app = app; } catch (_) {}
  }

  const destroy = () => {
    try { comps.destroy(); } catch (_) {}
    try { tools.destroy(); } catch (_) {}
    try { inter.destroy(); } catch (_) {}
    try { off?.destroy?.(); } catch (_) {}
    try { core.destroy(); } catch (_) {}
  };

  return { ...app, destroy };
}

/* ---------- Helpers: assets ---------- */

function rebuildAssetMapFromRobot(robot, assetToMeshes) {
  const tmp = new Map();
  robot.traverse((o) => {
    if (o && o.isMesh && o.geometry) {
      const k =
        (o.userData &&
          (o.userData.__assetKey ||
            o.userData.assetKey ||
            o.userData.filename)) ||
        null;
      if (!k) return;
      const arr = tmp.get(k) || [];
      arr.push(o);
      tmp.set(k, arr);
    }
  });
  tmp.forEach((arr, k) => {
    if (arr && arr.length) assetToMeshes.set(k, arr);
  });
}

function listAssets(assetToMeshes) {
  const items = [];
  assetToMeshes.forEach((meshes, assetKey) => {
    if (!meshes || meshes.length === 0) return;
    const { base, ext } = splitName(assetKey);
    items.push({ assetKey, base, ext, count: meshes.length });
  });
  items.sort((a, b) =>
    a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: 'base' }),
  );
  return items;
}

function splitName(key) {
  const clean = String(key || '').split('?')[0].split('#')[0];
  const base = clean.split('/').pop();
  const dot = base.lastIndexOf('.');
  return {
    base: dot >= 0 ? base.slice(0, dot) : base,
    ext: dot >= 0 ? base.slice(dot + 1).toLowerCase() : '',
  };
}

/* ---------- Helpers: aislar / mostrar ---------- */

function isolateAsset(core, assetToMeshes, assetKey) {
  const meshes = assetToMeshes.get(assetKey) || [];
  if (!core.robot) return;
  core.robot.traverse((o) => {
    if (o.isMesh && o.geometry) o.visible = false;
  });
  meshes.forEach((m) => { m.visible = true; });
  frameMeshes(core, meshes);
}

function showAll(core) {
  if (!core.robot) return;
  core.robot.traverse((o) => {
    if (o.isMesh && o.geometry) o.visible = true;
  });
  if (core.fitAndCenter) core.fitAndCenter(core.robot, 1.06);
}

function frameMeshes(core, meshes) {
  if (!meshes || meshes.length === 0) return;

  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let has = false;

  meshes.forEach((m) => {
    if (!m) return;
    tmp.setFromObject(m);
    if (!has) { box.copy(tmp); has = true; }
    else { box.union(tmp); }
  });

  if (!has) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  const cam = core.camera;
  const ctrl = core.controls;

  if (cam.isPerspectiveCamera) {
    const fov = (cam.fov || 60) * Math.PI / 180;
    const dist = maxDim / Math.tan(Math.max(1e-6, fov / 2));
    cam.near = Math.max(maxDim / 1000, 0.001);
    cam.far = Math.max(maxDim * 1500, 1500);
    cam.updateProjectionMatrix();
    const dir = new THREE.Vector3(1, 0.7, 1).normalize();
    cam.position.copy(center.clone().add(dir.multiplyScalar(dist)));
  } else {
    cam.left = -maxDim;
    cam.right = maxDim;
    cam.top = maxDim;
    cam.bottom = -maxDim;
    cam.near = Math.max(maxDim / 1000, 0.001);
    cam.far = Math.max(maxDim * 1500, 1500);
    cam.updateProjectionMatrix();
    cam.position.copy(
      center.clone().add(new THREE.Vector3(maxDim, maxDim * 0.9, maxDim)),
    );
  }

  if (ctrl) {
    ctrl.target.copy(center);
    ctrl.update();
  }
}

/* ---------- Offscreen thumbnails ---------- */

function buildOffscreenForThumbnails(core) {
  if (!core.robot) return null;

  const OFF_W = 640;
  const OFF_H = 480;

  const canvas = document.createElement('canvas');
  canvas.width = OFF_W;
  canvas.height = OFF_H;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(OFF_W, OFF_H, false);

  if (core.renderer) {
    renderer.physicallyCorrectLights =
      core.renderer.physicallyCorrectLights ?? true;
    renderer.toneMapping = core.renderer.toneMapping;
    renderer.toneMappingExposure =
      core.renderer.toneMappingExposure ?? 1.0;

    if ('outputColorSpace' in renderer && 'outputColorSpace' in core.renderer) {
      renderer.outputColorSpace = core.renderer.outputColorSpace;
    } else if ('outputEncoding' in renderer && 'outputEncoding' in core.renderer) {
      renderer.outputEncoding = core.renderer.outputEncoding;
    }

    renderer.shadowMap.enabled = core.renderer.shadowMap?.enabled ?? false;
    renderer.shadowMap.type =
      core.renderer.shadowMap?.type ?? THREE.PCFSoftShadowMap;
  }

  const baseScene = new THREE.Scene();
  baseScene.background =
    core.scene?.background ?? new THREE.Color(0xffffff);
  baseScene.environment = core.scene?.environment ?? null;

  const amb = new THREE.AmbientLight(0xffffff, 0.95);
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(2.5, 2.5, 2.5);
  baseScene.add(amb, dir);

  const camera = new THREE.PerspectiveCamera(
    60,
    OFF_W / OFF_H,
    0.01,
    10000,
  );

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const ready = (async () => {
    await sleep(400);
    renderer.render(baseScene, camera);
    debugLog('[Thumbs] Offscreen primed');
  })();

  function buildCloneAndMap() {
    const scene = baseScene.clone();
    scene.background = baseScene.background;
    scene.environment = baseScene.environment;

    const robotClone = core.robot.clone(true);
    scene.add(robotClone);

    robotClone.traverse((o) => {
      if (o.isMesh && o.material) {
        if (Array.isArray(o.material)) {
          o.material = o.material.map((m) => m.clone());
        } else {
          o.material = o.material.clone();
        }
        o.material.needsUpdate = true;
      }
    });

    const cloneMap = new Map();
    robotClone.traverse((o) => {
      const key = o?.userData?.__assetKey;
      if (key && o.isMesh && o.geometry) {
        const arr = cloneMap.get(key) || [];
        arr.push(o);
        cloneMap.set(key, arr);
      }
    });

    return { scene, robotClone, cloneMap };
  }

  function snapshotAsset(assetKey) {
    const { scene, robotClone, cloneMap } = buildCloneAndMap();
    const meshes = cloneMap.get(assetKey) || [];
    if (!meshes.length) {
      debugLog('[Thumbs] no meshes for', assetKey);
      return null;
    }

    robotClone.traverse((o) => {
      if (o.isMesh && o.geometry) o.visible = false;
    });
    meshes.forEach((m) => { m.visible = true; });

    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let has = false;
    meshes.forEach((m) => {
      tmp.setFromObject(m);
      if (!has) { box.copy(tmp); has = true; }
      else { box.union(tmp); }
    });
    if (!has) return null;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.0;

    camera.near = Math.max(maxDim / 1000, 0.001);
    camera.far = Math.max(maxDim * 1000, 1000);
    camera.updateProjectionMatrix();

    const az = Math.PI * 0.25;
    const el = Math.PI * 0.20;
    const dirV = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az),
    ).multiplyScalar(dist);

    camera.position.copy(center.clone().add(dirV));
    camera.lookAt(center);

    renderer.render(scene, camera);
    return canvas.toDataURL('image/png');
  }

  return {
    async thumbnail(assetKey) {
      try {
        await ready;
        const url = snapshotAsset(assetKey);
        debugLog('[Thumbs] thumbnail', assetKey, !!url);
        return url;
      } catch (e) {
        debugLog('[Thumbs] thumbnail error', assetKey, String(e));
        return null;
      }
    },
    destroy() {
      try { renderer.dispose(); } catch (_) {}
      try { baseScene.clear(); } catch (_) {}
    },
  };
}

/* ---------- IA bootstrap + auto-save ---------- */

function bootstrapComponentDescriptions(app, assetToMeshes, off) {
  debugLog('[IA] bootstrapComponentDescriptions start');

  if (!off || typeof off.thumbnail !== 'function') {
    debugLog('[IA] No offscreen; abort IA');
    return;
  }

  const kernel =
    typeof window !== 'undefined' &&
    window.google &&
    window.google.colab &&
    window.google.colab.kernel &&
    window.google.colab.kernel.invokeFunction
      ? window.google.colab.kernel
      : null;

  if (!kernel) {
    debugLog('[IA] No Colab kernel; abort IA');
    return;
  }

  const items = listAssets(assetToMeshes);
  if (!items.length) {
    debugLog('[IA] No components; abort IA');
    return;
  }

  (async () => {
    try {
      const entries = [];
      for (const ent of items) {
        try {
          const url = await off.thumbnail(ent.assetKey);
          if (!url) continue;
          const b64 = await makeApproxSizedBase64(url, 5);
          if (!b64) continue;
          entries.push({ key: ent.assetKey, image_b64: b64 });
        } catch (e) {
          debugLog('[IA] thumb error', ent.assetKey, String(e));
        }
      }

      debugLog('[IA] entries', entries.length);
      if (!entries.length) return;

      let res;
      try {
        res = await kernel.invokeFunction('describe_component_images', [entries], {});
        debugLog('[IA] describe_component_images result', res);
      } catch (e) {
        debugLog('[IA] invokeFunction error', String(e));
        return;
      }

      const map = extractDescMap(res);
      debugLog('[IA] parsed map', map);

      if (!map || typeof map !== 'object' || !Object.keys(map).length) {
        debugLog('[IA] No usable descriptions from IA');
        return;
      }

      applyIaDescriptionsAndAutoSave(app, map, kernel);
    } catch (err) {
      debugLog('[IA] bootstrap error', String(err));
    }
  })();
}

function extractDescMap(res) {
  if (!res) return null;
  let data = res.data ?? res;

  if (data && typeof data === 'object' && data['application/json']) {
    const inner = data['application/json'];
    if (inner && typeof inner === 'object') return inner;
  }

  if (data && typeof data === 'object' && typeof data['text/plain'] === 'string') {
    const parsed = parseMaybePythonDict(data['text/plain'].trim());
    if (parsed) return parsed;
  }

  if (typeof data === 'string') {
    const parsed = parseMaybePythonDict(data.trim());
    if (parsed) return parsed;
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data) && data.length && typeof data[0] === 'object') {
    return data[0];
  }

  return null;
}

function parseMaybePythonDict(raw) {
  if (!raw || raw[0] !== '{' || raw[raw.length - 1] !== '}') return null;
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') return j;
  } catch (_) {}
  try {
    let jsonLike = raw.replace(/'/g, '"');
    jsonLike = jsonLike.replace(/([,{]\s*)([A-Za-z0-9_./-]+)\s*:/g, '$1"$2":');
    const j2 = JSON.parse(jsonLike);
    if (j2 && typeof j2 === 'object') return j2;
  } catch (_) {}
  return null;
}

function applyIaDescriptionsAndAutoSave(app, map, kernel) {
  if (!map || typeof map !== 'object') return;

  const store =
    app.componentDescriptions && typeof app.componentDescriptions === 'object'
      ? app.componentDescriptions
      : (app.componentDescriptions = {});

  for (const [k, v] of Object.entries(map)) {
    if (typeof v === 'string' && v.trim()) {
      store[String(k).toLowerCase()] = v.trim();
    }
  }

  if (!app.__patchedGetComponentDescription) {
    const orig = app.getComponentDescription
      ? app.getComponentDescription.bind(app)
      : null;

    app.getComponentDescription = function (assetKey, index = 0) {
      const cd = app.componentDescriptions || {};
      const values = Object.values(cd);

      if (assetKey) {
        const key = String(assetKey).toLowerCase();
        if (cd[key]) return cd[key];
        const base = key.split(/[\\/]/).pop();
        if (cd[base]) return cd[base];
        for (const k of Object.keys(cd)) {
          if (k.endsWith('/' + base)) return cd[k];
        }
      }

      if (orig) {
        const fromOrig = orig(assetKey, index);
        if (fromOrig) return fromOrig;
      }

      return values[index] || values[0] || '';
    };

    app.__patchedGetComponentDescription = true;
  }

  const detail = { map: app.componentDescriptions };
  if (typeof app.emit === 'function') {
    try { app.emit('ia_descriptions_ready', detail); } catch (_) {}
  }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('ia_descriptions_ready', { detail }),
      );
    }
  } catch (_) {}

  debugLog('[IA] Descriptions applied', Object.keys(app.componentDescriptions).length);

  const cbName = app.saveCallbackName;
  if (!cbName || !kernel || typeof kernel.invokeFunction !== 'function') {
    debugLog('[IA] Autosave skipped (no callback/kernel)');
    return;
  }

  const safe = {};
  for (const [k, v] of Object.entries(app.componentDescriptions || {})) {
    if (typeof v === 'string' && v.trim()) {
      safe[String(k)] = v.trim();
    }
  }

  if (!Object.keys(safe).length) {
    debugLog('[IA] Autosave skipped (empty map)');
    return;
  }

  debugLog('[IA] Autosave →', cbName, 'count=', Object.keys(safe).length);

  kernel
    .invokeFunction(cbName, [safe], {})
    .then((res) => {
      debugLog('[IA] Autosave result', res);
    })
    .catch((err) => {
      debugLog('[IA] Autosave error', String(err));
    });
}

/* ---------- IA thumbnails: reduce tamaño ---------- */

async function makeApproxSizedBase64(dataURL, targetKB = 5) {
  try {
    const maxBytes = targetKB * 1024;

    const resp = await fetch(dataURL);
    const blob = await resp.blob();

    const img = document.createElement('img');
    const u = URL.createObjectURL(blob);

    await new Promise((res, rej) => {
      img.onload = () => res();
      img.onerror = rej;
      img.src = u;
    });

    const ratio = Math.min(1, Math.max(0.05, maxBytes / (blob.size || maxBytes)));
    const scale = Math.sqrt(ratio);
    const w = Math.max(32, Math.floor(img.width * scale));
    const h = Math.max(32, Math.floor(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    URL.revokeObjectURL(u);

    const out = canvas.toDataURL('image/png');
    const b64 = out.split(',')[1] || '';
    if (!b64) return null;

    debugLog('[IA] thumb ~bytes', Math.floor((b64.length * 3) / 4));
    return b64;
  } catch (e) {
    debugLog('[IA] makeApproxSizedBase64 error', String(e));
    return null;
  }
}

/* ---------- Click sound opcional ---------- */

function installClickSound(dataURL) {
  if (!dataURL || typeof dataURL !== 'string') return;
  let ctx = null;
  let buf = null;

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
    if (!buf) {
      ensure().then(play).catch(() => {});
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    try { src.start(); } catch (_) {}
  }

  window.__urdf_click__ = play;
}

/* ---------- Helper global ---------- */

if (typeof window !== 'undefined') {
  window.URDFViewer = window.URDFViewer || {};
  window.URDFViewer.render = (opts) => {
    const app = render(opts);
    try { window.URDFViewer.__app = app; } catch (_) {}
    return app;
  };
}
