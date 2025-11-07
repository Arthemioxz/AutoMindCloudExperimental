// urdf_viewer_main.js
// ViewerCore + AssetDB + SelectionAndDrag + ToolsDock + ComponentsPanel
// IA secuencial: una imagen por componente -> describe_component_image
// Sistema de thumbnails/offscreen (thumbalist-style) se mantiene.

/* global THREE */

import { THEME } from "./Theme.js";
import { createViewer } from "./core/ViewerCore.js";
import { buildAssetDB, createLoadMeshCb } from "./core/AssetDB.js";
import { attachInteraction } from "./interaction/SelectionAndDrag.js";
import { createToolsDock } from "./ui/ToolsDock.js";
import { createComponentsPanel } from "./ui/ComponentsPanel.js";

/* ======================== PUBLIC API ======================== */

export function render(opts = {}) {
  const {
    container,
    urdfContent = "",
    meshDB = {},
    selectMode = "link",
    background = THEME.canvasBg ?? THEME.bgCanvas ?? 0xffffff,
    clickAudioDataURL = null,
  } = opts;

  const core = createViewer({ container, background });

  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map();

  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse((o) => {
        if (o && o.isMesh && o.geometry) {
          o.userData.__assetKey = assetKey;
          list.push(o);
        }
      });
      assetToMeshes.set(assetKey, list);
    },
  });

  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // 📸 Thumbalist/offscreen (no se toca la filosofía)
  const off = buildOffscreenForThumbnails(core, assetToMeshes);

  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode,
  });

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
      if (tools && typeof tools.set === "function") {
        tools.set(!!open);
      }
    },

    // mapa dinámico con las descripciones que van llegando
    componentDescriptions: {},
    descriptionsReady: false,

    getComponentDescription(assetKey, index) {
      const src = app.componentDescriptions || {};
      if (!src) return "";

      // directa
      if (src[assetKey]) return src[assetKey];

      // por nombre de archivo
      const clean = String(assetKey || "").split("?")[0].split("#")[0];
      const baseFull = clean.split(/[\\/]/).pop() || "";
      const dot = baseFull.lastIndexOf(".");
      const base = dot >= 0 ? baseFull.slice(0, dot) : baseFull;

      if (src[base]) return src[base];
      if (src[base?.toLowerCase()]) return src[base.toLowerCase()];

      // por índice (si alguna vez se usa array)
      if (Array.isArray(src) && typeof index === "number") {
        return src[index] || "";
      }

      return "";
    },
  };

  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);
  app._componentsPanel = comps;

  if (clickAudioDataURL) {
    try { installClickSound(clickAudioDataURL); } catch (_) {}
  }

  // 🔥 IA secuencial, sin romper thumbalist:
  bootstrapComponentDescriptions(app, assetToMeshes, off);

  const destroy = () => {
    try { comps.destroy?.(); } catch (_) {}
    try { tools.destroy?.(); } catch (_) {}
    try { inter.destroy?.(); } catch (_) {}
    try { off?.destroy?.(); } catch (_) {}
    try { core.destroy?.(); } catch (_) {}
  };

  return { ...app, destroy };
}

/* ======================= ASSETS / ISOLATE ======================= */

function listAssets(assetToMeshes) {
  const items = [];
  assetToMeshes.forEach((meshes, assetKey) => {
    if (!meshes || !meshes.length) return;
    const clean = String(assetKey || "").split("?")[0].split("#")[0];
    const baseFull = clean.split(/[\\/]/).pop() || "";
    const dot = baseFull.lastIndexOf(".");
    const base = dot >= 0 ? baseFull.slice(0, dot) : baseFull;
    const ext = dot >= 0 ? baseFull.slice(dot + 1).toLowerCase() : "";
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
  if (!meshes || !meshes.length) return;
  const { camera, renderer, scene } = core;
  if (!camera || !renderer || !scene) return;

  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let has = false;

  const vis = [];
  meshes.forEach((m) => {
    if (!m) return;
    vis.push([m, m.visible]);
    tmp.setFromObject(m);
    if (!has) {
      box.copy(tmp);
      has = true;
    } else {
      box.union(tmp);
    }
  });

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
  const dir = new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az)
  ).multiplyScalar(dist);

  camera.position.copy(center.clone().add(dir));
  camera.lookAt(center);
  renderer.render(scene, camera);

  vis.forEach(([o, v]) => (o.visible = v));
}

/* =================== THUMBALIST / OFFSCREEN =================== */

function buildOffscreenForThumbnails(core, assetToMeshes) {
  if (!core.robot || typeof THREE === "undefined") {
    return {
      thumbnail: async () => null,
      destroy() {},
    };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const OFF_W = 640;
  const OFF_H = 480;

  const canvas = document.createElement("canvas");
  canvas.width = OFF_W;
  canvas.height = OFF_H;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(OFF_W, OFF_H, false);

  if (core.renderer) {
    renderer.physicallyCorrectLights =
      core.renderer.physicallyCorrectLights ?? true;
    renderer.toneMapping = core.renderer.toneMapping;
    renderer.toneMappingExposure =
      core.renderer.toneMappingExposure ?? 1.0;

    if ("outputColorSpace" in renderer && "outputColorSpace" in core.renderer) {
      renderer.outputColorSpace = core.renderer.outputColorSpace;
    } else if ("outputEncoding" in renderer && "outputEncoding" in core.renderer) {
      renderer.outputEncoding = core.renderer.outputEncoding;
    }

    renderer.shadowMap.enabled = !!core.renderer.shadowMap?.enabled;
    renderer.shadowMap.type =
      core.renderer.shadowMap?.type ?? THREE.PCFSoftShadowMap;
  }

  const scene = new THREE.Scene();
  scene.background =
    core.scene?.background !== undefined
      ? core.scene.background
      : new THREE.Color(0xffffff);
  scene.environment = core.scene?.environment ?? null;

  const amb = new THREE.AmbientLight(0xffffff, 0.95);
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(2.5, 2.5, 2.5);
  dir.castShadow = false;
  scene.add(amb, dir);

  const camera = new THREE.PerspectiveCamera(
    60,
    OFF_W / OFF_H,
    0.01,
    10000
  );

  const robotClone = core.robot.clone(true);
  scene.add(robotClone);

  robotClone.traverse((o) => {
    if (o.isMesh && o.material) {
      if (Array.isArray(o.material)) {
        o.material = o.material.map((m) => m.clone());
      } else {
        o.material = o.material.clone();
      }
      o.material.needsUpdate = true;
      o.castShadow = renderer.shadowMap.enabled;
      o.receiveShadow = renderer.shadowMap.enabled;
    }
  });

  const cloneAssetToMeshes = new Map();
  robotClone.traverse((o) => {
    const k = o?.userData?.__assetKey;
    if (k && o.isMesh && o.geometry) {
      const arr = cloneAssetToMeshes.get(k) || [];
      arr.push(o);
      cloneAssetToMeshes.set(k, arr);
    }
  });

  const ready = (async () => {
    await sleep(120);
  })();

  async function snapshotAsset(assetKey) {
    await ready;

    const meshes = cloneAssetToMeshes.get(assetKey) || [];
    if (!meshes.length) return null;

    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let has = false;

    const vis = [];
    cloneAssetToMeshes.forEach((arr, key) => {
      arr.forEach((m) => {
        vis.push([m, m.visible]);
        m.visible = key === assetKey;
      });
    });

    meshes.forEach((m) => {
      tmp.setFromObject(m);
      if (!has) {
        box.copy(tmp);
        has = true;
      } else {
        box.union(tmp);
      }
    });

    if (!has) {
      vis.forEach(([o, v]) => (o.visible = v));
      return null;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.2;

    camera.near = Math.max(maxDim / 1000, 0.001);
    camera.far = Math.max(maxDim * 1000, 1000);
    camera.updateProjectionMatrix();

    const az = Math.PI * 0.28;
    const el = Math.PI * 0.22;
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).multiplyScalar(dist);

    camera.position.copy(center.clone().add(dir));
    camera.lookAt(center);

    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL("image/png");

    vis.forEach(([o, v]) => (o.visible = v));
    return url;
  }

  return {
    thumbnail: async (assetKey) => {
      try {
        await ready;
        await sleep(80);
        return await snapshotAsset(assetKey);
      } catch (e) {
        console.warn("[Thumbnails] Error generando thumbnail para", assetKey, e);
        return null;
      }
    },
    destroy: () => {
      try { renderer.dispose(); } catch (_) {}
      try { scene.clear(); } catch (_) {}
    },
  };
}

/* ================= IA SECUENCIAL: describe_component_image ================= */

let _bootstrapStarted = false;

function bootstrapComponentDescriptions(app, assetToMeshes, off) {
  if (_bootstrapStarted) return;
  _bootstrapStarted = true;

  const hasColab =
    typeof window !== "undefined" &&
    window.google &&
    window.google.colab &&
    window.google.colab.kernel &&
    typeof window.google.colab.kernel.invokeFunction === "function";

  if (!hasColab) {
    console.debug("[Components] Colab bridge no disponible; sin descripciones IA.");
    app.descriptionsReady = true;
    return;
  }

  const items = listAssets(assetToMeshes);
  if (!items.length) {
    console.debug("[Components] No hay assets para describir.");
    app.descriptionsReady = true;
    return;
  }

  app.componentDescriptions = app.componentDescriptions || {};
  app.descriptionsReady = false;

  (async () => {
    console.debug(
      `[Components] Procesando descripciones secuenciales para ${items.length} componentes.`
    );

    for (const ent of items) {
      try {
        const url = await off.thumbnail(ent.assetKey);
        if (!url || typeof url !== "string") continue;
        const parts = url.split(",");
        if (parts.length !== 2) continue;
        const b64 = parts[1];

        const payload = { key: ent.assetKey, image_b64: b64 };

        const result = await window.google.colab.kernel.invokeFunction(
          "describe_component_image",
          [payload],
          {}
        );

        const descMap = extractDescMap(result);
        if (descMap && typeof descMap === "object") {
          Object.entries(descMap).forEach(([k, v]) => {
            if (!v) return;
            const text = String(v);

            app.componentDescriptions[k] = text;

            const clean = String(k).split("?")[0].split("#")[0];
            const baseFull = clean.split(/[\\/]/).pop() || "";
            const dot = baseFull.lastIndexOf(".");
            const base = dot >= 0 ? baseFull.slice(0, dot) : baseFull;

            if (base && !app.componentDescriptions[base]) {
              app.componentDescriptions[base] = text;
            }
            if (base && !app.componentDescriptions[base.toLowerCase()]) {
              app.componentDescriptions[base.toLowerCase()] = text;
            }
          });

          if (app._componentsPanel) {
            try {
              if (typeof app._componentsPanel.refresh === "function") {
                app._componentsPanel.refresh();
              } else if (typeof app._componentsPanel.renderList === "function") {
                app._componentsPanel.renderList();
              }
            } catch (e) {
              console.warn("[Components] Error refrescando panel:", e);
            }
          }
        } else {
          console.warn(
            "[Components] Respuesta sin descripción utilizable para",
            ent.assetKey
          );
        }
      } catch (err) {
        console.error(
          "[Components] Error invokeFunction describe_component_image:",
          ent.assetKey,
          err
        );
      }
    }

    app.descriptionsReady = true;
    if (typeof window !== "undefined") {
      window.COMPONENT_DESCRIPTIONS = app.componentDescriptions;
    }
    console.debug(
      `[Components] IA secuencial completada. Total descripciones: ${
        Object.keys(app.componentDescriptions || {}).length
      }.`
    );
  })();
}

function extractDescMap(result) {
  if (!result) return {};
  const d = result.data || result;

  if (d["application/json"] && typeof d["application/json"] === "object") {
    return d["application/json"];
  }

  if (Array.isArray(d) && d.length && typeof d[0] === "object") {
    return d[0];
  }

  const tp = d["text/plain"];
  if (typeof tp === "string") {
    const t = tp.trim();

    if ((t.startsWith("{") || t.startsWith("[")) && t.includes('"')) {
      try {
        const parsed = JSON.parse(t);
        if (parsed && typeof parsed === "object") return parsed;
      } catch (_) {}
    }

    try {
      if (t.startsWith("{") && t.endsWith("}")) {
        const fixed = t
          .replace(/'/g, '"')
          .replace(/\bFalse\b/g, "false")
          .replace(/\bTrue\b/g, "true")
          .replace(/\bNone\b/g, "null");
        const obj = JSON.parse(fixed);
        if (obj && typeof obj === "object") return obj;
      }
    } catch (_) {}
  }

  if (typeof d === "object" && !Array.isArray(d)) {
    return d;
  }

  return {};
}

/* ===================== CLICK SOUND OPCIONAL ===================== */

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
    try { src.start(); } catch (_) {}
  }

  window.__urdf_click__ = play;
}

/* ======================= GLOBAL HOOK ======================= */

if (typeof window !== "undefined") {
  window.URDFViewer = { render };
}
