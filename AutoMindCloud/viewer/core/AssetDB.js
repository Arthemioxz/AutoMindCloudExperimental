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
 * @param {Object.<string,string>} opts.meshDB   — key → base64
 * @param {'link'|'mesh'} [opts.selectMode='link']
 * @param {number|null} [opts.background=THEME.bgCanvas]
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

  // Viewer core
  const app = createViewer({ container, background });

  // Assets
  const assets = buildAssetDB(meshDB);
  const loadMeshCb = createLoadMeshCb(assets);

  // Load URDF (passing loadMeshCb)
  if (urdfContent) app.loadURDF(urdfContent, { loadMeshCb });

  // Interaction (selection, drag, key 'i' focus/iso)
  attachInteraction({
    scene: app.scene,
    camera: app.camera,
    renderer: app.renderer,
    controls: app.controls,
    robot: app.robot,
    selectMode
  });

  // UI: Tools (right) + Components (left)
  const tools = createToolsDock(app, THEME);
  const components = createComponentsPanel(app, THEME);

  setupClickSfx(clickAudioDataURL);

  return { app, tools, components };
}

/* --------------------- SFX optional --------------------- */
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
      try { src.start(); } catch (_) {}
    };
  }).catch(() => {
    window.__urdf_click__ = () => {};
  });
}

/* --------------------- Global UMD-style hook -------------------- */

if (typeof window !== 'undefined') {
  window.URDFViewer = { render };
}
