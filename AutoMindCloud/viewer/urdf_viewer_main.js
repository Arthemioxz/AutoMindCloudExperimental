// urdf_viewer_main.js
// Entrypoint: crea viewer, paneles y puente con Colab para descripciones.

import { THEME } from "./Theme.js";
import { createViewer } from "./core/ViewerCore.js";
import { buildAssetDB, createLoadMeshCb } from "./core/AssetDB.js";
import { attachInteraction } from "./interaction/SelectionAndDrag.js";
import { createToolsDock } from "./ui/ToolsDock.js";
import { createComponentsPanel } from "./ui/ComponentsPanel.js";

export function render(opts = {}) {
  const {
    container,
    urdfContent = "",
    meshDB = {},
    selectMode = "link",
    background = THEME.bgCanvas || 0xffffff,
    clickAudioDataURL = null,
  } = opts;

  // Core
  const core = createViewer({ container, background });

  // Asset DB + registro de meshes por assetKey
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

  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // Offscreen thumbnails con cache
  const off = buildOffscreenForThumbnails(core, assetToMeshes);

  // Interacción
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode,
  });

  // App facade
  const app = {
    ...core,
    robot,

    assets: {
      list: () => listAssets(assetToMeshes),
      thumbnail: (assetKey) => off?.thumbnail(assetKey),
    },

    isolate: {
      asset: (assetKey) => isolateAsset(core, assetToMeshes, assetKey),
      clear: () => showAll(core),
    },

    showAll: () => showAll(core),

    openTools(open = true) {
      tools.set(!!open);
    },

    // Se llena cuando llega la respuesta de Colab
    componentDescriptions: {},

    getComponentDescription(assetKey, index) {
      const map = app.componentDescriptions || {};
      if (map[assetKey]) return map[assetKey];

      const base = (assetKey || "").split("/").pop().split(".")[0];
      if (map[base]) return map[base];

      // Si viene como array (no es nuestro caso principal, pero soportado)
      if (Array.isArray(map) && typeof index === "number") {
        return map[index] || "";
      }

      return "";
    },
  };

  // UI
  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);

  // Click SFX opcional
  if (clickAudioDataURL) {
    try {
      installClickSound(clickAudioDataURL);
    } catch (_) {}
  }

  // Bootstrap: capturar componentes y pedir descripciones AL INICIO
  bootstrapComponentDescriptions(app, assetToMeshes, off);

  // Destroy
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
      off?.destroy();
    } catch (_) {}
    try {
      core.destroy();
    } catch (_) {}
  };

  return { ...app, destroy };
}

/* ------------------------ Bootstrap Colab Bridge ------------------------ */

function bootstrapComponentDescriptions(app, assetToMeshes, off) {
  // Verificar puente de Colab
  const hasColab =
    typeof window !== "undefined" &&
    window.google &&
    window.google.colab &&
    window.google.colab.kernel &&
    typeof window.google.colab.kernel.invokeFunction === "function";

  if (!hasColab) {
    console.debug(
      "[Components] Colab bridge no disponible; se omite petición de descripciones."
    );
    return;
  }

  const items = listAssets(assetToMeshes);
  if (!items.length) {
    console.debug("[Components] Sin assets para describir.");
    return;
  }

  (async () => {
    const entries = [];

    for (const ent of items) {
      try {
        const url = await off.thumbnail(ent.assetKey);
        if (!url || typeof url !== "string") continue;
        const parts = url.split(",");
        if (parts.length !== 2) continue;
        const b64 = parts[1];
        entries.push({ key: ent.assetKey, image_b64: b64 });
      } catch (e) {
        console.warn(
          "[Components] Error generando thumbnail para",
          ent.assetKey,
          e
        );
      }
    }

    console.debug(
      `[Components] Enviando ${entries.length} capturas a Colab para descripción.`
    );

    if (!entries.length) return;

    try {
      const result = await window.google.colab.kernel.invokeFunction(
        "describe_component_images",
        [entries],
        {}
      );
      const descMap =
        (result && result.data && result.data[0]) || {};
      console.debug(
        "[Components] Descripciones recibidas desde Colab:",
        descMap
      );
      app.componentDescriptions = descMap;
      if (typeof window !== "undefined") {
        window.COMPONENT_DESCRIPTIONS = descMap;
      }
    } catch (err) {
      console.error(
        "[Components] Error al invocar describe_component_images:",
        err
      );
    }
  })();
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
  meshes.forEach((m) => (m.visible = true));
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

function buildOffscreenForThumbnails(core, assetToMeshes) {
  const { scene, camera, renderer } = core;
  if (!scene || !camera || !renderer) {
    return {
      thumbnail: async () => null,
      destroy() {},
    };
  }

  const thumbCache = new Map();

  function snapshotAsset(assetKey) {
    if (!assetKey) return null;
    if (thumbCache.has(assetKey)) return thumbCache.get(assetKey);

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

    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL("image/png");

    vis.forEach(([o, v]) => (o.visible = v));
    thumbCache.set(assetKey, url);
    return url;
  }

  return {
    thumbnail: async (assetKey) => {
      try {
        return snapshotAsset(assetKey);
      } catch (e) {
        console.warn("[Thumbnails] error:", e);
        return null;
      }
    },
    destroy() {
      // usamos renderer principal; no destruimos aquí
    },
  };
}

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

if (typeof window !== "undefined") {
  window.URDFViewer = { render };
}
