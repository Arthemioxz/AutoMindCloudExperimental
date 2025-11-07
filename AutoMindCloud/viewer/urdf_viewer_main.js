// urdf_viewer_main.js
// Entrypoint que compone ViewerCore + AssetDB + Interaction + UI (Tools & Components)
// con soporte opcional para IA_Widgets (mini-lotes de thumbnails → Colab → API).

import { THEME } from "./Theme.js";
import { createViewer } from "./core/ViewerCore.js";
import { buildAssetDB, createLoadMeshCb } from "./core/AssetDB.js";
import { attachInteraction } from "./interaction/SelectionAndDrag.js";
import { createToolsDock } from "./ui/ToolsDock.js";
import { createComponentsPanel } from "./ui/ComponentsPanel.js";

/**
 * Public entry: render the URDF viewer.
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {string} opts.urdfContent
 * @param {Object.<string,string>} opts.meshDB
 * @param {string} [opts.selectMode="link"]
 * @param {number|null} [opts.background]
 * @param {boolean} [opts.IA_Widgets=false]  // ✅ si true, habilita integración con IA
 */
export function render(opts = {}) {
  const {
    container,
    urdfContent = "",
    meshDB = {},
    selectMode = "link",
    background = THEME.bgCanvas || 0xffffff,
    clickAudioDataURL = null,
    IA_Widgets = false,
  } = opts;

  // 1) Core viewer
  const core = createViewer({ container, background });

  // 2) Asset DB + loadMeshCb con hook para mapear assetKey -> meshes
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map();

  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse((o) => {
        if (o && o.isMesh && o.geometry) {
          list.push(o);
        }
      });
      if (list.length) {
        assetToMeshes.set(assetKey, list);
      }
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

  // 3b) Fallback: si el hook no llenó nada, reconstruimos desde userData.__assetKey
  if (robot && !assetToMeshes.size) {
    rebuildAssetMapFromRobot(robot, assetToMeshes);
  }

  // 4) Offscreen thumbnails (tipo thumbalist)
  const off = buildOffscreenForThumbnails(core, assetToMeshes);

  // 5) Interacción selección / drag
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

  // 8) Sonido opcional
  if (clickAudioDataURL) {
    try {
      installClickSound(clickAudioDataURL);
    } catch (_) {}
  }

  // 9) IA opcional
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

/* ---------- Helpers: assets / isolate / frame ---------- */

function rebuildAssetMapFromRobot(robot, assetToMeshes) {
  const tmp = new Map();
  robot.traverse((o) => {
    if (o && o.isMesh && o.geometry) {
      const k =
        (o.userData && (o.userData.__assetKey || o.userData.assetKey)) || null;
      if (!k) return;
      const arr = tmp.get(k) || [];
      arr.push(o);
      tmp.set(k, arr);
    }
  });
  if (!tmp.size) return;
  tmp.forEach((arr, k) => {
    if (arr && arr.length) assetToMeshes.set(k, arr);
  });
}

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

/* ---------- Offscreen thumbnails ---------- */

function buildOffscreenForThumbnails(core, assetToMeshes) {
  if (!core.robot || typeof THREE === "undefined") {
    return {
      thumbnail: async () => null,
      destroy() {},
    };
  }

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
    renderer.shadowMap.type =
      core.renderer.shadowMap?.type ?? THREE.PCFSoftShadowMap;
  }

  const baseScene = new THREE.Scene();
  baseScene.background =
    core.scene && core.scene.background
      ? core.scene.background
      : new THREE.Color(0xffffff);
  baseScene.environment = core.scene ? core.scene.environment : null;

  const amb = new THREE.AmbientLight(0xffffff, 0.95);
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(2.5, 2.5, 2.5);
  baseScene.add(amb, dir);

  const camera = new THREE.PerspectiveCamera(
    60,
    OFF_W / OFF_H,
    0.01,
    10000
  );

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const ready = (async () => {
    await sleep(200);
    await new Promise((res) =>
      requestAnimationFrame(() => requestAnimationFrame(res))
    );
    renderer.render(baseScene, camera);
  })();

  function buildClone() {
    const scene = baseScene.clone();
    scene.background = baseScene.background;
    scene.environment = baseScene.environment;
    const robotClone = core.robot.clone(true);
    scene.add(robotClone);
    return { scene, robotClone };
  }

  async function captureForAsset(assetKey, meshes) {
    await ready;
    const { scene, robotClone } = buildClone();

    robotClone.traverse((o) => {
      if (o.isMesh && o.geometry) o.visible = false;
    });

    meshes.forEach((m) => {
      const clone = m.clone();
      clone.material = m.material.clone();
      clone.visible = true;
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

    return canvas.toDataURL("image/png");
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
      try { renderer.dispose(); } catch (_) {}
      cache.clear();
    },
  };
}

/* ---------- IA: mini-lotes comprimidos (~5KB) ---------- */

function bootstrapComponentDescriptions(app, assetToMeshes, off) {
  if (!app || app.IA_Widgets !== true) {
    console.debug("[Components] IA_Widgets desactivado: no se piden descripciones.");
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
        const fullURL = await off.thumbnail(ent.assetKey);
        if (!fullURL) continue;
        const b64_5kb = await makeApproxSizedBase64(fullURL, 5);
        if (!b64_5kb) continue;
        entries.push({ key: ent.assetKey, image_b64: b64_5kb });
      } catch (e) {
        console.warn("[Components] Error generando thumb IA", ent.assetKey, e);
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
    const url = URL.createObjectURL(blob);

    await new Promise((res, rej) => {
      img.onload = () => res();
      img.onerror = (e) => rej(e);
      img.src = url;
    });

    const ratio = Math.min(1, Math.max(0.05, maxBytes / (blob.size || maxBytes)));
    const scale = Math.sqrt(ratio);
    const w = Math.max(16, Math.floor(img.width * scale));
    const h = Math.max(16, Math.floor(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);

    URL.revokeObjectURL(url);

    let bestB64 = "";
    let q = 0.92;
    for (let i = 0; i < 8; i++) {
      const qq = Math.max(0.4, Math.min(0.96, q));
      const out = canvas.toDataURL("image/jpeg", qq);
      const b64 = out.split(",")[1] || "";
      if (!b64) break;
      bestB64 = b64;
      const bytes = Math.floor((b64.length * 3) / 4);
      if (bytes <= maxBytes) break;
      q *= 0.7;
    }
    return bestB64 || null;
  } catch (e) {
    console.warn("[makeApproxSizedBase64] Error", e);
    return null;
  }
}

/* ---------- Click sound opcional ---------- */

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

/* ---------- Hook global ---------- */

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
