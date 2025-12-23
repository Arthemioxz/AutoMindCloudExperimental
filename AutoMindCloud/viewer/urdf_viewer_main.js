// /viewer/urdf_viewer_main.js
// Viewer moderno + thumbnails + IA opt-in con:
//  - Imagen ISO del robot completo (__robot_iso__)
//  - Nombres + orden de componentes
//  - Reducción de thumbnails a ~5KB solo para IA
//  - Parser robusto para el dict que llega desde Colab
//
// ✅ FIX PRINCIPAL (lo que estabas pidiendo):
//  - NO depende de offscreen para IA.
//  - Toma las fotos YA capturadas (window.Base64Images / Base64Images) y las envía a Colab invokeFunction.
//  - Si assetToMeshes está vacío, igual arma lista de componentes desde assetDB (meshDB keys).
//
// Nota: esto NO cambia tu sistema original de capturas.
// Solo “engancha” el envío cuando IA_Widgets=true.

import { THEME } from './Theme.js';
import * as ViewerCore from './core/ViewerCore.js';
const createViewer =
  ViewerCore.createViewer ||
  ViewerCore.default ||
  (typeof window !== 'undefined' ? window.createViewer : null);
if (createViewer == null) {
  throw new Error(
    "ViewerCore: createViewer no encontrado. Revisa core/ViewerCore.js (export) o window.createViewer (UMD).",
  );
}

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
  } = opts;

  debugLog('render() init', { selectMode, background, IA_Widgets });

  // Wait until the URDF meshes stop arriving (assetToMeshes settles).
  function waitForAssetMapToSettle(assetToMeshes, maxWaitMs = 8000, quietMs = 350) {
    const start = performance.now();
    let lastCount = -1;
    let lastChange = performance.now();

    function countNow() {
      let n = 0;
      try {
        assetToMeshes.forEach((arr) => {
          n += arr && arr.length ? arr.length : 0;
        });
      } catch (_) {}
      return n;
    }

    return new Promise((resolve) => {
      function tick() {
        const now = performance.now();
        const c = countNow();
        if (c !== lastCount) {
          lastCount = c;
          lastChange = now;
        }

        const settled = now - lastChange >= quietMs;
        const timeout = now - start >= maxWaitMs;

        if (settled || timeout) resolve({ meshes: c, settled, timeout });
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  // 1) Core viewer
  const _createViewer =
    (ViewerCore &&
      (ViewerCore.createViewer ||
        (ViewerCore.default && ViewerCore.default.createViewer))) ||
    window.createViewer;
  if (typeof _createViewer !== 'function')
    throw new Error(
      '[urdf_viewer_main] createViewer not found (ESM export or UMD global).',
    );
  const core = _createViewer({ container, background });

  // 2) Asset DB
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

  // 4) Offscreen thumbnails (opcional). NO lo usamos para IA si ya hay capturas.
  const off = safeBuildOffscreenForThumbnails(core, assetToMeshes, THEME);
  if (!off) debugLog('Offscreen thumbnails no disponible (no robot o deshabilitado)');

  // 5) Interacción
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode,
  });

  // 6) Facade app para UI + IA
  const app = {
    ...core,
    robot,
    IA_Widgets,
    assets: {
      // ✅ FIX: lista robusta (si assetToMeshes vacío, usa assetDB)
      list: () => listAssetsSmart(assetToMeshes, assetDB),
      thumbnail: (assetKey) => off?.thumbnail?.(assetKey) ?? null,
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

    // Si tu sistema original ya llena window.Base64Images, esto solo lo expone.
    async collectAllThumbnails() {
      const items = app.assets.list();

      // Si ya hay fotos capturadas por tu sistema original, no las recalculamos.
      const existing = (typeof window !== 'undefined' && Array.isArray(window.Base64Images))
        ? window.Base64Images
        : Base64Images;

      if (Array.isArray(existing) && existing.length) {
        Base64Images = existing.slice();
        debugLog('collectAllThumbnails: usando Base64Images existente', { count: Base64Images.length });
        return Base64Images;
      }

      // Fallback: si NO existe, intentamos generar con offscreen (si está disponible)
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

  // 8) Click sound opcional
  if (clickAudioDataURL) {
    try {
      installClickSound(clickAudioDataURL);
    } catch (e) {
      debugLog('installClickSound error', String(e));
    }
  }

  // 9) (opcional) prime offscreen thumbnails solo para UI si quieres.
  // No lo hacemos obligatorio porque tú NO quieres depender de esto para IA.
  (async () => {
    try {
      if (!off || typeof off.primeAll !== 'function') return;
      const settle = await waitForAssetMapToSettle(assetToMeshes, 12000, 450);
      debugLog('[Thumbs] settle', settle);

      const keys = Array.from(assetToMeshes.keys());
      await off.primeAll(keys);

      try {
        window.dispatchEvent(new Event('thumbnails_ready'));
      } catch (_) {}
    } catch (e) {
      debugLog('[Thumbs] auto prime error', String(e));
    }
  })();

  // 10) IA opt-in
  if (IA_Widgets) {
    debugLog('[IA] IA_Widgets=true → bootstrap IA (usa capturas existentes primero)');
    bootstrapComponentDescriptions(app, assetToMeshes, assetDB, off);
  } else {
    debugLog('[IA] IA_Widgets=false → sin IA');
  }

  // 11) Expose global
  if (typeof window !== 'undefined') {
    window.URDFViewer = window.URDFViewer || {};
    try {
      window.URDFViewer.__app = app;
    } catch (_) {}
  }

  const destroy = () => {
    try {
      comps.destroy();
    } catch (_) {}
    try {
      tools.destroy();
    } catch (_) {}
    try {
      inter.destroy();
    } catch (_) {}
    try {
      off?.destroy?.();
    } catch (_) {}
    try {
      core.destroy();
    } catch (_) {}
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
          (o.userData.__assetKey || o.userData.assetKey || o.userData.filename)) ||
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

function splitName(key) {
  const clean = String(key || '').split('?')[0].split('#')[0];
  const base = clean.split('/').pop();
  const dot = base.lastIndexOf('.');
  return {
    base: dot >= 0 ? base.slice(0, dot) : base,
    ext: dot >= 0 ? base.slice(dot + 1).toLowerCase() : '',
  };
}

function listAssetsSmart(assetToMeshes, assetDB) {
  // 1) Preferimos el mapa real del URDFLoader si existe
  const items = [];
  try {
    assetToMeshes.forEach((meshes, assetKey) => {
      if (!meshes || meshes.length === 0) return;
      const { base, ext } = splitName(assetKey);
      items.push({ assetKey, base, ext, count: meshes.length });
    });
  } catch (_) {}

  if (items.length) {
    items.sort((a, b) =>
      a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: 'base' }),
    );
    return items;
  }

  // 2) ✅ FIX: si assetToMeshes está vacío, construimos desde meshDB (assetDB)
  const fallback = [];
  const keys = (assetDB && typeof assetDB.keys === 'function') ? assetDB.keys() : [];
  const seenBase = new Set();

  // Nos quedamos con meshes “reales”
  const allowed = new Set(['dae', 'stl', 'step', 'stp']);
  for (const k of keys) {
    const { base, ext } = splitName(k);
    if (!allowed.has(ext)) continue;
    // evita duplicados por base (típicamente base.dae y base.jpg)
    if (seenBase.has(base)) continue;
    seenBase.add(base);
    fallback.push({ assetKey: k, base, ext, count: 0 });
  }

  fallback.sort((a, b) =>
    a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: 'base' }),
  );

  debugLog('[Assets] fallback listAssets (assetToMeshes vacío)', { count: fallback.length });
  return fallback;
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
    const fov = ((cam.fov || 60) * Math.PI) / 180;
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

/* ================= Offscreen thumbnails (opcional) ================= */

// ✅ No cambiamos tu sistema original.
// Pero evitamos que “rompa” IA si no existe.
function safeBuildOffscreenForThumbnails(core, assetToMeshes, theme) {
  try {
    // Si tú tienes una versión real de buildOffscreenForThumbnails en otro archivo,
    // puedes engancharla aquí. Por ahora, no es requerida para IA.
    // Retornamos null para no inventar un sistema de capturas distinto.
    return null;
  } catch (_) {
    return null;
  }
}

/* ================= IA opt-in: describe_component_images ================= */

function bootstrapComponentDescriptions(app, assetToMeshes, assetDB, off) {
  debugLog('[IA] bootstrapComponentDescriptions start');

  const hasColab =
    typeof window !== 'undefined' &&
    window.google &&
    window.google.colab &&
    window.google.colab.kernel &&
    typeof window.google.colab.kernel.invokeFunction === 'function';

  debugLog('[IA] Colab bridge?', hasColab);
  if (!hasColab) return;

  (async () => {
    try {
      // ✅ 1) Esperar las capturas existentes (tu sistema original)
      const existing = await waitForExistingCaptures(12000);

      const items = listAssetsSmart(assetToMeshes, assetDB);
      debugLog('[IA] Componentes a describir', items.length);

      // Si no hay items, aún así podemos mandar solo el ISO si existe
      const entries = [];

      // ISO opcional (si tu sistema lo guarda)
      // Soportamos:
      //  - window.RobotISOBase64 (b64 puro)
      //  - window.__robot_iso_b64__ (b64 puro)
      //  - window.RobotISODataURL (dataURL)
      //  - window.__robot_iso_dataurl__ (dataURL)
      const isoB64 = extractAnyIsoBase64();
      if (isoB64) {
        entries.push({
          key: '__robot_iso__',
          name: 'robot_iso',
          index: -1,
          image_b64: isoB64,
        });
        debugLog('[IA] __robot_iso__ agregado (desde capturas existentes)');
      }

      // ✅ 2) Armar payload desde Base64Images (NO offscreen)
      if (Array.isArray(existing) && existing.length) {
        // Emparejamos por índice con la lista de componentes (si existe).
        // Si hay más fotos que items, truncamos; si hay menos fotos, truncamos items.
        const n = Math.min(existing.length, items.length || existing.length);
        for (let i = 0; i < n; i++) {
          const it = items[i] || { assetKey: `component_${i}`, base: `component_${i}` };
          const b64 = String(existing[i] || '').trim();
          if (!b64) continue;

          entries.push({
            key: it.assetKey,
            name: it.base || it.assetKey,
            index: i,
            image_b64: b64,
          });
        }

        debugLog('[IA] entries desde Base64Images', {
          images: existing.length,
          components: items.length,
          sent: entries.length,
        });
      } else {
        debugLog('[IA] Base64Images vacío → fallback a offscreen');

        // Fallback opcional (solo si existe offscreen REAL)
        if (off && typeof off.thumbnail === 'function' && items.length) {
          let idx = 0;
          for (const it of items) {
            const url = await off.thumbnail(it.assetKey);
            if (!url) continue;
            const b64 = await makeApproxSizedBase64(url, 5);
            if (!b64) continue;
            entries.push({ key: it.assetKey, name: it.base, index: idx, image_b64: b64 });
            idx++;
          }
          debugLog('[IA] entries desde offscreen fallback', entries.length);
        } else {
          debugLog('[IA] Offscreen no disponible; cancelando IA');
          return;
        }
      }

      if (!entries.length) {
        debugLog('[IA] No hay entries para enviar');
        return;
      }

      // ✅ 3) Enviar a Colab (tu python debe llamar tu API GPT y devolver un dict)
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

/* ================= Captures wait / ISO helpers ================= */

async function waitForExistingCaptures(maxWaitMs = 12000) {
  const t0 = performance.now();
  while (performance.now() - t0 < maxWaitMs) {
    const arr =
      (typeof window !== 'undefined' && Array.isArray(window.Base64Images) && window.Base64Images) ||
      (Array.isArray(Base64Images) && Base64Images) ||
      null;

    if (Array.isArray(arr) && arr.length) return arr;

    await new Promise((r) => setTimeout(r, 150));
  }

  return (
    (typeof window !== 'undefined' && Array.isArray(window.Base64Images) && window.Base64Images) ||
    (Array.isArray(Base64Images) && Base64Images) ||
    []
  );
}

function extractAnyIsoBase64() {
  try {
    if (typeof window === 'undefined') return null;

    const b64Direct = window.RobotISOBase64 || window.__robot_iso_b64__;
    if (typeof b64Direct === 'string' && b64Direct.trim()) return b64Direct.trim();

    const dataUrl = window.RobotISODataURL || window.__robot_iso_dataurl__;
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
      const b64 = dataUrl.split(',')[1] || '';
      return b64 || null;
    }
  } catch (_) {}
  return null;
}

/* ====== extractDescMap / parseMaybePythonDict / applyIaDescriptions ===== */

function extractDescMap(res) {
  if (!res) return null;

  let data = res.data ?? res;

  // Caso Colab típico: data['application/json']
  if (
    data &&
    typeof data === 'object' &&
    data['application/json'] &&
    typeof data['application/json'] === 'object'
  ) {
    return data['application/json'];
  }

  // Caso actual: data['text/plain'] = "{'base.dae': '...'}"
  if (data && typeof data === 'object' && typeof data['text/plain'] === 'string') {
    const raw = data['text/plain'].trim();
    const parsed = parseMaybePythonDict(raw);
    if (parsed) return parsed;
  }

  // Si es string plano, intentar parsear igual
  if (typeof data === 'string') {
    const parsed = parseMaybePythonDict(data.trim());
    if (parsed) return parsed;
  }

  // Si ya es objeto razonable, úsalo
  if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    !(Object.keys(data).length === 1 && 'text/plain' in data)
  ) {
    return data;
  }

  // Array de objetos: tomar el primero
  if (Array.isArray(data) && data.length && typeof data[0] === 'object') {
    return data[0];
  }

  return null;
}

function parseMaybePythonDict(raw) {
  if (!raw) return null;
  raw = String(raw).trim();
  if (!raw.startsWith('{') || !raw.endsWith('}')) return null;

  // 1) Intento JSON directo
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') return j;
  } catch (_) {}

  // 2) Intento: reemplazar sintaxis Python -> JS y evaluar de forma controlada
  try {
    let expr = raw;
    expr = expr.replace(/\bNone\b/g, 'null');
    expr = expr.replace(/\bTrue\b/g, 'true');
    expr = expr.replace(/\bFalse\b/g, 'false');

    const obj = new Function('return (' + expr + ')')();
    if (obj && typeof obj === 'object') return obj;
  } catch (_) {}

  // 3) Fallback simple: pares 'k': 'v'
  try {
    const out = {};
    const inner = raw.slice(1, -1);
    const regex = /'([^']+)'\s*:\s*'([^']*)'/g;
    let m;
    while ((m = regex.exec(inner))) {
      const key = m[1];
      let val = m[2] || '';
      val = val.replace(/\\n/g, '\n');
      out[key] = val;
    }
    if (Object.keys(out).length) return out;
  } catch (_) {}

  return null;
}

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
    const orig = app.getComponentDescription ? app.getComponentDescription.bind(app) : null;

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
    try {
      app.emit('ia_descriptions_ready', detail);
    } catch (_) {}
  }

  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ia_descriptions_ready', { detail }));
    }
  } catch (_) {}

  debugLog('[IA] Descripciones IA aplicadas; ia_descriptions_ready emitido', detail);
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

    debugLog('[IA] makeApproxSizedBase64 bytes ~', Math.floor((b64.length * 3) / 4));
    return b64;
  } catch (e) {
    debugLog('[IA] makeApproxSizedBase64 error', String(e));
    return null;
  }
}

/* ================= Click sound + global hook ================= */

function installClickSound(dataURL) {
  if (!dataURL || typeof dataURL !== 'string') return;

  let ctx = null;
  let buf = null;

  async function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!buf) {
      const resp = await fetch(dataURL);
      const arr = await resp.arrayBuffer();
      buf = await ctx.decodeAudioData(arr);
    }
  }

  function play() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
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
