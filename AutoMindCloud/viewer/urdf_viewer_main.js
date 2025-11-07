// urdf_viewer_main.js
// Entrypoint that composes ViewerCore + AssetDB + Selection & Drag + UI (Tools & Components)

import { THEME } from "./Theme.js";
import { createViewer } from "./core/ViewerCore.js";
import { buildAssetDB, createLoadMeshCb } from "./core/AssetDB.js";
import { attachInteraction } from "./interaction/SelectionAndDrag.js";
import { createToolsDock } from "./ui/ToolsDock.js";
import { createComponentsPanel } from "./ui/ComponentsPanel.js";

export function render(opts = {}) {
  const {
    container,
    urdfContent = "",
    meshDB = {},
    selectMode = "link",
    background = THEME.bgCanvas || 0xffffff,
    clickAudioDataURL = null,
  } = opts;

  // 1) Core viewer
  const core = createViewer({ container, background });

  // 2) Asset DB + loadMeshCb with onMeshTag hook to index meshes by assetKey
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map();

  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      // Mapeo para el viewer en vivo
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse((o) => {
        if (o && o.isMesh && o.geometry) list.push(o);
      });
      assetToMeshes.set(assetKey, list);

      // Muy importante: taggear para el clon offscreen (sistema viejo de thumbalist)
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

  // 4) Offscreen thumbnails (usa el sistema viejo, robusto)
  const off = buildOffscreenForThumbnails(core, assetToMeshes);

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

    assets: {
      list: () => listAssets(assetToMeshes),
      // Thumbnails de la lista de componentes:
      // → usan la salida original de off.thumbnail (sin comprimir).
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
      const src = app.componentDescriptions;
      if (!src) return "";

      if (!Array.isArray(src) && typeof src === "object") {
        if (src[assetKey]) return src[assetKey];
        const base = (assetKey || "").split("/").pop().split(".")[0];
        if (src[base]) return src[base];
      }

      if (Array.isArray(src) && typeof index === "number") {
        return src[index] || "";
      }

      return "";
    },
  };

  // 7) UI
  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);

  // 8) Click sound opcional
  if (clickAudioDataURL) {
    try {
      installClickSound(clickAudioDataURL);
    } catch (_) {}
  }

  // 9) Colab: capturar thumbnails y pedir descripciones (usando versiones ~5KB)
  bootstrapComponentDescriptions(app, assetToMeshes, off);

  // 10) Destroy
  const destroy = () => {
    try { comps.destroy(); } catch (_) {}
    try { tools.destroy(); } catch (_) {}
    try { inter.destroy(); } catch (_) {}
    try { off?.destroy(); } catch (_) {}
    try { core.destroy(); } catch (_) {}
  };

  return { ...app, destroy };
}

/* ---------- JS <-> Colab: thumbnails comprimidos (~5KB) ---------- */

function bootstrapComponentDescriptions(app, assetToMeshes, off) {
  const hasColab =
    typeof window !== "undefined" &&
    window.google &&
    window.google.colab &&
    window.google.colab.kernel &&
    typeof window.google.colab.kernel.invokeFunction === "function";

  if (!hasColab) {
    console.debug("[Components] Colab bridge no disponible; sin descripciones.");
    return;
  }

  const items = listAssets(assetToMeshes);
  if (!items.length) {
    console.debug("[Components] No hay assets para describir.");
    return;
  }

  (async () => {
    const entries = [];

    for (const ent of items) {
      try {
        // Thumbnail full-res para UI:
        const url = await off.thumbnail(ent.assetKey);
        if (!url || typeof url !== "string") continue;

        // Versión optimizada SOLO para enviar a Colab (~5KB):
        const b64_5kb = await make5KBBase64FromDataURL(url, 5);
        if (!b64_5kb) continue;

        entries.push({
          key: ent.assetKey,
          image_b64: b64_5kb,
        });
      } catch (e) {
        console.warn("[Components] Error thumbnail", ent.assetKey, e);
      }
    }

    console.debug(
      `[Components] Enviando ${entries.length} capturas (5KB) a Colab para descripción.`
    );
    if (!entries.length) return;

    try {
      const result = await window.google.colab.kernel.invokeFunction(
        "describe_component_images",
        [entries],
        {}
      );

      console.debug("[Components] Respuesta raw:", result);

      const descMap = extractDescMap(result);
      console.debug("[Components] Mapa final de descripciones:", descMap);

      if (descMap && typeof descMap === "object") {
        app.componentDescriptions = descMap;
        if (typeof window !== "undefined") {
          window.COMPONENT_DESCRIPTIONS = descMap; // debug
        }
      } else {
        console.warn("[Components] No se obtuvo mapa de descripciones válido.");
      }
    } catch (err) {
      console.error("[Components] Error invokeFunction:", err);
    }
  })();
}

function extractDescMap(result) {
  if (!result) return {};
  const d = result.data || result;

  if (d["application/json"] && typeof d["application/json"] === "object") {
    return d["application/json"];
  }

  if (Array.isArray(d) && d.length && typeof d[0] === "object") {
    return d[0];
  }

  if (d["text/plain"] && typeof d["text/plain"] === "string") {
    const t = d["text/plain"].trim();
    try {
      const jsonLike = t
        .replace(/^dict\(/, "{")
        .replace(/\)$/, "}")
        .replace(/'/g, '"');
      const parsed = JSON.parse(jsonLike);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (e) {
      console.warn("[Components] No se pudo parsear text/plain:", e, t);
    }
  }

  if (typeof d === "object" && !Array.isArray(d)) return d;

  return {};
}

/* ---------- Helpers viewer ---------- */

function listAssets(assetToMeshes) {
  const items = [];
  assetToMeshes.forEach((meshes, assetKey) => {
    if (!meshes || !meshes.length) return;
    const clean = String(assetKey || "").split("?")[0].split("#")[0];
    const baseFull = clean.split("/").pop();
    const dot = baseFull.lastIndexOf(".");
    const base = dot >= 0 ? baseFull.slice(0, dot) : baseFull;
    const ext = dot >= 0 ? baseFull.slice(dot + 1).toLowerCase() : "";
    items.push({ assetKey, base, ext, count: meshes.length });
  });
  items.sort((a, b) =>
    a.base.localeCompare(b.base, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
  return items;
}

function isolateAsset(core, assetToMeshes, assetKey) {
  const meshes = assetToMeshes.get(assetKey) || [];
  if (core.robot) {
    core.robot.traverse((o) => {
      if (o.isMesh && o.geometry) o.visible = false;
    });
  }
  meshes.forEach((m) => (m.visible = true));
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
  if (!meshes || !meshes.length || !core.camera) return;
  const { camera, renderer, scene } = core;

  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let has = false;

  for (const m of meshes) {
    tmp.setFromObject(m);
    if (!has) {
      box.copy(tmp);
      has = true;
    } else box.union(tmp);
  }

  if (!has) return;

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
}

/* ---------- Offscreen thumbnails (sistema viejo mejorado) ---------- */
/**
 * Usa un renderer offscreen propio + clon del robot.
 * - Evita thumbs negros.
 * - Thumbnails para la UI salen en buena calidad.
 * - El Colab usa luego una copia comprimida (~5KB) sin tocar estos.
 */
function buildOffscreenForThumbnails(core, assetToMeshes) {
  if (!core.robot || typeof THREE === "undefined") {
    return {
      thumbnail: async () => null,
      destroy() {},
    };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const OFF_W = 640;
  const OFF_H = 480;

  const canvas = document.createElement("canvas");
  canvas.width = OFF_W;
  canvas.height = OFF_H;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(OFF_W, OFF_H, false);

  // Intentar matchear config del renderer principal para evitar diferencias raras
  if (core.renderer) {
    renderer.physicallyCorrectLights =
      core.renderer.physicallyCorrectLights ?? true;
    renderer.toneMapping = core.renderer.toneMapping;
    renderer.toneMappingExposure =
      core.renderer.toneMappingExposure ?? 1.0;

    if ("outputColorSpace" in renderer) {
      renderer.outputColorSpace =
        core.renderer.outputColorSpace ?? THREE.SRGBColorSpace;
    } else {
      renderer.outputEncoding =
        core.renderer.outputEncoding ?? THREE.sRGBEncoding;
    }

    renderer.shadowMap.enabled = core.renderer.shadowMap?.enabled ?? false;
    renderer.shadowMap.type = core.renderer.shadowMap?.type ?? THREE.PCFSoftShadowMap;
  }

  const baseScene = new THREE.Scene();
  baseScene.background =
    core.scene && core.scene.background
      ? core.scene.background
      : new THREE.Color(0xffffff);
  baseScene.environment = core.scene ? core.scene.environment : null;

  // Luces suaves para evitar negros
  const amb = new THREE.AmbientLight(0xffffff, 0.95);
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(2.5, 2.5, 2.5);
  baseScene.add(amb, dir);

  const camera = new THREE.PerspectiveCamera(
    60,
    OFF_W / OFF_H,
    0.01,
    10000
  );

  // Precalentar renderer
  const ready = (async () => {
    await sleep(300);
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    );
    renderer.render(baseScene, camera);
  })();

  function buildCloneAndMap() {
    const scene = baseScene.clone();
    scene.background = baseScene.background;
    scene.environment = baseScene.environment;

    const robotClone = core.robot.clone(true);
    scene.add(robotClone);

    // Clonar materiales para este renderer
    robotClone.traverse((o) => {
      if (o.isMesh && o.material) {
        if (Array.isArray(o.material)) {
          o.material = o.material.map((m) => m.clone());
        } else {
          o.material = o.material.clone();
        }
        o.material.needsUpdate = true;
        o.castShadow = renderer.shadowMap.enabled;
        o.receiveShadow = renderer.shadowMap.enabled;
      }
    });

    const cloneAssetToMeshes = new Map();

    // Reconstruir mapping usando __assetKey
    robotClone.traverse((o) => {
      if (o.isMesh && o.geometry) {
        const k = o.userData && o.userData.__assetKey;
        if (k) {
          const arr = cloneAssetToMeshes.get(k) || [];
          arr.push(o);
          cloneAssetToMeshes.set(k, arr);
        }
      }
    });

    // Fallback por nombre si hiciera falta
    if (!cloneAssetToMeshes.size && assetToMeshes && assetToMeshes.size) {
      robotClone.traverse((o) => {
        if (o.isMesh && o.geometry) {
          assetToMeshes.forEach((meshes, ak) => {
            if (meshes.some((m) => m.name === o.name)) {
              const arr = cloneAssetToMeshes.get(ak) || [];
              arr.push(o);
              cloneAssetToMeshes.set(ak, arr);
            }
          });
        }
      });
    }

    return { scene, robotClone, cloneAssetToMeshes };
  }

  function snapshotAsset(assetKey) {
    const { scene, robotClone, cloneAssetToMeshes } = buildCloneAndMap();
    const meshes = cloneAssetToMeshes.get(assetKey) || [];
    if (!meshes.length) return null;

    const vis = [];
    robotClone.traverse((o) => {
      if (o.isMesh && o.geometry) vis.push([o, o.visible]);
    });

    // Ocultar todo
    for (const [m] of vis) m.visible = false;
    // Mostrar sólo el asset
    for (const m of meshes) m.visible = true;

    // Fit camera
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let has = false;

    for (const m of meshes) {
      tmp.setFromObject(m);
      if (!has) {
        box.copy(tmp);
        has = true;
      } else box.union(tmp);
    }
    if (!has) return null;

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

    // DataURL completo (alta calidad) para la UI
    const url = renderer.domElement.toDataURL("image/png");

    // Restaurar (aunque es un clon descartable)
    for (const [o, v] of vis) o.visible = v;

    return url;
  }

  return {
    thumbnail: async (assetKey) => {
      try {
        await ready;
        await new Promise((r) => requestAnimationFrame(r));
        return snapshotAsset(assetKey);
      } catch (e) {
        console.warn("[Thumbnails] error:", e);
        return null;
      }
    },
    destroy: () => {
      try { renderer.dispose(); } catch (_) {}
      try { baseScene.clear(); } catch (_) {}
    },
  };
}

/* ---------- Compresión a ~5KB SOLO para envío a Colab ---------- */

function estimateBytesFromBase64(b64) {
  return Math.ceil((b64.length * 3) / 4);
}

/**
 * Recibe un dataURL, devuelve SOLO el base64 de una versión JPEG ~5KB.
 * No afecta las thumbnails originales usadas en la UI.
 */
function make5KBBase64FromDataURL(url, targetKB = 5) {
  const maxBytes = targetKB * 1024;

  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || img.width || 512;
        let h = img.naturalHeight || img.height || 512;

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        let quality = 0.9;
        let bestB64 = "";

        for (let i = 0; i < 10; i++) {
          canvas.width = w;
          canvas.height = h;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          const dataURL = canvas.toDataURL("image/jpeg", quality);
          const b64 = dataURL.split(",")[1] || "";
          if (!b64) break;

          bestB64 = b64;
          const bytes = estimateBytesFromBase64(b64);

          if (
            bytes <= maxBytes ||
            (w <= 32 && h <= 32 && quality <= 0.25)
          ) {
            break;
          }

          // Reducir progresivamente
          w = Math.max(32, Math.floor(w * 0.7));
          h = Math.max(32, Math.floor(h * 0.7));
          quality = Math.max(0.25, quality * 0.8);
        }

        resolve(bestB64 || url.split(",")[1] || "");
      };
      img.onerror = () => {
        resolve(url.split(",")[1] || "");
      };
      img.src = url;
    } catch (e) {
      console.warn("[5KB] Error al comprimir:", e);
      resolve(url.split(",")[1] || "");
    }
  });
}

/* ------------------------- Click Sound ------------------------- */

function installClickSound(dataURL) {
  if (!dataURL || typeof dataURL !== "string") return;
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
    if (ctx.state === "suspended") ctx.resume();
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

/* --------------------- Global hook --------------------- */

if (typeof window !== "undefined") {
  window.URDFViewer = window.URDFViewer || {};
  window.URDFViewer.render = (opts) => {
    const app = render(opts);
    try {
      window.URDFViewer.__app = app;
    } catch (_) {}
    return app;
  };
}
