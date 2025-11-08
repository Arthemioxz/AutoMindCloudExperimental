// /viewer/urdf_viewer_main.js
// Entrypoint del viewer: ViewerCore + AssetDB + Interaction + Tools + Components + Hooks IA/Thumbnails

import { THEME } from "./Theme.js";
import { createViewer } from "./core/ViewerCore.js";
import { buildAssetDB } from "./core/AssetDB.js";
import { attachInteraction } from "./interaction/SelectionAndDrag.js";
import { createToolsDock } from "./ui/ToolsDock.js";
import { createComponentsPanel } from "./ui/ComponentsPanel.js";

export function render(opts = {}) {
  const {
    container,
    urdfContent = "",
    meshDB = {},
    selectMode = "link",
    background = THEME.bgCanvas || 0x111111,
    clickAudioDataURL = null,
    enableIA = true, // 🔹 controlado por IA_Widgets desde Python
  } = opts;

  if (!container) {
    throw new Error("[URDF] Falta container en render(opts).");
  }

  // Layout base estable
  container.style.position = "relative";
  if (!container.style.width) container.style.width = "100%";
  if (!container.style.height) container.style.height = "600px";
  container.style.overflow = "hidden";

  const core = createViewer({
    container,
    background,
    urdfContent,
    meshDB,
  });

  const assetDB = buildAssetDB(meshDB);

  const app = {
    core,
    assetDB,
    selectMode,
    clickAudioDataURL,
    enableIA,
    components: [],
    descriptions: {},      // { assetKey: desc }
    thumbnails: {},        // { assetKey: dataURL }
    listeners: {},         // event emitter simple
  };

  // ========= Event Emitter =========
  app.on = (ev, cb) => {
    if (!app.listeners[ev]) app.listeners[ev] = [];
    app.listeners[ev].push(cb);
  };

  app.emit = (ev, payload) => {
    (app.listeners[ev] || []).forEach((cb) => {
      try {
        cb(payload);
      } catch (e) {
        console.error(e);
      }
    });
  };

  // ========= Inicializar componentes =========
  const meshKeys = Object.keys(assetDB.meshes || assetDB || {});
  app.components = meshKeys.map((key) => ({
    key,
    label: key,
    description: "",
    thumbDataUrl: null,
  }));

  app.getComponents = () => app.components.slice();

  app.getDescription = (assetKey) =>
    app.descriptions[assetKey] || "";

  // ========= Descripciones IA =========
  app.setComponentDescriptions = (mapping) => {
    if (!mapping || typeof mapping !== "object") {
      console.warn("[IA] mapping inválido en setComponentDescriptions:", mapping);
      return;
    }

    let updated = 0;
    for (const [key, desc] of Object.entries(mapping)) {
      if (typeof desc === "string" && desc.trim()) {
        const cleanKey = String(key);
        const cleanDesc = desc.trim();
        app.descriptions[cleanKey] = cleanDesc;

        const comp = app.components.find((c) => c.key === cleanKey);
        if (comp) {
          comp.description = cleanDesc;
        }
        updated++;
      }
    }

    if (!updated) {
      console.warn("[IA] Respuesta sin descripciones utilizables:", mapping);
    } else {
      console.log(`[IA] ${updated} descripciones aplicadas.`);
    }

    app.emit("descriptionsUpdated", app.descriptions);
  };

  // ========= Thumbnails locales =========
  app.setComponentThumbnails = (entries) => {
    if (!Array.isArray(entries)) {
      console.warn("[Thumbs] entries inválido en setComponentThumbnails:", entries);
      return;
    }

    let count = 0;
    for (const e of entries) {
      const key = e.assetKey;
      const dataUrl = e.data_url || e.dataURL;
      if (!key || !dataUrl) continue;

      app.thumbnails[key] = dataUrl;

      const comp = app.components.find((c) => c.key === key);
      if (comp) {
        comp.thumbDataUrl = dataUrl;
        count++;
      }
    }

    console.log(`[Thumbs] Thumbnails asignados a ${count} componentes.`);
    app.emit("thumbnailsUpdated", app.thumbnails);
  };

  app.captureComponentThumbnails = async () => {
    const viewer = core;
    if (
      !viewer ||
      !viewer.renderer ||
      !viewer.camera ||
      !viewer.scene ||
      typeof viewer.renderer.render !== "function"
    ) {
      console.warn("[Thumbs] Viewer no listo para capturar.");
      return [];
    }

    const r = viewer.renderer;
    let origW = 512;
    let origH = 512;
    try {
      if (typeof r.getSize === "function") {
        const size = r.getSize(new THREE.Vector2());
        origW = size.x;
        origH = size.y;
      }
    } catch (_) {}

    const entries = [];

    for (const comp of app.components) {
      const assetKey = comp.key;
      if (!assetKey) continue;

      try {
        if (typeof core.isolate === "function") {
          core.isolate(assetKey);
        }

        if (typeof core.fitCameraToSelection === "function") {
          await core.fitCameraToSelection(0.0);
        }

        if (typeof r.setSize === "function") {
          r.setSize(256, 256, false);
        }

        r.render(viewer.scene, viewer.camera);
        const dataUrl = r.domElement.toDataURL("image/png");
        const image_b64 = dataUrl.replace(/^data:image\\/png;base64,/, "");

        entries.push({
          assetKey,
          data_url: dataUrl,
          image_b64,
        });
      } catch (err) {
        console.error("[Thumbs] Error capturando", assetKey, err);
      }
    }

    // Restaurar escena
    try {
      if (typeof core.showAll === "function") {
        core.showAll();
      }
      if (typeof r.setSize === "function") {
        r.setSize(origW, origH, false);
        r.render(viewer.scene, viewer.camera);
      }
    } catch (err) {
      console.error("[Thumbs] Error restaurando viewer:", err);
    }

    console.log("[Thumbs] Capturas generadas:", entries.length);
    return entries;
  };

  // ========= Controles de vista =========
  app.isolate = (assetKey) => {
    if (!assetKey) return;
    if (typeof core.isolate === "function") {
      core.isolate(assetKey);
    } else {
      console.warn("[URDF] core.isolate no definido");
    }
  };

  app.showAll = () => {
    if (typeof core.showAll === "function") {
      core.showAll();
    } else {
      console.warn("[URDF] core.showAll no definido");
    }
  };

  // ========= Interacción + UI =========
  attachInteraction({
    core,
    assetDB,
    selectMode,
    clickAudioDataURL,
    app,
  });

  createToolsDock(app, THEME);
  createComponentsPanel(app, THEME);

  console.log("[URDF] Viewer inicializado. enableIA =", enableIA);
  return app;
}
