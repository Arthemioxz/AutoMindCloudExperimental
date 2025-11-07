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

  // 2) Asset DB + loadMeshCb with onMeshTag hook
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map(); // assetKey -> Mesh[]
  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      // Index meshes for this assetKey
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse((o) => {
        if (o && o.isMesh && o.geometry) list.push(o);
      });
      assetToMeshes.set(assetKey, list);

      // Tag meshes so offscreen clone can map them
      obj.traverse(o => {
        if (o && o.isMesh && o.geometry) {
          o.userData = o.userData || {};
          if (!o.userData.__assetKey) o.userData.__assetKey = assetKey;
        }
      });
    }
  });

  // 3) Load URDF
  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // 4) Offscreen thumbnails (sistema antiguo bueno)
  const off = buildOffscreenForThumbnails(core, assetToMeshes);

  // 5) Interaction
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode
  });

  // 6) App facade
  const app = {
    ...core,
    robot,

    assets: {
      list: () => listAssets(assetToMeshes),
      thumbnail: (assetKey) => off?.thumbnail(assetKey)
    },

    componentDescriptions: {},
    getComponentDescription(assetKey) {
      return this.componentDescriptions?.[assetKey] || null;
    },

    isolate: {
      asset: (assetKey) => isolateAsset(core, assetToMeshes, assetKey),
      clear: () => showAll(core)
    },

    showAll: () => showAll(core),

    openTools(open = true) {
      tools.set(!!open);
    }
  };

  // 7) UI
  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);

  // 8) IA: thumbnails + batch -> Colab -> descriptions map
  bootstrapComponentDescriptions(app, off);

  // Optional SFX
  if (clickAudioDataURL) {
    try { installClickSound(clickAudioDataURL); } catch (_) {}
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

/* ---------------------------- Helpers ---------------------------- */

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
      sensitivity: 'base'
    })
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
    core.robot.traverse(o => {
      if (o.isMesh && o.geometry) o.visible = false;
    });
  }
  meshes.forEach(m => { m.visible = true; });
  frameMeshes(core, meshes);
}

function showAll(core) {
  if (core.robot) {
    core.robot.traverse(o => {
      if (o.isMesh && o.geometry) o.visible = true;
    });
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
    if (!has) { box.copy(tmp); has = true; }
    else box.union(tmp);
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
      center.clone().add(new THREE.Vector3(maxDim, maxDim * 0.9, maxDim))
    );
  }

  ctrl.target.copy(center);
  ctrl.update();
}

/* --------------------- Offscreen thumbnails --------------------- */

function buildOffscreenForThumbnails(core, assetToMeshes) {
  if (!core.robot) return null;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const OFF_W = 640;
  const OFF_H = 480;
  const canvas = document.createElement('canvas');
  canvas.width = OFF_W;
  canvas.height = OFF_H;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true
  });
  renderer.setSize(OFF_W, OFF_H, false);

  if (core?.renderer) {
    renderer.physicallyCorrectLights =
      core.renderer.physicallyCorrectLights ?? true;
    renderer.toneMapping = core.renderer.toneMapping;
    renderer.toneMappingExposure =
      core.renderer.toneMappingExposure ?? 1.0;
    if ('outputColorSpace' in renderer) {
      renderer.outputColorSpace =
        core.renderer.outputColorSpace ?? THREE.SRGBColorSpace;
    } else {
      renderer.outputEncoding =
        core.renderer.outputEncoding ?? THREE.sRGBEncoding;
    }
    renderer.shadowMap.enabled =
      core.renderer.shadowMap?.enabled ?? false;
    renderer.shadowMap.type =
      core.renderer.shadowMap?.type ?? THREE.PCFSoftShadowMap;
  }

  const scene = new THREE.Scene();
  scene.background = core?.scene?.background ?? new THREE.Color(0xffffff);
  scene.environment = core?.scene?.environment ?? null;

  const amb = new THREE.AmbientLight(0xffffff, 0.95);
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(2.5, 2.5, 2.5);
  scene.add(amb, dir);

  const camera = new THREE.PerspectiveCamera(60, OFF_W / OFF_H, 0.01, 10000);

  const robotClone = core.robot.clone(true);
  scene.add(robotClone);

  robotClone.traverse(o => {
    if (o.isMesh && o.material) {
      if (Array.isArray(o.material)) {
        o.material = o.material.map(m => m.clone());
      } else {
        o.material = o.material.clone();
      }
      o.material.needsUpdate = true;
      o.castShadow = renderer.shadowMap.enabled;
      o.receiveShadow = renderer.shadowMap.enabled;
    }
  });

  const cloneAssetToMeshes = new Map();
  robotClone.traverse(o => {
    const k = o?.userData?.__assetKey;
    if (k && o.isMesh && o.geometry) {
      const arr = cloneAssetToMeshes.get(k) || [];
      arr.push(o);
      cloneAssetToMeshes.set(k, arr);
    }
  });

  const ready = (async () => {
    await sleep(1000);
    await new Promise(r =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    );
    renderer.render(scene, camera);
  })();

  function snapshotAsset(assetKey) {
    const meshes = cloneAssetToMeshes.get(assetKey) || [];
    if (!meshes.length) return null;

    const vis = [];
    robotClone.traverse(o => {
      if (o.isMesh && o.geometry) {
        vis.push([o, o.visible]);
        o.visible = false;
      }
    });
    meshes.forEach(m => { m.visible = true; });

    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let has = false;
    meshes.forEach(m => {
      tmp.setFromObject(m);
      if (!has) { box.copy(tmp); has = true; }
      else box.union(tmp);
    });
    if (!has) {
      vis.forEach(([o, v]) => { o.visible = v; });
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
    const el = Math.PI * 0.18;
    const dirV = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).multiplyScalar(dist);

    camera.position.copy(center.clone().add(dirV));
    camera.lookAt(center);

    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');

    vis.forEach(([o, v]) => { o.visible = v; });

    return url;
  }

  return {
    thumbnail: async (assetKey) => {
      try {
        await ready;
        await sleep(150);
        return snapshotAsset(assetKey);
      } catch (_) {
        return null;
      }
    },
    destroy: () => {
      try { renderer.dispose(); } catch (_) {}
      try { scene.clear(); } catch (_) {}
    }
  };
}

/* ----------------- Bootstrap IA descriptions ----------------- */

function bootstrapComponentDescriptions(app, off) {
  if (!off || !app?.assets?.list) {
    console.debug('[Components] IA bootstrap omitido: falta offscreen o assets.');
    return;
  }

  const invoke =
    window.google?.colab?.kernel?.invokeFunction ||
    window.parent?.google?.colab?.kernel?.invokeFunction;

  if (!invoke) {
    console.debug('[Components] No Colab kernel disponible; sin IA.');
    return;
  }

  (async () => {
    try {
      const assets = app.assets.list();
      if (!assets || !assets.length) {
        console.debug('[Components] Sin assets para describir.');
        return;
      }

      console.debug('[Components] Generando thumbnails para', assets.length, 'componentes...');
      const entries = [];
      for (const a of assets) {
        const url = await off.thumbnail(a.assetKey);
        if (!url || typeof url !== 'string') continue;
        const comma = url.indexOf(',');
        const b64 = comma >= 0 ? url.slice(comma + 1) : url;
        if (!b64) continue;
        entries.push({ key: a.assetKey, image_b64: b64 });
      }

      if (!entries.length) {
        console.debug('[Components] No se generaron capturas para IA.');
        return;
      }

      console.debug('[Components] Enviando', entries.length, 'capturas a Colab describe_component_images...');
      const res = await invoke('describe_component_images', [entries], {});
      const descMap = extractDescMap(res);

      if (descMap && Object.keys(descMap).length) {
        app.componentDescriptions = descMap;
        console.debug('[Components] Descripciones IA cargadas:', Object.keys(descMap).length);
      } else {
        console.warn('[Components] Respuesta sin descripciones utilizables.', res);
      }
    } catch (err) {
      console.error('[Components] Error al obtener descripciones IA:', err);
    }
  })();
}

function extractDescMap(res) {
  console.debug('[Components] Callback result bruto:', res);
  if (!res || typeof res !== 'object') return null;

  // En Colab normalmente viene como { data: { ... } }
  let data = res.data || res;

  // Caso 1: ya parece un mapa key->string (sin application/json/text/plain)
  if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data)
  ) {
    const keys = Object.keys(data);
    const hasMimeKeys = keys.some(
      (k) => k === 'application/json' || k === 'text/plain'
    );
    if (!hasMimeKeys && keys.length) {
      const looksMap = keys.every((k) => {
        const v = data[k];
        return (
          typeof v === 'string' ||
          typeof v === 'number'
        );
      });
      if (looksMap) {
        console.debug('[Components] Interpretando respuesta como dict directo.');
        return data;
      }
    }
  }

  // Caso 2: viene envuelto en mime-types
  let raw = data['application/json'] ?? data['text/plain'] ?? null;
  if (!raw) {
    return null;
  }

  // Si ya es objeto
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    console.debug('[Components] Usando objeto application/json directo.');
    return raw;
  }

  if (typeof raw !== 'string') return null;

  raw = raw.trim();

  // Intento JSON puro
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      console.debug('[Components] JSON válido parseado desde respuesta.');
      return parsed;
    }
  } catch (_) {
    // ignore
  }

  // Intento diccionario estilo Python: {'a': 'b', ...}
  try {
    const candidate = raw
      // claves no entrecomilladas → "clave":
      .replace(/([{,]\s*)([A-Za-z0-9_./-]+)\s*:/g, '$1"$2":')
      // comillas simples → dobles
      .replace(/'/g, '"');
    const parsed2 = JSON.parse(candidate);
    if (parsed2 && typeof parsed2 === 'object' && !Array.isArray(parsed2)) {
      console.debug('[Components] Diccionario estilo Python parseado correctamente.');
      return parsed2;
    }
  } catch (_) {
    // ignore
  }

  console.warn('[Components] No se pudo interpretar la respuesta como mapa de descripciones.');
  return null;
}

/* ------------------------- Click Sound ------------------------- */

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

/* --------------------- Global UMD-style hook -------------------- */

if (typeof window !== 'undefined') {
  window.URDFViewer = { render };
}
