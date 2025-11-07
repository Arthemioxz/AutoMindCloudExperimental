// urdf_viewer_main.js — versión debug extendida
// -------------------------------------------------------------
// Guarda resultado crudo y parseado en window.*
// Agrega logs visibles en consola para depurar parseo
// -------------------------------------------------------------

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
      tools.set(!!open);
    },

    componentDescriptions: {},
    descriptionsReady: false,

    getComponentDescription(assetKey, index) {
      const src = app.componentDescriptions;
      if (!src || !app.descriptionsReady) return "";

      if (!Array.isArray(src) && typeof src === "object") {
        if (src[assetKey]) return src[assetKey];

        const clean = String(assetKey || "").split("?")[0].split("#")[0];
        const base = clean.split("/").pop();
        if (src[base]) return src[base];

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
    } catch (e) {
      console.warn("[ClickSound] error:", e);
    }
  }

  bootstrapComponentDescriptions(app, assetToMeshes, off);

  const destroy = () => {
    try { comps.destroy(); } catch (e) {}
    try { tools.destroy(); } catch (e) {}
    try { inter.destroy(); } catch (e) {}
    try { off?.destroy?.(); } catch (e) {}
    try { core.destroy(); } catch (e) {}
  };

  return { ...app, destroy };
}

/* ============ JS <-> Colab con logs extendidos ============ */

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
    console.debug("[Components] Colab bridge no disponible; sin descripciones.");
    app.descriptionsReady = true;
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

        const parts = url.split(",");
        if (parts.length !== 2) continue;
        const b64 = parts[1];

        entries.push({
          key: ent.assetKey,
          image_b64: b64,
          mime: "image/png",
        });
      } catch (e) {
        console.warn("[Components] Error thumbnail", ent.assetKey, e);
      }
    }

    console.group("[DEBUG Components]");
    console.debug("📸 Capturas generadas:", entries.length);
    console.debug("Primera clave:", entries[0]?.key);

    if (!entries.length) {
      console.debug("[Components] No se generaron capturas para describir.");
      console.groupEnd();
      app.descriptionsReady = true;
      return;
    }

    try {
      const result = await window.google.colab.kernel.invokeFunction(
        "describe_component_images",
        [entries],
        {}
      );

      window.lastDescribeResult = result; // 🔥 Guarda el resultado crudo
      console.debug("🧩 Resultado bruto recibido desde Colab:", result);

      const descMap = extractDescMap(result);
      window.lastParsedDescMap = descMap; // 🔥 Guarda el resultado parseado
      console.debug("📦 Resultado parseado por extractDescMap:", descMap);

      // log texto resumido (si es texto)
      try {
        const textPreview = JSON.stringify(result).slice(0, 1000);
        console.debug("🧾 Vista previa (truncada):", textPreview);
      } catch {}

      const keys =
        descMap && typeof descMap === "object" ? Object.keys(descMap) : [];

      if (keys.length) {
        app.componentDescriptions = descMap;
        app.descriptionsReady = true;
        window.COMPONENT_DESCRIPTIONS = descMap;
        console.debug(
          `[✅ Components] Descripciones listas (${keys.length} piezas):`,
          keys
        );
      } else {
        console.warn("[⚠️ Components] Respuesta sin descripciones utilizables.");
        console.debug("Contenido crudo del resultado:", result);
        app.descriptionsReady = true;
      }
    } catch (err) {
      console.error("[❌ Components] Error invokeFunction:", err);
      app.descriptionsReady = true;
    } finally {
      console.groupEnd();
    }
  })();
}

/* ============ Parser con logs ============ */

function extractDescMap(result) {
  console.groupCollapsed("[DEBUG extractDescMap]");
  console.debug("Entrada:", result);

  if (!result) {
    console.groupEnd();
    return {};
  }

  let d = result;

  if (d.data && typeof d.data === "object") {
    d = d.data;
    console.debug("📨 Extraído .data:", d);
  }

  if (d["application/json"] && typeof d["application/json"] === "object") {
    console.debug("🎯 Detectado application/json plano");
    console.groupEnd();
    return d["application/json"];
  }

  if (typeof d === "object" && !Array.isArray(d)) {
    const keys = Object.keys(d);
    if (keys.length && !("text/plain" in d) && !("application/json" in d)) {
      console.debug("🎯 Detectado dict plano con claves:", keys);
      console.groupEnd();
      return d;
    }
  }

  if (Array.isArray(d)) {
    console.debug("🔄 Array detectado, iterando subniveles...");
    for (const item of d) {
      const sub = extractDescMap(item);
      if (sub && Object.keys(sub).length) {
        console.groupEnd();
        return sub;
      }
    }
  }

  const tp = d["text/plain"];
  if (typeof tp === "string") {
    const t = tp.trim();
    console.debug("🧾 text/plain detectado (len=", t.length, ")");

    let candidate = t;
    const s0 = t.indexOf("{");
    const s1 = t.lastIndexOf("}");
    if (s0 !== -1 && s1 !== -1 && s1 > s0) {
      candidate = t.slice(s0, s1 + 1);
    }

    try {
      const parsed = JSON.parse(candidate);
      console.debug("🎯 JSON.parse exitoso:", parsed);
      console.groupEnd();
      return parsed;
    } catch (e) {
      try {
        const fixed = candidate.replace(/'/g, '"');
        const parsed = JSON.parse(fixed);
        console.debug("🎯 parse con comillas fijas:", parsed);
        console.groupEnd();
        return parsed;
      } catch (e2) {
        console.debug("⚠️ No fue JSON válido directo ni corregido.");
      }
    }
  }

  console.groupEnd();
  return {};
}

/* ... el resto (listAssets, isolateAsset, thumbnails, etc.) igual ... */
