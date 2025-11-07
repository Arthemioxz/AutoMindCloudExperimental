// /viewer/urdf_viewer_main.js
// Entrypoint principal del URDF Viewer + sistema de descripciones por mini-lotes.

import { THEME } from "./Theme.js";
import { createViewer } from "./core/ViewerCore.js";
import { buildAssetDB, createLoadMeshCb } from "./core/AssetDB.js";
import { attachInteraction } from "./interaction/SelectionAndDrag.js";
import { createToolsDock } from "./ui/ToolsDock.js";
import { createComponentsPanel } from "./ui/ComponentsPanel.js";

/**
 * render(opts)
 *  - container: HTMLElement
 *  - urdfContent: string
 *  - meshDB: { [path:string]: base64 }
 *  - selectMode: "link" | "joint" | ...
 *  - background: number | null
 *  - pixelRatio: number
 *  - autoResize: boolean
 */
export function render(opts = {}) {
  const {
    container,
    urdfContent,
    meshDB = {},
    selectMode = "link",
    background = 0xffffff,
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2),
    autoResize = true,
  } = opts;

  if (!container) {
    throw new Error("[urdf_viewer_main] Falta 'container'.");
  }
  if (!urdfContent) {
    throw new Error("[urdf_viewer_main] Falta 'urdfContent'.");
  }

  // =========================
  // Crear Viewer base
  // =========================
  const viewer = createViewer({
    container,
    background,
    pixelRatio,
  });

  const {
    scene,
    camera,
    controls,
    renderer,
    loadURDF,
    setProjection,
    setSceneToggles,
    getState,
    setState,
    resize,
  } = viewer;

  const app = {
    theme: THEME,
    scene,
    camera,
    controls,
    renderer,
    setProjection,
    setSceneToggles,
    getState,
    setState,
    resize,
  };

  // =========================
  // AssetDB + carga URDF
  // =========================
  const assetDB = buildAssetDB(meshDB);
  const loadMeshCb = createLoadMeshCb(assetDB);

  const robot = loadURDF(urdfContent, { loadMeshCb });
  app.robot = robot;

  // =========================
  // Selección / interacción
  // =========================
  attachInteraction({
    scene,
    camera,
    renderer,
    controls,
    robot,
    selectMode,
    app,
  });

  // =========================
  // ToolsDock + ComponentsPanel
  // =========================
  const toolsDock = createToolsDock(app, THEME);
  const componentsPanel = createComponentsPanel(app, THEME);

  app.toolsDock = toolsDock;
  app.componentsPanel = componentsPanel;

  // Exponer global opcional
  if (typeof window !== "undefined") {
    window._URDF_APP = app;
    window._componentsPanel = componentsPanel;
  }

  // =========================
  // Focus helper (para rows)
  // =========================
  app.focusComponent = function (assetKey) {
    if (!robot || !assetKey || !window.THREE) return;
    const THREE = window.THREE;
    const targets = [];

    robot.traverse((o) => {
      if (
        o.isMesh &&
        (o.userData?.__assetKey === assetKey ||
          o.userData?.assetKey === assetKey)
      ) {
        targets.push(o);
      }
    });

    if (!targets.length) return;

    const box = new THREE.Box3();
    targets.forEach((m) => box.expandByObject(m));
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    const fov = (camera.fov || 60) * (Math.PI / 180);
    const dist = maxDim / Math.tan(Math.max(1e-3, fov / 2));

    const dir = new THREE.Vector3(1, 0.7, 1).normalize();
    const pos = center.clone().add(dir.multiplyScalar(dist * 1.1));

    camera.position.copy(pos);
    camera.lookAt(center);
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
  };

  // =========================
  // Thumbalist: snapshots por componente
  //  - thumbDataUrl: para la lista (no se baja resolución).
  //  - image_b64: versión más pequeña solo para la API.
  // =========================
  async function snapshotComponents() {
    if (!robot || !window.THREE) return [];
    const THREE = window.THREE;

    const assetMeshes = new Map(); // assetKey -> [meshes]

    robot.traverse((o) => {
      const k =
        o?.userData?.__assetKey ||
        o?.userData?.assetKey ||
        o?.userData?.meshKey;
      if (o.isMesh && k) {
        if (!assetMeshes.has(k)) assetMeshes.set(k, []);
        assetMeshes.get(k).push(o);
      }
    });

    const keys = Array.from(assetMeshes.keys());
    if (!keys.length) {
      console.warn("[urdf_viewer_main] No se encontraron assetKeys en robot.");
      return [];
    }

    console.log(
      `[urdf_viewer_main] Generando thumbnails para ${keys.length} componentes...`
    );

    // Guardar estado original
    const orig = {
      camPos: camera.position.clone(),
      camUp: camera.up.clone(),
      ctrlTarget: controls ? controls.target.clone() : null,
      size: renderer.getSize(new THREE.Vector2()),
      pixelRatio: renderer.getPixelRatio(),
      vis: [],
    };

    robot.traverse((o) => {
      orig.vis.push({ o, visible: o.visible });
    });

    const entries = [];
    const tmpBox = new THREE.Box3();
    const tmpV = new THREE.Vector3();

    const MAX_THUMB = 512; // buena calidad para la UI
    const LOW_MAX = 320; // versión reducida para API

    for (const key of keys) {
      const meshes = assetMeshes.get(key) || [];
      if (!meshes.length) continue;

      // Ocultar todo
      orig.vis.forEach((v) => (v.o.visible = false));
      // Mostrar solo este componente
      meshes.forEach((m) => (m.visible = true));

      // Bounds
      tmpBox.makeEmpty();
      meshes.forEach((m) => tmpBox.expandByObject(m));
      if (tmpBox.isEmpty()) continue;

      const center = tmpBox.getCenter(tmpV.set(0, 0, 0));
      const size = tmpBox.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;

      const fov = (camera.fov || 60) * (Math.PI / 180);
      const dist = maxDim / Math.tan(Math.max(1e-3, fov / 2));

      const dir = new THREE.Vector3(1, 0.9, 1).normalize();
      const pos = center.clone().add(dir.multiplyScalar(dist * 1.4));

      camera.position.copy(pos);
      camera.lookAt(center);
      if (controls) {
        controls.target.copy(center);
        controls.update();
      }

      // Render hi-res para UI
      const baseW = orig.size.x || renderer.domElement.width || 640;
      const baseH = orig.size.y || renderer.domElement.height || 480;
      const scaleHi = Math.min(1, MAX_THUMB / Math.max(baseW, baseH));
      const wHi = Math.max(96, Math.round(baseW * scaleHi));
      const hHi = Math.max(72, Math.round(baseH * scaleHi));

      renderer.setPixelRatio(orig.pixelRatio);
      renderer.setSize(wHi, hHi, false);
      renderer.render(scene, camera);

      const hiDataUrl = renderer.domElement.toDataURL("image/png");

      // Low-res para API (sin tocar hiDataUrl)
      let lowB64;
      {
        const canvas = document.createElement("canvas");
        const scaleLo = Math.min(1, LOW_MAX / Math.max(wHi, hHi));
        canvas.width = Math.max(48, Math.round(wHi * scaleLo));
        canvas.height = Math.max(36, Math.round(hHi * scaleLo));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
        const lowDataUrl = canvas.toDataURL("image/jpeg", 0.8);
        lowB64 = lowDataUrl.replace(/^data:image\/jpeg;base64,/, "");
      }

      entries.push({
        key,
        assetKey: key,
        base: key.split("/").pop(),
        thumbDataUrl: hiDataUrl, // 👍 buena resolución para la lista
        image_b64: lowB64, // 👍 versión reducida solo para API
      });
    }

    // Restaurar estado
    orig.vis.forEach((v) => (v.o.visible = v.visible));
    camera.position.copy(orig.camPos);
    camera.up.copy(orig.camUp);
    if (controls && orig.ctrlTarget) {
      controls.target.copy(orig.ctrlTarget);
      controls.update();
    }
    renderer.setPixelRatio(orig.pixelRatio);
    renderer.setSize(orig.size.x, orig.size.y, false);

    console.log(
      `[urdf_viewer_main] Thumbnails generados: ${entries.length}/${keys.length}`
    );
    return entries;
  }

  // =========================
  // Configurar assets + lanzar análisis en mini-lotes
  // =========================
  (async () => {
    try {
      const entries = await snapshotComponents();

      app.componentDescriptions = app.componentDescriptions || {};
      app.assets = {
        list() {
          return entries.map((e) => ({
            assetKey: e.assetKey,
            base: e.base,
          }));
        },
        thumbnail(assetKey) {
          const ent = entries.find((e) => e.assetKey === assetKey);
          return ent ? ent.thumbDataUrl : null;
        },
      };

      // Cuando abramos el panel, ya tendrá datos
      app.componentsPanel.refresh();

      // === Mini-lotes + callback Colab ===
      if (window.google?.colab?.kernel) {
        await analyzeInMiniBatches(entries, 8);
      } else {
        console.warn(
          "[urdf_viewer_main] Entorno sin google.colab.kernel: no se solicitarán descripciones."
        );
      }
    } catch (e) {
      console.error("[urdf_viewer_main] Error en snapshot/analyze:", e);
    }
  })();

  async function analyzeInMiniBatches(entries, batchSize = 8) {
    const kernel = window.google?.colab?.kernel;
    if (!kernel || typeof kernel.invokeFunction !== "function") {
      console.warn("[urdf_viewer_main] Colab kernel no disponible.");
      return;
    }

    console.log(
      `[urdf_viewer_main] Iniciando análisis en mini-lotes de tamaño ${batchSize}...`
    );

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize).map((e) => ({
        key: e.key,
        image_b64: e.image_b64,
      }));

      try {
        const res = await kernel.invokeFunction(
          "describe_component_images",
          [batch],
          {}
        );

        // Colab suele devolver JSON como string en 'text/plain'
        let payload =
          (res && res.data && res.data["text/plain"]) || res || null;

        if (typeof payload === "string") {
          try {
            payload = JSON.parse(payload);
          } catch (e) {
            console.warn(
              "[urdf_viewer_main] No se pudo parsear JSON parcial:",
              e
            );
            payload = null;
          }
        }

        if (payload && typeof payload === "object") {
          app.componentDescriptions = {
            ...(app.componentDescriptions || {}),
            ...payload,
          };

          if (
            window._componentsPanel &&
            typeof window._componentsPanel.updateDescriptions === "function"
          ) {
            window._componentsPanel.updateDescriptions(payload);
          }
        }

        console.log(
          `[urdf_viewer_main] Lote ${
            i / batchSize + 1
          } procesado (${batch.length} componentes).`
        );
      } catch (e) {
        console.error("[urdf_viewer_main] Error en mini-lote:", e);
      }
    }

    console.log("[urdf_viewer_main] Análisis por mini-lotes finalizado.");
  }

  // =========================
  // Auto-resize opcional
  // =========================
  if (autoResize) {
    const onResize = () => {
      try {
        const w =
          window.innerWidth || container.clientWidth || renderer.domElement.width;
        const h =
          (window.visualViewport?.height ||
            window.innerHeight ||
            container.clientHeight ||
            renderer.domElement.height) || 600;
        resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
      } catch (e) {
        console.warn("[urdf_viewer_main] Error en resize:", e);
      }
    };
    window.addEventListener("resize", onResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onResize);
    }
    setTimeout(onResize, 0);
  }

  return app;
}
