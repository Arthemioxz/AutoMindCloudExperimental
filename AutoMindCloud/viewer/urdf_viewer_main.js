// /viewer/urdf_viewer_main.js
// Entrypoint: ViewerCore + AssetDB + Selection & Drag + UI (Tools & Components)
// - Thumbnails de componentes:
//     * usando renderer offscreen que clona el robot con materiales reales
//     * muestra SOLO el componente (todas sus instancias) aislado, sin el robot entero
//     * iso view, sin imágenes negras
// - IA_Widgets (opt-in):
//     * si true, envía thumbnails comprimidos a Colab (describe_component_images)
//     * si false, no se hace ninguna llamada ni callback

/* global THREE */

import { THEME } from './Theme.js';
import { createViewer } from './core/ViewerCore.js';
import { buildAssetDB, createLoadMeshCb } from './core/AssetDB.js';
import { attachInteraction } from './interaction/SelectionAndDrag.js';
import { createToolsDock } from './ui/ToolsDock.js';
import { createComponentsPanel } from './ui/ComponentsPanel.js';

export let Base64Images = []; // para compatibilidad: guarda PNG base64 (sin header)

/**
 * Public entry.
 */
export function render(opts = {}) {
  const {
    container,
    urdfContent = '',
    meshDB = {},
    selectMode = 'link',
    background = THEME.bgCanvas || 0xffffff,
    clickAudioDataURL = null,
    IA_Widgets = false,          // ✅ opt-in IA
  } = opts;

  // 1) Core viewer
  const core = createViewer({ container, background });

  // 2) Asset DB + onMeshTag para indexar meshes
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map(); // assetKey -> Mesh[]

  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse((o) => {
        if (o && o.isMesh && o.geometry) list.push(o);
      });
      assetToMeshes.set(assetKey, list);

      // tag para reconstruir luego en clones
      obj.traverse((o) => {
        if (o && o.isMesh) {
          o.userData = o.userData || {};
          o.userData.__assetKey = assetKey;
        }
      });
    }
  });

  // 3) Load URDF
  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // fallback si no se llenó assetToMeshes
  if (robot && !assetToMeshes.size) {
    rebuildAssetMapFromRobot(robot, assetToMeshes);
  }

  // 4) Offscreen thumbnails (usa lógica probada del script viejo)
  const off = buildOffscreenForThumbnails(core);

  // 5) Interacción
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode
  });

  // 6) Facade app (para ToolsDock / ComponentsPanel)
  const app = {
    ...core,
    robot,
    IA_Widgets,

    // lista + thumbnail por assetKey
    assets: {
      list: () => listAssets(assetToMeshes),
      thumbnail: (assetKey) => off?.thumbnail(assetKey)
    },

    isolate: {
      asset: (assetKey) => isolateAsset(core, assetToMeshes, assetKey),
      clear: () => showAll(core)
    },

    showAll: () => showAll(core),

    openTools(open = true) { tools.set(!!open); },

    // IA: descripciones por asset
    componentDescriptions: {},
    getComponentDescription(assetKey, index) {
      const src = app.componentDescriptions;
      if (!src) return '';

      if (!Array.isArray(src) && typeof src === 'object') {
        if (src[assetKey]) return src[assetKey];
        const base = (assetKey || '').split('/').pop().split('.')[0];
        if (src[base]) return src[base];
      }

      if (Array.isArray(src) && typeof index === 'number') {
        return src[index] || '';
      }

      return '';
    },

    // compat: recolectar thumbnails en Base64Images
    collectAllThumbnails: async () => {
      const items = app.assets.list();
      Base64Images.length = 0;
      for (const it of items) {
        try {
          const url = await app.assets.thumbnail(it.assetKey);
          if (!url || typeof url !== 'string') continue;
          const base64 = url.split(',')[1] || '';
          if (base64) Base64Images.push(base64);
        } catch (_) {}
      }
      if (typeof window !== 'undefined') window.Base64Images = Base64Images;
      return Base64Images;
    }
  };

  // 7) UI
  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);

  // 8) Click SFX opcional
  if (clickAudioDataURL) {
    try { installClickSound(clickAudioDataURL); } catch (_) {}
  }

  // 9) IA (solo si IA_Widgets = true)
  if (IA_Widgets) {
    bootstrapComponentDescriptions(app, assetToMeshes, off);
  }

  // 10) Exponer en window
  if (typeof window !== 'undefined') {
    window.URDFViewer = window.URDFViewer || {};
    try { window.URDFViewer.__app = app; } catch (_) {}
  }

  // destroy
  const destroy = () => {
    try { comps.destroy(); } catch (_) {}
    try { tools.destroy(); } catch (_) {}
    try { inter.destroy(); } catch (_) {}
    try { off?.destroy?.(); } catch (_) {}
    try { core.destroy(); } catch (_) {}
  };

  return { ...app, destroy };
}

/* =========================== Helpers =========================== */

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

function listAssets(assetToMeshes) {
  const items = [];
  assetToMeshes.forEach((meshes, assetKey) => {
    if (!meshes || meshes.length === 0) return;
    const { base, ext } = splitName(assetKey);
    items.push({ assetKey, base, ext, count: meshes.length });
  });
  items.sort((a, b) =>
    a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: 'base' })
  );
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
  if (core.robot) {
    core.robot.traverse(o => { if (o.isMesh && o.geometry) o.visible = false; });
  }
  meshes.forEach(m => { m.visible = true; });
  frameMeshes(core, meshes);
}

function showAll(core) {
  if (!core.robot) return;
  core.robot.traverse(o => { if (o.isMesh && o.geometry) o.visible = true; });
  if (core.fitAndCenter) core.fitAndCenter(core.robot, 1.06);
}

function frameMeshes(core, meshes) {
  if (!meshes || meshes.length === 0) return;
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let has = false;
  meshes.forEach(m => {
    if (!m) return;
    tmp.setFromObject(m);
    if (!has) { box.copy(tmp); has = True; } else box.union(tmp);
  });
  if (!has) return;
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
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
    cam.left = -maxDim; cam.right = maxDim;
    cam.top = maxDim;   cam.bottom = -maxDim;
    cam.near = Math.max(maxDim / 1000, 0.001);
    cam.far = Math.max(maxDim * 1500, 1500);
    cam.updateProjectionMatrix();
    cam.position.copy(center.clone().add(new THREE.Vector3(maxDim, maxDim * 0.9, maxDim)));
  }

  if (ctrl) {
    ctrl.target.copy(center);
    ctrl.update();
  }
}

/* ================= Offscreen thumbnails (script viejo) ================= */

function buildOffscreenForThumbnails(core) {
  if (!core.robot) return null;

  const OFF_W = 640, OFF_H = 480;
  const canvas = document.createElement('canvas');
  canvas.width = OFF_W;
  canvas.height = OFF_H;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true
  });
  renderer.setSize(OFF_W, OFF_H, false);

  // Copiar config del renderer principal (clave para evitar negros raros)
  if (core.renderer) {
    renderer.physicallyCorrectLights = core.renderer.physicallyCorrectLights ?? true;
    renderer.toneMapping = core.renderer.toneMapping;
    renderer.toneMappingExposure = core.renderer.toneMappingExposure ?? 1.0;
    if ('outputColorSpace' in renderer) {
      renderer.outputColorSpace = core.renderer.outputColorSpace ?? THREE.SRGBColorSpace;
    } else {
      renderer.outputEncoding = core.renderer.outputEncoding ?? THREE.sRGBEncoding;
    }
    renderer.shadowMap.enabled = core.renderer.shadowMap?.enabled ?? false;
    renderer.shadowMap.type = core.renderer.shadowMap?.type ?? THREE.PCFSoftShadowMap;
  }

  const baseScene = new THREE.Scene();
  baseScene.background = core.scene?.background ?? new THREE.Color(0xffffff);
  baseScene.environment = core.scene?.environment ?? null;

  const amb = new THREE.AmbientLight(0xffffff, 0.95);
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(2.5, 2.5, 2.5);
  baseScene.add(amb, dir);

  const camera = new THREE.PerspectiveCamera(60, OFF_W / OFF_H, 0.01, 10000);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const ready = (async () => {
    await sleep(400);
    renderer.render(baseScene, camera);
  })();

  function buildCloneAndMap() {
    const scene = baseScene.clone();
    scene.background = baseScene.background;
    scene.environment = baseScene.environment;

    const robotClone = core.robot.clone(true);
    scene.add(robotClone);

    // Clonar materiales
    robotClone.traverse(o => {
      if (o.isMesh && o.material) {
        if (Array.isArray(o.material)) {
          o.material = o.material.map(m => m.clone());
        } else {
          o.material = o.material.clone();
        }
        o.material.needsUpdate = true;
      }
    });

    // Re-armar mapping a partir de __assetKey
    const cloneMap = new Map();
    robotClone.traverse(o => {
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
    if (!meshes.length) return null;

    // Ocultar todo menos ese assetKey
    const vis = [];
    robotClone.traverse(o => {
      if (o.isMesh && o.geometry) {
        vis.push([o, o.visible]);
        o.visible = false;
      }
    });
    meshes.forEach(m => { m.visible = true; });

    // Box del componente aislado (todas sus instancias)
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let has = false;
    meshes.forEach(m => {
      tmp.setFromObject(m);
      if (!has) { box.copy(tmp); has = true; } else box.union(tmp);
    });
    if (!has) return null;

    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist   = maxDim * 2.0;

    camera.near = Math.max(maxDim / 1000, 0.001);
    camera.far  = Math.max(maxDim * 1000, 1000);
    camera.updateProjectionMatrix();

    // Iso view
    const az = Math.PI * 0.25;
    const el = Math.PI * 0.20;
    const dirV = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).multiplyScalar(dist);
    camera.position.copy(center.clone().add(dirV));
    camera.lookAt(center);

    renderer.render(scene, camera);

    const url = canvas.toDataURL('image/png');
    const base64 = url.split(',')[1] || '';
    if (base64) {
      Base64Images.push(base64);
      if (typeof window !== 'undefined') window.Base64Images = Base64Images;
    }

    // Restaurar (no esencial: clone se descarta)
    for (const [o, v] of vis) o.visible = v;

    return url;
  }

  return {
    thumbnail: async (assetKey) => {
      try {
        await ready;
        return snapshotAsset(assetKey);
      } catch {
        return null;
      }
    },
    destroy: () => {
      try { renderer.dispose(); } catch (_) {}
      try { baseScene.clear(); } catch (_) {}
    }
  };
}

/* =================== IA opt-in: describe_component_images =================== */

function bootstrapComponentDescriptions(app, assetToMeshes, off) {
  const hasColab =
    typeof window !== 'undefined' &&
    window.google &&
    window.google.colab &&
    window.google.colab.kernel &&
    typeof window.google.colab.kernel.invokeFunction === 'function';

  if (!hasColab) {
    console.debug('[Components] Colab bridge no disponible; IA deshabilitada.');
    return;
  }

  const items = listAssets(assetToMeshes);
  if (!items.length) return;

  (async () => {
    const entries = [];
    for (const ent of items) {
      try {
        const url = await off.thumbnail(ent.assetKey);
        if (!url) continue;
        const b64 = await makeApproxSizedBase64(url, 5);
        if (!b64) continue;
        entries.push({ key: ent.assetKey, image_b64: b64 });
      } catch (e) {
        console.warn('[Components] Error generando thumb IA', ent.assetKey, e);
      }
    }

    if (!entries.length) return;

    try {
      const res = await window.google.colab.kernel.invokeFunction(
        'describe_component_images',
        [entries],
        {}
      );
      const map = extractDescMap(res);
      if (map && typeof map === 'object') {
        app.componentDescriptions = map;
        if (typeof window !== 'undefined') {
          window.COMPONENT_DESCRIPTIONS = map;
        }
      }
    } catch (err) {
      console.error('[Components] Error invokeFunction IA:', err);
    }
  })();
}

function extractDescMap(res) {
  if (!res) return {};
  const data = res.data || res;
  if (data['application/json'] && typeof data['application/json'] === 'object') {
    return data['application/json'];
  }
  if (Array.isArray(data) && data.length && typeof data[0] === 'object') {
    return data[0];
  }
  if (typeof data === 'object') return data;
  return {};
}

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
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(u);

    let best = '';
    let q = 0.92;
    for (let i = 0; i < 8; i++) {
      const out = canvas.toDataURL('image/jpeg', Math.max(0.4, Math.min(0.96, q)));
      const b64 = out.split(',')[1] || '';
      if (!b64) break;
      best = b64;
      const bytes = Math.floor((b64.length * 3) / 4);
      if (bytes <= maxBytes) break;
      q *= 0.7;
    }
    return best || null;
  } catch (e) {
    console.warn('[makeApproxSizedBase64] Error', e);
    return null;
  }
}

/* ================= Click sound + hook global ================= */

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
  window.__urdf_click__ = play;
}

if (typeof window !== 'undefined') {
  window.URDFViewer = window.URDFViewer || {};
  window.URDFViewer.render = (opts) => {
    const app = render(opts);
    try { window.URDFViewer.__app = app; } catch (_) {}
    return app;
  };
}
