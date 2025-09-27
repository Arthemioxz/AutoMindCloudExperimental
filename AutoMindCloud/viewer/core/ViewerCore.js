// /viewer/core/ViewerCore.js
/* global THREE, URDFLoader */
function assertThree(){
  if(typeof THREE==='undefined') throw new Error('[ViewerCore] THREE is not defined');
  if(typeof URDFLoader==='undefined') throw new Error('[ViewerCore] URDFLoader is not defined');
}
const clamp01 = x => Math.max(0, Math.min(1, x));

function applyDoubleSided(root){
  root?.traverse?.(n=>{
    if(n.isMesh && n.geometry){
      if (Array.isArray(n.material)) n.material.forEach(m=>m.side=THREE.DoubleSide);
      else if(n.material) n.material.side=THREE.DoubleSide;
      n.castShadow=false; n.receiveShadow=false;
      n.geometry.computeVertexNormals?.();
    }
  });
}
function rectifyUpForward(obj){
  if(!obj || obj.userData.__rectified) return;
  obj.rotateX(-Math.PI/2); obj.userData.__rectified=true; obj.updateMatrixWorld(true);
}
function getBounds(object, pad=1.0){
  const box=new THREE.Box3().setFromObject(object); if(box.isEmpty()) return null;
  const center=box.getCenter(new THREE.Vector3()); const size=box.getSize(new THREE.Vector3()).multiplyScalar(pad);
  const maxDim=Math.max(size.x,size.y,size.z)||1; return { box, center, size, maxDim };
}
function fitAndCenter(camera, controls, object, pad=1.06){
  const b=getBounds(object, pad); if(!b) return false;
  const {center, maxDim}=b;
  if(camera.isPerspectiveCamera){
    const fov=(camera.fov||60)*Math.PI/180; const dist=maxDim/Math.tan(Math.max(1e-6,fov/2));
    camera.near=Math.max(maxDim/1000,0.001); camera.far=Math.max(maxDim*1500,1500); camera.updateProjectionMatrix();
    const dir=camera.position.clone().sub(controls.target||new THREE.Vector3()).normalize();
    if(!isFinite(dir.lengthSq()) || dir.lengthSq()<1e-10) dir.set(1,0.7,1).normalize();
    camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
  }else{
    const asp=Math.max(1e-6,(controls?.domElement?.clientWidth||1)/(controls?.domElement?.clientHeight||1));
    const size= maxDim; camera.left=-size*asp; camera.right=size*asp; camera.top=size; camera.bottom=-size;
    camera.near=Math.max(maxDim/1000,0.001); camera.far=Math.max(maxDim*1500,1500); camera.updateProjectionMatrix();
    camera.position.copy(center.clone().add(new THREE.Vector3(maxDim,maxDim*0.9,maxDim)));
  }
  controls.target.copy(center); controls.update(); return true;
}

export function createViewer({ container, background=0xffffff, pixelRatio }={}){
  assertThree();
  const rootEl = container || document.body;
  if (getComputedStyle(rootEl).position === 'static') rootEl.style.position='relative';

  const scene = new THREE.Scene();
  scene.background = (background===null||typeof background==='undefined') ? null : new THREE.Color(background);

  const aspect = Math.max(1e-6,(rootEl.clientWidth||1)/(rootEl.clientHeight||1));
  const camera = new THREE.PerspectiveCamera(75, aspect, 0.01, 10000);
  camera.position.set(0,0,3);

  const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
  renderer.setPixelRatio(pixelRatio || window.devicePixelRatio || 1);
  renderer.setSize(rootEl.clientWidth||1, rootEl.clientHeight||1);
  Object.assign(renderer.domElement.style, { width:'100%', height:'100%', display:'block', touchAction:'none' });
  rootEl.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;

  const hemi=new THREE.HemisphereLight(0xffffff, 0xcfeeee, 0.7);
  const dir = new THREE.DirectionalLight(0xffffff, 1.05); dir.position.set(3,4,2);
  dir.castShadow=false; scene.add(hemi); scene.add(dir);

  function onResize(){ const w=rootEl.clientWidth||1, h=rootEl.clientHeight||1, asp=Math.max(1e-6,w/h);
    camera.aspect=asp; camera.updateProjectionMatrix(); renderer.setSize(w,h); }
  window.addEventListener('resize', onResize);

  const urdfLoader = new URDFLoader();
  let robotModel = null;

  function loadURDF(urdfText, { loadMeshCb }={}){
    if(robotModel){ try{ scene.remove(robotModel);}catch(_){ } robotModel=null; }
    if(!urdfText || typeof urdfText!=='string') return null;
    if(typeof loadMeshCb==='function') urdfLoader.loadMeshCb = loadMeshCb;
    let robot=null; try{ robot=urdfLoader.parse(urdfText); }catch(e){ console.warn('[ViewerCore] URDF parse error:', e); return null; }
    if(robot && robot.isObject3D){
      robotModel=robot; scene.add(robotModel); rectifyUpForward(robotModel); applyDoubleSided(robotModel);
      setTimeout(()=>{ if(robotModel) fitAndCenter(camera, controls, robotModel, 1.06); }, 50);
    }
    return robotModel;
  }

  function renderOnce(){ renderer.render(scene, camera); }
  (function loop(){ requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();

  function destroy(){ try{ renderer.dispose(); }catch(_){ } try{ renderer.domElement.remove(); }catch(_){ } }

  return { scene, camera, renderer, controls, loadURDF, fitAndCenter:(o,p=1.06)=>fitAndCenter(camera,controls,o,p), destroy };
}
