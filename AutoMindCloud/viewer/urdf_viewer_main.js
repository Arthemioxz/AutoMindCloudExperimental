// /viewer/urdf_viewer_main.js
//
// Nuevo flujo IA:
//  - Genera 1 captura ISO del robot completo (contexto).
//  - Genera 1 captura por componente (thumb UI).
//  - Comprime SOLO para IA (~5KB JPEG).
//  - Envía TODO en una sola llamada a `describe_component_images(entries)`.
//  - Recibe { descriptions: { assetKey: "desc" } } y actualiza la UI.
//
// También:
//  - Mantiene viewer grande.
//  - IA_Widgets controla si se llama o no a la IA (opt-in).

import { THEME } from "./Theme.js";
import { createViewer } from "./core/ViewerCore.js";
import { buildAssetDB, createLoadMeshCb } from "./core/AssetDB.js";
import { attachInteraction } from "./interaction/SelectionAndDrag.js";
import { createToolsDock } from "./ui/ToolsDock.js";
import { createComponentsPanel } from "./ui/ComponentsPanel.js";

export let Base64Images = [];

/* ============================ Debug ============================ */

function debugLog(...args) {
  try {
    console.log("[URDF_VIEWER]", ...args);
  } catch (_) {}
  try {
    if (typeof window !== "undefined") {
      window.URDF_DEBUG_LOGS = window.URDF_DEBUG_LOGS || [];
      window.URDF_DEBUG_LOGS.push(args);
    }
  } catch (_) {}
}

/* ============================ Render ============================ */

export async function render(opts = {}) {
  const {
    container,
    urdfContent = "",
    meshDB = {},
    selectMode = "link",
    background = THEME.canvasBg || 0xffffff,
    IA_Widgets = false,
    clickAudioDataURL = null,
  } = opts;

  if (!container) {
    throw new Error("[URDF Viewer] Falta container.");
  }

  // Asegurar tamaño decente siempre
  container.innerHTML = "";
  container.style.position = container.style.position || "relative";
  container.style.width = "100%";
  if (!container.style.height || container.style.height === "0px") {
    container.style.height = IA_Widgets ? "640px" : "640px";
  }

  debugLog("render() init", { selectMode, background, IA_Widgets });

  // 1) Core viewer
  const core = createViewer({
    container,
    background,
  });

  // 2) Asset DB + loadMeshCb
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

  // 3) Cargar URDF
  const robot = core.loadURDF(urdfContent, { loadMeshCb });
  core.robot = robot;
  debugLog("Robot loaded:", !!robot);

  if (robot && !assetToMeshes.size) {
    rebuildAssetMapFromRobot(robot, assetToMeshes);
  }

  // Vista inicial
  if (core.fitAndCenter && robot) {
    core.fitAndCenter(robot, 1.1);
  } else if (core.zoomToFit) {
    core.zoomToFit();
  }

  // 4) Construir lista de componentes
  const assets = buildAssetsList(assetToMeshes);
  debugLog("Assets:", assets.map((a) => a.key));

  // 5) Interacción selección
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode,
  });

  // 6) Facade app para UI
  const app = createAppFacade(core, robot, assets);

  // 7) UI
  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);
  app.componentsPanel = comps;

  // 8) SFX opcional
  if (clickAudioDataURL) {
    try {
      installClickSound(clickAudioDataURL);
    } catch (e) {
      debugLog("installClickSound error", e);
    }
  }

  // 9) IA batch único
  if (IA_Widgets) {
    debugLog("[IA] IA_Widgets = true → inicializando batch IA");
    try {
      await generateThumbnailsAndDescribeAll(app);
    } catch (e) {
      debugLog("[IA] Error generando descripciones:", e);
    }
  } else {
    debugLog("[IA] IA_Widgets = false → sin llamada IA");
  }

  // 10) Resize responsive
  if (typeof window !== "undefined" && typeof core.resize === "function") {
    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      core.resize(rect.width, rect.height);
    });
    ro.observe(container);
  }

  // Exponer app
  if (typeof window !== "undefined") {
    window.URDFViewer = window.URDFViewer || {};
    window.URDFViewer.__app = app;
  }

  const destroy = () => {
    try {
      comps.destroy && comps.destroy();
    } catch (_) {}
    try {
      tools.destroy && tools.destroy();
    } catch (_) {}
    try {
      inter.destroy && inter.destroy();
    } catch (_) {}
    try {
      core.destroy && core.destroy();
    } catch (_) {}
  };

  return { ...app, destroy };
}

/* ======================= App Facade ======================= */

function createAppFacade(core, robot, assets) {
  const app = {
    core,
    robot,
    assets,
    componentsPanel: null,
    _selection: null,
    descriptionsMap: {},

    isolate(key) {
      if (!robot || !key) return;
      robot.traverse((o) => {
        if (o.isMesh && o.geometry) o.visible = false;
      });
      robot.traverse((o) => {
        if (o.isMesh && o.geometry && o.userData && o.userData.__assetKey === key) {
          o.visible = true;
        }
      });
      if (core.requestRender) core.requestRender();
    },

    showAll() {
      if (!robot) return;
      robot.traverse((o) => {
        if (o.isMesh && o.geometry) o.visible = true;
      });
      if (core.requestRender) core.requestRender();
    },

    setSelection(key) {
      this._selection = key;
      if (this.componentsPanel && this.componentsPanel.setActive) {
        this.componentsPanel.setActive(key);
      }
    },

    getSelection() {
      return this._selection;
    },
  };

  return app;
}

/* ======================= Assets helpers ======================= */

function rebuildAssetMapFromRobot(robot, assetToMeshes) {
  robot.traverse((o) => {
    if (o && o.isMesh && o.geometry) {
      const key =
        (o.userData && (o.userData.__assetKey || o.userData.assetKey || o.userData.filename)) ||
        null;
      if (!key) return;
      const arr = assetToMeshes.get(key) || [];
      arr.push(o);
      assetToMeshes.set(key, arr);
    }
  });
}

function buildAssetsList(assetToMeshes) {
  const list = [];
  assetToMeshes.forEach((meshes, key) => {
    if (!meshes || !meshes.length) return;
    const clean = String(key || "");
    list.push({
      key: clean,
      name: clean.split("/").pop(),
      thumb: null,
      desc: "",
    });
  });
  list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!list.length) {
    list.push({ key: "model", name: "model", thumb: null, desc: "" });
  }
  return list;
}

/* ======================= IA Batch ======================= */

const TARGET_API_BYTES = 5 * 1024; // ~5KB

async function generateThumbnailsAndDescribeAll(app) {
  const { core, robot, assets } = app;
  if (!core || !robot || !assets || !assets.length) {
    debugLog("[IA] Sin core/robot/assets para procesar.");
    return;
  }

  const mainCanvas = getViewerCanvas(core);
  if (!mainCanvas) {
    debugLog("[IA] No se encontró canvas principal.");
    return;
  }

  const originalState = snapshotVisibility(robot);

  // 1) Contexto: ISO del robot completo
  let contextEntry = null;
  try {
    showAll(robot);
    setIsoView(core, robot);
    forceRender(core);

    const isoDataURL = mainCanvas.toDataURL("image/png");
    const isoB64 = isoDataURL.split(",")[1] || "";
    const isoSmall = await compressBase64ToTargetSize(isoB64, TARGET_API_BYTES);

    contextEntry = {
      assetKey: "__context_iso__",
      image_b64: isoSmall,
      mime: "image/jpeg",
      is_context: true,
    };
    debugLog("[IA] Contexto ISO listo.");
  } catch (e) {
    debugLog("[IA] Error generando contexto ISO:", e);
  }

  // 2) Thumbnails por componente
  const entries = [];
  Base64Images.length = 0;

  for (const comp of assets) {
    try {
      applyIsolationForKey(robot, comp.key);
      setIsoView(core, robot, comp.key);
      forceRender(core);

      const url = mainCanvas.toDataURL("image/png");
      comp.thumb = url;

      const rawB64 = url.split(",")[1] || "";
      const smallB64 = await compressBase64ToTargetSize(rawB64, TARGET_API_BYTES);

      if (smallB64) {
        entries.push({
          assetKey: comp.key,
          image_b64: smallB64,
          mime: "image/jpeg",
          is_context: false,
        });
        Base64Images.push(smallB64);
      }
    } catch (e) {
      debugLog("[IA] Error thumbnail componente", comp.key, e);
    }
  }

  // 3) Restaurar visibilidad global
  restoreVisibility(robot, originalState);
  showAll(robot);
  forceRender(core);

  if (typeof window !== "undefined") {
    window.Base64Images = Base64Images;
  }

  // 4) Llamar a Colab (batch único)
  const hasColab =
    typeof window !== "undefined" &&
    window.google &&
    window.google.colab &&
    window.google.colab.kernel &&
    typeof window.google.colab.kernel.invokeFunction === "function";

  if (!hasColab) {
    debugLog("[IA] Entorno sin Colab; no se llama a describe_component_images.");
    return;
  }

  const allEntries = [];
  if (contextEntry) allEntries.push(contextEntry);
  allEntries.push(...entries);

  if (!allEntries.length) {
    debugLog("[IA] No hay entradas para IA.");
    return;
  }

  debugLog("[IA] Enviando", allEntries.length, "imágenes a describe_component_images...");

  let res;
  try {
    res = await window.google.colab.kernel.invokeFunction(
      "describe_component_images",
      [allEntries],
      {}
    );
  } catch (e) {
    debugLog("[IA] Error invokeFunction:", e);
    return;
  }

  const payload = extractPayload(res);
  const map = (payload && payload.descriptions) || payload || {};
  if (!map || typeof map !== "object") {
    debugLog("[IA] Respuesta IA sin mapa utilizable:", payload);
    return;
  }

  // 5) Aplicar descripciones
  app.descriptionsMap = map;

  for (const comp of assets) {
    const d = map[comp.key];
    if (typeof d === "string" && d.trim()) {
      comp.desc = d.trim();
    }
  }

  if (app.componentsPanel && app.componentsPanel.refreshDescriptions) {
    app.componentsPanel.refreshDescriptions();
  }

  debugLog("[IA] Descripciones aplicadas a componentes.");
}

/* ======================= IA helpers ======================= */

function getViewerCanvas(core) {
  if (core && core.renderer && core.renderer.domElement) {
    return core.renderer.domElement;
  }
  const c = document.querySelector("canvas");
  return c || null;
}

function forceRender(core) {
  if (!core) return;
  if (core.renderOnce) core.renderOnce();
  else if (core.renderer && core.scene && core.camera) {
    core.renderer.render(core.scene, core.camera);
  }
}

function showAll(robot) {
  if (!robot) return;
  robot.traverse((o) => {
    if (o.isMesh && o.geometry) o.visible = true;
  });
}

function applyIsolationForKey(robot, key) {
  if (!robot || !key) return;
  robot.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const k =
        (o.userData && (o.userData.__assetKey || o.userData.assetKey || o.userData.filename)) ||
        null;
      o.visible = k === key;
    }
  });
}

function setIsoView(core, robot, _keyForFlavor) {
  if (!core || !core.camera || !robot) return;

  const box = new THREE.Box3().setFromObject(robot);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  const cam = core.camera;
  const dist = maxDim * 2.0;
  const az = Math.PI * 0.25;
  const el = Math.PI * 0.25;

  const dir = new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az)
  ).multiplyScalar(dist);

  cam.position.copy(center.clone().add(dir));
  cam.near = Math.max(maxDim / 1000, 0.001);
  cam.far = Math.max(maxDim * 1000, 1000);
  cam.updateProjectionMatrix();
  cam.lookAt(center);

  if (core.controls) {
    core.controls.target.copy(center);
    core.controls.update();
  }
}

function snapshotVisibility(root) {
  const vis = new Map();
  if (!root) return vis;
  root.traverse((o) => {
    if (o.isMesh && o.geometry) vis.set(o.id, o.visible);
  });
  return vis;
}

function restoreVisibility(root, vis) {
  if (!root || !vis) return;
  root.traverse((o) => {
    if (o.isMesh && o.geometry && vis.has(o.id)) {
      o.visible = vis.get(o.id);
    }
  });
}

async function compressBase64ToTargetSize(base64Input, targetBytes) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // Ajuste solo por calidad para mantener forma
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        let quality = 0.85;
        let outB64 = canvas.toDataURL("image/jpeg", quality).split(",")[1];
        let iter = 0;

        while (outB64.length > targetBytes * 1.4 && iter < 8) {
          quality *= 0.7;
          if (quality < 0.12) break;
          outB64 = canvas.toDataURL("image/jpeg", quality).split(",")[1];
          iter++;
        }

        resolve(outB64 || base64Input);
      };
      img.onerror = () => resolve(base64Input);
      img.src = "data:image/png;base64," + base64Input;
    } catch (e) {
      debugLog("[IA] compress error", e);
      resolve(base64Input);
    }
  });
}

function extractPayload(res) {
  if (!res) return null;
  if (res.data) {
    // Formato típico de Colab
    const d = res.data;
    if (typeof d === "object") {
      if (d["application/json"]) return d["application/json"];
      if (d["text/plain"]) {
        try {
          return JSON.parse(d["text/plain"]);
        } catch {
          return null;
        }
      }
      return d;
    }
  }
  return res;
}

/* ======================= Click sound ======================= */

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
    src.start();
  }

  if (typeof window !== "undefined") {
    window.__urdf_click__ = play;
  }
}

// Hook global opcional
if (typeof window !== "undefined") {
  window.URDFViewer = window.URDFViewer || {};
  window.URDFViewer.render = (opts) => {
    return render(opts);
  };
}
