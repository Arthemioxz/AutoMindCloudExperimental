// /viewer/core/ViewerCore.js
// Minimal viewer core: scene, camera, controls, lights, loader shim, utilities.
/* global THREE */

export function createViewer({ container, background = 0xffffff } = {}) {
  if (!container) throw new Error('[ViewerCore] container required');

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  // Camera + controls
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 2000);
  camera.position.set(2.5, 1.5, 2.5);

  const controls = new THREE.OrbitControls(camera, container);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.target.set(0, 0.3, 0);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  const pr = Math.max(0.5, Math.min(3, window.devicePixelRatio || 1));
  renderer.setPixelRatio(pr);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // Resize
  function onResize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  const ro = new ResizeObserver(onResize);
  ro.observe(container);

  // Basic lights & helpers
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.9);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 8, 3);
  scene.add(hemi, dir);

  const grid = new THREE.GridHelper(10, 20, 0x88caca, 0xe0f0f0);
  grid.visible = false;
  const axes = new THREE.AxesHelper(0.7);
  axes.visible = false;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.15 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  ground.visible = false;
  scene.add(grid, axes, ground);

  // Robot placeholder (set on loadURDF)
  let robot = new THREE.Group();
  scene.add(robot);

  // Simple URDF loader shim
  async function loadURDF(urdfString, { loadMeshCb } = {}) {
    // You can swap this by your own URDFLoader. Here we keep the callback API.
    if (!urdfString) return;
    // Example: create a dummy root so downstream APIs are stable
    if (robot) scene.remove(robot);
    robot = new THREE.Group();
    robot.name = 'URDFRoot';
    scene.add(robot);

    // Mesh loading via provided callback:
    if (typeof loadMeshCb === 'function') {
      // Your real implementation will traverse URDF and call loadMeshCb(...)
      // For now we just ensure the callback exists so app code is consistent.
      // e.g. const mesh = await loadMeshCb({url, key, type})
    }
  }

  // Render loop
  let destroyed = false;
  function tick() {
    if (destroyed) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Exposed API expected by UI
  function setProjection(mode) {
    const w = renderer.domElement.clientWidth || 1;
    const h = renderer.domElement.clientHeight || 1;
    if (mode === 'Orthographic') {
      const aspect = w / h;
      const d = 1.8;
      const ortho = new THREE.OrthographicCamera(-d*aspect, d*aspect, d, -d, 0.01, 2000);
      ortho.position.copy(camera.position);
      controls.object = ortho;
      controls.update();
      camera.copy(ortho, true);
    } else {
      const persp = new THREE.PerspectiveCamera(60, w / h, 0.01, 2000);
      persp.position.copy(camera.position);
      controls.object = persp;
      controls.update();
      camera.copy(persp, true);
    }
  }

  function setSceneToggles({ grid: gv, ground: gd, axes: ax } = {}) {
    if (typeof gv === 'boolean') grid.visible = gv;
    if (typeof gd === 'boolean') ground.visible = gd;
    if (typeof ax === 'boolean') axes.visible = ax;
  }

  function destroy() {
    destroyed = true;
    try { ro.disconnect(); } catch {}
    try { renderer.dispose(); } catch {}
    try { container.removeChild(renderer.domElement); } catch {}
  }

  return {
    scene, camera, controls, renderer,
    grid, axes, ground,
    robot,
    loadURDF,
    setProjection,
    setSceneToggles,
    destroy
  };
}
