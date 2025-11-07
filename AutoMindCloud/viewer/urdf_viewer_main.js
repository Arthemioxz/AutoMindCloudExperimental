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
 * @param {Object} opts.options - optional configuration
 */
export async function renderURDFViewer({ container, options = {} }) {
  const app = {};
  app.theme = THEME;

  // ──────────────────────────────
  // Core viewer + interaction
  // ──────────────────────────────
  const viewer = createViewer(container, app.theme);
  const assetDB = buildAssetDB(viewer);
  attachInteraction(viewer, assetDB, app.theme);

  // ──────────────────────────────
  // UI Panels
  // ──────────────────────────────
  const toolsDock = createToolsDock(app, viewer, assetDB);
  const componentsPanel = createComponentsPanel(app, assetDB);
  window._componentsPanel = componentsPanel; // global ref para updates incrementales
  container.appendChild(toolsDock);
  container.appendChild(componentsPanel);

  // ──────────────────────────────
  // Cargar robot / URDF
  // ──────────────────────────────
  const urdfUrl = options.urdfUrl || './robot.urdf';
  const loadMeshCb = createLoadMeshCb(assetDB);
  await viewer.loadURDF(urdfUrl, loadMeshCb);

  // ──────────────────────────────
  // Generar thumbnails (una vez)
  // ──────────────────────────────
  const entries = await assetDB.snapshotAllAssets(viewer);
  console.log(`📸 ${entries.length} capturas generadas.`);

  // ──────────────────────────────
  // Analizar imágenes en mini-batches
  // ──────────────────────────────
  async function analyzeInBatches(entries, batchSize = 8) {
    const allDescriptions = {};

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      console.log(`🧩 Enviando batch ${i / batchSize + 1} (${batch.length} imágenes)...`);

      try {
        const result = await google.colab.kernel.invokeFunction(
          "describe_component_images",
          [batch],
          {}
        );

        // Parse result safely
        const text = result.data["text/plain"];
        const partial = typeof text === "string" ? JSON.parse(text) : text;

        Object.assign(allDescriptions, partial);

        // 🔹 Actualizar UI incrementalmente
        if (window._componentsPanel && partial) {
          window._componentsPanel.updateDescriptions(partial);
        }

      } catch (err) {
        console.error("⚠️ Error procesando batch:", err);
      }
    }

    return allDescriptions;
  }

  // ──────────────────────────────
  // Ejecutar descripción incremental
  // ──────────────────────────────
  console.log("🧠 Analizando componentes...");
  app.componentDescriptions = await analyzeInBatches(entries, 8);
  console.log("✅ Descripciones completas listas.");
}
