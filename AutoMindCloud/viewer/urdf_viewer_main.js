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
    meshDB = {},
    selectMode = 'link',
    background = THEME.colors?.canvasBg ?? 0xf6fbfb,
    clickAudioDataURL = null
  } = opts || {};
  if (!container) throw new Error('[urdf_viewer_main] container required');

  // 1) Viewer core
  const app = createViewer({ container, background });

  // 2) Asset DB y callback para URDFLoader (NO existe app.setLoadMeshCallback)
  const assetDB = buildAssetDB(meshDB);
  const loadMeshCb = createLoadMeshCb(assetDB);

  // 3) Cargar URDF pasando el callback correcto
  if (urdfContent) app.loadURDF(urdfContent, { loadMeshCb });

  // 4) Interacción (selección/arrastre + tecla 'i' focus/iso con distancia fija)
  attachInteraction({
    scene: app.scene,
    camera: app.camera,
    renderer: app.renderer,
    controls: app.controls,
    robot: app.robot,
    selectMode
  });

  // 5) UI: Tools (derecha, hotkey 'h') + Components (izquierda, hotkey 'c')
  const tools = createToolsDock(app, THEME);
  const components = createComponentsPanel(app, THEME);

  // 6) (Opcional) sonido de click de UI
  setupClickSfx(clickAudioDataURL);

  // Exponer por si lo necesitas desde fuera
  return { app, tools, components };
}

/* --------------------- SFX opcional --------------------- */
function setupClickSfx(dataURL) {
  if (!dataURL || typeof window === 'undefined') {
    window.__urdf_click__ = () => {};
    return;
  }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  fetch(dataURL).then(r => r.arrayBuffer()).then(buf => ctx.decodeAudioData(buf)).then(audioBuf => {
    window.__urdf_click__ = () => {
      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(ctx.destination);
      try { src.start(0); } catch (_) {}
    };
  }).catch(() => { window.__urdf_click__ = () => {}; });
}

/* --------------------- Global UMD-style hook -------------------- */
if (typeof window !== 'undefined') {
  window.URDFViewer = { render };
}
