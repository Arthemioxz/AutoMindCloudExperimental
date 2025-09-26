// ViewerCore.js — escena/cámara/renderer, carga URDF, bbox helpers y snapshot/restore

export async function initCore({ container, background = 0xffffff }) {
  const THREE = window.THREE;
  if (!THREE) throw new Error('[ViewerCore] THREE no cargado');

  const scene = new THREE.Scene();
  if (background === null) scene.background = null; else scene.background = new THREE.Color(background);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: background === null });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x889999, 1.0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(3, 6, 4); dir.castShadow = false; scene.add(dir);

  function resize() {
    const w = container.clientWidth || window.innerWidth || 1;
    const h = container.clientHeight || window.innerHeight || 1;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    renderer.render(scene, camera);
  }
  resize();
  window.addEventListener('resize', resize);

  function renderLoop() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);

  return {
    scene, camera, controls, renderer, THREE,
    destroy() {
      try { window.removeEventListener('resize', resize); } catch {}
      try { renderer.dispose(); } catch {}
      try { container.removeChild(renderer.domElement); } catch {}
    }
  };
}

export async function loadRobot({ urdfContent, meshDB, selectMode = 'link' }) {
  const THREE = window.THREE; const URDFLoader = window.URDFLoader;
  if (!URDFLoader) throw new Error('[ViewerCore] URDFLoader no disponible');

  const loader = new URDFLoader();
  loader.fetchOptions = { mode: 'cors', cache: 'no-store' };

  // Exponer meshDB global (inyectado por el entry)
  const mdb = window.__AMC_meshDB__ || {};

  loader.loadMeshCb = (path, loadingManager, done) => {
    try {
      const key = (path || '').toLowerCase();
      const base = key.split('/').pop();
      const dataUrl = mdb[key] || mdb[base];
      if (!dataUrl) return done(null);

      const ext = (key.split('.').pop() || '').toLowerCase();
      if (ext === 'stl') {
        const stl = new THREE.STLLoader(loadingManager);
        const b64 = dataUrl.split(',').pop();
        const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
        const geo = stl.parse(bin);
        const mat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.05, roughness: 0.9 });
        done(new THREE.Mesh(geo, mat));
      } else if (ext === 'dae') {
        const dae = new THREE.ColladaLoader(loadingManager);
        fetch(dataUrl).then(r => r.arrayBuffer()).then(buf => {
          const txt = new TextDecoder().decode(buf);
          const res = dae.parse(txt);
          const g = new THREE.Group(); g.add(res.scene);
          done(g);
        }).catch(() => done(null));
      } else {
        done(null);
      }
    } catch {
      done(null);
    }
  };

  const robot = loader.parse(urdfContent || '', { packages: { '': '' }, workingPath: '' });
  robot.rotation.order = 'XYZ';
  robot.updateMatrixWorld(true);
  robot.selectMode = selectMode;

  return { robot, loader };
}

// --- snapshot / restore de transformaciones completas ---
export function snapshotInitialPose(root) {
  root.traverse((o) => {
    if (!o.userData) o.userData = {};
    o.updateMatrixWorld(true);
    o.userData.__initPose__ = {
      position: o.position.clone(),
      quaternion: o.quaternion.clone(),
      scale: o.scale.clone(),
      visible: o.visible !== false
    };
  });
}
export function restoreInitialPose(root) {
  root.traverse((o) => {
    const ip = o.userData && o.userData.__initPose__;
    if (!ip) return;
    o.position.copy(ip.position);
    o.quaternion.copy(ip.quaternion);
    o.scale.copy(ip.scale);
    o.visible = ip.visible;
    o.updateMatrixWorld(true);
  });
}

// --- bbox helpers ---
export function boxCenter(obj, THREE = window.THREE) {
  if (!obj) return null;
  const b = new THREE.Box3().setFromObject(obj);
  return b.isEmpty() ? null : b.getCenter(new THREE.Vector3());
}
export function boxMax(obj, THREE = window.THREE) {
  const b = new THREE.Box3().setFromObject(obj);
  const s = b.getSize(new THREE.Vector3());
  return Math.max(s.x, s.y, s.z) || 1;
}

// --- tween de cámara ---
export function tweenOrbits(camera, controls, { toPos, toTarget = null, ms = 700 }) {
  const ease = (t) => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
  const p0 = camera.position.clone(), t0 = controls.target.clone(), tStart = performance.now();
  controls.enabled = false; camera.up.set(0,1,0);
  const moveTarget = (toTarget !== null);
  function step(t) {
    const u = Math.min(1, (t - tStart)/ms), e = ease(u);
    camera.position.set(
      p0.x + (toPos.x - p0.x)*e,
      p0.y + (toPos.y - p0.y)*e,
      p0.z + (toPos.z - p0.z)*e
    );
    if (moveTarget) controls.target.set(
      t0.x + (toTarget.x - t0.x)*e,
      t0.y + (toTarget.y - t0.y)*e,
      t0.z + (toTarget.z - t0.z)*e
    );
    controls.update();
    requestAnimationFrame(u < 1 ? step : () => { controls.enabled = true; });
  }
  requestAnimationFrame(step);
}

