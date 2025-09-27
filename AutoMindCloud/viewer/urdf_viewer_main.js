// /viewer/urdf_viewer_main.js
// Compose ViewerCore + AssetDB + Interaction + UI (Tools right, Components left)

import { THEME } from './Theme.js';
import { createViewer } from './core/ViewerCore.js';
import { buildAssetDB, createLoadMeshCb } from './core/AssetDB.js';
import { attachInteraction } from './interaction/SelectionAndDrag.js';
import { createToolsDock } from './ui/ToolsDock.js';
import { createComponentsPanel } from './ui/ComponentsPanel.js';

export function render(opts = {}) {
  const {
    container,
    urdfContent,
    meshDB,
    selectMode = 'link',
    background = THEME.colors?.canvasBg ?? 0xf6fbfb,
    clickAudioDataURL = null
  } = opts || {};
  if (!container) throw new Error('[urdf_viewer_main] container required');

  // Viewer core
  const app = createViewer({ container, background, clickAudioDataURL });

  // Assets
  const assets = buildAssetDB(meshDB || {});
  app.setLoadMeshCallback(createLoadMeshCb(assets));

  // Load URDF
  if (urdfContent) app.loadURDF(urdfContent);

  // Interaction (selection, drag, key 'i' focus/iso)
  attachInteraction({
    scene: app.scene,
    camera: app.camera,
    renderer: app.renderer,
    controls: app.controls,
    robot: app.robot,
    selectMode
  });

  // UI: Tools (derecha) + Components (izquierda)
  const tools = createToolsDock(app, THEME);
  const components = createComponentsPanel(app, THEME);

  // Exponer por si necesitas desde fuera
  return { app, tools, components };
}

