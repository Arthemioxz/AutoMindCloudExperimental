//
// /viewer/core/ViewerCore.js
// Three.js r132 compatible core for a URDF viewer
// Exports: createViewer({ container, background, pixelRatio })

/* global THREE, URDFLoader */

function assertThree() {
  if (typeof THREE === 'undefined') {
    throw new Error('[ViewerCore] THREE is not defined. Load three.js before ViewerCore.js');
  }
  if (typeof URDFLoader === 'undefined') {
    throw new Error('[ViewerCore] URDFLoader is not defined. Load urdf-loader UMD before ViewerCore.js');
  }
}

/** Minor math helpers */
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Ensure meshes are double-sided and shadows off by default */
function applyDoubleSided(root) {
  root?.traverse?.(n => {
    if (n.isMesh && n.geometry) {
      if (Array.isArray(n.material)) n.material.forEach(m => (m.side = THREE.DoubleSide));
      else if (n.material) n.material.side = THREE.DoubleSide;
      n.castShadow = false;
      n.receiveShadow = false;
      n.geometry.computeVertexNormals?.();
    }
  });
}

/** Many URDF assets come Z-up; we rectify to Y-up (Three default) once. */
function rectifyUpForward(obj) {
  if (!obj || obj.userData.__rectified) return;
  obj.rotateX(-Math.PI / 2);
  obj.userData.__rectified = true;
  obj.updateMatrixWorld(true);
}

/** Compute a padded bounding box for an object */
function getObjectBounds(object, pad = 1.0) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(pad);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  return { box, center, size, maxDim };
}

/** Fit an object to the given camera+controls */
function fitAndCenter(camera, controls, object, pad = 1.08) {
  const b = getObjectBounds(object, pad);
  if (!b) return false;

  const { center, maxDim } = b;

  if (camera.isPerspectiveCamera) {
    // distance heuristic robust across FOVs
    const fov = (camera.fov || 60) * Math.PI / 180;
    const dist = maxDim / Math.tan(Math.max(1e-6, fov / 2));
    camera.near = Math.max(maxDim / 1000, 0.001);
    camera.far = Math.max(maxDim * 1500, 1500);
    camera.updateProjectionMatrix();
    // keep direction (if any); otherwise use iso-ish
    const dir = camera.position.clone().sub(controls.target || new THREE.Vector3()).normalize();
    if (!isFinite(dir.lengthSq()) || dir.lengthSq() < 1e-10) {
      dir.set(1, 0.7, 1).normalize();
    }
    camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
  } else if (camera.isOrthographicCamera) {
    // set ortho frustum around object
    const aspect = Math.max(1e-6, (controls?.domElement?.clientWidth || 1) / (controls?.domElement?.clientHeight || 1));
    camera.left = -maxDim * aspect;
    camera.right = maxDim * aspect;
    camera.top = maxDim;
    camera.bottom = -maxDim;
    camera.near = Math.max(maxDim / 1000, 0.001);
    camera.far = Math.max(maxDim * 1500, 1500);
    camera.updateProjectionMatrix();
    camera.position.copy(center.clone().add(new THREE.Vector3(maxDim, maxDim * 0.9, maxDim)));
  }

  controls.target.copy(center);
  controls.update();
  return true;
}

/** Build ground, grid, axes helpers (hidden by default) */
function buildHelpers() {
  const group = new THREE.Group();

  // Grid (teal-ish defaults; can be recolored by UI later)
  const grid = new THREE.GridHelper(10, 20, 0x0ea5a6, 0x14b8b9);
  grid.visible = false;
  group.add(grid);

  // Ground (only useful if shadows are enabled)
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.25 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.0001;
  ground.receiveShadow = false;
  ground.visible = false;
  group.add(ground);

  // Axes
  const axes = new THREE.AxesHelper(1);
  axes.visible = false;
  group.add(axes);

  return { group, grid, ground, axes };
}

/**
 * Create the viewer core.
 * @param {Object} params
 * @param {HTMLElement} params.container
 * @param {number|null} params.background - three Color int or null for transparent
 * @param {number} [params.pixelRatio] - optional pixel ratio override
 */
export function createViewer({ container, background = 0xffffff, pixelRatio } = {}) {
  assertThree();

  const rootEl = container || document.body;
  if (getComputedStyle(rootEl).position === 'static') {
    rootEl.style.position = 'relative';
  }

  // Scene
  const scene = new THREE.Scene();
  if (background === null || typeof background === 'undefined') {
    scene.background = null;
  } else {
    scene.background = new THREE.Color(background);
  }

  // Cameras
  const aspect = Math.max(1e-6, (rootEl.clientWidth || 1) / (rootEl.clientHeight || 1));
  const persp = new THREE.PerspectiveCamera(75, aspect, 0.01, 10000);
  persp.position.set(0, 0, 3);

  const orthoSize = 2.5;
  const ortho = new THREE.OrthographicCamera(
    -orthoSize * aspect, orthoSize * aspect,
    orthoSize, -orthoSize,
    0.01, 10000
  );
  ortho.position.set(0, 0, 3);

  let camera = persp;

  // Renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true
  });
  renderer.setPixelRatio(pixelRatio || window.devicePixelRatio || 1);
  renderer.setSize(rootEl.clientWidth || 1, rootEl.clientHeight || 1);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  rootEl.appendChild(renderer.domElement);

  // Shadows OFF by default
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Controls
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0xcfeeee, 0.7);
  const dir = new THREE.DirectionalLight(0xffffff, 1.05);
  dir.position.set(3, 4, 2);
  dir.castShadow = false;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.near = 0.1;
  dir.shadow.camera.far = 1000;
  scene.add(hemi);
  scene.add(dir);

  // Helpers
  const helpers = buildHelpers();
  scene.add(helpers.group);

  function sizeAxesHelper(maxDim, center) {
    helpers.axes.scale.setScalar(maxDim * 0.75);
    helpers.axes.position.copy(center || new THREE.Vector3());
  }

  // Handle resizes
  function onResize() {
    const w = rootEl.clientWidth || 1;
    const h = rootEl.clientHeight || 1;
    const asp = Math.max(1e-6, w / h);
    if (camera.isPerspectiveCamera) {
      camera.aspect = asp;
    } else {
      const size = orthoSize;
      camera.left = -size * asp;
      camera.right = size * asp;
      camera.top = size;
      camera.bottom = -size;
    }
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  // URDF loader & current robot
  const urdfLoader = new URDFLoader();
  let robotModel = null;

  /** Load URDF content (string) with an external loadMeshCb(path, manager, onComplete) */
  function loadURDF(urdfText, { loadMeshCb } = {}) {
    if (robotModel) {
      try { scene.remove(robotModel); } catch (_) {}
      robotModel = null;
    }
    if (!urdfText || typeof urdfText !== 'string') return null;

    if (typeof loadMeshCb === 'function') {
      urdfLoader.loadMeshCb = loadMeshCb;
    }

    let robot = null;
    try {
      robot = urdfLoader.parse(urdfText);
    } catch (e) {
      console.warn('[ViewerCore] URDF parse error:', e);
      return null;
    }

    if (robot && robot.isObject3D) {
      robotModel = robot;
      scene.add(robotModel);
      rectifyUpForward(robotModel);
      applyDoubleSided(robotModel);

      // First fit
      setTimeout(() => {
        if (!robotModel) return;
        const ok = fitAndCenter(camera, controls, robotModel, 1.06);
        if (ok) {
          const b = getObjectBounds(robotModel);
          if (b) sizeAxesHelper(b.maxDim, b.center);
        }
      }, 50);
    }
    return robotModel;
  }

  /** Switch projection mode (Perspective|Orthographic) while preserving view as much as possible */
  function setProjection(mode = 'Perspective') {
    const w = rootEl.clientWidth || 1, h = rootEl.clientHeight || 1;
    const asp = Math.max(1e-6, w / h);

    if (mode === 'Orthographic' && camera.isPerspectiveCamera) {
      const t = controls.target.clone();
      const v = camera.position.clone().sub(t);
      const dist = v.length();
      const dirN = v.clone().normalize();

      ortho.left = -orthoSize * asp;
      ortho.right = orthoSize * asp;
      ortho.top = orthoSize;
      ortho.bottom = -orthoSize;
      ortho.near = Math.max(0.001, dist * 0.01);
      ortho.far = Math.max(1000, dist * 50);
      ortho.position.copy(t.clone().add(dirN.multiplyScalar(dist)));
      ortho.updateProjectionMatrix();

      controls.object = ortho;
      camera = ortho;
      controls.target.copy(t);
      controls.update();
    } else if (mode === 'Perspective' && camera.isOrthographicCamera) {
      const t = controls.target.clone();
      const v = camera.position.clone().sub(t);
      const dist = v.length();
      const dirN = v.clone().normalize();

      persp.aspect = asp;
      persp.near = Math.max(0.001, dist * 0.01);
      persp.far = Math.max(1000, dist * 50);
      persp.position.copy(t.clone().add(dirN.multiplyScalar(dist)));
      persp.updateProjectionMatrix();

      controls.object = persp;
      camera = persp;
      controls.target.copy(t);
      controls.update();
    }
  }

  /** Toggle helpers and shadows from upper layers (UI) */
  function setSceneToggles({ grid, ground, axes, shadows } = {}) {
    if (typeof grid === 'boolean') helpers.grid.visible = grid;
    if (typeof ground === 'boolean') helpers.ground.visible = ground;

    if (typeof axes === 'boolean') helpers.axes.visible = axes;

    if (typeof shadows === 'boolean') {
      renderer.shadowMap.enabled = !!shadows;
      dir.castShadow = !!shadows;
      if (robotModel) {
        robotModel.traverse(o => {
          if (o.isMesh && o.geometry) {
            o.castShadow = !!shadows;
            o.receiveShadow = !!shadows;
          }
        });
      }
    }
    // Resize axes to object
    if (helpers.axes.visible && robotModel) {
      const b = getObjectBounds(robotModel);
      if (b) sizeAxesHelper(b.maxDim, b.center);
    }
  }

  /** Set background (int color) or null for transparent */
  function setBackground(colorIntOrNull) {
    if (colorIntOrNull === null || typeof colorIntOrNull === 'undefined') {
      scene.background = null;
    } else {
      scene.background = new THREE.Color(colorIntOrNull);
    }
  }

  /** Allow upper layer to adjust pixel ratio (e.g., for performance) */
  function setPixelRatio(r) {
    const pr = Math.max(0.5, Math.min(3, r || window.devicePixelRatio || 1));
    renderer.setPixelRatio(pr);
    onResize();
  }

  // Animation loop
  let raf = null;
  function animate() {
    raf = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // Cleanup
  function destroy() {
    try { cancelAnimationFrame(raf); } catch (_) {}
    try { window.removeEventListener('resize', onResize); } catch (_) {}
    try {
      const el = renderer?.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    } catch (_) {}
    try { renderer?.dispose?.(); } catch (_) {}
  }

  // Public facade
  return {
    // Core Three.js objects
    scene,
    get camera() { return camera; },
    renderer,
    controls,

    // Helpers group (in case UI needs references)
    helpers,

    // Current robot getter
    get robot() { return robotModel; },

    // APIs
    loadURDF,
    fitAndCenter: (obj, pad) => fitAndCenter(camera, controls, obj || robotModel, pad),
    setProjection,
    setSceneToggles,
    setBackground,
    setPixelRatio,
    onResize,
    destroy
  };
}
