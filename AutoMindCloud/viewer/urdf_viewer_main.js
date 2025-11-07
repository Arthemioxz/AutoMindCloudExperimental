// /viewer/urdf_viewer_main.js
// Entrypoint que compone ViewerCore + AssetDB + Interaction + UI (ToolsDock + ComponentsPanel)

import { THEME } from "./Theme.js";
import { createViewer } from "./core/ViewerCore.js";
import { buildAssetDB, createLoadMeshCb } from "./core/AssetDB.js";
import { attachInteraction } from "./interaction/SelectionAndDrag.js";
import { createToolsDock } from "./ui/ToolsDock.js";
import { createComponentsPanel } from "./ui/ComponentsPanel.js";

/**
 * Public entry: render the URDF viewer.
 *
 * opts:
 *  - container: HTMLElement
 *  - urdfContent: string
 *  - meshDB: { [key: string]: base64 }
 *  - selectMode: 'link' | 'mesh'
 *  - background: int | null
 *  - clickAudioDataURL?: string
 *  - componentDescriptions?: array | { [assetKey]: string }
 */
export function render(opts = {}) {
  const {
    container,
    urdfContent = "",
    meshDB = {},
    selectMode = "link",
    background = THEME.bgCanvas || 0xffffff,
    clickAudioDataURL = null,
    // puede venir desde el HTML o como fallback global
    componentDescriptions =
      (typeof window !== "undefined" && window.COMPONENT_DESCRIPTIONS) || null,
  } = opts;

  // 1) Core viewer
  const core = createViewer({ container, background });

  // 2) Asset DB + mapa assetKey -> meshes
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map();

  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse((o) => {
        if (o && o.isMesh && o.geometry) list.push(o);
      });
      assetToMeshes.set(assetKey, list);
    },
  });

  // 3) Cargar URDF (dispara onMeshTag)
  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // 4) Thumbnails offscreen
  const off = buildOffscreenForThumbnails(core, assetToMeshes);

  // 5) Interacción (hover, selección, joints, etc.)
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode,
  });

  // 6) Facade app para capas de UI
  const app = {
    ...core,
    robot,

    // --- Assets para ComponentsPanel ---
    assets: {
      list: () => listAssets(assetToMeshes),
      thumbnail: (assetKey) => off?.thumbnail(assetKey),
    },

    // --- Aislar / restaurar ---
    isolate: {
      asset: (assetKey) => isolateAsset(core, assetToMeshes, assetKey),
      clear: () => showAll(core),
    },

    showAll: () => showAll(core),

    openTools(open = true) {
      tools.set(!!open);
    },

    // 🔹 Descripciones inyectadas desde Python
    componentDescriptions,

    /**
     * Devuelve la descripción para un componente:
     * - Si es array: por índice de fila.
     * - Si es objeto: por assetKey o por basename.
     */
    getComponentDescription(assetKey, index) {
      const src = componentDescriptions;
      if (!src) return "";

      // Array → índice
      if (Array.isArray(src)) {
        if (
          typeof index === "number" &&
          index >= 0 &&
          index < src.length
        ) {
          return src[index] || "";
        }
        return "";
      }

      // Objeto → assetKey directo
      if (typeof src === "object") {
        if (src[assetKey]) return src[assetKey];

        const base = (assetKey || "").split("/").pop().split(".")[0];
        if (base && src[base]) return src[base];
      }

      return "";
    },
  };

  // 7) UI
  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);

  // 8) Click sound opcional
  if (clickAudioDataURL) {
    try {
      installClickSound(clickAudioDataURL);
    } catch (_) {}
  }

  // 9) Limpieza
  const destroy = () => {
    try {
      comps.destroy();
    } catch (_) {}
    try {
      tools.destroy();
    } catch (_) {}
    try {
      inter.destroy();
    } catch (_) {}
    try {
      off?.destroy?.();
    } catch (_) {}
    try {
      core.destroy();
    } catch (_) {}
  };

  return { ...app, destroy };
}

/* ---------------------------- Helpers ---------------------------- */

function listAssets(assetToMeshes) {
  const items = [];
  assetToMeshes.forEach((meshes, assetKey) => {
    if (!meshes || !meshes.length) return;
    const { base, ext } = splitName(assetKey);
    items.push({ assetKey, base, ext, count: meshes.length });
  });
  items.sort((a, b) =>
    a.base.localeCompare(b.base, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
  return items;
}

function splitName(key) {
  const clean = String(key || "").split("?")[0].split("#")[0];
  const base = clean.split("/").pop();
  const dot = base.lastIndexOf(".");
  return {
    base: dot >= 0 ? base.slice(0, dot) : base,
    ext: dot >= 0 ? base.slice(dot + 1).toLowerCase() : "",
  };
}

function isolateAsset(core, assetToMeshes, assetKey) {
  const meshes = assetToMeshes.get(assetKey) || [];
  if (core.robot) {
    core.robot.traverse((o) => {
      if (o.isMesh && o.geometry) o.visible = false;
    });
  }
  meshes.forEach((m) => {
    m.visible = true;
  });
  frameMeshes(core, meshes);
}

function showAll(core) {
  if (!core.robot) return;
  core.robot.traverse((o) => {
    if (o.isMesh && o.geometry) o.visible = true;
  });
  if (core.fitAndCenter) {
    core.fitAndCenter(core.robot, 1.06);
  }
}

function frameMeshes(core, meshes) {
  if (!meshes || !meshes.length || !core.camera || !core.controls) return;

  const { camera, controls, renderer, scene } = core;
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let has = false;
  const vis = [];

  for (const m of meshes) {
    vis.push([m, m.visible]);
  }

  for (const m of meshes) {
    tmp.setFromObject(m);
    if (!has) {
      box.copy(tmp);
      has = true;
    } else {
      box.union(tmp);
    }
  }

  if (!has) {
    vis.forEach(([o, v]) => (o.visible = v));
    return;
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim * 2.0;

  camera.near = Math.max(maxDim / 1000, 0.001);
  camera.far = Math.max(maxDim * 1000, 1000);
  camera.updateProjectionMatrix();

  const az = Math.PI * 0.25;
  const el = Math.PI * 0.18;
  const dirV = new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az)
  ).multiplyScalar(dist);
  camera.position.copy(center.clone().add(dirV));
  camera.lookAt(center);

  renderer.render(scene, camera);

  vis.forEach(([o, v]) => (o.visible = v));
}

// Offscreen thumbnails para ComponentsPanel
function buildOffscreenForThumbnails(core, assetToMeshes) {
  const { scene, camera, renderer } = core;
  if (!scene || !camera || !renderer) {
    return {
      thumbnail: async () => null,
      destroy() {},
    };
  }

  const offRenderer = renderer;
  const ready = Promise.resolve();

  function snapshotAsset(assetKey) {
    const meshes = assetToMeshes.get(assetKey) || [];
    if (!meshes.length) return null;

    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let has = false;
    const vis = [];

    for (const m of meshes) {
      vis.push([m, m.visible]);
      m.visible = true;
    }

    for (const m of meshes) {
      tmp.setFromObject(m);
      if (!has) {
        box.copy(tmp);
        has = true;
      } else {
        box.union(tmp);
      }
    }

    if (!has) {
      vis.forEach(([o, v]) => (o.visible = v));
      return null;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.0;

    camera.near = Math.max(maxDim / 1000, 0.001);
    camera.far = Math.max(maxDim * 1000, 1000);
    camera.updateProjectionMatrix();

    const az = Math.PI * 0.25;
    const el = Math.PI * 0.18;
    const dirV = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).multiplyScalar(dist);
    camera.position.copy(center.clone().add(dirV));
    camera.lookAt(center);

    offRenderer.render(scene, camera);
    const url = offRenderer.domElement.toDataURL("image/png");

    vis.forEach(([o, v]) => (o.visible = v));
    return url;
  }

  return {
    thumbnail: async (assetKey) => {
      try {
        await ready;
        await new Promise((r) => setTimeout(r, 150));
        return snapshotAsset(assetKey);
      } catch (e) {
        console.warn("[Thumbnails] error:", e);
        return null;
      }
    },
    destroy() {
      // usamos el mismo renderer principal; no lo destruimos aquí
    },
  };
}

// Click SFX opcional
function installClickSound(dataURL) {
  if (!dataURL || typeof dataURL !== "string") return;
  let ctx = null;
  let buf = null;

  async function ensure() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (!buf) {
      const resp = await fetch(dataURL);
      const arr = await resp.arrayBuffer();
      buf = await ctx.decodeAudioData(arr);
    }
  }

  function play() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    if (!buf) {
      ensure().then(play).catch(() => {});
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    try {
      src.start();
    } catch (_) {}
  }

  window.__urdf_click__ = play;
}

// UMD-style global para integraciones legacy
if (typeof window !== "undefined") {
  window.URDFViewer = { render };
}
