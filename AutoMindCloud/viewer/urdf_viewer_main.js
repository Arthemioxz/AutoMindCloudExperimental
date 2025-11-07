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
    IA_Widgets = false, // ✅ opt-in
  } = opts;

  // 1) Core viewer
  const core = createViewer({ container, background });

  // 2) Asset DB
  const assetDB = buildAssetDB(meshDB);
  const loadMeshCb = createLoadMeshCb(assetDB, core);

  // Mapa assetKey -> [meshes]
  const assetToMeshes = new Map();

  // Wrap para trackear meshes por asset
  const trackedLoadMeshCb = (url, manager, onComplete) =>
    loadMeshCb(url, manager, (mesh, meta) => {
      if (mesh && meta && meta.assetKey) {
        const key = meta.assetKey;
        if (!assetToMeshes.has(key)) assetToMeshes.set(key, []);
        assetToMeshes.get(key).push(mesh);
      }
      if (onComplete) onComplete(mesh, meta);
    });

  // 3) Load URDF
  const robot = core.loadURDF(urdfContent, { loadMeshCb: trackedLoadMeshCb });

  // 4) Offscreen thumbnails (sistema viejo mejorado)
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
    IA_Widgets,

    assets: {
      list: () => listAssets(assetToMeshes),
      // Thumbnails mostrados en ComponentsPanel:
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

  // 9) IA opcional: solo si IA_Widgets está activo
  if (IA_Widgets) {
    bootstrapComponentDescriptions(app, assetToMeshes, off);
  }

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

/* ---------- Helpers: assets / isolate / thumbnails ---------- */

function listAssets(assetToMeshes) {
  const out = [];
  for (const [assetKey, meshes] of assetToMeshes.entries()) {
    if (!meshes || !meshes.length) continue;
    const base = assetKey.split("/").pop() || assetKey;
    const ext = base.includes(".") ? base.split(".").pop() : "";
    out.push({
      assetKey,
      base,
      ext,
      count: meshes.length,
    });
  }
  out.sort((a, b) => a.base.localeCompare(b.base));
  return out;
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
      has = True;
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

    return { scene, robotClone };
  }

  async function captureForAsset(assetKey, meshes) {
    await ready;

    const { scene, robotClone } = buildCloneAndMap();

    const cloned = [];
    robotClone.traverse((o) => {
      if (o.isMesh && o.material && o.geometry) {
        o.visible = false;
      }
    });

    meshes.forEach((m) => {
      const clone = m.clone();
      clone.material = m.material.clone();
      cloned.push(clone);
      robotClone.add(clone);
    });

    const box = new THREE.Box3().setFromObject(robotClone);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.2;

    const az = Math.PI * 0.25;
    const el = Math.PI * 0.22;
    const dirV = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).multiplyScalar(dist);

    camera.position.copy(center.clone().add(dirV));
    camera.lookAt(center);
    camera.near = Math.max(maxDim / 1000, 0.001);
    camera.far = Math.max(maxDim * 1000, 5000);
    camera.updateProjectionMatrix();

    renderer.setSize(OFF_W, OFF_H, false);
    renderer.render(scene, camera);

    const url = canvas.toDataURL("image/png");

    cloned.forEach((c) => {
      try {
        robotClone.remove(c);
      } catch (_) {}
    });

    return url;
  }

  const cache = new Map();

  return {
    async thumbnail(assetKey) {
      if (cache.has(assetKey)) return cache.get(assetKey);
      const meshes = assetToMeshes.get(assetKey);
      if (!meshes || !meshes.length) return null;
      const url = await captureForAsset(assetKey, meshes);
      cache.set(assetKey, url);
      return url;
    },
    destroy() {
      try {
        renderer.dispose();
      } catch (_) {}
      cache.clear();
    },
  };
}

/* ---------- JS <-> Colab: thumbnails comprimidos (~5KB) ---------- */

function bootstrapComponentDescriptions(app, assetToMeshes, off) {
  // Solo continuar si IA_Widgets está activo
  if (!app || app.IA_Widgets !== true) {
    console.debug("[Components] IA_Widgets desactivado; no se pedirán descripciones.");
    return;
  }

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
        const url = await off.thumbnail(ent.assetKey);
        if (!url || typeof url !== "string") continue;

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
          window.COMPONENT_DESCRIPTIONS = descMap;
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

  return {};
}

/* make5KBBase64FromDataURL: ajusta a ~N KB */
async function make5KBBase64FromDataURL(dataURL, targetKB = 5) {
  try {
    const maxBytes = targetKB * 1024;

    const [header, b64] = dataURL.split(",");
    if (!b64) return null;

    const bin = atob(b64);
    if (bin.length <= maxBytes) {
      return b64;
    }

    const ratio = maxBytes / bin.length;
    const canvas = document.createElement("canvas");
    const img = document.createElement("img");
    const blob = await (await fetch(dataURL)).blob();
    const imgURL = URL.createObjectURL(blob);

    await new Promise((res, rej) => {
      img.onload = () => res();
      img.onerror = (e) => rej(e);
      img.src = imgURL;
    });

    const w = Math.max(16, Math.floor(img.width * Math.sqrt(ratio)));
    const h = Math.max(16, Math.floor(img.height * Math.sqrt(ratio)));

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);

    let q = 0.92;
    let outB64 = "";
    for (let i = 0; i < 8; i++) {
      const qClamped = Math.max(0.4, Math.min(0.95, q));
      const outURL = canvas.toDataURL("image/jpeg", qClamped);
      const [, out] = outURL.split(",");
      if (!out) break;
      const bytes = atob(out).length;
      outB64 = out;
      if (bytes <= maxBytes) break;
      q *= 0.75;
    }

    URL.revokeObjectURL(imgURL);
    return outB64 || null;
  } catch (e) {
    console.warn("[make5KBBase64FromDataURL] Error", e);
    return null;
  }
}

/* Click sound hook opcional (igual que antes) */
function installClickSound(dataURL) {
  try {
    const audio = new Audio(dataURL);
    const origPlay = window.__urdf_click__ || (() => audio.play().catch(() => {}));
    window.__urdf_click__ = () => {
      try {
        audio.currentTime = 0;
        audio.play().catch(() => origPlay());
      } catch (_) {
        origPlay();
      }
    };
  } catch (_) {}
}

/* Hook global */

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
