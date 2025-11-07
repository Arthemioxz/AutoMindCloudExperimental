// urdf_viewer_main.js
// Entrypoint que compone ViewerCore + AssetDB + Interaction + UI (Tools & Components)
// - Genera thumbnails offscreen para el panel de componentes
// - Envía thumbnails en base64 a Colab; allí se comprimen a ~5KB antes de la API

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

  const core = createViewer({ container, background });

  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map();

  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse((o) => {
        if (o && o.isMesh && o.geometry) list.push(o);
      });
      assetToMeshes.set(assetKey, list);
    },
  });

  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // Offscreen renderer para thumbnails
  const off = buildOffscreenForThumbnails(core, assetToMeshes);

  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode,
  });

  const app = {
    ...core,
    robot,

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
    descriptionsReady: false,

    getComponentDescription(assetKey, index) {
      const src = app.componentDescriptions;
      if (!src || !app.descriptionsReady) return "";

      if (!Array.isArray(src) && typeof src === "object") {
        if (src[assetKey]) return src[assetKey];

        const clean = String(assetKey || "").split("?")[0].split("#")[0];
        const base = clean.split("/").pop();
        if (src[base]) return src[base];

        const baseNoExt = base.split(".")[0];
        if (src[baseNoExt]) return src[baseNoExt];
      }

      if (Array.isArray(src) && typeof index === "number") {
        return src[index] || "";
      }

      return "";
    },
  };

  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);

  if (clickAudioDataURL) {
    try {
      installClickSound(clickAudioDataURL);
    } catch (e) {
      console.warn("[ClickSound] error:", e);
    }
  }

  bootstrapComponentDescriptions(app, assetToMeshes, off);

  const destroy = () => {
    try { comps.destroy(); } catch (e) {}
    try { tools.destroy(); } catch (e) {}
    try { inter.destroy(); } catch (e) {}
    try { off?.destroy?.(); } catch (e) {}
    try { core.destroy(); } catch (e) {}
  };

  return { ...app, destroy };
}

/* ============ JS <-> Colab ============ */

let _bootstrapStarted = false;

function bootstrapComponentDescriptions(app, assetToMeshes, off) {
  if (_bootstrapStarted) return;
  _bootstrapStarted = true;

  const hasColab =
    typeof window !== "undefined" &&
    window.google &&
    window.google.colab &&
    window.google.colab.kernel &&
    typeof window.google.colab.kernel.invokeFunction === "function";

  if (!hasColab) {
    console.debug("[Components] Colab bridge no disponible; sin descripciones.");
    app.descriptionsReady = true;
    return;
  }

  const items = listAssets(assetToMeshes);
  if (!items.length) {
    console.debug("[Components] No hay assets para describir.");
    app.descriptionsReady = true;
    return;
  }

  (async () => {
    const entries = [];

    for (const ent of items) {
      try {
        const url = await off.thumbnail(ent.assetKey);
        if (!url || typeof url !== "string") continue;

        const parts = url.split(",");
        if (parts.length !== 2) continue;
        const b64 = parts[1];

        entries.push({
          key: ent.assetKey,
          image_b64: b64,
          mime: "image/png",
        });
      } catch (e) {
        console.warn("[Components] Error thumbnail", ent.assetKey, e);
      }
    }

    if (!entries.length) {
      console.debug("[Components] No se generaron capturas para describir.");
      app.descriptionsReady = true;
      return;
    }

    console.debug(
      `[Components] Enviando ${entries.length} capturas a Colab para descripción.`
    );

    try {
      const result = await window.google.colab.kernel.invokeFunction(
        "describe_component_images",
        [entries],
        {}
      );

      const descMap = extractDescMap(result);
      const keys =
        descMap && typeof descMap === "object" ? Object.keys(descMap) : [];

      if (keys.length) {
        app.componentDescriptions = descMap;
        app.descriptionsReady = true;
        if (typeof window !== "undefined") {
          window.COMPONENT_DESCRIPTIONS = descMap;
        }
        console.debug(
          `[Components] Descripciones listas (${keys.length} piezas).`
        );
      } else {
        console.warn("[Components] Respuesta sin descripciones utilizables.");
        app.descriptionsReady = true;
      }
    } catch (err) {
      console.error("[Components] Error invokeFunction:", err);
      app.descriptionsReady = true;
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

  const tp = d["text/plain"];
  if (typeof tp === "string") {
    const t = tp.trim();

    if ((t.startsWith("{") || t.startsWith("[")) && t.includes('"')) {
      try {
        const parsed = JSON.parse(t);
        if (parsed && typeof parsed === "object") return parsed;
      } catch (e) {}
    }

    try {
      if (t.startsWith("{") && t.endsWith("}")) {
        const obj = Function('"use strict"; return (' + t + ");")();
        if (obj && typeof obj === "object") return obj;
      }
    } catch (e) {
      console.warn("[Components] No se pudo parsear text/plain como dict:", e);
    }
  }

  if (typeof d === "object" && !Array.isArray(d)) return d;

  return {};
}

/* ============ Helpers viewer ============ */

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
  const vis = [];

  for (const m of meshes) vis.push([m, m.visible]);

  for (const m of meshes) {
    tmp.setFromObject(m);
    if (!has) {
      box.copy(tmp);
      has = true;          // <- AQUÍ estaba el bug (antes decía True)
    } else {
      box.union(tmp);
    }
  }

  if (!has) {
    vis.forEach(([o, v]) => (o.visible = v));
    return;
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
  vis.forEach(([o, v]) => (o.visible = v));
}

/* ============ Offscreen thumbnails ============ */

function buildOffscreenForThumbnails(core, assetToMeshes) {
  if (!core.robot) {
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

    renderer.shadowMap.enabled =
      core.renderer.shadowMap?.enabled ?? false;
    renderer.shadowMap.type =
      core.renderer.shadowMap?.type ?? THREE.PCFSoftShadowMap;
  }

  const scene = new THREE.Scene();
  scene.background =
    core.scene?.background ?? new THREE.Color(0xffffff);
  scene.environment = core.scene?.environment ?? null;

  const amb = new THREE.AmbientLight(0xffffff, 0.95);
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(2.5, 2.5, 2.5);
  scene.add(amb, dir);

  const camera = new THREE.PerspectiveCamera(
    60,
    OFF_W / OFF_H,
    0.01,
    10000
  );

  const robotClone = core.robot.clone(true);
  scene.add(robotClone);

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
  robotClone.traverse((o) => {
    const k = o?.userData?.__assetKey;
    if (k && o.isMesh && o.geometry) {
      const arr = cloneAssetToMeshes.get(k) || [];
      arr.push(o);
      cloneAssetToMeshes.set(k, arr);
    }
  });

  const ready = (async () => {
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    );
    renderer.render(scene, camera);
  })();

  function snapshotAsset(assetKey) {
    const meshes = cloneAssetToMeshes.get(assetKey) || [];
    if (!meshes.length) return null;

    const vis = [];
    robotClone.traverse((o) => {
      if (o.isMesh && o.geometry) vis.push([o, o.visible]);
    });

    for (const [m] of vis) m.visible = false;
    for (const m of meshes) m.visible = true;

    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let has = false;

    for (const m of meshes) {
      tmp.setFromObject(m);
      if (!has) {
        box.copy(tmp);
        has = true; // aquí aseguramos boolean JS correcto
      } else {
        box.union(tmp);
      }
    }

    if (!has) {
      vis.forEach(([o, v]) => (o.visible = v));
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
    const url = renderer.domElement.toDataURL("image/png");

    vis.forEach(([o, v]) => (o.visible = v));

    return url;
  }

  return {
    thumbnail: async (assetKey) => {
      try {
        await ready;
        return snapshotAsset(assetKey);
      } catch (e) {
        console.warn("[Thumbnails] error:", e);
        return null;
      }
    },
    destroy: () => {
      try { renderer.dispose(); } catch (e) {}
      try { scene.clear(); } catch (e) {}
    },
  };
}

/* --------------------- Click sound --------------------- */

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
    try { src.start(); } catch (e) {}
  }

  window.__urdf_click__ = play;
}

/* --------------------- Global UMD-style hook -------------------- */

if (typeof window !== "undefined") {
  window.URDFViewer = { render };
}
