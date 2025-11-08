// urdf_viewer_main.js
// ViewerCore + AssetDB + Interaction + UI
// Thumbnails: componente aislado (todas sus instancias), Iso View, colores correctos.
// IA: opt-in con IA_Widgets.

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
    IA_Widgets = false,
  } = opts;

  // 1) Core
  const core = createViewer({ container, background });

  // 2) AssetDB + assetKey -> meshes
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map();

  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse((o) => {
        if (o && o.isMesh && o.geometry) {
          list.push(o);
          o.userData = o.userData || {};
          if (!o.userData.__assetKey) o.userData.__assetKey = assetKey;
        }
      });
      if (list.length) assetToMeshes.set(assetKey, list);
    },
  });

  // 3) Carga URDF
  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // Fallback si el hook no llenó nada
  if (robot && !assetToMeshes.size) {
    rebuildAssetMapFromRobot(robot, assetToMeshes);
  }

  // 4) Sistema de thumbnails aislados
  const thumbs = buildIsoThumbnailSystem(core, robot, assetToMeshes);

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
    bootstrapComponentDescriptions(app, assetToMeshes, thumbs);
  }

  // 10) Destroy
  const destroy = () => {
    try { comps.destroy(); } catch (_) {}
    try { tools.destroy(); } catch (_) {}
    try { inter.destroy(); } catch (_) {}
    try { thumbs.destroy(); } catch (_) {}
    try { core.destroy(); } catch (_) {}
  };

  return { ...app, destroy };
}

/* ======================= Helpers: assets / isolate ===================== */

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

  const az = Math.PI * 0.25;
  const el = Math.PI * 0.3;
  const dirV = new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az)
  ).multiplyScalar(dist);

  camera.position.copy(center.clone().add(dirV));
  camera.lookAt(center);

  renderer.render(scene, camera);
}

/* ================= Thumbs: componente aislado + Iso View ================ */

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
  renderer.setClearColor(0xffffff, 1);

  // Heredar configuración básica
  if (core.renderer) {
    renderer.toneMapping = core.renderer.toneMapping;
    renderer.toneMappingExposure = core.renderer.toneMappingExposure;
    renderer.physicallyCorrectLights =
      core.renderer.physicallyCorrectLights ?? true;

    if ("outputColorSpace" in renderer && "outputColorSpace" in core.renderer) {
      renderer.outputColorSpace = core.renderer.outputColorSpace;
    } else if ("outputEncoding" in renderer && "outputEncoding" in core.renderer) {
      renderer.outputEncoding = core.renderer.outputEncoding;
    }

    renderer.shadowMap.enabled = false;
  }

  const cache = new Map();

  function collectMeshesForKey(assetKey) {
    const out = [];
    const keyNorm = String(assetKey);

    // 1) Si tenemos assetToMeshes, úsalo
    if (assetToMeshes && assetToMeshes.size) {
      const arr = assetToMeshes.get(assetKey);
      if (arr && arr.length) {
        return arr.slice();
      }
    }

    // 2) Fallback: buscar por userData
    robot.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const k =
        (o.userData &&
          (o.userData.__assetKey || o.userData.assetKey || o.userData.filename)) ||
        null;
      if (k === keyNorm) out.push(o);
    });

    return out;
  }

  async function captureIso(assetKey) {
    const meshes = collectMeshesForKey(assetKey);
    if (!meshes.length) return null;

    // Asegura matrices actualizadas
    robot.updateWorldMatrix(true, true);
    meshes.forEach((m) => m.updateWorldMatrix(true, false));

    // Escena nueva SOLO con ese componente
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const amb = new THREE.AmbientLight(0xffffff, 0.9);
    const dir = new THREE.DirectionalLight(0xffffff, 1.3);
    dir.position.set(3, 4, 5);
    scene.add(amb, dir);

    const group = new THREE.Group();
    scene.add(group);

    // Clonar cada mesh con su transform global → componente aislado
    for (const m of meshes) {
      if (!m.isMesh || !m.geometry) continue;
      const clone = m.clone();

      if (Array.isArray(m.material)) {
        clone.material = m.material.map((mt) => mt.clone());
      } else if (m.material) {
        clone.material = m.material.clone();
      }

      clone.applyMatrix4(m.matrixWorld); // posición real
      clone.visible = true;
      group.add(clone);
    }

    if (!group.children.length) return null;

    // Bounding box del componente aislado
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.2;

    // Cámara Iso
    const camera = new THREE.PerspectiveCamera(
      55,
      WIDTH / HEIGHT,
      Math.max(maxDim / 1000, 0.001),
      Math.max(maxDim * 1000, 5000)
    );
    const az = Math.PI * 0.25;
    const el = Math.PI * 0.3;
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

/* ========================== IA (optativa) ============================= */

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

/* ==================== Click sound + hook global ======================= */

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
