// urdf_viewer_main.js — versión debug extendida y completa
// -------------------------------------------------------------
// Incluye logs en navegador, y buildOffscreenForThumbnails
// Guarda resultados en window.lastDescribeResult / window.lastParsedDescMap
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
    try { installClickSound(clickAudioDataURL); } catch (e) { console.warn("[ClickSound]", e); }
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

/* ===================== JS <-> Colab con logs ===================== */

let _bootstrapStarted = false;

function bootstrapComponentDescriptions(app, assetToMeshes, off) {
  if (_bootstrapStarted) return;
  _bootstrapStarted = true;

  const hasColab =
    typeof window !== "undefined" &&
    window.google?.colab?.kernel &&
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
        const b64 = url.split(",")[1];
        entries.push({ key: ent.assetKey, image_b64: b64, mime: "image/png" });
      } catch (e) {
        console.warn("[Components] Error thumbnail", ent.assetKey, e);
      }
    }

    console.group("[DEBUG Components]");
    console.debug("📸 Capturas generadas:", entries.length);
    console.debug("Primera clave:", entries[0]?.key);

    try {
      const result = await window.google.colab.kernel.invokeFunction(
        "describe_component_images",
        [entries],
        {}
      );

      window.lastDescribeResult = result;
      console.debug("🧩 Resultado bruto desde Colab:", result);

      const descMap = extractDescMap(result);
      window.lastParsedDescMap = descMap;
      console.debug("📦 Mapa parseado:", descMap);

      const textPreview = JSON.stringify(result).slice(0, 1000);
      console.debug("🧾 Vista previa (truncada):", textPreview);

      const keys = descMap && typeof descMap === "object" ? Object.keys(descMap) : [];
      if (keys.length) {
        app.componentDescriptions = descMap;
        app.descriptionsReady = true;
        window.COMPONENT_DESCRIPTIONS = descMap;
        console.debug(`[✅ Components] Descripciones listas (${keys.length}):`, keys);
      } else {
        console.warn("[⚠️ Components] Respuesta sin descripciones utilizables.");
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

/* ===================== Parser ===================== */

function extractDescMap(result) {
  console.groupCollapsed("[DEBUG extractDescMap]");
  console.debug("Entrada:", result);

  if (!result) { console.groupEnd(); return {}; }

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
      if (sub && Object.keys(sub).length) { console.groupEnd(); return sub; }
    }
  }

  const tp = d["text/plain"];
  if (typeof tp === "string") {
    const t = tp.trim();
    console.debug("🧾 text/plain detectado, len:", t.length);
    const s0 = t.indexOf("{"), s1 = t.lastIndexOf("}");
    let candidate = (s0 !== -1 && s1 !== -1 && s1 > s0) ? t.slice(s0, s1 + 1) : t;
    try {
      const parsed = JSON.parse(candidate);
      console.debug("🎯 JSON.parse exitoso:", parsed);
      console.groupEnd();
      return parsed;
    } catch {
      try {
        const fixed = candidate.replace(/'/g, '"');
        const parsed = JSON.parse(fixed);
        console.debug("🎯 parse con comillas fijas:", parsed);
        console.groupEnd();
        return parsed;
      } catch { console.debug("⚠️ No fue JSON válido directo ni corregido."); }
    }
  }

  console.groupEnd();
  return {};
}

/* ===================== Helpers y thumbnails ===================== */

function listAssets(assetToMeshes) {
  const items = [];
  assetToMeshes.forEach((meshes, assetKey) => {
    if (!meshes?.length) return;
    const clean = String(assetKey || "").split("?")[0].split("#")[0];
    const baseFull = clean.split("/").pop();
    const dot = baseFull.lastIndexOf(".");
    const base = dot >= 0 ? baseFull.slice(0, dot) : baseFull;
    const ext = dot >= 0 ? baseFull.slice(dot + 1).toLowerCase() : "";
    items.push({ assetKey, base, ext, count: meshes.length });
  });
  items.sort((a,b)=>a.base.localeCompare(b.base,undefined,{numeric:true,sensitivity:"base"}));
  return items;
}

function isolateAsset(core, assetToMeshes, assetKey) {
  const meshes = assetToMeshes.get(assetKey) || [];
  if (core.robot) core.robot.traverse(o=>{ if(o.isMesh) o.visible=false; });
  meshes.forEach(m=>m.visible=true);
  frameMeshes(core, meshes);
}
function showAll(core){ if(!core.robot)return; core.robot.traverse(o=>{if(o.isMesh)o.visible=true;}); core.fitAndCenter?.(core.robot,1.06);}
function frameMeshes(core, meshes){
  if(!meshes?.length||!core.camera)return;
  const {camera,renderer,scene}=core;
  const box=new THREE.Box3(),tmp=new THREE.Box3();let has=false;
  for(const m of meshes){tmp.setFromObject(m); if(!has){box.copy(tmp);has=true;}else box.union(tmp);}
  if(!has)return;
  const c=box.getCenter(new THREE.Vector3()),s=box.getSize(new THREE.Vector3());
  const maxDim=Math.max(s.x,s.y,s.z)||1,dist=maxDim*2.0;
  camera.near=Math.max(maxDim/1000,0.001);camera.far=Math.max(maxDim*1000,1000);camera.updateProjectionMatrix();
  const az=Math.PI*0.25,el=Math.PI*0.18;
  const dirV=new THREE.Vector3(Math.cos(el)*Math.cos(az),Math.sin(el),Math.cos(el)*Math.sin(az)).multiplyScalar(dist);
  camera.position.copy(c.clone().add(dirV));camera.lookAt(c);
  renderer.render(scene,camera);
}

function buildOffscreenForThumbnails(core, assetToMeshes){
  const OFF_W=640,OFF_H=480;
  const canvas=document.createElement("canvas");canvas.width=OFF_W;canvas.height=OFF_H;
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(OFF_W,OFF_H,false);
  const scene=new THREE.Scene();scene.background=core.scene?.background??new THREE.Color(0xffffff);
  const amb=new THREE.AmbientLight(0xffffff,0.95),dir=new THREE.DirectionalLight(0xffffff,1.1);dir.position.set(2.5,2.5,2.5);scene.add(amb,dir);
  const camera=new THREE.PerspectiveCamera(60,OFF_W/OFF_H,0.01,10000);
  const robotClone=core.robot.clone(true);scene.add(robotClone);
  robotClone.traverse(o=>{if(o.isMesh&&o.material){o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();o.material.needsUpdate=true;}});
  const cloneAssetToMeshes=new Map();
  robotClone.traverse(o=>{const k=o?.userData?.__assetKey;if(k&&o.isMesh){const arr=cloneAssetToMeshes.get(k)||[];arr.push(o);cloneAssetToMeshes.set(k,arr);}});
  const ready=(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));renderer.render(scene,camera);})();
  function snapshotAsset(assetKey){
    const meshes=cloneAssetToMeshes.get(assetKey)||[];if(!meshes.length)return null;
    robotClone.traverse(o=>{if(o.isMesh)o.visible=false;});meshes.forEach(m=>m.visible=true);
    const box=new THREE.Box3(),tmp=new THREE.Box3();let has=false;
    for(const m of meshes){tmp.setFromObject(m);if(!has){box.copy(tmp);has=true;}else box.union(tmp);}
    if(!has)return null;
    const c=box.getCenter(new THREE.Vector3()),s=box.getSize(new THREE.Vector3());
    const maxDim=Math.max(s.x,s.y,s.z)||1,dist=maxDim*2.0;
    camera.near=Math.max(maxDim/1000,0.001);camera.far=Math.max(maxDim*1000,1000);camera.updateProjectionMatrix();
    const az=Math.PI*0.25,el=Math.PI*0.18;
    const dirV=new THREE.Vector3(Math.cos(el)*Math.cos(az),Math.sin(el),Math.cos(el)*Math.sin(az)).multiplyScalar(dist);
    camera.position.copy(c.clone().add(dirV));camera.lookAt(c);
    renderer.render(scene,camera);
    return renderer.domElement.toDataURL("image/png");
  }
  return {
    thumbnail: async (key)=>{try{await ready;return snapshotAsset(key);}catch(e){console.warn("[Thumbnails] error:",e);return null;}},
    destroy:()=>{try{renderer.dispose();}catch{}try{scene.clear();}catch{}}
  };
}

/* ============ Click sound ============ */
function installClickSound(dataURL){
  if(!dataURL)return;let ctx=null,buf=null;
  async function ensure(){if(!ctx)ctx=new (window.AudioContext||window.webkitAudioContext)();if(!buf){const r=await fetch(dataURL);const a=await r.arrayBuffer();buf=await ctx.decodeAudioData(a);}}
  function play(){if(!ctx)ctx=new (window.AudioContext||window.webkitAudioContext)();if(ctx.state==="suspended")ctx.resume();if(!buf){ensure().then(play).catch(()=>{});return;}const s=ctx.createBufferSource();s.buffer=buf;s.connect(ctx.destination);try{s.start();}catch{}}
  window.__urdf_click__=play;
}

if(typeof window!=="undefined"){window.URDFViewer={render};}
