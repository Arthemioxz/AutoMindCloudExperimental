// /viewer/urdf_viewer_main.js
// Minimal entry that renders the robot and wires the Tools Dock UI.
// Requires globals: THREE, URDFLoader, STLLoader, ColladaLoader, OrbitControls
// Loads ToolsDock (with "h" to open/close) and Theme tokens via ESM.
import { createToolsDock } from './ui/ToolsDock.js';
import { THEME } from './Theme.js';

/** Mime guess for URLModifier */
function guessMime(fname = '') {
  const f = String(fname).toLowerCase();
  if (f.endsWith('.jpg') || f.endsWith('.jpeg')) return 'image/jpeg';
  if (f.endsWith('.png')) return 'image/png';
  if (f.endsWith('.stl')) return 'model/stl';
  if (f.endsWith('.dae')) return 'model/vnd.collada+xml';
  return 'application/octet-stream';
}

/** Normalize db keys */
function normalizeKey(url = '') {
  return String(url).replace(/^package:\/\//, '')
                    .replace(/\\/g, '/')
                    .replace(/^\.\//, '')
                    .toLowerCase();
}

console.log('Updated');

/** LoadingManager that remaps URLs requested by loaders to data: URLs from meshDB */
function buildLoadingManager(meshDB) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const k1 = normalizeKey(url);
    const k2 = k1.split('/').pop(); // basename
    const hit = meshDB[k1] || meshDB[k2];
    if (hit) return `data:${guessMime(k1)};base64,${hit}`;
    return url;
  });
  return manager;
}

/** Fit camera to object while preserving current view direction */
function fitToObject(camera, controls, object, pad = 1.25) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return false;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  if (camera.isPerspectiveCamera) {
    const fov = (camera.fov || 60) * Math.PI / 180;
    const dist = (maxDim * pad) / Math.tan(Math.max(1e-6, fov / 2));
    const dir = camera.position.clone().sub(controls.target ?? new THREE.Vector3()).normalize();
    if (!isFinite(dir.lengthSq()) || dir.lengthSq() < 1e-10) dir.set(1, 0.7, 1).normalize();
    camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    camera.near = Math.max(0.01, dist / 1000);
    camera.far  = Math.max(1000, dist * 1000);
    camera.updateProjectionMatrix();
  } else {
    const w = controls.domElement?.clientWidth || 1;
    const h = controls.domElement?.clientHeight || 1;
    const asp = Math.max(1e-6, w / h);
    camera.left = -maxDim * asp;
    camera.right =  maxDim * asp;
    camera.top = maxDim;
    camera.bottom = -maxDim;
    camera.near = Math.max(0.01, maxDim / 1000);
    camera.far  = Math.max(1000, maxDim * 1000);
    camera.position.copy(center.clone().add(new THREE.Vector3(maxDim, maxDim * 0.9, maxDim)));
    camera.updateProjectionMatrix();
  }

  controls.target.copy(center);
  controls.update();
  return true;
}

/** Small utilities */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function render(opts = {}) {
  const {
    container,
    urdfContent = '',
    meshDB = {},
    selectMode = 'link',     // not used here, left for compatibility
    background = null        // null => transparent
  } = opts;

  if (!container) throw new Error('[URDF entry] Missing container');
  if (!urdfContent) throw new Error('[URDF entry] Missing urdfContent');

  // ---------- Renderer ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: background === null });
  renderer.setPixelRatio(clamp(window.devicePixelRatio || 1, 1, 2));
  renderer.setSize(container.clientWidth || 1, container.clientHeight || 1, false);
  if (background !== null) renderer.setClearColor(new THREE.Color(background), 1);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';

  container.innerHTML = '';
  container.appendChild(renderer.domElement);

  // ---------- Scene / Camera / Controls ----------
  const scene = new THREE.Scene();
  if (background === null) scene.background = null;

  const aspect = Math.max(1e-6, (container.clientWidth || 1) / (container.clientHeight || 1));
  const camera = new THREE.PerspectiveCamera(60, aspect, 0.01, 1e6);
  camera.position.set(2.2, 1.6, 2.2);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Lights
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.8));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(3, 5, 2);
  scene.add(dir);

  // ---------- Loaders with URL remap ----------
  const manager = buildLoadingManager(meshDB);
  const urdfLoader = new URDFLoader(manager);
  // (We keep STL/Collada/Texture loaders global; URDFLoader internally uses manager + Collada/Texture)

  // ---------- Load robot from string ----------
  let robot = null;
  try {
    robot = urdfLoader.parse(urdfContent, { packages: '' });
  } catch (e) {
    console.error('[URDF entry] URDF parse error:', e);
    throw e;
  }

  const root = new THREE.Group();
  if (robot) root.add(robot);
  scene.add(root);

  // Initial frame
  controls.target.set(0, 0.6, 0);
  fitToObject(camera, controls, root, 1.4);

  // ---------- Resize handling (always full container) ----------
  function onResize() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    fitToObject(camera, controls, root, 1.25);
  }
  const ro = new ResizeObserver(() => onResize());
  try { ro.observe(container); } catch (_) {}
  window.addEventListener('resize', onResize);

  // ---------- Basic render loop ----------
  let disposed = false;
  function loop() {
    if (disposed) return;
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }
  loop();

  // ---------- App facade for ToolsDock ----------
  // You can extend these (projection switch, helpers, toggles) as needed.
  const app = {
    renderer, scene, camera, controls, robot,
    setProjection: (mode = 'Perspective') => {
      // simple perspective-only (extend with an OrthographicCamera if needed)
      // left as a stub to keep API compatible with the dock
      // No-op: the dock will call this but it’s safe if you don’t need ortho
      // Implement if you want ortho/persp switching.
      if (mode === 'Perspective') return;
      console.warn('[App] Orthographic mode is not implemented in this minimal entry.');
    },
    setSceneToggles: (opts = {}) => {
      // Grid / ground / axes are not created in this minimal entry.
      // Hook here if you add helpers; keep silent otherwise.
      // Example:
      // if (grid) grid.visible = !!opts.grid;
      // if (axes) axes.visible = !!opts.axes;
      // if (ground) { ground.visible = !!opts.ground; renderer.shadowMap.enabled = !!opts.shadows; }
    }
  };

  // ---------- Mount the Tools Dock (press "h" to toggle) ----------
  createToolsDock(app, THEME);

  // ---------- Return app so caller can interact if needed ----------
  app.dispose = () => {
    disposed = true;
    try { ro.disconnect(); } catch (_) {}
    window.removeEventListener('resize', onResize);
    try { renderer.dispose(); } catch (_) {}
    try { container.removeChild(renderer.domElement); } catch (_) {}
  };

  return app;
}

