// /viewer/urdf_viewer_main.js
// Entrypoint: ViewerCore + AssetDB + Interaction + Tools + Components + IA hooks

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
  } = opts;

  if (!container) {
    throw new Error("[URDF] Falta 'container' en opts.render");
  }

  // 🔧 Fix layout (especialmente cuando hay IA widgets)
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
    components: [],
    descriptions: {}, // { assetKey: "texto" }
    listeners: {},    // eventos simples
  };

  // =============== Event Emitter simple ===================
  app.on = (event, cb) => {
    if (!app.listeners[event]) app.listeners[event] = [];
    app.listeners[event].push(cb);
  };

  app.emit = (event, payload) => {
    (app.listeners[event] || []).forEach((cb) => {
      try { cb(payload); } catch (e) { console.error(e); }
    });
  };

  // =============== Componentes desde assetDB ==============
  // Ajusta según cómo estés guardando meshes en AssetDB.
  const meshKeys = Object.keys(assetDB.meshes || assetDB || {});
  app.components = meshKeys.map((key) => ({
    key,
    label: key,
    description: "",
  }));

  app.getComponents = () => app.components.slice();

  app.getDescription = (assetKey) => {
    return app.descriptions[assetKey] || "";
  };

  // =============== IA: recibir descripciones ==============
  app.setComponentDescriptions = (mapping) => {
    if (!mapping || typeof mapping !== "object") {
      console.warn("[Components] mapping inválido en setComponentDescriptions:", mapping);
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
      console.warn("[Components] Respuesta sin descripciones utilizables.", mapping);
    } else {
      console.log(`[Components] ${updated} descripciones actualizadas.`);
    }

    app.emit("descriptionsUpdated", app.descriptions);
  };

  // =============== Control de vista (aislar/mostrar) ======
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

  // =============== Captura de thumbnails ==================
  // Se llama desde Python inmediatamente tras render().
  // Devuelve: [ { assetKey, image_b64 }, ... ]
  app.captureComponentThumbnails = async () => {
    const viewer = core;
    if (
      !viewer ||
      !viewer.renderer ||
      !viewer.camera ||
      !viewer.scene ||
      typeof viewer.renderer.getSize !== "function"
    ) {
      console.warn("[Thumbs] Viewer incompleto para capturas.");
      return [];
    }

    const entries = [];
    const originalSize = viewer.renderer.getSize
      ? viewer.renderer.getSize(new THREE.Vector2())
      : { x: 512, y: 512 };

    for (const comp of app.components) {
      const assetKey = comp.key;
      if (!assetKey) continue;

      try {
        if (typeof core.isolate === "function") {
          core.isolate(assetKey);
        }

        if (typeof core.fitCameraToSelection === "function") {
          await core.fitCameraToSelection(0.0); // sin animación, rápido
        }

        // Tamaño pequeño para IA (optimiza tokens/tiempo)
        if (viewer.renderer.setSize) {
          viewer.renderer.setSize(256, 256, false);
        }

        viewer.renderer.render(viewer.scene, viewer.camera);
        const dataURL = viewer.renderer.domElement.toDataURL("image/png");
        const b64 = dataURL.replace(/^data:image\/png;base64,/, "");

        entries.push({
          assetKey,
          image_b64: b64,
        });
      } catch (err) {
        console.error("[Thumbs] Error capturando componente", assetKey, err);
      }
    }

    // Restaurar vista
    try {
      if (typeof core.showAll === "function") core.showAll();
      if (viewer.renderer.setSize && originalSize.x && originalSize.y) {
        viewer.renderer.setSize(originalSize.x, originalSize.y, false);
        viewer.renderer.render(viewer.scene, viewer.camera);
      }
    } catch (err) {
      console.error("[Thumbs] Error restaurando viewer:", err);
    }

    console.log("[Thumbs] Capturas generadas:", entries.length);
    return entries;
  };

  // =============== Interacción y UI =======================

  attachInteraction({
    core,
    assetDB,
    selectMode,
    clickAudioDataURL,
    app,
  });

  createToolsDock(app, THEME);
  createComponentsPanel(app, THEME);

  console.log("[URDF] Viewer inicializado correctamente.");
  return app;
}
