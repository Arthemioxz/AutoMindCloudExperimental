// /viewer/urdf_viewer_main.js
// Viewer moderno + thumbnails + IA opt-in + guardado manual de descripciones.
//
// Flujo IA:
//   - JS genera thumbnails (~5KB) de cada componente.
//   - Llama a "describe_component_images" (Colab) para obtener descripciones.
//   - Aplica el mapa a app.componentDescriptions.
//   - NO guarda nada automáticamente.
//   - Solo cuando se llama app.saveDescriptions() (o el botón "Save IA descriptions")
//     se invoca el callback "persist.saveURDFDescriptions" enviado desde Python.
//   - Ese callback guarda SOLO { assetKey: descripcion } en JSON.

import { THEME } from './Theme.js';
import { createViewer } from './core/ViewerCore.js';
import { buildAssetDB, createLoadMeshCb } from './core/AssetDB.js';
import { attachInteraction } from './interaction/SelectionAndDrag.js';
import { createToolsDock } from './ui/ToolsDock.js';
import { createComponentsPanel } from './ui/ComponentsPanel.js';

export let Base64Images = [];

/* ========================= Debug helper ========================= */

function debugLog(...args) {
  try {
    console.log('[URDF_DEBUG]', ...args);
  } catch (_) {}
  try {
    if (typeof window !== 'undefined') {
      window.URDF_DEBUG_LOGS = window.URDF_DEBUG_LOGS || [];
      window.URDF_DEBUG_LOGS.push(args);
    }
  } catch (_) {}
}

/* ============================ Render ============================ */

export function render(opts = {}) {
  const {
    container,
    urdfContent = '',
    meshDB = {},
    selectMode = 'link',
    background = THEME.bgCanvas || 0xffffff,
    clickAudioDataURL = null,
    IA_Widgets = false,
    saveCallbackName = null, // nombre del callback Colab tipo Board
  } = opts;

  debugLog('render() init', { selectMode, background, IA_Widgets, saveCallbackName });

  // 1) Core viewer
  const core = createViewer({ container, background });

  // 2) Asset DB + indexado
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map(); // assetKey -> Mesh[]

  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse((o) => {
        if (o && o.isMesh && o.geometry) list.push(o);
      });
      assetToMeshes.set(assetKey, list);

      obj.traverse((o) => {
        if (o && o.isMesh) {
          o.userData = o.userData || {};
          o.userData.__assetKey = assetKey;
        }
      });
    },
  });

  // 3) Cargar URDF
  const robot = core.loadURDF(urdfContent, { loadMeshCb });
  debugLog('Robot loaded', { hasRobot: !!robot });

  if (robot && !assetToMeshes.size) {
    debugLog('assetToMeshes vacío, reconstruyendo desde userData');
    rebuildAssetMapFromRobot(robot, assetToMeshes);
  }

  debugLog('assetToMeshes keys', Array.from(assetToMeshes.keys()));

  // 4) Thumbnails (renderer offscreen)
  const off = buildOffscreenForThumbnails(core);
  if (!off) debugLog('Offscreen thumbnails no disponible (no robot)');

  // 5) Interacción
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode,
  });

  // 6) Facade app
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

  // 8) SFX opcional
  if (clickAudioDataURL) {
    try {
      installClickSound(clickAudioDataURL);
    } catch (e) {
      debugLog('installClickSound error', String(e));
    }
  }

  // 9) IA opt-in
  if (IA_Widgets) {
    debugLog('[IA] IA_Widgets=true → bootstrap IA');
    bootstrapComponentDescriptions(app, assetToMeshes, off);
  } else {
    debugLog('[IA] IA_Widgets=false → sin IA');
  }

  // 10) expose
  if (typeof window !== 'undefined') {
    window.URDFViewer = window.URDFViewer || {};
    try {
      window.URDFViewer.__app = app;
    } catch (_) {}
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

/* ======================= Helpers: assets / isolate ======================= */

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
    a.base.localeCompare(b.base, undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
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

function isolateAsset(core, assetToMeshes, assetKey) {
  const meshes = assetToMeshes.get(assetKey) || [];
  if (!core.robot) return;

  core.robot.traverse((o) => {
    if (o.isMesh && o.geometry) o.visible = false;
  });
  meshes.forEach((m) => {
    m.visible = true;
  });

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
    if (!has) {
      box.copy(tmp);
      has = true;
    } else {
      box.union(tmp);
    }
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

/* ============= Offscreen thumbnails: componente aislado ============= */

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
      debugLog('[Thumbs] snapshotAsset sin meshes para', assetKey);
      return null;
    }

    robotClone.traverse((o) => {
      if (o.isMesh && o.geometry) o.visible = false;
    });
    meshes.forEach((m) => {
      m.visible = true;
    });

    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let has = false;

    meshes.forEach((m) => {
      tmp.setFromObject(m);
      if (!has) {
        box.copy(tmp);
        has = true;
      } else {
        box.union(tmp);
      }
    });

    if (!has) {
      debugLog('[Thumbs] snapshotAsset box vacío para', assetKey);
      return null;
    }

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
    const url = canvas.toDataURL('image/png');
    return url;
  }

  return {
    async thumbnail(assetKey) {
      try {
        await ready;
        const url = snapshotAsset(assetKey);
        debugLog('[Thumbs] thumbnail', assetKey, !!url);
        return url;
      } catch (e) {
        debugLog('[Thumbs] Error thumbnail', assetKey, String(e));
        return null;
      }
    },
    destroy() {
      try { renderer.dispose(); } catch (_) {}
      try { baseScene.clear(); } catch (_) {}
    },
  };
}

/* ================= IA opt-in: describe_component_images ================= */

function bootstrapComponentDescriptions(app, assetToMeshes, off) {
  debugLog('[IA] bootstrapComponentDescriptions start');

  if (!off || typeof off.thumbnail !== 'function') {
    debugLog('[IA] Offscreen no disponible; cancelando IA');
    return;
  }

  const hasColab =
    typeof window !== 'undefined' &&
    window.google &&
    window.google.colab &&
    window.google.colab.kernel &&
    typeof window.google.colab.kernel.invokeFunction === 'function';

  debugLog('[IA] Colab bridge?', hasColab);
  if (!hasColab) return;

  const items = listAssets(assetToMeshes);
  debugLog('[IA] Componentes a describir', items.length);
  if (!items.length) return;

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
          debugLog('[IA] Error thumb IA', ent.assetKey, String(e));
        }
      }

      debugLog('[IA] entries generadas', entries.length);
      if (!entries.length) return;

      let res;
      try {
        res = await window.google.colab.kernel.invokeFunction(
          'describe_component_images',
          [entries],
          {},
        );
        debugLog('[IA] invokeFunction OK', res);
      } catch (e) {
        debugLog('[IA] invokeFunction error', String(e));
        return;
      }

      const map = extractDescMap(res);
      debugLog('[IA] parsed map', map);

      if (map && typeof map === 'object' && Object.keys(map).length) {
        applyIaDescriptionsToApp(app, map);
      } else {
        debugLog('[IA] Respuesta IA sin mapa utilizable');
      }
    } catch (err) {
      debugLog('[IA] Error en bootstrapComponentDescriptions', String(err));
    }
  })();
}

/**
 * Extrae un mapa assetKey -> descripción desde la respuesta
 * de google.colab.kernel.invokeFunction.
 */
function extractDescMap(res) {
  if (!res) return null;

  let data = res.data ?? res;

  // 1) application/json
  if (
    data &&
    typeof data === 'object' &&
    data['application/json'] &&
    typeof data['application/json'] === 'object'
  ) {
    return data['application/json'];
  }

  // 2) text/plain con dict
  if (
    data &&
    typeof data === 'object' &&
    typeof data['text/plain'] === 'string'
  ) {
    const raw = data['text/plain'].trim();
    const parsed = parseMaybePythonDict(raw);
    if (parsed) return parsed;
  }

  // 3) string directa
  if (typeof data === 'string') {
    const parsed = parseMaybePythonDict(data.trim());
    if (parsed) return parsed;
  }

  // 4) objeto plano
  if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data)
  ) {
    return data;
  }

  // 5) array con objeto dentro
  if (
    Array.isArray(data) &&
    data.length &&
    typeof data[0] === 'object'
  ) {
    return data[0];
  }

  return null;
}

/**
 * Parsea dict tipo Python o JSON:
 *   "{'base.dae': 'Actuador ...'}"
 *   '{"base.dae": "Actuador ..."}"
 */
function parseMaybePythonDict(raw) {
  if (!raw || raw[0] !== '{' || raw[raw.length - 1] !== '}') return null;

  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') return j;
  } catch (_) {}

  try {
    let jsonLike = raw.replace(/'/g, '"');
    jsonLike = jsonLike.replace(
      /([,{]\s*)([A-Za-z0-9_./-]+)\s*:/g,
      '$1"$2":',
    );
    const j2 = JSON.parse(jsonLike);
    if (j2 && typeof j2 === 'object') return j2;
  } catch (_) {}

  return null;
}

/**
 * Aplica el mapa IA:
 * - Normaliza claves.
 * - Parcha getComponentDescription.
 * - Define app.saveDescriptions():
 *     * arma dict plano {key: desc}
 *     * llama kernel.invokeFunction(saveCallbackName, [dict], {})
 * - NO guarda automáticamente; solo cuando se llama saveDescriptions().
 */
function applyIaDescriptionsToApp(app, map) {
  if (!map || typeof map !== 'object') return;

  if (!app.componentDescriptions || typeof app.componentDescriptions !== 'object') {
    app.componentDescriptions = {};
  }

  const store = app.componentDescriptions;

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

  app.__iaDescriptionsReady = true;
  debugLog('[IA] Descripciones IA aplicadas', {
    count: Object.keys(app.componentDescriptions).length,
  });

  if (!app.saveDescriptions) {
    app.saveDescriptions = async function () {
      try {
        const cbName = app.saveCallbackName;
        if (!cbName) {
          debugLog('[IA] saveDescriptions: sin saveCallbackName');
          return { ok: false, error: 'no_callback' };
        }

        const kernel = window.google?.colab?.kernel;
        if (!kernel || typeof kernel.invokeFunction !== 'function') {
          debugLog('[IA] saveDescriptions: sin kernel Colab');
          return { ok: false, error: 'no_kernel' };
        }

        const src = app.componentDescriptions || {};
        const safe = {};
        for (const [k, v] of Object.entries(src)) {
          if (typeof v === 'string' && v.trim()) {
            safe[String(k)] = v.trim();
          }
        }

        debugLog('[IA] saveDescriptions →', cbName, {
          count: Object.keys(safe).length,
        });

        const res = await kernel.invokeFunction(cbName, [safe], {});
        debugLog('[IA] saveDescriptions: respuesta', res);
        return res || { ok: true };
      } catch (e) {
        debugLog('[IA] saveDescriptions error', String(e));
        return { ok: false, error: String(e) };
      }
    };
  }
}

/* =================== Reducción thumbnails ~5KB =================== */

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

    const ratio = Math.min(
      1,
      Math.max(0.05, maxBytes / (blob.size || maxBytes)),
    );
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

    debugLog(
      '[IA] makeApproxSizedBase64 bytes ~',
      Math.floor((b64.length * 3) / 4),
    );
    return b64;
  } catch (e) {
    debugLog('[IA] makeApproxSizedBase64 error', String(e));
    return null;
  }
}

/* ================= Click sound ================= */

function installClickSound(dataURL) {
  if (!dataURL || typeof dataURL !== 'string') return;

  let ctx = null;
  let buf = null;

  async function ensure() {
    if (!ctx) {
      ctx =
        new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!buf) {
      const resp = await fetch(dataURL);
      const arr = await resp.arrayBuffer();
      buf = await ctx.decodeAudioData(arr);
    }
  }

  function play() {
    if (!ctx) {
      ctx =
        new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();

    if (!buf) {
      ensure().then(play).catch(() => {});
      return;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    try {
      src.start();
    } catch (_) {}
  }

  window.__urdf_click__ = play;
}

/* ================== Global helper ================== */

if (typeof window !== 'undefined') {
  window.URDFViewer = window.URDFViewer || {};
  window.URDFViewer.render = (opts) => {
    const app = render(opts);
    try {
      window.URDFViewer.__app = app;
    } catch (_) {}
    return app;
  };
}
