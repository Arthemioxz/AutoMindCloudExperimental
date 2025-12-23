// /viewer/urdf_viewer_main.js
// ✅ “thumbalist con texturas” (como el sistema antiguo: TODO base64/dataURL, sin blobs)
// - Thumbnails NO usan robotClone para componentes.
// - Para cada thumbnail:
//    1) ColladaLoader carga el .dae del componente
//    2) LoadingManager.setURLModifier reescribe URLs internas (texturas) via assetDB.resolveURL(...)
//    3) Espera REAL a que terminen texturas (manager.onLoad)
//    4) Render a RenderTarget -> PNG dataURL
//
// Requisitos (igual que el sistema antiguo URDF_Render_Script.py):
// - meshDB trae base64 de .dae + .png/.jpg/... y AssetDB.resolveURL retorna "data:...;base64,...."
// - AssetDB.js expone: buildAssetDB + createLoadMeshCb + resolveURL (opcional dispose)
//
// IMPORTANTE: Precompute thumbnails al iniciar (no al presionar "c") ✅

import { THEME } from './Theme.js';
import * as ViewerCore from './core/ViewerCore.js';
const createViewer =
  ViewerCore.createViewer ||
  ViewerCore.default ||
  (typeof window !== 'undefined' ? window.createViewer : null);
if (createViewer == null) {
  throw new Error(
    'ViewerCore: createViewer no encontrado. Revisa core/ViewerCore.js (export) o window.createViewer (UMD).',
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

/* Wait until URDF meshes stop arriving (assetToMeshes settles). */
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

  // 1) Core viewer
  const _createViewer =
    (ViewerCore && (ViewerCore.createViewer || (ViewerCore.default && ViewerCore.default.createViewer))) ||
    window.createViewer;
  if (typeof _createViewer !== 'function')
    throw new Error('[urdf_viewer_main] createViewer not found (ESM export or UMD global).');
  const core = _createViewer({ container, background });

  // 2) Asset DB (base64/dataURL)
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

  // 3) Load URDF
  const robot = core.loadURDF(urdfContent, { loadMeshCb });
  debugLog('Robot loaded', { hasRobot: !!robot });

  if (robot && !assetToMeshes.size) {
    debugLog('assetToMeshes vacío, reconstruyendo desde userData');
    rebuildAssetMapFromRobot(robot, assetToMeshes);
  }
  debugLog('assetToMeshes keys', Array.from(assetToMeshes.keys()));

  // 4) Offscreen thumbnails (DAE + textures fully loaded BEFORE photo)
  const off = buildOffscreenForThumbnails(core, assetDB, assetToMeshes);
  if (!off) debugLog('Offscreen thumbnails no disponible (no robot)');

  // 5) Interaction
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode,
  });

  // 6) Facade app for UI + IA
  const app = {
    ...core,
    robot,
    IA_Widgets,
    assets: {
      list: () => listAssets(assetToMeshes),
      thumbnail: (assetKey) => off?.thumbnail(assetKey),
      iso: () => off?.iso?.(),
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

      if (Array.isArray(src) && typeof index === 'number') return src[index] || '';
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

      if (typeof window !== 'undefined') window.Base64Images = Base64Images;
      debugLog('collectAllThumbnails done', { count: Base64Images.length });
      return Base64Images;
    },
  };

  // 7) UI
  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);

  // 8) Click sound (optional)
  if (clickAudioDataURL) {
    try {
      installClickSound(clickAudioDataURL);
    } catch (e) {
      debugLog('installClickSound error', String(e));
    }
  }

  // 9) ✅ Precompute thumbnails AT STARTUP (not on "c")
  (async () => {
    try {
      if (!off || typeof off.primeAll !== 'function') return;

      // wait a bit for assetToMeshes to stabilize
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
    debugLog('[IA] IA_Widgets=true → bootstrap IA');
    bootstrapComponentDescriptions(app, assetToMeshes, off);
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
      assetDB?.dispose?.();
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
      const k = (o.userData && (o.userData.__assetKey || o.userData.assetKey || o.userData.filename)) || null;
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
    } else box.union(tmp);
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
    cam.position.copy(center.clone().add(new THREE.Vector3(maxDim, maxDim * 0.9, maxDim)));
  }

  if (ctrl) {
    ctrl.target.copy(center);
    ctrl.update();
  }
}

/* ============= Offscreen thumbnails: CARGA DAE + TEXTURAS ANTES ============= */

function buildOffscreenForThumbnails(core, assetDB, assetToMeshes) {
  const OFF_W = 320;
  const OFF_H = 320;
  const BG = 0xf2f2f2;

  const thumbCache = new Map(); // assetKey -> dataURL
  let isoCache = null;

  let closed = false;
  let session = null;
  let priming = null;

  // serialize GPU work
  let chain = Promise.resolve();
  const enqueue = (fn) => {
    chain = chain.then(fn, fn);
    return chain;
  };

  function destroySession() {
    if (!session) return;
    try {
      session.rt?.dispose?.();
    } catch (_) {}
    try {
      session.scene?.clear?.();
    } catch (_) {}
    session = null;
    closed = true;
  }

  function pauseLoop(on) {
    try {
      if (core && typeof core.setPaused === 'function') core.setPaused(!!on);
    } catch (_) {}
  }

  async function ensureSession() {
    if (closed) return null;
    if (session) return session;
    if (!core || !core.renderer || typeof THREE === 'undefined') return null;

    const rt = new THREE.WebGLRenderTarget(OFF_W, OFF_H, {
      depthBuffer: true,
      stencilBuffer: false,
    });

    const canvas2d = document.createElement('canvas');
    canvas2d.width = OFF_W;
    canvas2d.height = OFF_H;
    const ctx2d = canvas2d.getContext('2d', { willReadFrequently: true });

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);

    const amb = new THREE.AmbientLight(0xffffff, 0.95);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 5, 4);
    scene.add(amb, dir);

    const camera = new THREE.PerspectiveCamera(40, OFF_W / OFF_H, 0.001, 2000);

    session = {
      renderer: core.renderer,
      rt,
      canvas2d,
      ctx2d,
      scene,
      camera,
      _tmpBox: new THREE.Box3(),
      _box: new THREE.Box3(),
      _center: new THREE.Vector3(),
      _size: new THREE.Vector3(),
      _loadedRoot: null,
      _loadedKey: null,
    };

    debugLog('[Thumbs] Offscreen session created (shared renderer; no extra WebGL context)');
    return session;
  }

  function cleanupLoaded(ses) {
    if (!ses) return;
    if (ses._loadedRoot) {
      try {
        ses.scene.remove(ses._loadedRoot);
      } catch (_) {}
      ses._loadedRoot = null;
      ses._loadedKey = null;
    }
  }

  function makeManagerForDAE(assetKey) {
    const mgr = new THREE.LoadingManager();

    // ✅ magia: reescribe URLs internas del DAE a dataURL base64 desde meshDB
    mgr.setURLModifier((url) => {
      try {
        const out = assetDB?.resolveURL?.(url, assetKey);
        return out || url;
      } catch (_) {
        return url;
      }
    });

    return mgr;
  }

  function setMaterialVisibilityFix(root) {
    root?.traverse?.((n) => {
      if (!n || !n.isMesh) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      mats.forEach((m) => {
        if (!m) return;
        m.side = THREE.DoubleSide;
        if (m.opacity !== undefined && m.opacity <= 0) m.opacity = 1;
        m.depthWrite = true;
        m.depthTest = true;
        m.needsUpdate = true;
      });
      n.castShadow = false;
      n.receiveShadow = false;
    });
  }

  // ✅ Espera ColladaLoader + mgr.onLoad (texturas listas)
  async function loadDAEWithTextures(assetKey) {
    // DAE también viene como dataURL base64
    const daeURL = assetDB?.resolveURL?.(assetKey, null) || assetKey;

    return new Promise((resolve, reject) => {
      if (!THREE || !THREE.ColladaLoader) {
        reject(new Error('THREE.ColladaLoader no está disponible (¿cargaste 19ColladaLoader.js?)'));
        return;
      }

      const mgr = makeManagerForDAE(assetKey);
      const loader = new THREE.ColladaLoader(mgr);

      let root = null;
      let sceneReady = false;
      let managerDone = false;
      let finished = false;

      const TIMEOUT_MS = 15000;
      const t0 = performance.now();

      function maybeFinish() {
        if (finished) return;
        if (sceneReady && managerDone && root) {
          finished = true;
          // 1 frame extra para asegurar sampleo de texturas
          requestAnimationFrame(() => resolve(root));
        }
      }

      const timer = setInterval(() => {
        if (finished) {
          clearInterval(timer);
          return;
        }
        const dt = performance.now() - t0;
        if (dt >= TIMEOUT_MS) {
          clearInterval(timer);
          if (root) {
            debugLog('[Thumbs] loadDAEWithTextures timeout, devolviendo root igual', assetKey);
            finished = true;
            requestAnimationFrame(() => resolve(root));
            return;
          }
          finished = true;
          reject(new Error('Timeout cargando DAE/texturas: ' + assetKey));
        }
      }, 250);

      mgr.onLoad = () => {
        managerDone = true;
        maybeFinish();
      };

      loader.load(
        daeURL,
        (collada) => {
          root = collada?.scene || collada;
          if (!root) {
            clearInterval(timer);
            if (!finished) {
              finished = true;
              reject(new Error('ColladaLoader devolvió scene nula'));
            }
            return;
          }

          setMaterialVisibilityFix(root);
          sceneReady = true;
          maybeFinish();
        },
        undefined,
        (err) => {
          clearInterval(timer);
          if (finished) return;
          finished = true;
          reject(err || new Error('ColladaLoader error'));
        },
      );
    });
  }

  function computeVisibleBoxFromObject(ses, obj) {
    try {
      obj.updateWorldMatrix(true, true);
    } catch (_) {}

    const box = ses._box;
    box.makeEmpty();

    const tmp = ses._tmpBox;
    let has = false;

    obj.traverse((n) => {
      if (!n || !n.isMesh || !n.visible) return;
      tmp.setFromObject(n);
      if (tmp.isEmpty()) return;
      if (!has) {
        box.copy(tmp);
        has = true;
      } else box.union(tmp);
    });

    if (has) return box;

    tmp.setFromObject(obj);
    return tmp;
  }

  function fitCameraIso(ses, box) {
    const center = ses._center;
    const size = ses._size;
    box.getCenter(center);
    box.getSize(size);

    let maxDim = Math.max(size.x, size.y, size.z);
    if (!isFinite(maxDim) || maxDim <= 1e-6) maxDim = 1;

    const dir = new THREE.Vector3(1, 0.8, 1).normalize();
    const fov = (ses.camera.fov * Math.PI) / 180;
    const dist = (maxDim / Math.tan(Math.max(1e-6, fov / 2))) * 0.55;

    ses.camera.position.copy(center).addScaledVector(dir, dist);
    ses.camera.near = Math.max(0.001, dist / 100);
    ses.camera.far = dist * 200;
    ses.camera.updateProjectionMatrix();
    ses.camera.lookAt(center);
  }

  function renderToDataURL(ses) {
    const r = ses.renderer;

    const prevRT = r.getRenderTarget();
    const prevVp = r.getViewport(new THREE.Vector4());
    const prevSc = r.getScissor(new THREE.Vector4());
    const prevScTest = r.getScissorTest();
    const prevClearAlpha = r.getClearAlpha();
    const prevClearColor = r.getClearColor(new THREE.Color());

    try {
      r.setRenderTarget(ses.rt);
      r.setViewport(0, 0, OFF_W, OFF_H);
      r.setScissor(0, 0, OFF_W, OFF_H);
      r.setScissorTest(false);
      r.setClearColor(BG, 1);
      r.clear(true, true, true);
      r.render(ses.scene, ses.camera);

      const pixels = new Uint8Array(OFF_W * OFF_H * 4);
      r.readRenderTargetPixels(ses.rt, 0, 0, OFF_W, OFF_H, pixels);

      const ctx = ses.ctx2d;
      const img = ctx.createImageData(OFF_W, OFF_H);
      for (let y = 0; y < OFF_H; y++) {
        const src = (OFF_H - 1 - y) * OFF_W * 4;
        const dst = y * OFF_W * 4;
        img.data.set(pixels.subarray(src, src + OFF_W * 4), dst);
      }
      ctx.putImageData(img, 0, 0);
      return ses.canvas2d.toDataURL('image/png');
    } catch (e) {
      debugLog('[Thumbs] renderToDataURL failed', e);
      return null;
    } finally {
      r.setRenderTarget(prevRT);
      r.setViewport(prevVp.x, prevVp.y, prevVp.z, prevVp.w);
      r.setScissor(prevSc.x, prevSc.y, prevSc.z, prevSc.w);
      r.setScissorTest(prevScTest);
      r.setClearColor(prevClearColor, prevClearAlpha);
    }
  }

  async function ensureLoadedForKey(ses, assetKey) {
    if (ses._loadedKey === assetKey && ses._loadedRoot) return ses._loadedRoot;

    cleanupLoaded(ses);

    const root = await loadDAEWithTextures(assetKey);
    ses._loadedRoot = root;
    ses._loadedKey = assetKey;
    ses.scene.add(root);

    return root;
  }

  async function _thumbNoPrime(assetKey) {
    if (!assetKey) return null;
    if (thumbCache.has(assetKey)) return thumbCache.get(assetKey);

    const ses = await ensureSession();
    if (!ses) return null;

    return enqueue(async () => {
      if (thumbCache.has(assetKey)) return thumbCache.get(assetKey);

      pauseLoop(true);
      try {
        const root = await ensureLoadedForKey(ses, assetKey);

        const box = computeVisibleBoxFromObject(ses, root);
        fitCameraIso(ses, box);

        // frame extra
        await new Promise((res) => requestAnimationFrame(res));

        const url = renderToDataURL(ses);
        if (url) thumbCache.set(assetKey, url);
        return url;
      } catch (e) {
        debugLog('[Thumbs] thumb error', assetKey, String(e));
        return null;
      } finally {
        pauseLoop(false);
      }
    });
  }

  async function _isoNoPrime() {
    if (isoCache) return isoCache;

    const ses = await ensureSession();
    if (!ses) return null;

    return enqueue(async () => {
      pauseLoop(true);
      try {
        if (isoCache) return isoCache;

        cleanupLoaded(ses);

        const clone = core.robot ? core.robot.clone(true) : null;
        if (!clone) return null;

        setMaterialVisibilityFix(clone);
        ses._loadedRoot = clone;
        ses._loadedKey = '__robot_iso__';
        ses.scene.add(clone);

        const box = computeVisibleBoxFromObject(ses, clone);
        fitCameraIso(ses, box);

        await new Promise((res) => requestAnimationFrame(res));

        const url = renderToDataURL(ses);
        if (url) isoCache = url;
        return url;
      } catch (e) {
        debugLog('[Thumbs] iso error', String(e));
        return null;
      } finally {
        pauseLoop(false);
      }
    });
  }

  async function primeAll(assetKeys = []) {
    if (priming) return priming;

    priming = (async () => {
      try {
        if (assetToMeshes) await waitForAssetMapToSettle(assetToMeshes, 12000, 450);

        await _isoNoPrime();

        const keys = Array.isArray(assetKeys) ? assetKeys : [];
        for (const k of keys) await _thumbNoPrime(k);

        debugLog('[Thumbs] primeAll done', { wanted: keys.length, ok: thumbCache.size });
      } finally {
        destroySession();
      }
    })();

    return priming;
  }

  async function thumbnail(assetKey) {
    if (!assetKey) return null;
    if (thumbCache.has(assetKey)) return thumbCache.get(assetKey);
    if (priming) {
      await priming;
      return thumbCache.get(assetKey) || null;
    }
    return _thumbNoPrime(assetKey);
  }

  async function iso() {
    if (isoCache) return isoCache;
    if (priming) {
      await priming;
      return isoCache || null;
    }
    return _isoNoPrime();
  }

  return {
    thumbnail,
    iso,
    primeAll,
    has: (k) => thumbCache.has(k),
    destroy: destroySession,
    _cache: thumbCache,
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

      // 1) ISO robot completo
      if (typeof off.iso === 'function') {
        try {
          const isoUrl = await off.iso();
          if (isoUrl) {
            const isoB64 = await makeApproxSizedBase64(isoUrl, 8);
            if (isoB64) {
              entries.push({
                key: '__robot_iso__',
                name: 'robot_iso',
                index: -1,
                image_b64: isoB64,
              });
              debugLog('[IA] __robot_iso__ agregado al payload IA');
            }
          }
        } catch (e) {
          debugLog('[IA] Error generando ISO robot', String(e));
        }
      }

      // 2) Componentes
      let idx = 0;
      for (const ent of items) {
        try {
          const url = await off.thumbnail(ent.assetKey);
          if (!url) continue;

          const b64 = await makeApproxSizedBase64(url, 5);
          if (!b64) continue;

          entries.push({
            key: ent.assetKey,
            name: ent.base,
            index: idx,
            image_b64: b64,
          });
          idx += 1;
        } catch (e) {
          debugLog('[IA] Error thumb IA', ent.assetKey, String(e));
        }
      }

      debugLog('[IA] entries generadas', entries.length);
      if (!entries.length) return;

      let res;
      try {
        res = await window.google.colab.kernel.invokeFunction('describe_component_images', [entries], {});
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

/* ====== extractDescMap / parseMaybePythonDict / applyIaDescriptions ===== */

function extractDescMap(res) {
  if (!res) return null;

  let data = res.data ?? res;

  if (data && typeof data === 'object' && data['application/json'] && typeof data['application/json'] === 'object') {
    return data['application/json'];
  }

  if (data && typeof data === 'object' && typeof data['text/plain'] === 'string') {
    const raw = data['text/plain'].trim();
    const parsed = parseMaybePythonDict(raw);
    if (parsed) return parsed;
  }

  if (typeof data === 'string') {
    const parsed = parseMaybePythonDict(data.trim());
    if (parsed) return parsed;
  }

  if (data && typeof data === 'object' && !Array.isArray(data) && !(Object.keys(data).length === 1 && 'text/plain' in data)) {
    return data;
  }

  if (Array.isArray(data) && data.length && typeof data[0] === 'object') return data[0];

  return null;
}

function parseMaybePythonDict(raw) {
  if (!raw) return null;
  raw = String(raw).trim();
  if (!raw.startsWith('{') || !raw.endsWith('}')) return null;

  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') return j;
  } catch (_) {}

  try {
    let expr = raw;
    expr = expr.replace(/\bNone\b/g, 'null');
    expr = expr.replace(/\bTrue\b/g, 'true');
    expr = expr.replace(/\bFalse\b/g, 'false');

    const obj = new Function('return (' + expr + ')')();
    if (obj && typeof obj === 'object') return obj;
  } catch (_) {}

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

/* =================== Reducción thumbnails ~5KB (SIN fetch/blob) =================== */

async function makeApproxSizedBase64(dataURL, targetKB = 5) {
  try {
    const maxBytes = targetKB * 1024;

    // estimación rápida: bytes ~ (len(base64)*3/4)
    const b64in = String(dataURL || '').split(',')[1] || '';
    const inBytes = Math.floor((b64in.length * 3) / 4) || maxBytes;

    const img = new Image();
    img.decoding = 'async';
    img.src = dataURL;

    await new Promise((res, rej) => {
      img.onload = () => res();
      img.onerror = rej;
    });

    const ratio = Math.min(1, Math.max(0.05, maxBytes / Math.max(1, inBytes)));
    const scale = Math.sqrt(ratio);

    const w = Math.max(32, Math.floor(img.width * scale));
    const h = Math.max(32, Math.floor(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

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
