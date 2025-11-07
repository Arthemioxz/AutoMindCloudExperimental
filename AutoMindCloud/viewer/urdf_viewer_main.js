// urdf_viewer_main.js
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

  const core = createViewer({ container, background });

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

  // 🔹 Sistema offscreen para thumbnails (alta calidad para UI)
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
      // Importante: esto sigue devolviendo la miniatura ORIGINAL (offscreen)
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

    // mapa { assetKey / base / baseNoExt : descripcion }
    componentDescriptions: {},
    descriptionsReady: false,

    getComponentDescription(assetKey, index) {
      const src = app.componentDescriptions;
      if (!src || !app.descriptionsReady) {
        return ""; // el panel decide si mostrar "cargando..."
      }

      if (!Array.isArray(src) && typeof src === "object") {
        // clave exacta
        if (src[assetKey]) return src[assetKey];

        // mismo nombre con ruta
        const clean = String(assetKey || "").split("?")[0].split("#")[0];
        const base = clean.split("/").pop();
        if (src[base]) return src[base];

        // sin extensión
        const baseNoExt = base.split(".")[0];
        if (src[baseNoExt]) return src[baseNoExt];
      }

      if (Array.isArray(src) && typeof index === "number") {
        return src[index] || "";
      }

      return "";
    },
  };

  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);

  if (clickAudioDataURL) {
    try {
      installClickSound(clickAudioDataURL);
    } catch (_) {}
  }

  bootstrapComponentDescriptions(app, assetToMeshes, off);

  const destroy = () => {
    try { comps.destroy(); } catch (_) {}
    try { tools.destroy(); } catch (_) {}
    try { inter.destroy(); } catch (_) {}
    try { off?.destroy?.(); } catch (_) {}
    try { core.destroy(); } catch (_) {}
  };

  return { ...app, destroy };
}

/* ============ JS <-> Colab ============ */

let _bootstrapStarted = false;

/**
 * Comprime un dataURL a ~targetKB usando JPEG y reescalado.
 * SOLO para las copias que se mandan a la API.
 * La UI sigue usando la miniatura original.
 */
async function toTinyB64(url, targetKB = 5) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const maxBytes = targetKB * 1024;
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");

          if (!ctx) {
            const parts = url.split(",");
            resolve(parts[1] || "");
            return;
          }

          const w = img.naturalWidth || img.width || 1;
          const h = img.naturalHeight || img.height || 1;

          // Escala agresiva: queremos algo muy liviano
          const maxDim = Math.max(w, h) || 1;
          const targetDim = 320; // tamaño razonable para ~5KB
          const scale = Math.min(1, targetDim / maxDim);

          canvas.width = Math.max(16, Math.round(w * scale));
          canvas.height = Math.max(16, Math.round(h * scale));

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          let quality = 0.7;
          let out = canvas.toDataURL("image/jpeg", quality);
          let b64 = (out.split(",")[1] || "");
          let bytes = (b64.length * 3) / 4;

          let iter = 0;
          while (bytes > maxBytes && iter < 7 && quality > 0.25) {
            quality -= 0.1;
            out = canvas.toDataURL("image/jpeg", quality);
            b64 = (out.split(",")[1] || "");
            bytes = (b64.length * 3) / 4;
            iter++;
          }

          if (!b64) {
            const parts = url.split(",");
            b64 = parts[1] || "";
          }

          resolve(b64);
        } catch (e) {
          console.warn("[Components] toTinyB64 error:", e);
          const parts = url.split(",");
          resolve(parts[1] || "");
        }
      };
      img.onerror = () => {
        const parts = url.split(",");
        resolve(parts[1] || "");
      };
      img.src = url;
    } catch (e) {
      console.warn("[Components] toTinyB64 outer error:", e);
      const parts = url.split(",");
      resolve(parts[1] || "");
    }
  });
}

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
    console.debug("[Components] Colab bridge no disponible; sin descripciones.");
    app.descriptionsReady = true; // no habrá
    return;
  }

  const items = listAssets(assetToMeshes);
  if (!items.length) {
    console.debug("[Components] No hay assets para describir.");
    app.descriptionsReady = true;
    return;
  }

  (async () => {
    const entries = [];

    for (const ent of items) {
      try {
        const url = await off.thumbnail(ent.assetKey);
        if (!url || typeof url !== "string") continue;

        // 🔹 Solo para API: versión comprimida ~5KB
        const tinyB64 = await toTinyB64(url, 5);
        if (!tinyB64) continue;

        // Mandamos SOLO la versión comprimida al callback de Colab
        entries.push({
          key: ent.assetKey,
          image_b64: tinyB64,
          mime: "image/jpeg",
        });
      } catch (e) {
        console.warn("[Components] Error thumbnail", ent.assetKey, e);
      }
    }

    if (!entries.length) {
      console.debug("[Components] No se generaron capturas para describir.");
      app.descriptionsReady = true;
      return;
    }

    console.debug(
      `[Components] Enviando ${entries.length} capturas (comprimidas) a Colab para descripción.`
    );

    try {
      const result = await window.google.colab.kernel.invokeFunction(
        "describe_component_images",
        [entries],
        {}
      );

      console.debug("[Components] Respuesta raw:", result);

      const descMap = extractDescMap(result);
      const keys = descMap && typeof descMap === "object"
        ? Object.keys(descMap)
        : [];

      if (keys.length) {
        app.componentDescriptions = descMap;
        app.descriptionsReady = true;
        if (typeof window !== "undefined") {
          window.COMPONENT_DESCRIPTIONS = descMap; // debug
        }
        console.debug(
          `[Components] Descripciones listas (${keys.length} piezas).`
        );
      } else {
        console.warn("[Components] Respuesta sin descripciones utilizables.");
        app.descriptionsReady = true;
      }
    } catch (err) {
      console.error("[Components] Error invokeFunction:", err);
      app.descriptionsReady = true;
    }
  })();
}

function extractDescMap(result) {
  if (!result) return {};
  const d = result.data || result;

  // 1) application/json directo
  if (d["application/json"] && typeof d["application/json"] === "object") {
    return d["application/json"];
  }

  // 2) lista con objeto
  if (Array.isArray(d) && d.length && typeof d[0] === "object") {
    return d[0];
  }

  // 3) dict de Python en text/plain
  const tp = d["text/plain"];
  if (typeof tp === "string") {
    const t = tp.trim();

    // a) JSON válido
    if ((t.startsWith("{") || t.startsWith("[")) && t.includes('"')) {
      try {
        const parsed = JSON.parse(t);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        // seguimos
      }
    }

    // b) dict Python: {'key': 'value', ...}
    try {
      if (t.startsWith("{") && t.endsWith("}")) {
        const obj = Function('"use strict"; return (' + t + ");")();
        if (obj && typeof obj === "object") return obj;
      }
    } catch (e) {
      console.warn("[Components] No se pudo parsear text/plain como dict:", e);
    }
  }

  // 4) objeto suelto
  if (typeof d === "object" && !Array.isArray(d)) return d;

  return {};
}

/* ============ Helpers viewer ============ */

function listAssets(assetToMeshes) {
  const items = [];
  assetToMeshes.forEach((meshes, assetKey) => {
    if (!meshes || !meshes.length) return;
    const clean = String(assetKey || "").split("?")[0].split("#")[0];
    const baseFull = clean.split("/").pop();
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
  if (core.fitAndCenter) core.fitAndCenter(core.robot, 1.06);
}

function frameMeshes(core, meshes) {
  if (!meshes || !meshes.length || !core.camera) return;
  const { camera, renderer, scene } = core;

  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let has = false;
  const vis = [];

  for (const m of meshes) vis.push([m, m.visible]);

  for (const m of meshes) {
    tmp.setFromObject(m);
    if (!has) {
      box.copy(tmp);
      has = true;
    } else box.union(tmp);
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

/* ============ Offscreen thumbnails (sistema sólido) ============ */

function buildOffscreenForThumbnails(core, assetToMeshes) {
  if (!core.robot) {
    return {
      thumbnail: async () => null,
      destroy() {},
    };
  }

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

  // Match main renderer para look consistente
  if (core.renderer) {
    renderer.physicallyCorrectLights =
      core.renderer.physicallyCorrectLights ?? true;
    renderer.toneMapping = core.renderer.toneMapping;
    renderer.toneMappingExposure =
      core.renderer.toneMappingExposure ?? 1.0;

    if ("outputColorSpace" in renderer) {
      renderer.outputColorSpace =
        core.renderer.outputColorSpace ?? THREE.SRGBColorSpace;
    } else {
      renderer.outputEncoding =
        core.renderer.outputEncoding ?? THREE.sRGBEncoding;
    }

    renderer.shadowMap.enabled =
      core.renderer.shadowMap?.enabled ?? false;
    renderer.shadowMap.type =
      core.renderer.shadowMap?.type ?? THREE.PCFSoftShadowMap;
  }

  const scene = new THREE.Scene();
  scene.background =
    core.scene?.background ?? new THREE.Color(0xffffff);
  scene.environment = core.scene?.environment ?? null;

  const amb = new THREE.AmbientLight(0xffffff, 0.95);
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(2.5, 2.5, 2.5);
  scene.add(amb, dir);

  const camera = new THREE.PerspectiveCamera(
    60,
    OFF_W / OFF_H,
    0.01,
    10000
  );

  // Clone robot
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

  // Map assetKey → meshes en el clon
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
    await new Promise((r) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(r)
      )
    );
    renderer.render(scene, camera);
  })();

  function snapshotAsset(assetKey) {
    const meshes = cloneAssetToMeshes.get(assetKey) || [];
    if (!meshes.length) return null;

    const vis = [];
    robotClone.traverse((o) => {
      if (o.isMesh && o.geometry) vis.push([o, o.visible]);
    });

    for (const [m] of vis) m.visible = false;
    for (const m of meshes) m.visible = true;

    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let has = false;

    for (const m of meshes) {
      tmp.setFromObject(m);
      if (!has) {
        box.copy(tmp);
        has = True;
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

    return url;
  }

  return {
    thumbnail: async (assetKey) => {
      try {
        await ready;
        return snapshotAsset(assetKey);
      } catch (e) {
        console.warn("[Thumbnails] error:", e);
        return null;
      }
    },
    destroy: () => {
      try { renderer.dispose(); } catch (_) {}
      try { scene.clear(); } catch (_) {}
    },
  };
}

/* ------------------------- Click Sound ------------------------- */

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

/* --------------------- Global UMD-style hook -------------------- */

if (typeof window !== "undefined") {
  window.URDFViewer = { render };
}
