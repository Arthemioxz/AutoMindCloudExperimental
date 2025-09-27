// /viewer/urdf_viewer_main.js
// Entrypoint que compone ViewerCore + AssetDB + Selection&Drag + UI (Tools right / Components left)

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
 * @param {string} opts.urdfContent
 * @param {Object.<string,string>} opts.meshDB
 * @param {'link'|'mesh'} [opts.selectMode='link']
 * @param {number|null} [opts.background=THEME.bgCanvas]
 * @param {string|null} [opts.clickAudioDataURL]
 */
export function render(opts = {}) {
  const {
    container,
    urdfContent = '',
    meshDB = {},
    selectMode = 'link',
    background = (THEME.colors?.canvasBg ?? THEME.bgCanvas ?? 0xf6fbfb),
    clickAudioDataURL = null
  } = opts || {};
  if (!container) throw new Error('[urdf_viewer_main] container required');

  // 1) Core viewer
  const core = createViewer({ container, background });

  // 2) Asset DB + loadMeshCb con tagging para thumbnails
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map(); // assetKey -> Mesh[]
  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse(o => { if (o && o.isMesh && o.geometry) list.push(o); });
      assetToMeshes.set(assetKey, list);
    }
  });

  // 3) Cargar URDF (dispara tagging)
  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // 4) Offscreen para thumbnails de componentes
  const off = buildOffscreenForThumbnails(core, assetToMeshes);

  // 5) Interacción (hover, selección, drag joints, tecla 'i' focus/iso)
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    robot,
    selectMode
  });

  // 6) Fachada app para UIs
  const app = {
    ...core,
    robot,

    // Assets para panel de componentes
    assets: {
      list: () => listAssets(assetToMeshes),
      thumbnail: (assetKey) => off?.thumbnail(assetKey)
    },

    // Aislar por assetKey (para acciones desde Components)
    isolate: {
      asset: (assetKey) => isolateAsset(core, assetToMeshes, assetKey),
      clear: () => showAll(core)
    },

    showAll: () => showAll(core),

    // Gancho opcional desde afuera
    openTools(open = true) { tools.set(!!open); }
  };

  // 7) UIs
  const tools = createToolsDock(app, THEME);          // dock a la derecha (hotkey 'h')
  const comps = createComponentsPanel(app, THEME);    // dock a la izquierda (hotkey 'c')

  // 8) SFX opcional
  if (clickAudioDataURL) installClickSound(clickAudioDataURL);

  return { app, tools, comps, inter };
}

/* -------------------- helpers para thumbnails y aislar -------------------- */

function listAssets(assetToMeshes) {
  const out = [];
  for (const [assetKey, arr] of assetToMeshes.entries()) {
    const base = basenameNoExt(assetKey);
    const ext = extOf(assetKey);
    out.push({ assetKey, base, ext, count: Array.isArray(arr) ? arr.length : 0 });
  }
  return out.sort((a, b) => a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: 'base' }));
}

function basenameNoExt(k='') {
  const m = k.split('/').pop() || k;
  return m.replace(/\.[^.]+$/,'');
}
function extOf(k='') {
  const m = (k.match(/\.([a-z0-9]+)$/i)||[])[1];
  return m ? ('.'+m.toLowerCase()) : '';
}

function showAll(core) {
  core.scene?.traverse(o => { if (o.isMesh) o.visible = true; });
  core.renderer?.render(core.scene, core.camera);
}

function isolateAsset(core, assetToMeshes, assetKey) {
  const meshes = assetToMeshes.get(assetKey) || [];
  const vis = [];
  core.scene?.traverse(o => { if (o.isMesh && o.geometry) { vis.push([o,o.visible]); o.visible = meshes.includes(o); } });
  // opcional: encuadre rápido
  try {
    const bb = new THREE.Box3().setFromObject(core.scene);
    const c = bb.getCenter(new THREE.Vector3());
    core.controls.target.copy(c); core.controls.update();
  } catch(_) {}
  // restaura visibilidades cuando quieras devolver todo
  return () => vis.forEach(([o,v]) => (o.visible=v));
}

function buildOffscreenForThumbnails(core, assetToMeshes) {
  const { scene, camera } = core;
  const OFF_W = 240, OFF_H = 180;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const canvas = renderer.domElement;

  const robotClone = new THREE.Group();
  scene.add(robotClone);

  function snapshotAsset(assetKey) {
    const meshes = assetToMeshes.get(assetKey) || [];
    if (!meshes.length) return null;

    const vis = [];
    core.scene.traverse(o => { if (o.isMesh && o.geometry) { vis.push([o, o.visible]); o.visible = meshes.includes(o); } });

    const bb = new THREE.Box3().setFromObject(core.scene);
    if (bb.isEmpty()) { vis.forEach(([o,v]) => (o.visible=v)); return null; }
    const center = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.0;

    camera.near = Math.max(maxDim / 1000, 0.001);
    camera.far = Math.max(maxDim * 1000, 1000);
    camera.updateProjectionMatrix();

    const az = Math.PI * 0.25, el = Math.PI * 0.18;
    const d = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    ).multiplyScalar(dist);
    camera.position.copy(center.clone().add(d));
    camera.lookAt(center);

    renderer.setSize(OFF_W, OFF_H, false);
    renderer.render(scene, camera);

    vis.forEach(([o,v]) => (o.visible=v));
    return canvas.toDataURL('image/png');
  }

  return { thumbnail(assetKey){ try { return snapshotAsset(assetKey); } catch { return null; } }, destroy(){ try{renderer.dispose();}catch{}} };
}

/* --------------------- click SFX opcional --------------------- */
function installClickSound(dataUrl) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  fetch(dataUrl).then(r=>r.arrayBuffer()).then(buf=>ctx.decodeAudioData(buf)).then((buf)=>{
    window.__urdf_click__ = () => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.connect(ctx.destination); try { src.start(); } catch {}
    };
  }).catch(()=>{ window.__urdf_click__ = () => {}; });
}

/* --------------------- Global UMD hook -------------------- */
if (typeof window !== 'undefined') { window.URDFViewer = { render }; }
