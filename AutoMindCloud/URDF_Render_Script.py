import base64, re, os, json
from IPython.display import HTML
import gdown, zipfile, shutil

# Download & extract a Drive ZIP into /content/Output_Name
def Download_URDF(Drive_Link, Output_Name="Model"):
    root_dir = "/content"
    file_id = Drive_Link.split('/d/')[1].split('/')[0]
    download_url = f'https://drive.google.com/uc?id={file_id}'
    zip_path = os.path.join(root_dir, Output_Name + ".zip")
    tmp_extract = os.path.join(root_dir, f"__tmp_extract_{Output_Name}")
    final_dir = os.path.join(root_dir, Output_Name)

    if os.path.exists(tmp_extract): shutil.rmtree(tmp_extract)
    os.makedirs(tmp_extract, exist_ok=True)
    if os.path.exists(final_dir): shutil.rmtree(final_dir)

    gdown.download(download_url, zip_path, quiet=True)
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(tmp_extract)

    def is_junk(n): return n.startswith('.') or n == '__MACOSX'
    top = [n for n in os.listdir(tmp_extract) if not is_junk(n)]
    if len(top)==1 and os.path.isdir(os.path.join(tmp_extract, top[0])):
        shutil.move(os.path.join(tmp_extract, top[0]), final_dir)
    else:
        os.makedirs(final_dir, exist_ok=True)
        for n in top: shutil.move(os.path.join(tmp_extract, n), os.path.join(final_dir, n))
    shutil.rmtree(tmp_extract, ignore_errors=True)

# Viewer with robust selection + joint rotation (revolute/continuous/prismatic)
def URDF_Render(folder_path: str = "Model"):
    # --- locate urdf/ and meshes/ (one level deep allowed) ---
    def find_dirs(root):
        d_u, d_m = os.path.join(root,"urdf"), os.path.join(root,"meshes")
        if os.path.isdir(d_u) and os.path.isdir(d_m): return d_u, d_m
        if os.path.isdir(root):
            for name in os.listdir(root):
                cand = os.path.join(root, name)
                u, m = os.path.join(cand,"urdf"), os.path.join(cand,"meshes")
                if os.path.isdir(u) and os.path.isdir(m): return u, m
        return None, None

    urdf_dir, meshes_dir = find_dirs(folder_path)
    if not urdf_dir or not meshes_dir:
        raise FileNotFoundError(f"Could not find urdf/ and meshes/ inside '{folder_path}' (or one nested level).")

    urdf_files = [f for f in os.listdir(urdf_dir) if f.lower().endswith(".urdf")]
    if not urdf_files:
        raise FileNotFoundError(f"No .urdf file in {urdf_dir}")
    urdf_path = os.path.join(urdf_dir, urdf_files[0])

    with open(urdf_path, "r", encoding="utf-8") as f:
        urdf_raw = f.read()

    def esc_js(s: str) -> str:
        return (s.replace('\\','\\\\')
                 .replace('`','\\`')
                 .replace('$','\\$')
                 .replace("</script>","<\\/script>"))

    # collect mesh refs from URDF
    mesh_refs = re.findall(r'filename="([^"]+\.(?:stl|dae))"', urdf_raw, re.IGNORECASE)
    mesh_refs = list(dict.fromkeys(mesh_refs))

    # index actual files on disk
    disk_files = []
    for root, _, files in os.walk(meshes_dir):
        for name in files:
            if name.lower().endswith((".stl",".dae",".png",".jpg",".jpeg")):
                disk_files.append(os.path.join(root, name))
    by_basename = {os.path.basename(p).lower(): p for p in disk_files}

    _cache = {}
    def b64(path):
        if path not in _cache:
            with open(path, "rb") as f:
                _cache[path] = base64.b64encode(f.read()).decode("ascii")
        return _cache[path]

    mesh_db = {}
    def add_entry(key, path):
        k = key.replace("\\","/").lower()
        if k not in mesh_db: mesh_db[k] = b64(path)

    # map URDF refs to files
    for ref in mesh_refs:
        base = os.path.basename(ref).lower()
        if base in by_basename:
            real = by_basename[base]
            add_entry(ref, real)
            add_entry(ref.replace("package://",""), real)
            add_entry(base, real)

    # include textures by basename
    for p in disk_files:
        bn = os.path.basename(p).lower()
        if bn.endswith((".png",".jpg",".jpeg")) and bn not in mesh_db:
            add_entry(bn, p)

    # === Full-screen HTML (badge only) ===
    html = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>URDF Viewer</title>
<style>
  html,body { margin:0; height:100%; overflow:hidden; background:#f0f0f0; }
  canvas { display:block; width:100vw; height:100vh; }
  .badge{
      position:fixed;
      right:14px;
      bottom:12px;
      z-index:10;
      user-select:none;
      pointer-events:none;
  }
  .badge img{ max-height:40px; display:block; }
</style>
</head>
<body>
  <div class="badge">
    <img src="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png" alt="badge"/>
  </div>

<script src="https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/controls/OrbitControls.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/STLLoader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.132.2/examples/js/loaders/ColladaLoader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/urdf-loader@0.12.6/umd/URDFLoader.js"></script>

<script>
(() => {
  const SELECT_MODE = 'link'; // 'link' agrupa toda la pieza conectada

  // Limpia instancias previas si re-ejecutas la celda
  if (window.__URDF_VIEWER__ && typeof window.__URDF_VIEWER__.destroy === 'function') {
    try { window.__URDF_VIEWER__.destroy(); } catch(e){}
    try { delete window.__URDF_VIEWER__; } catch(e){}
  }

  const meshDB = /*__MESH_DB__*/ {};
  const urdfContent = `/*__URDF_CONTENT__*/`;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0f0);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 10000);
  camera.position.set(0, 0, 3);

  const renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.style.touchAction = 'none';
  document.body.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;

  // Iluminación
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(2, 2, 2);
  scene.add(dirLight);

  function onResize(){
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  // --- loader helpers ---
  const urdfLoader = new URDFLoader();
  const textDecoder = new TextDecoder();
  const b64ToUint8 = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const b64ToText  = (b64) => textDecoder.decode(b64ToUint8(b64));
  const MIME = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', stl:'model/stl', dae:'model/vnd.collada+xml' };
  const normKey = s => String(s||'').replace(/\\/g,'/').toLowerCase();
  function variantsFor(path){
    const out = new Set(), p = normKey(path);
    out.add(p); out.add(p.replace(/^package:\/\//,''));
    const bn = p.split('/').pop();
    out.add(bn); out.add(bn.split('?')[0].split('#')[0]);
    const parts = p.split('/'); for (let i=1;i<parts.length;i++) out.add(parts.slice(i).join('/'));
    return Array.from(out);
  }

  const daeCache = new Map();
  let pendingMeshes = 0, fitTimer = null;

  function applyDoubleSided(obj){
    obj?.traverse?.(node=>{
      if (node.isMesh && node.geometry){
        if (Array.isArray(node.material)) node.material.forEach(m=>m.side=THREE.DoubleSide);
        else if (node.material) node.material.side = THREE.DoubleSide;
        node.castShadow = node.receiveShadow = true;
        node.geometry.computeVertexNormals?.();
      }
    });
  }

  function scheduleFit(){
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      if (pendingMeshes === 0 && api.robotModel) {
        rectifyUpForward(api.robotModel);
        fitAndCenter(api.robotModel);
      }
    }, 80);
  }

  function fitAndCenter(object){
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 1.8;
    camera.near = Math.max(maxDim/1000, 0.001);
    camera.far  = Math.max(maxDim*1000, 1000);
    camera.updateProjectionMatrix();
    camera.position.copy(center.clone().add(new THREE.Vector3(dist, dist*0.9, dist)));
    controls.target.copy(center); controls.update();
  }

  // Z-up (ROS) -> Y-up (Three)
  function rectifyUpForward(obj){
    if (obj.userData.__rectified) return;
    obj.rotateX(-Math.PI/2);
    obj.userData.__rectified = true;
    obj.updateMatrixWorld(true);
  }

  // Cargador de mallas desde el diccionario embebido
  urdfLoader.loadMeshCb = (path, manager, onComplete) => {
    const tries = variantsFor(path);
    let keyFound = null;
    for (const k of tries){ const kk = normKey(k); if (meshDB[kk]) { keyFound = kk; break; } }
    if (!keyFound){ onComplete(new THREE.Mesh()); return; }

    pendingMeshes++;
    const done = (mesh) => {
      applyDoubleSided(mesh);
      onComplete(mesh);
      pendingMeshes--; scheduleFit();
    };

    const ext = keyFound.split('.').pop();
    try{
      if (ext === 'stl'){
        const bytes = b64ToUint8(meshDB[keyFound]);
        const loader = new THREE.STLLoader();
        const geom = loader.parse(bytes.buffer);
        geom.computeVertexNormals();
        done(new THREE.Mesh(
          geom,
          new THREE.MeshStandardMaterial({ color: 0x8aa1ff, roughness: 0.85, metalness: 0.15, side: THREE.DoubleSide })
        ));
        return;
      }
      if (ext === 'dae'){
        if (daeCache.has(keyFound)){ done(daeCache.get(keyFound).clone(true)); return; }
        const daeText = b64ToText(meshDB[keyFound]);
        const mgr = new THREE.LoadingManager();
        mgr.setURLModifier((url)=>{
          const tries2 = variantsFor(url);
          for (const k2 of tries2){
            const key2 = normKey(k2);
            if (meshDB[key2]){
              const mime = MIME[key2.split('.').pop()] || 'application/octet-stream';
              return `data:${mime};base64,${meshDB[key2]}`;
            }
          }
          return url;
        });
        const loader = new THREE.ColladaLoader(mgr);
        const collada = loader.parse(daeText, '');
        const obj = collada.scene || new THREE.Object3D();
        daeCache.set(keyFound, obj);
        done(obj.clone(true));
        return;
      }
      done(new THREE.Mesh());
    }catch(e){ done(new THREE.Mesh()); }
  };

  // =========================
  // Selección + rotación de joints (robusto)
  // =========================
  const api = { scene, camera, renderer, controls, robotModel:null, linkSet:null };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let dragState = null;

  const jt = s => (s||'').toString().toLowerCase();
  const isMovable   = j => { const t = jt(j.jointType); return t && t !== 'fixed'; };
  const isPrismatic = j => jt(j.jointType) === 'prismatic';

  // Overlay de hover sin parpadeo
  const hoverState = { overlays: [] };
  function clearHover() { for (const o of hoverState.overlays) if (o?.parent) o.parent.remove(o); hoverState.overlays.length = 0; }
  function makeOverlayForMesh(meshObj) {
    if (!meshObj || !meshObj.isMesh || !meshObj.geometry) return null;
    const overlay = new THREE.Mesh(
      meshObj.geometry,
      new THREE.MeshBasicMaterial({ color:0x9e9e9e, transparent:true, opacity:0.35, depthTest:false, depthWrite:false })
    );
    overlay.renderOrder = 999;
    overlay.userData.__isHoverOverlay = true;
    return overlay;
  }
  function collectMeshesInLink(linkObj) {
    const targets = [];
    const stack = [linkObj];
    while (stack.length) {
      const n = stack.pop();
      if (!n) continue;
      if (n.isMesh && n.geometry && !n.userData.__isHoverOverlay) targets.push(n);
      const kids = n.children ? n.children.slice() : [];
      for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
    return targets;
  }
  function showHoverMesh(meshObj) {
    const ov = makeOverlayForMesh(meshObj);
    if (ov) { meshObj.add(ov); hoverState.overlays.push(ov); }
  }
  function showHoverLink(linkObj) {
    const meshes = collectMeshesInLink(linkObj);
    for (const m of meshes) {
      const ov = makeOverlayForMesh(m);
      if (ov) { m.add(ov); hoverState.overlays.push(ov); }
    }
  }

  function getPointer(e){
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left)/r.width)*2-1;
    pointer.y = -((e.clientY - r.top)/r.height)*2+1;
  }

  // Nearest ancestor with jointType OR link tagged with __joint
  function findAncestorJoint(o){
    let n = o;
    while (n){
      if (n.jointType && isMovable(n)) return n;
      if (n.userData && n.userData.__joint && isMovable(n.userData.__joint)) return n.userData.__joint;
      n = n.parent;
    }
    return null;
  }
  function findAncestorLink(o){
    while (o){
      if (api.linkSet && api.linkSet.has(o)) return o;
      o = o.parent;
    }
    return null;
  }

  function clampByLimits(val, joint){
    const lim = joint.limit || {};
    if (jt(joint.jointType) !== 'continuous'){
      if (typeof lim.lower === 'number') val = Math.max(val, lim.lower);
      if (typeof lim.upper === 'number') val = Math.min(val, lim.upper);
    }
    return val;
  }
  function getJointValue(j){
    if (isPrismatic(j)) return (typeof j.position === 'number') ? j.position : 0;
    return (typeof j.angle === 'number') ? j.angle : 0;
  }
  function setJointValue(j, v){
    v = clampByLimits(v, j);
    if (typeof j.setJointValue === 'function') j.setJointValue(v);
    else if (api.robotModel && j.name) api.robotModel.setJointValue(j.name, v);
    api.robotModel?.updateMatrixWorld(true);
  }

  // Drag state + fallback
  const ROT_PER_PIXEL = 0.01;    // rad / pixel
  const PRISM_PER_PIXEL = 0.003; // m / pixel

  function startJointDrag(joint, ev){
    const originW = joint.getWorldPosition(new THREE.Vector3());
    const qWorld  = joint.getWorldQuaternion(new THREE.Quaternion());
    const axisW   = (joint.axis || new THREE.Vector3(1,0,0)).clone().normalize().applyQuaternion(qWorld).normalize();

    // Plane perpendicular to axis (works for both; for revolute used to define arc)
    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisW.clone(), originW);

    // Seed vector for revolute arc
    raycaster.setFromCamera(pointer, camera);
    const p0 = new THREE.Vector3();
    let r0 = null;
    if (raycaster.ray.intersectPlane(dragPlane, p0)){
      r0 = p0.clone().sub(originW);
      if (r0.lengthSq() > 1e-12) r0.normalize(); else r0 = null;
    }

    dragState = {
      joint, originW, axisW, dragPlane, r0,
      value: getJointValue(joint),
      lastClientX: ev.clientX, lastClientY: ev.clientY
    };
    controls.enabled = false;
    renderer.domElement.style.cursor = 'grabbing';
    renderer.domElement.setPointerCapture?.(ev.pointerId);
  }

  function updateJointDrag(ev){
    const ds = dragState;
    const fine = ev.shiftKey ? 0.35 : 1.0;

    getPointer(ev);
    raycaster.setFromCamera(pointer, camera);

    const dX = (ev.clientX - (ds.lastClientX ?? ev.clientX));
    const dY = (ev.clientY - (ds.lastClientY ?? ev.clientY));
    ds.lastClientX = ev.clientX; ds.lastClientY = ev.clientY;

    if (isPrismatic(ds.joint)){
      const hit = new THREE.Vector3();
      let delta = 0;
      if (raycaster.ray.intersectPlane(ds.dragPlane, hit)){
        const t1 = hit.clone().sub(ds.originW).dot(ds.axisW);
        delta = (t1 - (ds.lastT ?? t1)); ds.lastT = t1;
      } else {
        delta = - (dY * PRISM_PER_PIXEL);
      }
      ds.value += delta * fine;
      setJointValue(ds.joint, ds.value);
      return;
    }

    // Revolute / Continuous
    let applied = false;
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(ds.dragPlane, hit)){
      let r1 = hit.clone().sub(ds.originW);
      if (r1.lengthSq() >= 1e-12){
        r1.normalize();
        if (!ds.r0) ds.r0 = r1.clone();
        const cross = new THREE.Vector3().crossVectors(ds.r0, r1);
        const dot = THREE.MathUtils.clamp(ds.r0.dot(r1), -1, 1);
        const sign = Math.sign(ds.axisW.dot(cross)) || 1;
        const delta = Math.atan2(cross.length(), dot) * sign;
        ds.value += (delta * fine);
        ds.r0 = r1;
        setJointValue(ds.joint, ds.value);
        applied = true;
      }
    }
    if (!applied){
      const delta = (dX * ROT_PER_PIXEL) * fine;
      ds.value += delta;
      setJointValue(ds.joint, ds.value);
    }
  }

  function endJointDrag(ev){
    if (dragState){
      renderer.domElement.releasePointerCapture?.(ev.pointerId);
    }
    dragState = null;
    controls.enabled = true;
    renderer.domElement.style.cursor = 'auto';
  }

  // --------- Eventos de puntero ----------
  renderer.domElement.addEventListener('pointermove', (e)=>{
    getPointer(e);
    if (dragState) { updateJointDrag(e); return; }
    if (!api.robotModel) return;

    raycaster.setFromCamera(pointer, camera);
    const pickables = [];
    api.robotModel.traverse(o => { if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay) pickables.push(o); });

    const hits = raycaster.intersectObjects(pickables, true);

    clearHover();
    if (hits.length){
      const meshHit = hits[0].object;
      const link = findAncestorLink(meshHit);
      const joint = findAncestorJoint(meshHit);
      if (SELECT_MODE === 'link' && link) showHoverLink(link);
      else showHoverMesh(meshHit);
      renderer.domElement.style.cursor = (joint && isMovable(joint)) ? 'grab' : 'auto';
    } else {
      renderer.domElement.style.cursor = 'auto';
    }
  }, {passive:true});

  renderer.domElement.addEventListener('pointerdown', (e)=>{
    e.preventDefault();
    if (!api.robotModel || e.button!==0) return;

    raycaster.setFromCamera(pointer, camera);
    const pickables = [];
    api.robotModel.traverse(o => { if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay) pickables.push(o); });
    const hits = raycaster.intersectObjects(pickables, true);
    if (!hits.length) return;

    const joint = findAncestorJoint(hits[0].object);
    if (joint && isMovable(joint)) startJointDrag(joint, e);
  }, {passive:false});

  renderer.domElement.addEventListener('pointerup', endJointDrag);
  renderer.domElement.addEventListener('pointerleave', endJointDrag);
  renderer.domElement.addEventListener('pointercancel', endJointDrag);

  // ---------- Carga y mapeo de joints → links (FIX robusto) ----------
  function markLinksAndJoints(robot){
    // 1) Set de links para selección por grupo
    api.linkSet = new Set(Object.values(robot.links || {}));

    // 2) Por cada joint, identificar de forma robusta su link hijo y etiquetarlo
    const joints = Object.values(robot.joints || {});
    const linkByName = robot.links || {};

    joints.forEach(j=>{
      try {
        j.userData.__isURDFJoint = true;

        // Preferir objeto directo si existe
        let childLinkObj = j.child && j.child.isObject3D ? j.child : null

        // Si no, intentar por nombre (j.childLink o j.child.name o atributo 'child' string)
        const childName =
          (j.childLink && typeof j.childLink === 'string' && j.childLink) ||
          (j.child && typeof j.child.name === 'string' && j.child.name) ||
          (typeof j.child === 'string' && j.child) ||
          (typeof j.child_link === 'string' && j.child_link) ||
          null;

        if (!childLinkObj && childName && linkByName[childName]) {
          childLinkObj = linkByName[childName];
        }

        // Último recurso: buscar descendientes del joint con .name == childName
        if (!childLinkObj && childName && j.children && j.children.length){
          const stack = j.children.slice();
          while (stack.length){
            const n = stack.pop();
            if (!n) continue;
            if (n.name === childName) { childLinkObj = n; break; }
            const kids = n.children ? n.children.slice() : [];
            for (let i=0;i<kids.length;i++) stack.push(kids[i]);
          }
        }

        // Etiquetar el link hijo con su joint (si es movable)
        if (childLinkObj && isMovable(j)) {
          childLinkObj.userData.__joint = j;
        }
      } catch(e){}
    });
  }

  function loadURDF(){
    if (api.robotModel) { scene.remove(api.robotModel); api.robotModel=null; }
    pendingMeshes = 0;
    try{
      const robot = urdfLoader.parse(urdfContent);
      if (robot?.isObject3D){
        api.robotModel = robot; scene.add(api.robotModel);
        rectifyUpForward(api.robotModel);
        markLinksAndJoints(api.robotModel);
        scheduleFit();
      }
    }catch(e){}
  }

  function animate(){
    api._raf = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene,camera);
  }
  animate();
  loadURDF();

  // expose a destroy for next runs
  const apiObj = {
    ...api,
    destroy: function(){
      try{ cancelAnimationFrame(api._raf); }catch(e){}
      try{ window.removeEventListener('resize', onResize); }catch(e){}
      try{ if (api.robotModel) scene.remove(api.robotModel); }catch(e){}
      try{ renderer.dispose(); }catch(e){}
      try{ const el = renderer.domElement; el && el.parentNode && el.parentNode.removeChild(el); }catch(e){}
    }
  };
  window.__URDF_VIEWER__ = apiObj;
})(); // end IIFE
</script>
</body>
</html>"""

    html = html.replace("/*__MESH_DB__*/ {}", json.dumps(mesh_db))
    html = html.replace("/*__URDF_CONTENT__*/", esc_js(urdf_raw))
    return HTML(html)
