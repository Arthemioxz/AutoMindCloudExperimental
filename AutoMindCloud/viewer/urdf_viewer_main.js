// /viewer/urdf_viewer_main.js
// Minimal entry: renderiza SOLO el robot (sin docks, sin paneles) y arregla texturas con data: URLs.
/* global THREE, URDFLoader */

function guessMime(fname = "") {
  const f = fname.toLowerCase();
  if (f.endsWith(".jpg") || f.endsWith(".jpeg")) return "image/jpeg";
  if (f.endsWith(".png")) return "image/png";
  if (f.endsWith(".stl")) return "model/stl";
  if (f.endsWith(".dae")) return "model/vnd.collada+xml";
  return "application/octet-stream";
}

function normalizeKey(url) {
  return url.replace(/^package:\/\//, "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function buildLoadingManager(meshDB) {
  const manager = new THREE.LoadingManager();

  // Redirige URLs solicitadas por DAE/texturas a data: desde meshDB
  manager.setURLModifier((url) => {
    const k1 = normalizeKey(url);
    const k2 = k1.split("/").pop(); // basename
    const hit = meshDB[k1] || meshDB[k2];
    if (hit) {
      const mime = guessMime(k1);
      return `data:${mime};base64,${hit}`;
    }
    return url; // fallback
  });

  return manager;
}

function fitToObject(camera, controls, object, pad = 1.2) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  const fov = (camera.fov || 60) * Math.PI / 180;
  const dist = (maxDim * pad) / Math.tan(fov / 2);

  // Mantener dirección actual
  const dir = camera.position.clone().sub(controls.target).normalize();
  const pos = center.clone().add(dir.multiplyScalar(dist));

  controls.target.copy(center);
  camera.position.copy(pos);
  camera.near = Math.max(0.01, dist / 1000);
  camera.far  = dist * 1000;
  camera.updateProjectionMatrix();
  controls.update();
}

export function render(opts = {}) {
  const {
    container,
    urdfContent = "",
    meshDB = {},
    selectMode = "link",
    background = null
  } = opts;

  if (!container) throw new Error("[URDF entry] Falta container");
  if (!urdfContent) throw new Error("[URDF entry] Falta urdfContent");

  // ---- Renderer ----
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: background === null });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight, false);
  if (background !== null) renderer.setClearColor(new THREE.Color(background), 1);
  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  // ---- Scene, Camera, Controls ----
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight), 0.01, 1e6);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // ---- Lights ----
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.8));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(3, 5, 2);
  scene.add(dir);

  // ---- LoadingManager con URLModifier -> data: desde meshDB ----
  const manager = buildLoadingManager(meshDB);

  // ---- Loaders ----
  const urdfLoader = new URDFLoader(manager);
  const stlLoader  = new THREE.STLLoader(manager);
  const daeLoader  = new THREE.ColladaLoader(manager);
  const texLoader  = new THREE.TextureLoader(manager);
  THREE.ImageLoader.prototype.crossOrigin = null;
  THREE.TextureLoader.prototype.crossOrigin = null;

  // (Opcional) Si necesitas override de mallas personalizadas, puedes usar:
  // urdfLoader.loadMeshCb = (path, mng, done) => {
  //   const k = normalizeKey(path);
  //   const b64 = meshDB[k] || meshDB[k.split("/").pop()];
  //   if (!b64) return done(null);
  //   if (k.endsWith(".stl")) {
  //     const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
  //     const geom = stlLoader.parse(buf);
  //     const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0xb0b0b0 }));
  //     mesh.castShadow = mesh.receiveShadow = true;
  //     done(mesh);
  //   } else if (k.endsWith(".dae")) {
  //     const xml = atob(b64);
  //     const collada = daeLoader.parse(xml, "/");
  //     done(collada.scene);
  //   } else {
  //     done(null);
  //   }
  // };

  // ---- Cargar desde string ----
  let robot = null;
  try {
    robot = urdfLoader.parse(urdfContent, { packages: "" }); // 'packages' irrelevante gracias a URLModifier
  } catch (e) {
    console.error("[URDF entry] Error parseando URDF:", e);
    throw e;
  }

  // Algunos URDFs quedan dentro de un Group; asegurar que haya objeto
  const root = new THREE.Group();
  root.add(robot);
  scene.add(root);

  // ---- Frame inicial (ISO-ish) ----
  camera.position.set(2.2, 1.6, 2.2);
  controls.target.set(0, 0.6, 0);
  fitToObject(camera, controls, root, 1.4);

  // ---- Resize ----
  function resize() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  window.addEventListener("resize", resize);

  // ---- Loop ----
  function tick() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();

  // Retornar API mínima por si la quieres usar
  return { scene, camera, renderer, controls, robot: root, selectMode };
}
