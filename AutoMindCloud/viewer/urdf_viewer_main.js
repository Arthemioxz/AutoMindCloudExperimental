// urdf_viewer_main.js — debug completo en navegador
// -------------------------------------------------------------
// - Full viewer
// - Thumbnails offscreen
// - Llamada a describe_component_images (Colab)
// - Logs detallados en consola
// - Guarda window.lastDescribeResult y window.lastParsedDescMap
// -------------------------------------------------------------

import { THEME } from "./Theme.js";
import { createViewer } from "./core/ViewerCore.js";
import { buildAssetDB, createLoadMeshCb } from "./core/AssetDB.js";
import { attachInteraction } from "./interaction/SelectionAndDrag.js";
import { createToolsDock } from "./ui/ToolsDock.js";
import { createComponentsPanel } from "./ui/ComponentsPanel.js";

if (typeof window !== "undefined") {
  // inicializamos por si acaso
  window.lastDescribeResult = null;
  window.lastParsedDescMap = null;
}

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

/* ===================== JS <-> Colab con logs ===================== */

let _bootstrapStarted = false;

function bootstrapComponentDescriptions(app, assetToMeshes, off) {
  if (_bootstrapStarted) return;
  _bootstrapStarted = true;

  const hasColab =
    typeof window !== "undefined" &&
    window.google?.colab?.kernel &&
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

    console.group("[DEBUG Components]");
    console.debug("📸 Capturas generadas:", entries.length);
    console.debug("Ejemplo clave:", entries[0]?.key);

    if (!entries.length) {
      console.debug("[Components] No se generaron capturas para describir.");
      console.groupEnd();
      app.descriptionsReady = true;
      return;
    }

    let result = null;

    try {
      console.debug("[DEBUG Components] Llamando a Colab.describe_component_images...");
      result = await window.google.colab.kernel.invokeFunction(
        "describe_component_images",
        [entries],
        {}
      );
      console.debug("[DEBUG Components] invokeFunction OK, tipo:", typeof result);
    } catch (err) {
      console.error("[❌ Components] Error invokeFunction:", err);
      if (typeof window !== "undefined") {
        window.lastDescribeResult = { error: String(err) };
        window.lastParsedDescMap = null;
      }
      app.descriptionsReady = true;
      console.groupEnd();
      return;
    }

    if (typeof window !== "undefined") {
      window.lastDescribeResult = result;
    }
    console.debug("🧩 Resultado bruto desde Colab:", result);

    const descMap = extractDescMap(result);
    if (typeof window !== "undefined") {
      window.lastParsedDescMap = descMap;
    }
    console.debug("📦 Mapa parseado:", descMap);

    try {
      const preview = JSON.stringify(result).slice(0, 1000);
      console.debug("🧾 Vista previa (truncada):", preview);
    } catch (e) {
      console.debug("🧾 No se pudo serializar preview del resultado.");
    }

    const keys =
      descMap && typeof descMap === "object" ? Object.keys(descMap) : [];

    if (keys.length) {
      app.componentDescriptions = descMap;
      app.descriptionsReady = true;
      if (typeof window !== "undefined") {
        window.COMPONENT_DESCRIPTIONS = descMap;
      }
      console.debug(
        `[✅ Components] Descripciones listas (${keys.length} piezas):`,
        keys
      );
    } else {
      console.warn("[⚠️ Components] Respuesta sin descripciones utilizables.");
      app.descriptionsReady = true;
    }

    console.groupEnd();
  })();
}

/* ===================== Parser con logs ===================== */

function extractDescMap(result) {
  console.groupCollapsed("[DEBUG extractDescMap]");
  console.debug("Entrada:", result);

  if (!result) {
    console.debug("⛔ result vacío / null / undefined");
    console.groupEnd();
    return {};
  }

  let d = result;

  // Colab suele envolver en { data: {...} }
  if (d.data && typeof d.data === "object") {
    console.debug("📨 Detectado wrapper .data");
    d = d.data;
    console.debug("Contenido .data:", d);
  }

  // Caso 1: application/json dentro de data
  if (d["application/json"] && typeof d["application/json"] === "object") {
    console.debug("🎯 Detectado application/json");
    console.groupEnd();
    return d["application/json"];
  }

  // Caso 2: diccionario plano ya usable
  if (
    typeof d === "object" &&
    !Array.isArray(d) &&
    !("text/plain" in d) &&
    !("application/json" in d)
  ) {
    const keys = Object.keys(d);
    console.debug("🔍 Dict plano detectado, claves:", keys);
    if (keys.length) {
      console.groupEnd();
      return d;
    }
  }

  // Caso 3: array de posibles envoltorios
  if (Array.isArray(d)) {
    console.debug("🔄 Array detectado, iterando elementos...");
    for (const item of d) {
      const sub = extractDescMap(item);
      if (sub && Object.keys(sub).length) {
        console.groupEnd();
        return sub;
      }
    }
  }

  // Caso 4: text/plain con JSON o dict dentro
  const tp = d["text/plain"];
  if (typeof tp === "string") {
    const t = tp.trim();
    console.debug("🧾 text/plain detectado, len:", t.length);

    // Intentar extraer bloque { ... }
    const s0 = t.indexOf("{");
    const s1 = t.lastIndexOf("}");
    let candidate =
      s0 !== -1 && s1 !== -1 && s1 > s0 ? t.slice(s0, s1 + 1) : t;

    // Intento 1: JSON directo
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        console.debug("🎯 JSON.parse exitoso:", parsed);
        console.groupEnd();
        return parsed;
      }
    } catch (e) {
      console.debug("⛔ JSON.parse falló, probando comillas simples...");
    }

    // Intento 2: reemplazar comillas simples
    try {
      const fixed = candidate.replace(/'/g, '"');
      const parsed = JSON.parse(fixed);
      if (parsed && typeof parsed === "object") {
        console.debug("🎯 parse con comillas simples corregidas:", parsed);
        console.groupEnd();
        return parsed;
      }
    } catch (e2) {
      console.debug("⛔ Tampoco es JSON válido tras fix de comillas.");
    }
  }

  console.debug("⚠️ No se pudo extraer un mapa de descripciones utilizable.");
  console.groupEnd();
  return {};
}

/* ===================== Helpers viewer ===================== */

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

/* ===================== Offscreen thumbnails ===================== */

function buildOffscreenForThumbnails(core, assetToMeshes) {
  if (!core.robot) {
    return {
      thumbnail: async () => null,
      destroy: () => {},
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

  const scene = new THREE.Scene();
  scene.background = core.scene?.background ?? new THREE.Color(0xffffff);

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

    robotClone.traverse((o) => {
      if (o.isMesh && o.geometry) o.visible = false;
    });
    meshes.forEach((m) => (m.visible = true));

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

    return renderer.domElement.toDataURL("image/png");
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

/* ===================== Click sound ===================== */

function installClickSound(dataURL) {
  if (!dataURL || typeof dataURL !== "string") return;
  let ctx = null;
  let buf = null;

  async function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!buf) {
      const resp = await fetch(dataURL);
      const arr = await resp.arrayBuffer();
      buf = await ctx.decodeAudioData(arr);
    }
  }

  function play() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
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

/* ===================== Global ===================== */

if (typeof window !== "undefined") {
  window.URDFViewer = { render };
}
