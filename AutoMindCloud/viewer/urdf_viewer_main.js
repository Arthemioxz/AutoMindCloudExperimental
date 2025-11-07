// /viewer/urdf_viewer_main.js
// Entrypoint que compone ViewerCore + AssetDB + Selection & Drag + UI.
/* global google */

import { THEME } from './Theme.js';
import { createViewer } from './core/ViewerCore.js';
import { buildAssetDB, createLoadMeshCb, snapshotAllAssets } from './core/AssetDB.js';
import { attachInteraction } from './interaction/SelectionAndDrag.js';
import { createToolsDock } from './ui/ToolsDock.js';
import { createComponentsPanel } from './ui/ComponentsPanel.js';

/**
 * Único entrypoint público.
 * Llamado desde Colab: mod.render(opts)
 *
 * opts:
 *  - container
 *  - urdfContent (string)
 *  - meshDB (obj key->b64)
 *  - selectMode
 *  - background
 *  - pixelRatio
 */
export function render(opts = {}) {
  const {
    container,
    urdfContent = '',
    meshDB = {},
    selectMode = 'link',
    background = 0xffffff,
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2),
    autoResize = true
  } = opts;

  if (!container) {
    throw new Error('[urdf_viewer_main] opts.container requerido');
  }

  const app = {};
  app.theme = THEME;

  // ---------- Core viewer ----------
  const viewer = createViewer({
    container,
    background,
    pixelRatio,
    autoResize
  });

  app.viewer = viewer;
  app.scene = viewer.scene;
  app.camera = viewer.camera;
  app.renderer = viewer.renderer;
  app.controls = viewer.controls;

  // ---------- Asset DB ----------
  const assetDB = buildAssetDB(meshDB);
  app.assetDB = assetDB;

  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, key) {
      // hook opcional (ya se etiqueta __assetKey)
    }
  });

  // Carga URDF desde string
  viewer.loadURDF(urdfContent, { loadMeshCb });

  // ---------- Interaction ----------
  const inter = attachInteraction({
    scene: viewer.scene,
    camera: viewer.camera,
    renderer: viewer.renderer,
    controls: viewer.controls,
    robot: null,
    selectMode
  });

  // ---------- App helpers que usa ComponentsPanel ----------
  app.descriptions = {};
  app.descriptionsReady = false;
  app.getComponentDescription = (key) => app.descriptions[key] || '';

  const assets = {
    entries: [],
    thumbs: new Map(),
    async list() {
      return this.entries;
    },
    async thumbnail(key) {
      return this.thumbs.get(key) || '';
    }
  };
  app.assets = assets;

  app.isolate = {
    asset(assetKey) {
      const robot = viewer.robot;
      if (!robot || !assetKey) return;
      const keySet = new Set([assetKey]);
      robot.traverse((o) => {
        if (o.isMesh) {
          const k = o.userData && o.userData.__assetKey;
          o.visible = !!(k && keySet.has(k));
        }
      });
      viewer.requestRender && viewer.requestRender();
    }
  };
  app.showAll = function () {
    const robot = viewer.robot;
    if (!robot) return;
    robot.traverse((o) => {
      if (o.isMesh) o.visible = true;
    });
    viewer.requestRender && viewer.requestRender();
  };

  // ---------- UI ----------
  createToolsDock(app, app.theme);
  const componentsPanel = createComponentsPanel(app, app.theme);
  window._componentsPanel = componentsPanel; // para debug/manual si quieres

  // ---------- Esperar robot & lanzar descripción ----------
  async function waitForRobot(maxMs = 8000) {
    const start = performance.now();
    while (!viewer.robot && performance.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 40));
    }
    return !!viewer.robot;
  }

  function colabAvailable() {
    try {
      return !!(google && google.colab && google.colab.kernel);
    } catch {
      return false;
    }
  }

  function invokeDescribe(entries) {
    // wrapper para google.colab.kernel.invokeFunction
    return google.colab.kernel.invokeFunction(
      'describe_component_images',
      [entries],
      {}
    );
  }

  async function runDescriptions() {
    if (!colabAvailable()) {
      console.warn('[urdf_viewer_main] No Colab kernel detectado: sin descripciones.');
      return;
    }

    const ok = await waitForRobot();
    if (!ok) {
      console.warn('[urdf_viewer_main] Robot no cargó a tiempo.');
      return;
    }

    // informa interacción del robot al módulo de selección
    try {
      inter.setRobot && inter.setRobot(viewer.robot);
    } catch (_) {}

    // Construye mapa de conteos por assetKey
    const countByKey = new Map();
    viewer.robot.traverse((o) => {
      const k = o.userData && o.userData.__assetKey;
      if (k && o.isMesh) {
        countByKey.set(k, (countByKey.get(k) || 0) + 1);
      }
    });

    // 1) Thumbnails low-res (una sola pasada)
    const snaps = await snapshotAllAssets(viewer, { maxSize: 224 });
    const thumbsByKey = new Map();
    snaps.forEach((e) => {
      if (e.key && e.image_b64) {
        thumbsByKey.set(e.key, `data:image/png;base64,${e.image_b64}`);
      }
    });

    // 2) Lista de componentes (solo claves presentes en snaps)
    const entries = [];
    thumbsByKey.forEach((url, key) => {
      const baseName = key.split('/').pop() || key;
      const dot = baseName.lastIndexOf('.');
      const base = dot >= 0 ? baseName.slice(0, dot) : baseName;
      const ext = dot >= 0 ? baseName.slice(dot + 1) : '';
      entries.push({
        assetKey: key,
        base,
        ext,
        count: countByKey.get(key) || 1
      });
    });
    entries.sort((a, b) => a.base.localeCompare(b.base));

    assets.entries = entries;
    assets.thumbs = thumbsByKey;

    if (componentsPanel && componentsPanel.refresh) {
      componentsPanel.refresh();
    }

    console.log(`[urdf_viewer_main] ${entries.length} componentes con thumbnail.`);

    // 3 mecanismos sobre estos entries (JS lado) para incremental UI:
    const payload = snaps; // [{key,image_b64},...]

    const allDesc = {};

    // ---- M1: batch único ----
    try {
      console.log('[urdf_viewer_main] M1: batch único a describe_component_images');
      const res = await invokeDescribe(payload);
      const text = res.data && res.data['text/plain'];
      const parsed = typeof text === 'string' ? JSON.parse(text) : text;
      if (parsed && typeof parsed === 'object') {
        Object.assign(allDesc, parsed);
        Object.assign(app.descriptions, parsed);
        if (componentsPanel && componentsPanel.updateDescriptions) {
          componentsPanel.updateDescriptions(parsed);
        }
        console.log('[urdf_viewer_main] ✅ M1 OK');
        app.descriptionsReady = true;
        return;
      }
      console.warn('[urdf_viewer_main] ⚠️ M1 sin JSON usable, paso a M2.');
    } catch (err) {
      console.warn('[urdf_viewer_main] ⚠️ M1 falló, paso a M2:', err);
    }

    // ---- M2: mini-batches + incremental ----
    const BATCH = 8;
    for (let i = 0; i < payload.length; i += BATCH) {
      const batch = payload.slice(i, i + BATCH);
      const label = i / BATCH + 1;
      try {
        console.log(`[urdf_viewer_main] M2: batch ${label} (${batch.length})`);
        const res = await invokeDescribe(batch);
        const text = res.data && res.data['text/plain'];
        const partial = typeof text === 'string' ? JSON.parse(text) : text;
        if (partial && typeof partial === 'object') {
          Object.assign(allDesc, partial);
          Object.assign(app.descriptions, partial);
          if (componentsPanel && componentsPanel.updateDescriptions) {
            componentsPanel.updateDescriptions(partial);
          }
          continue;
        }
        console.warn(`[urdf_viewer_main] ⚠️ M2 batch ${label} sin JSON objeto, uso M3 para este batch.`);
        await runSingles(batch, allDesc, componentsPanel, app);
      } catch (e) {
        console.warn(`[urdf_viewer_main] ⚠️ M2 batch ${label} error, paso a M3 para este batch:`, e);
        await runSingles(batch, allDesc, componentsPanel, app);
      }
    }

    app.descriptionsReady = true;
    console.log('[urdf_viewer_main] ✅ Descripciones completadas con M2/M3.');

    async function runSingles(batch, acc, panel, appRef) {
      for (const entry of batch) {
        if (acc[entry.key]) continue;
        try {
          const res = await invokeDescribe([entry]);
          const text = res.data && res.data['text/plain'];
          let desc = '';
          try {
            const parsed = typeof text === 'string' ? JSON.parse(text) : text;
            if (typeof parsed === 'string') {
              desc = parsed;
            } else if (parsed && typeof parsed === 'object') {
              const k = Object.keys(parsed)[0];
              if (k) desc = parsed[k];
            } else {
              desc = String(text || '');
            }
          } catch {
            desc = String(text || '');
          }
          desc = (desc || '').trim();
          acc[entry.key] = desc;
          appRef.descriptions[entry.key] = desc;
          if (panel && panel.updateDescriptions) {
            panel.updateDescriptions({ [entry.key]: desc });
          }
          console.log('[urdf_viewer_main] ✅ M3 single OK', entry.key);
        } catch (e) {
          console.warn('[urdf_viewer_main] ❌ M3 single fallo', entry.key, e);
          acc[entry.key] = '';
          appRef.descriptions[entry.key] = '';
        }
      }
    }
  }

  // fire and forget
  runDescriptions();

  // Exponer por si quieres debugear
  window.URDF_APP = app;

  return app;
}
