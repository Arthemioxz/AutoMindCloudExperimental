// /viewer/urdf_viewer_main.js
// Entrypoint: ViewerCore + AssetDB + Selection & Drag + Tools + Components + Colab bridge

import { THEME } from "./Theme.js";
import { createViewer } from "./core/ViewerCore.js";
import { buildAssetDB, createLoadMeshCb } from "./core/AssetDB.js";
import { attachInteraction } from "./interaction/SelectionAndDrag.js";
import { createToolsDock } from "./ui/ToolsDock.js";
import { createComponentsPanel } from "./ui/ComponentsPanel.js";

/* global THREE */

export function render(opts = {}) {
  const {
    container,
    urdfContent = "",
    meshDB = {},
    selectMode = "link",
    background = THEME.bgCanvas || 0xffffff,
    clickAudioDataURL = null,
    pixelRatio,
    autoResize = true,
  } = opts;

  // Core viewer
  const core = createViewer({
    container,
    background,
    pixelRatio,
  });

  const assetDB = buildAssetDB(meshDB);
  const loadMeshCb = createLoadMeshCb(assetDB);

  // Cargar URDF
  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // Mapa assetKey -> [meshes]
  const assetToMeshes = buildAssetToMeshes(robot);

  // Interacción selección / drag
  const selection = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode,
  });

  // Offscreen para thumbnails (centrados y grandes)
  const off = buildOffscreenForThumbnails(core, assetToMeshes);

  const app = {
    ...core,
    robot,
    selection,

    assets: {
      list: () => listAssets(assetToMeshes),
      thumbnail: (assetKey) => off?.thumbnail(assetKey),
    },

    isolate: {
      asset: (assetKey) => isolateAsset(core, assetToMeshes, assetKey),
      clear: () => showAll(core),
    },

    showAll: () => showAll(core),

    componentDescriptions: {},
    descriptionsReady: false,

    getComponentDescription(assetKey, index) {
      const src = app.componentDescriptions;
      if (!src || !app.descriptionsReady) return "";

      // Mapa { key: desc }
      if (!Array.isArray(src) && typeof src === "object") {
        if (src[assetKey]) return src[assetKey];

        const clean = String(assetKey || "").split("?")[0].split("#")[0];
        const base = clean.split("/").pop();
        if (src[base]) return src[base];

        const baseNoExt = base.split(".")[0];
        if (src[baseNoExt]) return src[baseNoExt];
      }

      // Lista indexada (fallback)
      if (Array.isArray(src) && typeof index === "number") {
        return src[index] || "";
      }

      return "";
    },
  };

  // UI
  const theme = THEME || {};
  createToolsDock(app, theme);
  createComponentsPanel(app, theme);

  if (clickAudioDataURL) {
    installClickSound(clickAudioDataURL);
  }

  if (autoResize && typeof window !== "undefined") {
    window.addEventListener("resize", () => {
      try {
        app.onResize();
      } catch (_) {}
    });
  }

  // Bridge Colab: genera thumbnails, comprime a ~5KB SOLO para API, loguea I/O
  setupColabDescriptions(app, assetToMeshes, off);

  if (typeof window !== "undefined") {
    window.URDFViewer = { render };
  }

  return app;
}

/* ================= Helpers: assets & aislar ================= */

function buildAssetToMeshes(root) {
  const map = new Map();
  if (!root || !root.traverse) return map;

  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;

    const ud = o.userData || {};
    const key =
      ud.assetKey ||
      ud.filename ||
      ud.meshKey ||
      o.name ||
      (ud.tag && String(ud.tag)) ||
      null;

    if (!key) return;

    const k = String(key);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(o);
  });

  return map;
}

function listAssets(assetToMeshes) {
  const out = [];
  assetToMeshes.forEach((meshes, key) => {
    if (!meshes || !meshes.length) return;
    const clean = String(key || "").split("?")[0].split("#")[0];
    const base = clean.split("/").pop();
    out.push({
      assetKey: key,
      base,
      count: meshes.length,
    });
  });
  out.sort((a, b) => a.base.localeCompare(b.base));
  return out;
}

function isolateAsset(core, assetToMeshes, assetKey) {
  const meshes = assetToMeshes.get(assetKey) || [];
  if (!meshes.length) return;
  const { robot } = core;
  if (!robot) return;

  robot.traverse((o) => {
    if (o.isMesh && o.geometry) {
      o.visible = meshes.includes(o);
    }
  });

  frameMeshes(core, meshes);
}

function showAll(core) {
  const { robot } = core;
  if (!robot) return;
  robot.traverse((o) => {
    if (o.isMesh && o.geometry) o.visible = true;
  });
  if (core.fitAndCenter) core.fitAndCenter(robot, 1.06);
}

function frameMeshes(core, meshes) {
  if (!meshes || !meshes.length || !core.camera) return;

  const { camera, renderer, scene } = core;

  const box = new THREE.Box3();
  const tmp = new THREE.Box3();

  for (const m of meshes) {
    if (!m.isMesh || !m.geometry) continue;
    tmp.setFromObject(m);
    if (!tmp.isEmpty()) box.union(tmp);
  }

  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim * 2.0;

  camera.near = Math.max(maxDim / 1000, 0.001);
  camera.far = Math.max(maxDim * 1000, dist * 4.0);
  camera.updateProjectionMatrix();

  const az = Math.PI * 0.25;
  const el = Math.PI * 0.22;
  const dirV = new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az)
  ).multiplyScalar(dist);

  camera.position.copy(center.clone().add(dirV));
  camera.lookAt(center);

  if (renderer && scene) {
    renderer.render(scene, camera);
  }
}

/* ============ Offscreen thumbnails centrados (para UI) ============ */

function buildOffscreenForThumbnails(core, assetToMeshes) {
  if (!core.robot) {
    return {
      thumbnail: async () => null,
      destroy() {},
    };
  }

  const OFF_W = 512;
  const OFF_H = 512;

  const canvas = document.createElement("canvas");
  canvas.width = OFF_W;
  canvas.height = OFF_H;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(OFF_W, OFF_H, false);
  renderer.setClearColor(0x000000, 0);

  const camera = new THREE.PerspectiveCamera(
    30,
    OFF_W / OFF_H,
    0.001,
    10000
  );

  const scene = core.scene;
  const cache = new Map();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function thumbnail(assetKey) {
    if (cache.has(assetKey)) return cache.get(assetKey);

    const meshes = assetToMeshes.get(assetKey) || [];
    if (!meshes.length) {
      cache.set(assetKey, null);
      return null;
    }

    const box = new THREE.Box3();
    for (const m of meshes) {
      if (m.isMesh && m.geometry) {
        box.expandByObject(m);
      }
    }
    if (box.isEmpty()) {
      cache.set(assetKey, null);
      return null;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.2;

    const az = Math.PI * 0.32;
    const el = Math.PI * 0.26;
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).multiplyScalar(dist);

    camera.position.copy(center.clone().add(dir));
    camera.lookAt(center);
    camera.near = Math.max(maxDim / 500, 0.001);
    camera.far = Math.max(maxDim * 40, dist * 3);
    camera.updateProjectionMatrix();

    const vis = [];
    scene.traverse((o) => {
      if (o.isMesh && o.geometry) {
        vis.push([o, o.visible]);
        o.visible = meshes.includes(o);
      }
    });

    renderer.clear();
    renderer.render(scene, camera);

    const url = canvas.toDataURL("image/png");

    for (const [o, v] of vis) o.visible = v;

    await sleep(10);
    cache.set(assetKey, url);
    return url;
  }

  return {
    thumbnail,
    destroy: () => {
      try {
        renderer.dispose();
      } catch (_) {}
      try {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      } catch (_) {}
    },
  };
}

/* ============ Utilidades compresión ~5KB SOLO para API ============ */

function estimateBytesFromDataURL(dataURL) {
  if (!dataURL || typeof dataURL !== "string") return 0;
  const parts = dataURL.split(",");
  if (parts.length < 2) return 0;
  const b64 = parts[1];
  return Math.floor((b64.length * 3) / 4);
}

function compressForAPI5KB(dataURL, targetKB = 5) {
  const maxBytes = targetKB * 1024;

  return new Promise((resolve) => {
    if (!dataURL || typeof dataURL !== "string") {
      return resolve(null);
    }

    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || img.width || 64;
      let h = img.naturalHeight || img.height || 64;
      if (!w || !h) {
        w = 64;
        h = 64;
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      const shrinkTo = (factor) => {
        w = Math.max(24, Math.floor(w * factor));
        h = Math.max(24, Math.floor(h * factor));
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
      };

      // Límite inicial de tamaño
      const maxDim = 160;
      const maxSide = Math.max(w, h);
      if (maxSide > maxDim) {
        const f = maxDim / maxSide;
        shrinkTo(f);
      } else {
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
      }

      let q = 0.9;
      let best = canvas.toDataURL("image/jpeg", q);

      // Bajar calidad / resolución hasta acercarse a 5KB
      for (let i = 0; i < 16; i++) {
        const size = estimateBytesFromDataURL(best);
        if (size <= maxBytes) break;

        q *= 0.7;
        if (q < 0.18) {
          shrinkTo(0.7);
          q = 0.9;
        }
        best = canvas.toDataURL("image/jpeg", q);
      }

      const finalSize = estimateBytesFromDataURL(best);
      console.log(
        "[Compress5KB] Resultado:",
        finalSize,
        "bytes (~",
        (finalSize / 1024).toFixed(2),
        "KB)"
      );

      resolve(best);
    };

    img.onerror = () => {
      console.warn("[Compress5KB] Error al cargar imagen para comprimir.");
      resolve(null);
    };

    img.src = dataURL;
  });
}

/* ============ Normalizar respuesta de Colab ============ */

function normalizeDescribeResult(result) {
  console.log("[DescribeBatch] Raw invokeFunction result:", result);

  if (!result) return {};

  // Colab suele envolver en { data: { ... } }
  let d = result.data || result;

  // application/json directo
  if (d && typeof d === "object" && !Array.isArray(d)) {
    if (d["application/json"] && typeof d["application/json"] === "object") {
      return d["application/json"];
    }
    if (d["text/plain"] && typeof d["text/plain"] === "string") {
      try {
        return JSON.parse(d["text/plain"]);
      } catch (_) {
        // sigue abajo
      }
    }
  }

  // Si parece ya ser un mapa clave->desc
  if (d && typeof d === "object" && !Array.isArray(d)) {
    return d;
  }

  // Si es string JSON crudo
  if (typeof d === "string") {
    try {
      return JSON.parse(d);
    } catch (_) {
      return {};
    }
  }

  return {};
}

/* ============ Bridge Colab: mini-lotes + logs ============ */

function setupColabDescriptions(app, assetToMeshes, off) {
  const hasColab =
    typeof window !== "undefined" &&
    window.google &&
    window.google.colab &&
    window.google.colab.kernel &&
    typeof window.google.colab.kernel.invokeFunction === "function";

  if (!hasColab) {
    console.debug("[Describe] Colab bridge no disponible; sin descripciones.");
    app.descriptionsReady = true;
    return;
  }

  const items = listAssets(assetToMeshes);
  if (!items.length) {
    console.debug("[Describe] No hay assets para describir.");
    app.descriptionsReady = true;
    return;
  }

  const invoke = window.google.colab.kernel.invokeFunction;

  (async () => {
    const entries = [];

    // 1) Generar thumbnails UI + versión 5KB para API
    for (const ent of items) {
      try {
        const url = await off.thumbnail(ent.assetKey);
        if (!url) continue;

        // Thumbnails originales para la lista (NO se tocan)
        ent.thumbURL = url;

        // Copia comprimida a ~5KB solo para API
        const small = await compressForAPI5KB(url, 5);
        if (!small) continue;
        const parts = small.split(",");
        const b64 = (parts[1] || "").trim();
        if (!b64) continue;

        const sizeBytes = Math.floor((b64.length * 3) / 4);
        console.log(
          "[DescribePrep] Listo para API:",
          ent.assetKey,
          "=>",
          sizeBytes,
          "bytes (~",
          (sizeBytes / 1024).toFixed(2),
          "KB)"
        );

        entries.push({ key: ent.assetKey, image_b64: b64 });
      } catch (e) {
        console.warn("[DescribePrep] Error generando entrada para API:", e);
      }
    }

    if (!entries.length) {
      console.debug("[Describe] No se generaron capturas para describir.");
      app.descriptionsReady = true;
      return;
    }

    console.debug(
      `[Describe] Enviando ${entries.length} imágenes en mini-lotes a Colab...`
    );

    const batchSize = 8;
    const allDescs = {};

    // 2) Mini-lotes -> Colab -> API
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);

      const payloadPreview = batch.map((e) => ({
        key: e.key,
        bytes: Math.floor((e.image_b64.length * 3) / 4),
      }));
      console.log(
        `[DescribeBatch] Batch ${i / batchSize + 1} -> hacia API (via Colab):`,
        payloadPreview
      );

      try {
        const result = await invoke("describe_component_images", [batch], {});
        const map = normalizeDescribeResult(result) || {};
        console.log(
          `[DescribeBatch] Batch ${i / batchSize + 1} -> parsed map:`,
          map
        );

        Object.assign(allDescs, map);
        app.componentDescriptions = {
          ...(app.componentDescriptions || {}),
          ...allDescs,
        };

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("urdf-descriptions-partial", {
              detail: { count: Object.keys(allDescs).length },
            })
          );
        }
      } catch (e) {
        console.warn(
          `[DescribeBatch] Error en batch ${
            i / batchSize + 1
          } describe_component_images:`,
          e
        );
      }
    }

    // 3) Marcar listo
    app.descriptionsReady = true;

    console.debug(
      "[Describe] Descripciones finalizadas. Total claves:",
      Object.keys(app.componentDescriptions || {}).length
    );

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("urdf-descriptions-ready", {
          detail: { count: Object.keys(app.componentDescriptions || {}).length },
        })
      );
    }
  })();
}

/* ------------------------- Click Sound ------------------------- */

function installClickSound(dataURL) {
  if (!dataURL || typeof dataURL !== "string") return;
  let ctx = null;
  let buf = null;

  async function ensure() {
    if (!ctx) {
      const AC =
        window.AudioContext || window.webkitAudioContext || null;
      if (!AC) return;
      ctx = new AC();
    }
    if (!buf) {
      const resp = await fetch(dataURL);
      const arr = await resp.arrayBuffer();
      buf = await ctx.decodeAudioData(arr);
    }
  }

  async function play() {
    try {
      await ensure();
      if (!ctx || !buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (_) {}
  }

  window.__urdf_click__ = play;
}
