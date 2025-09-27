// /viewer/urdf_viewer_main.js
// Entrypoint that composes ViewerCore + AssetDB + Selection & Drag + UI (Tools & Components)

import { THEME } from './Theme.js';
import { createViewer } from './core/ViewerCore.js';
import { buildAssetDB, createLoadMeshCb } from './core/AssetDB.js';
import { attachInteraction } from './interaction/SelectionAndDrag.js';
import { createToolsDock } from './ui/ToolsDock.js';
import { createComponentsPanel } from './ui/ComponentsPanel.js';

/**
 * Public entry: render the URDF viewer.
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {string} opts.urdfContent              — URDF string
 * @param {Object.<string,string>} opts.meshDB   — key → dataURL/base64
 * @param {'link'|'mesh'} [opts.selectMode='link']
 * @param {number|null} [opts.background=THEME.colors.canvasBg]
 * @param {string|null} [opts.clickAudioDataURL] — optional UI SFX (not required)
 */
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

  // 2) Assets (DB + mesh loader callback)
  const assets = buildAssetDB(meshDB);
  const loadMeshCb = createLoadMeshCb(assets);

  // 3) Load URDF (pass the mesh callback here; there is no app.setLoadMeshCallback)
  if (urdfContent) app.loadURDF(urdfContent, { loadMeshCb });

  // 4) Interaction (hover/selection/drag + key 'i' focus/iso with fixed distance)
  attachInteraction({
    scene: app.scene,
    camera: app.camera,
    renderer: app.renderer,
    controls: app.controls,
    robot: app.robot,
    selectMode
  });

  // 5) UI: View Tools (RIGHT, hotkey 'h') + Components (LEFT, hotkey 'c')
  const tools = createToolsDock(app, THEME);
  const components = createComponentsPanel(app, THEME);

  // 6) Optional simple click SFX for UI
  setupClickSfx(clickAudioDataURL);

  // expose for external control if needed
  return { app, tools, components, assets };
}

/* --------------------- Optional SFX --------------------- */
function setupClickSfx(dataURL) {
  if (!dataURL || typeof window === 'undefined') {
    window.__urdf_click__ = () => {};
    return;
  }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  fetch(dataURL)
    .then(r => r.arrayBuffer())
    .then(buf => ctx.decodeAudioData(buf))
    .then(audioBuf => {
      window.__urdf_click__ = () => {
        const src = ctx.createBufferSource();
        src.buffer = audioBuf;
        src.connect(ctx.destination);
        try { src.start(0); } catch (_) {}
      };
    })
    .catch(() => { window.__urdf_click__ = () => {}; });
}

/* --------------------- Global UMD-style hook -------------------- */
if (typeof window !== 'undefined') {
  window.URDFViewer = { render };
}
