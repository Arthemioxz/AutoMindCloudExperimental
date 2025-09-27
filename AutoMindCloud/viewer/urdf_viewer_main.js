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
 * @param {string} opts.urdfContent              — URDF string
 * @param {Object.<string,string>} opts.meshDB   — key → base64
 * @param {'link'|'mesh'} [opts.selectMode='link']
 * @param {number|null} [opts.background=THEME.bgCanvas]
 * @param {string|null} [opts.clickAudioDataURL] — optional UI SFX (not required)
 */
export function render(opts = {}) {
  const {
    container,
    urdfContent = '',
    meshDB = {},
    selectMode = 'link',
    background = THEME.bgCanvas || 0xffffff,
    clickAudioDataURL = null
  } = opts;

  // Make sure container can receive focus → key events land inside the iframe
  container.setAttribute('tabindex', '0');
  container.style.outline = 'none';
  container.addEventListener('pointerdown', () => {
    try { container.focus({ preventScroll: true }); } catch {}
  });

  // 1) Core viewer
  const core = createViewer({ container, background });

  // 2) Asset DB + loadMeshCb with onMeshTag hook to index meshes by assetKey
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map(); // assetKey -> Mesh[]
  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey) {
      // Collect every mesh produced under this assetKey
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse((o) => {
        if (o && o.isMesh && o.geometry) list.push(o);
      });
      assetToMeshes.set(assetKey, list);
    }
  });

  // 3) Load URDF (this triggers tagging via `onMeshTag`)
  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // 4) Build an offscreen renderer for thumbnails (after robot exists)
  const off = buildOffscreenForThumbnails(core, assetToMeshes);

  // 5) Interaction (hover, select, drag joints, key 'i' etc.)
  const inter = attachInteraction({
    scene: core.scene,
    camera: core.camera,
    controls: core.controls,
    dom: core.renderer.domElement,
    selectMode
  });

  // 6) Facade “app” that is passed to UI components
  const app = {
    // Expose core bits
    ...core,
    robot,

    // --- Assets adapter for ComponentsPanel ---
    assets: {
      list: () => listAssets(assetToMeshes),
      thumbnail: (assetKey) => off?.thumbnail(assetKey)
    },

    // --- Isolate / restore ---
    isolate: {
      asset: (assetKey) => isolateAsset(core, assetToMeshes, assetKey),
      clear: () => showAll(core)
    },

    // --- Show all ---
    showAll: () => showAll(core),

    // Optional: open tools externally
    openTools(open = true) { tools.set(!!open); }
  };

  // 7) UI modules
  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app, THEME);

  // --- Robust 'h' hotkey binder with visual toast ---
  bindHotkeyH({ container, tools });

  // Optional click SFX for UI (kept minimal; UI modules do not depend on it)
  if (clickAudioDataURL) {
    try {
      const audio = new Audio(clickAudioDataURL);
      ['click','pointerup'].forEach(evt => container.addEventListener(
        evt, () => { try { audio.currentTime = 0; audio.play(); } catch {} }, { capture: true }
      ));
    } catch {}
  }

  return {
    ...core,
    robot,
    destroy() {
      try { inter?.destroy?.(); } catch {}
      try { comps?.destroy?.(); } catch {}
      try { tools?.destroy?.(); } catch {}
      core.destroy();
    }
  };
}

// ---------- Hotkey binding (works in iframe/shadow, multiple listeners) ----------
function bindHotkeyH({ container, tools }) {
  const doc = container.ownerDocument || document;
  const win = doc.defaultView || window;

  // Small toast overlay (so you *see* the event without DevTools)
  function toast(text) {
    const t = doc.createElement('div');
    Object.assign(t.style, {
      position: 'absolute',
      left: '12px', bottom: '12px',
      padding: '6px 10px',
      font: '12px/1.2 system-ui, sans-serif',
      color: '#0f172a',
      background: 'rgba(255,255,255,0.92)',
      border: '1px solid rgba(0,0,0,0.1)',
      borderRadius: '10px',
      boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
      zIndex: 99999,
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 120ms ease'
    });
    t.textContent = text;
    container.appendChild(t);
    requestAnimationFrame(() => (t.style.opacity = '1'));
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 220);
    }, 700);
  }

  function handler(e) {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.isComposing) return;
    const isH = (e.key === 'h' || e.key === 'H' || e.code === 'KeyH');
    if (!isH) return;
    e.preventDefault();
    try { console.log('pressed h'); } catch {}
    toast('pressed h');
    try { tools.toggle(); } catch {}
  }

  // Attach on all likely targets (covers iframe/shadow cases)
  win.addEventListener('keydown', handler, { capture: true });
  doc.addEventListener('keydown', handler, { capture: true });
  container.addEventListener('keydown', handler, { capture: true });

  // Ensure container keeps focus after clicks
  container.addEventListener('pointerdown', () => {
    try { container.focus({ preventScroll: true }); } catch {}
  });
}

// ---------- Helpers ----------
function listAssets(assetToMeshes) {
  const arr = [];
  for (const [k, v] of assetToMeshes.entries()) arr.push({ key: k, count: v.length });
  arr.sort((a,b) => a.key.localeCompare(b.key));
  return arr;
}

function isolateAsset(core, assetToMeshes, assetKey) {
  const meshes = assetToMeshes.get(assetKey) || [];
  if (core.robot) core.robot.traverse(o => { if (o.isMesh && o.geometry) o.visible = false; });
  meshes.forEach(m => { m.visible = true; });
  frameMeshes(core, meshes);
}

function showAll(core) {
  if (core.robot) core.robot.traverse(o => { if (o.isMesh && o.geometry) o.visible = true; });
}

function frameMeshes(core, meshes) {
  if (!meshes || meshes.length === 0) return;
  const bb = new THREE.Box3();
  meshes.forEach(m => bb.expandByObject(m));
  const ctr = bb.getCenter(new THREE.Vector3());
  const size = bb.getSize(new THREE.Vector3()).length() || 1;
  const dist = size * 1.6;

  const fromPos = core.camera.position.clone();
  const toPos = ctr.clone().add(new THREE.Vector3(dist, dist * 0.7, dist));
  tweenCamera(core, fromPos, toPos, core.controls.target.clone(), ctr, 400);
}

function tweenCamera(core, fromPos, toPos, fromTarget, toTarget, ms = 420) {
  const cam = core.camera;
  const ctl = core.controls;
  if (!cam || !ctl) return;

  const start = performance.now();
  const ease = (t) => (t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2);

  function step(t) {
    const u = Math.min(1, (t - start) / ms);
    const e = ease(u);
    cam.position.set(
      fromPos.x + (toPos.x - fromPos.x) * e,
      fromPos.y + (toPos.y - fromPos.y) * e,
      fromPos.z + (toPos.z - fromPos.z) * e
    );
    const tx = fromTarget.x + (toTarget.x - fromTarget.x) * e;
    const ty = fromTarget.y + (toTarget.y - fromTarget.y) * e;
    const tz = fromTarget.z + (toTarget.z - fromTarget.z) * e;
    ctl.target.set(tx, ty, tz);
    cam.lookAt(ctl.target);
    ctl.update();
    if (u < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ---------- Offscreen thumbnails ----------
function buildOffscreenForThumbnails(core, assetToMeshes) {
  try {
    const off = document.createElement('canvas');
    off.width = off.height = 128;
    const r = new THREE.WebGLRenderer({ canvas: off, antialias: true, alpha: true });
    const sc = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(40, 1, 0.01, 1e5);
    const light = new THREE.DirectionalLight(0xffffff, 1.0);
    light.position.set(1,1,1);
    sc.add(light);

    return {
      thumbnail(assetKey) {
        const meshes = assetToMeshes.get(assetKey) || [];
        if (meshes.length === 0) return null;

        const grp = new THREE.Group();
        meshes.forEach(m => grp.add(m.clone()));
        sc.add(grp);

        const bb = new THREE.Box3().setFromObject(grp);
        const ctr = bb.getCenter(new THREE.Vector3());
        const size = bb.getSize(new THREE.Vector3()).length() || 1;
        cam.position.copy(ctr.clone().add(new THREE.Vector3(size, size * 0.6, size)));
        cam.lookAt(ctr);
        r.setClearColor(0x000000, 0);
        r.render(sc, cam);

        const data = off.toDataURL('image/png');
        sc.remove(grp);
        return data;
      }
    };
  } catch {
    return null;
  }
}

