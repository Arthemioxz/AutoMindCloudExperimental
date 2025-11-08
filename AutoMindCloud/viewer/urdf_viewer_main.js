// /viewer/urdf_viewer_main.js
// Entrypoint que compone ViewerCore + AssetDB + Interaction + Tools + ComponentsPanel
// No rompe tu ComponentsPanel.js grande; solo expone las APIs que necesita.

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
    throw new Error("[URDF] Falta 'container' en render(opts).");
  }

  // Layout básico estable
  container.style.position = container.style.position || "relative";
  if (!container.style.width) container.style.width = "100%";
  if (!container.style.height) container.style.height = "600px";
  container.style.overflow = "hidden";

  // Core viewer
  const core = createViewer({
    container,
    background,
    urdfContent,
    meshDB,
  });

  // AssetDB / thumbalist / listado de componentes
  const assetDB = buildAssetDB(meshDB);

  const app = {
    core,
    renderer: core.renderer,
    scene: core.scene,
    camera: core.camera,
    assets: assetDB,      // 👈 ComponentsPanel usa app.assets.list / thumbnail
    selectMode,
    clickAudioDataURL,
  };

  // ---- APIs requeridas por ComponentsPanel.js ----

  // Aislar por asset
  app.isolate = app.isolate || {};
  app.isolate.asset = (assetKey) => {
    if (core && typeof core.isolate === "function") {
      core.isolate(assetKey);
    } else {
      console.warn("[URDF] core.isolate no definido");
    }
  };

  // Mostrar todo
  app.showAll = () => {
    if (core && typeof core.showAll === "function") {
      core.showAll();
    } else {
      console.warn("[URDF] core.showAll no definido");
    }
  };

  // Mapa opcional de descripciones IA (lo llenamos desde URDF_Render_Script)
  app.componentDescriptions = app.componentDescriptions || {};

  // Getter opcional (también se setea desde URDF_Render_Script si no existe)
  app.getComponentDescription = app.getComponentDescription || function (assetKey, index) {
    const direct = app.componentDescriptions[assetKey];
    if (direct) return direct;

    const base = String(assetKey || "").split("/").pop().split("?")[0].split("#")[0];
    const dot = base.lastIndexOf(".");
    const bare = dot >= 0 ? base.slice(0, dot) : base;

    return (
      app.componentDescriptions[base] ||
      app.componentDescriptions[bare] ||
      ""
    );
  };

  // ---- Interacción, tools dock, panel de componentes ----

  attachInteraction({
    core,
    assetDB,
    selectMode,
    clickAudioDataURL,
    app,
  });

  createToolsDock(app, THEME);
  createComponentsPanel(app, THEME);

  console.log("[URDF] Viewer + ComponentsPanel inicializados.");
  return app;
}
