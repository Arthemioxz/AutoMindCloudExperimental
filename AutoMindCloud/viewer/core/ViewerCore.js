// /viewer/core/ViewerCore.js
// Three.js r132 compatible core for loading URDF and controlling scene.

'use strict';

/* global THREE, URDFLoader */

function assertThree() {
  if (!window.THREE) throw new Error('THREE not found on window');
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Viewer uses a GridHelper of size 10; keep ortho frustum large enough so the grid never clips.
const GRID_SIZE = 10;
const GRID_HALF = GRID_SIZE * 0.5;

/**
 * Minimal TrackballControls (r132-friendly) to allow full 360° rotation in any direction.
 * Keeps the same public surface we rely on elsewhere: {"object","domElement","enabled","target","update()"}.
 */
class TrackballControls {
  constructor(object, domElement) {
    this.object = object;
    this.domElement = domElement;

    this.enabled = true;

    this.rotateSpeed = 4.0;
    this.zoomSpeed = 1.2;
    this.panSpeed = 0.8;

    this.staticMoving = false;
    this.dynamicDampingFactor = 0.15;

    this.target = new THREE.Vector3();

    this._state = 0; // 0 none, 1 rotate, 2 zoom, 3 pan
    this._rect = null;

    this._start = new THREE.Vector2();
    this._end = new THREE.Vector2();

    this._touchId = null;

    this._onContextMenu = (e) => e.preventDefault();
    this._onWheel = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const delta = (e.deltaY || 0);
      this._dolly(delta);
      this.update();
    };

    this._onPointerDown = (e) => {
      if (!this.enabled) return;
      // Only track primary pointer
      if (this._touchId !== null) return;
      this._touchId = e.pointerId;

      this._state = (e.button === 0) ? 1 : (e.button === 1) ? 2 : 3;

      this._start.set(e.clientX, e.clientY);
      this._end.copy(this._start);

      try { this.domElement.setPointerCapture(e.pointerId); } catch (err) { }
      window.addEventListener('pointermove', this._onPointerMove, true);
      window.addEventListener('pointerup', this._onPointerUp, true);
    };

    this._onPointerMove = (e) => {
      if (!this.enabled) return;
      if (this._touchId !== e.pointerId) return;

      this._end.set(e.clientX, e.clientY);

      if (this._state === 1) {
        this._rotate(this._start, this._end);
      } else if (this._state === 2) {
        const dy = (this._end.y - this._start.y);
        this._dolly(dy * 4);
      } else if (this._state === 3) {
        this._pan(this._start, this._end);
      }

      this._start.copy(this._end);
      this.update();
    };

    this._onPointerUp = (e) => {
      if (this._touchId !== e.pointerId) return;
      this._touchId = null;
      this._state = 0;
      window.removeEventListener('pointermove', this._onPointerMove, true);
      window.removeEventListener('pointerup', this._onPointerUp, true);
      try { this.domElement.releasePointerCapture(e.pointerId); } catch (err) { }
    };

    this.domElement.addEventListener('contextmenu', this._onContextMenu);
    this.domElement.addEventListener('wheel', this._onWheel, { passive: false });
    this.domElement.addEventListener('pointerdown', this._onPointerDown, true);
  }

  handleResize() {
    this._rect = this.domElement.getBoundingClientRect();
  }

  update() {
    if (!this._rect) this.handleResize();
    this.object.lookAt(this.target);
  }

  _getNDC(clientX, clientY) {
    if (!this._rect) this.handleResize();
    const x = (clientX - this._rect.left) / Math.max(1, this._rect.width);
    const y = (clientY - this._rect.top) / Math.max(1, this._rect.height);
    // map to [-1,1]
    return new THREE.Vector2(x * 2 - 1, -(y * 2 - 1));
  }

  _projectOnSphere(ndc) {
    const v = new THREE.Vector3(ndc.x, ndc.y, 0);
    const d2 = v.x * v.x + v.y * v.y;
    if (d2 <= 1.0) {
      v.z = Math.sqrt(1.0 - d2);
    } else {
      v.normalize();
      v.z = 0.0;
    }
    return v;
  }

  _rotate(startPx, endPx) {
    const a = this._projectOnSphere(this._getNDC(startPx.x, startPx.y));
    const b = this._projectOnSphere(this._getNDC(endPx.x, endPx.y));

    const axisCam = new THREE.Vector3().crossVectors(a, b);
    const axisLen = axisCam.length();
    if (axisLen < 1e-8) return;
    axisCam.normalize();

    const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
    const angle = Math.acos(dot) * this.rotateSpeed;

    // Rotate around axis expressed in world space
    const axisWorld = axisCam.clone().applyQuaternion(this.object.quaternion);

    const q = new THREE.Quaternion().setFromAxisAngle(axisWorld, angle);

    const eye = this.object.position.clone().sub(this.target);
    eye.applyQuaternion(q);
    this.object.up.applyQuaternion(q);
    this.object.position.copy(this.target.clone().add(eye));
  }

  _dolly(delta) {
    const zoomFactor = Math.pow(0.95, (delta * this.zoomSpeed) * 0.01);

    if (this.object.isPerspectiveCamera) {
      const eye = this.object.position.clone().sub(this.target);
      const newLen = Math.max(1e-6, eye.length() * zoomFactor);
      eye.setLength(newLen);
      this.object.position.copy(this.target.clone().add(eye));
    } else if (this.object.isOrthographicCamera) {
      // Orthographic: zoom property is the right knob
      this.object.zoom = Math.max(1e-3, this.object.zoom / zoomFactor);
      this.object.updateProjectionMatrix();
    }
  }

  _pan(startPx, endPx) {
    if (!this._rect) this.handleResize();
    const dx = (endPx.x - startPx.x);
    const dy = (endPx.y - startPx.y);

    const w = Math.max(1, this._rect.width);
    const h = Math.max(1, this._rect.height);

    let scale = 1.0;
    if (this.object.isPerspectiveCamera) {
      const eye = this.object.position.clone().sub(this.target);
      const dist = eye.length();
      const fov = (this.object.fov || 60) * Math.PI / 180;
      const worldPerPixel = 2 * dist * Math.tan(fov / 2) / h;
      scale = worldPerPixel;
    } else if (this.object.isOrthographicCamera) {
      const worldPerPixel = (this.object.top - this.object.bottom) / h;
      scale = worldPerPixel;
    }

    const panX = -dx * scale * this.panSpeed;
    const panY = dy * scale * this.panSpeed;

    const te = this.object.matrix.elements;
    const xAxis = new THREE.Vector3(te[0], te[1], te[2]);
    const yAxis = new THREE.Vector3(te[4], te[5], te[6]);

    const pan = xAxis.multiplyScalar(panX).add(yAxis.multiplyScalar(panY));

    this.object.position.add(pan);
    this.target.add(pan);
  }
}

/** Ensure meshes are double-sided + set shadow flags */
function applyDoubleSidedAndShadows(obj, castShadow, receiveShadow) {
  obj.traverse((c) => {
    if (c.isMesh) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach((m) => {
        if (!m) return;
        m.side = THREE.DoubleSide;
      });
      c.castShadow = !!castShadow;
      c.receiveShadow = !!receiveShadow;
    }
  });
}

/** compute bounds */
function getObjectBounds(obj, pad = 1.08) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) * pad;
  return { box, size, center, maxDim: Math.max(maxDim, 1e-6) };
}

/** fit camera + controls target to obj */
function fitAndCenter(camera, controls, obj, pad = 1.06) {
  if (!camera || !controls || !obj) return;
  const { center, maxDim } = getObjectBounds(obj, pad);

  controls.target.copy(center);

  if (camera.isPerspectiveCamera) {
    // move camera to see object
    const fov = camera.fov * Math.PI / 180;
    const dist = maxDim / Math.tan(fov / 2);
    const dir = new THREE.Vector3(1, 0.9, 1).normalize();
    camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    camera.near = Math.max(dist / 1000, 0.01);
    camera.far = Math.max(dist * 1500, 1500);
    camera.updateProjectionMatrix();
  } else if (camera.isOrthographicCamera) {
    // set ortho frustum around obj (ensure grid never clips)
    const aspect = Math.max(1e-6, (controls?.domElement?.clientWidth || 1) / (controls?.domElement?.clientHeight || 1));
    const minSpan = GRID_HALF * Math.SQRT2 * Math.max(1, 1 / aspect);
    const span = Math.max(maxDim, minSpan);
    camera.left = -span * aspect;
    camera.right = span * aspect;
    camera.top = span;
    camera.bottom = -span;
    camera.near = Math.max(span / 1000, 0.001);
    camera.far = Math.max(span * 1500, 1500);
    camera.updateProjectionMatrix();
    camera.position.copy(center.clone().add(new THREE.Vector3(span, span * 0.9, span)));
  }

  camera.lookAt(center);
  controls.update();
}

export function createViewer(rootEl, opts = {}) {
  assertThree();

  if (!rootEl) throw new Error('rootEl required');

  const state = {
    background: opts.background ?? 0x0b0f14,
    showGrid: opts.showGrid ?? false,
    showAxes: opts.showAxes ?? false,
    showGround: opts.showGround ?? false,
    shadows: opts.shadows ?? false,
    projection: opts.projection ?? 'Perspective', // or 'Orthographic'
    renderMode: opts.renderMode ?? 'Solid'
  };

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setClearColor(state.background, 1);
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(rootEl.clientWidth, rootEl.clientHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;

  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';

  rootEl.innerHTML = '';
  rootEl.appendChild(renderer.domElement);

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(state.background);

  // Camera(s)
  const persp = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
  persp.position.set(2.8, 2.2, 2.8);
  persp.up.set(0, 1, 0);

  const orthoSize = 2.5;
  const ortho = new THREE.OrthographicCamera(-orthoSize, orthoSize, orthoSize, -orthoSize, 0.001, 10000);
  ortho.position.copy(persp.position);
  ortho.up.copy(persp.up);

  let camera = (state.projection === 'Orthographic') ? ortho : persp;

  // Controls
  const controls = new TrackballControls(camera, renderer.domElement);
  controls.rotateSpeed = 4.0;
  controls.zoomSpeed = 1.4;
  controls.panSpeed = 0.8;
  controls.staticMoving = false;
  controls.dynamicDampingFactor = 0.15;
  controls.target.set(0, 0, 0);
  controls.update();

  // Lights
  const amb = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(amb);

  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(4, 7, 4);
  dir.castShadow = true;
  dir.shadow.mapSize.width = 2048;
  dir.shadow.mapSize.height = 2048;
  dir.shadow.camera.near = 0.1;
  dir.shadow.camera.far = 50;
  dir.shadow.bias = -0.00012;
  scene.add(dir);

  // Helpers group
  const helpers = new THREE.Group();
  scene.add(helpers);

  function buildHelpers() {
    helpers.clear();

    // Axes
    const axes = new THREE.AxesHelper(0.9);
    axes.visible = !!state.showAxes;
    helpers.add(axes);

    // Grid
    const grid = new THREE.GridHelper(10, 20, 0x334a5a, 0x1b2a33);
    grid.visible = !!state.showGrid;
    helpers.add(grid);

    // Ground with shadows
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.25 });
    groundMat.depthWrite = false;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.0001;
    ground.receiveShadow = true;
    ground.visible = !!state.showGround;
    helpers.add(ground);

    // Shadows OFF by default
    dir.castShadow = !!state.shadows;
    renderer.shadowMap.enabled = !!state.shadows;

    return { axes, grid, ground };
  }

  let helperRefs = buildHelpers();

  function setSceneToggles({ showGrid, showAxes, showGround, shadows } = {}) {
    if (typeof showGrid === 'boolean') state.showGrid = showGrid;
    if (typeof showAxes === 'boolean') state.showAxes = showAxes;
    if (typeof showGround === 'boolean') state.showGround = showGround;
    if (typeof shadows === 'boolean') state.shadows = shadows;

    helperRefs = buildHelpers();
  }

  // Resize handling
  function onResize() {
    const w = Math.max(1, rootEl.clientWidth);
    const h = Math.max(1, rootEl.clientHeight);
    const asp = Math.max(1e-6, w / h);
    if (controls && typeof controls.handleResize === 'function') controls.handleResize();

    if (camera.isPerspectiveCamera) {
      camera.aspect = asp;
    } else {
      const minSpan = GRID_HALF * Math.SQRT2 * Math.max(1, 1 / asp);
      const size = Math.max(Math.abs(camera.top) || orthoSize, minSpan);
      camera.left = -size * asp;
      camera.right = size * asp;
      camera.top = size;
      camera.bottom = -size;
    }

    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  window.addEventListener('resize', onResize);

  // URDF
  const loader = new URDFLoader();
  loader.workingPath = opts.workingPath ?? '';
  loader.parseColliders = false;

  let robotModel = null;

  function clearRobot() {
    if (robotModel) {
      scene.remove(robotModel);
      robotModel = null;
    }
  }

  function loadURDF(urdfUrl, onProgress) {
    return new Promise((resolve, reject) => {
      clearRobot();

      loader.load(
        urdfUrl,
        (urdf) => {
          robotModel = urdf;
          robotModel.name = 'URDFRobot';
          robotModel.rotation.x = 0;
          robotModel.position.set(0, 0, 0);

          scene.add(robotModel);

          // Apply default material tweaks
          applyDoubleSidedAndShadows(robotModel, state.shadows, state.shadows);

          // Frame camera
          fitAndCenter(camera, controls, robotModel, 1.08);

          resolve(robotModel);
        },
        (xhr) => {
          if (!onProgress) return;
          const total = xhr.total || 0;
          const loaded = xhr.loaded || 0;
          onProgress({ loaded, total, pct: total ? loaded / total : 0 });
        },
        (err) => reject(err)
      );
    });
  }

  // Projections
  function setProjection(mode) {
    state.projection = mode;

    const t = controls.target.clone();
    const v = camera.position.clone().sub(t);
    const dist = v.length();
    const dirNorm = v.clone().normalize();

    if (mode === 'Orthographic') {
      camera = ortho;
      controls.object = ortho;
      ortho.position.copy(t.clone().add(dirNorm.multiplyScalar(dist)));

      const w = Math.max(1, rootEl.clientWidth);
      const h = Math.max(1, rootEl.clientHeight);
      const asp = Math.max(1e-6, w / h);

      // Match apparent scale from current perspective view, while ensuring model + grid do not clip.
      let size = dist * Math.tan(Math.max(1e-6, ((camera.fov || 60) * Math.PI / 180) / 2));
      const b = robotModel ? getObjectBounds(robotModel, 1.08) : null;
      if (b && b.maxDim) size = Math.max(size, b.maxDim);
      const minSpan = GRID_HALF * Math.SQRT2 * Math.max(1, 1 / asp);
      size = Math.max(size, minSpan);

      ortho.left = -size * asp;
      ortho.right = size * asp;
      ortho.top = size;
      ortho.bottom = -size;

      ortho.near = Math.max(dist / 1000, 0.001);
      ortho.far = Math.max(dist * 1500, 1500);
      ortho.updateProjectionMatrix();

    } else {
      camera = persp;
      controls.object = persp;
      persp.position.copy(t.clone().add(dirNorm.multiplyScalar(dist)));

      persp.near = Math.max(dist / 1000, 0.01);
      persp.far = Math.max(dist * 1500, 1500);
      persp.updateProjectionMatrix();
    }

    camera.lookAt(t);
    controls.update();
    onResize();
  }

  // Pixel ratio
  function setPixelRatio(pr) {
    renderer.setPixelRatio(Math.max(0.5, pr || 1));
    onResize();
  }

  // Animation loop
  let running = true;

  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);

    controls.update();
    renderer.render(scene, camera);
  }

  animate();
  onResize();

  function destroy() {
    running = false;
    window.removeEventListener('resize', onResize);
    try { rootEl.removeChild(renderer.domElement); } catch (e) { }
    renderer.dispose();
  }

  return {
    renderer,
    scene,
    get camera() { return camera; },
    persp,
    ortho,
    controls,
    state,
    setSceneToggles,
    setProjection,
    loadURDF,
    clearRobot,
    fitAndCenter: (obj, pad) => fitAndCenter(camera, controls, obj || robotModel, pad),
    setPixelRatio,
    onResize,
    destroy
  };
}
