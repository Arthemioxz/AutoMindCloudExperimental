// urdf_viewer_main.js
// Entrypoint que compone ViewerCore + AssetDB + Interaction + UI (Tools & Components)
// con soporte opcional IA_Widgets y thumbnails en Iso View consistentes.

/* global THREE */

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

  // ---- Core viewer ----
  const core = createViewer({ container, background });

  // ---- Asset DB + hook assetKey -> meshes ----
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map();

  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse((o) => {
        if (o && o.isMesh && o.geometry) {
          list.push(o);
          o.userData = o.userData || {};
          if (!o.userData.__assetKey) {
            o.userData.__assetKey = assetKey;
          }
        }
      });
      if (list.length) assetToMeshes.set(assetKey, list);
    },
  });

  // ---- Cargar URDF ----
  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // Fallback: si por alguna razón el hook no llenó nada, reconstruir desde userData.__assetKey
  if (robot && !assetToMeshes.size) {
    rebuildAssetMapFromRobot(robot, assetToMeshes);
  }

  // ---- Sistema de thumbnails en Iso View (tipo thumbalist) ----
  const thumbs = buildIsoThumbnailSystem(core, robot, assetToMeshes);

  // ---- Interacción (selección / drag) ----
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode,
  });

  // ---- Facade app para UI ----
  const app = {
    ...core,
    robot,
    IA_Widgets,

    assets: {
      list: () => listAssets(assetToMeshes),
      thumbnail: (assetKey) => thumbs.thumbnail(assetKey),
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

      // Mapa { assetKey: desc }
      if (!Array.isArray(src) && typeof src === "object") {
        if (src[assetKey]) return src[assetKey];
        const base = (assetKey || "").split("/").pop().split(".")[0];
        if (src[base]) return src[base];
      }

      // Lista indexada (fallback)
      if (Array.isArray(src) && typeof index === "number") {
        return src[index] || "";
      }

      return "";
    },
  };

  // ---- UI ----
  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);

  // ---- Sonido opcional ----
  if (clickAudioDataURL) {
    try {
      installClickSound(clickAudioDataURL);
    } catch (_) {}
  }

  // ---- IA opcional (solo si IA_Widgets = true) ----
  if (IA_Widgets) {
    bootstrapComponentDescriptions(app, assetToMeshes, thumbs);
  }

  // ---- Destroy ----
  const destroy = () => {
    try { comps.destroy(); } catch (_) {}
    try { tools.destroy(); } catch (_) {}
    try { inter.destroy(); } catch (_) {}
    try { thumbs.destroy(); } catch (_) {}
    try { core.destroy(); } catch (_) {}
  };

  return { ...app, destroy };
}

/* ====================================================================== */
/* Helpers: asset map, lista, aislamiento, framing                        */
/* ====================================================================== */

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
  const out = [];
  assetToMeshes.forEach((meshes, assetKey) => {
    if (!meshes || !meshes.length) return;
    const clean = String(assetKey || "").split("?")[0].split("#")[0];
    const baseFull = clean.split("/").pop();
    const dot = baseFull.lastIndexOf(".");
    const base = dot >= 0 ? baseFull.slice(0, dot) : baseFull;
    const ext = dot >= 0 ? baseFull.slice(dot + 1).toLowerCase() : "";
    out.push({ assetKey, base, ext, count: meshes.length });
  });
  out.sort((a, b) =>
    a.base.localeCompare(b.base, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
  return out;
}

function isolateAsset(core, assetToMeshes, assetKey) {
  const meshes = assetToMeshes.get(assetKey) || [];
  if (!core.robot) return;
  core.robot.traverse((o) => {
    if (o.isMesh && o.geometry) o.visible = false;
  });
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
    } else {
      box.union(tmp);
    }
  }
  if (!has) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim * 2.0;

  camera.near = Math.max(maxDim / 1000, 0.001);
  camera.far = Math.max(maxDim * 1000, 1000);
  camera.updateProjectionMatrix();

  // Iso view
  const az = Math.PI * 0.25; // 45°
  const el = Math.PI * 0.3;  // ~30°
  const dirV = new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az)
  ).multiplyScalar(dist);

  camera.position.copy(center.clone().add(dirV));
  camera.lookAt(center);

  renderer.render(scene, camera);
}

/* ====================================================================== */
/* Thumbnails: Iso View, grupo correcto de geometrías por assetKey        */
/* ====================================================================== */

function buildIsoThumbnailSystem(core, robot, assetToMeshes) {
  if (!robot || typeof THREE === "undefined") {
    return {
      async thumbnail() { return null; },
      destroy() {},
    };
  }

  const WIDTH = 420;
  const HEIGHT = 320;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(WIDTH, HEIGHT, false);

  // Luces y fondo suaves (independiente del viewer principal)
  const baseScene = new THREE.Scene();
  baseScene.background = new THREE.Color(0xffffff);

  const amb = new THREE.AmbientLight(0xffffff, 0.95);
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(3, 4, 5);
  baseScene.add(amb, dir);

  // Plantilla de robot con userData.__assetKey ya propagado
  const templateRobot = robot.clone(true);
  baseScene.add(templateRobot);

  const cache = new Map();

  async function captureIso(assetKey) {
    if (!assetKey) return null;

    const keyNorm = String(assetKey);

    // Clonar escena+robot para este thumbnail
    const scene = baseScene.clone();
    const robotClone = templateRobot.clone(true);
    scene.add(robotClone);

    // 1) Ocultar todo
    robotClone.traverse((o) => {
      if (o.isMesh) o.visible = false;
    });

    // 2) Mostrar solo meshes con este assetKey
    let anyVisible = false;
    robotClone.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const k =
        (o.userData &&
          (o.userData.__assetKey || o.userData.assetKey || o.userData.filename)) ||
        null;
      if (k === keyNorm) {
        o.visible = true;
        anyVisible = true;
      }
    });

    // 3) Fallback: si nada visible, usar assetToMeshes
    if (!anyVisible && assetToMeshes && assetToMeshes.size) {
      const ms = assetToMeshes.get(assetKey) || [];
      if (ms.length) {
        robotClone.traverse((o) => {
          if (o.isMesh) o.visible = false;
        });
        ms.forEach((m) => {
          const clone = m.clone();
          clone.visible = true;
          scene.add(clone);
        });
        anyVisible = true;
      }
    }

    // 4) Si sigue sin haber nada, abortar
    if (!anyVisible) {
      return null;
    }

    // 5) Bounding box de lo visible
    const box = new THREE.Box3().setFromObject(robotClone);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.2;

    // 6) Cámara en Iso View
    const camera = new THREE.PerspectiveCamera(
      55,
      WIDTH / HEIGHT,
      Math.max(maxDim / 1000, 0.001),
      Math.max(maxDim * 1000, 5000)
    );

    const az = Math.PI * 0.25; // 45°
    const el = Math.PI * 0.3;  // ~30°
    const dirV = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).multiplyScalar(dist);

    camera.position.copy(center.clone().add(dirV));
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.render(scene, camera);

    return canvas.toDataURL("image/png");
  }

  return {
    async thumbnail(assetKey) {
      if (cache.has(assetKey)) return cache.get(assetKey);
      const url = await captureIso(assetKey);
      cache.set(assetKey, url);
      return url;
    },
    destroy() {
      try { renderer.dispose(); } catch (_) {}
      cache.clear();
    },
  };
}

/* ====================================================================== */
/* IA: mini-lotes (~5KB) usando thumbnails (optativo)                     */
/* ====================================================================== */

function bootstrapComponentDescriptions(app, assetToMeshes, thumbs) {
  if (!app || app.IA_Widgets !== true) {
    console.debug("[Components] IA_Widgets desactivado; no se piden descripciones.");
    return;
  }

  const hasColab =
    typeof window !== "undefined" &&
    window.google &&
    window.google.colab &&
    window.google.colab.kernel &&
    typeof window.google.colab.kernel.invokeFunction === "function";

  if (!hasColab) {
    console.debug("[Components] Colab bridge no disponible; sin IA.");
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
        const full = await thumbs.thumbnail(ent.assetKey);
        if (!full) continue;
        const b64 = await makeApproxSizedBase64(full, 5);
        if (!b64) continue;
        entries.push({ key: ent.assetKey, image_b64: b64 });
      } catch (e) {
        console.warn("[Components] Error thumbnail IA", ent.assetKey, e);
      }
    }

    console.debug(
      `[Components] Enviando ${entries.length} thumbnails (~5KB) a Colab para IA.`
    );
    if (!entries.length) return;

    try {
      const res = await window.google.colab.kernel.invokeFunction(
        "describe_component_images",
        [entries],
        {}
      );
      const map = extractDescMap(res);
      console.debug("[Components] Mapa IA:", map);

      if (map && typeof map === "object") {
        app.componentDescriptions = map;
        if (typeof window !== "undefined") {
          window.COMPONENT_DESCRIPTIONS = map;
        }
      } else {
        console.warn("[Components] Respuesta IA sin mapa utilizable.");
      }
    } catch (err) {
      console.error("[Components] Error invokeFunction:", err);
    }
  })();
}

function extractDescMap(res) {
  if (!res) return {};
  const data = res.data || res;
  if (data["application/json"] && typeof data["application/json"] === "object") {
    return data["application/json"];
  }
  if (Array.isArray(data) && data.length && typeof data[0] === "object") {
    return data[0];
  }
  if (typeof data === "object") return data;
  return {};
}

async function makeApproxSizedBase64(dataURL, targetKB = 5) {
  try {
    const maxBytes = targetKB * 1024;
    const resp = await fetch(dataURL);
    const blob = await resp.blob();

    const img = document.createElement("img");
    const u = URL.createObjectURL(blob);
    await new Promise((res, rej) => {
      img.onload = () => res();
      img.onerror = (e) => rej(e);
      img.src = u;
    });

    const ratio = Math.min(1, Math.max(0.05, maxBytes / (blob.size || maxBytes)));
    const scale = Math.sqrt(ratio);
    const w = Math.max(32, Math.floor(img.width * scale));
    const h = Math.max(32, Math.floor(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(u);

    let best = "";
    let q = 0.92;
    for (let i = 0; i < 8; i++) {
      const qq = Math.max(0.4, Math.min(0.96, q));
      const out = canvas.toDataURL("image/jpeg", qq);
      const b64 = out.split(",")[1] || "";
      if (!b64) break;
      best = b64;
      const bytes = Math.floor((b64.length * 3) / 4);
      if (bytes <= maxBytes) break;
      q *= 0.7;
    }
    return best || null;
  } catch (e) {
    console.warn("[makeApproxSizedBase64] Error", e);
    return null;
  }
}

/* ====================================================================== */
/* Click sound opcional + hook global                                     */
/* ====================================================================== */

function installClickSound(dataURL) {
  try {
    const audio = new Audio(dataURL);
    const play = () => {
      try {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } catch (_) {}
    };
    window.__urdf_click__ = play;
  } catch (_) {}
}

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
