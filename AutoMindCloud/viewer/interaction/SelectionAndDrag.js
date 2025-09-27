// /viewer/interaction/SelectionAndDrag.js
/* global THREE */
const HOVER_COLOR = 0x0ea5a6;
const HOVER_OPACITY = 0.28;

const isPrismatic = j => (j?.jointType||'').toString().toLowerCase()==='prismatic';
const isMovable = j => !!(j?.jointType) && (j.jointType.toLowerCase()!=='fixed');
const getJointValue = j => isPrismatic(j) ? (typeof j.position==='number'?j.position:0) : (typeof j.angle==='number'?j.angle:0);
function setJointValue(robot, j, v){
  if(!j) return; const t=(j.jointType||'').toLowerCase(); const lim=j.limit||{};
  if(t!=='continuous'){ if(typeof lim.lower==='number') v=Math.max(v, lim.lower); if(typeof lim.upper==='number') v=Math.min(v, lim.upper); }
  if(typeof j.setJointValue==='function') j.setJointValue(v); else if(robot && j.name) robot.setJointValue(j.name, v);
  robot?.updateMatrixWorld(true);
}

function collectMeshesIn(obj){
  const out=[]; obj?.traverse?.(o=>{ if(o.isMesh && o.geometry && !o.userData.__isHoverOverlay) out.push(o); }); return out;
}
function computeUnionBox(meshes){
  const box=new THREE.Box3(), tmp=new THREE.Box3(); let has=false;
  for(const m of meshes||[]){ if(!m) continue; tmp.setFromObject(m); if(!has){ box.copy(tmp); has=true;} else box.union(tmp); }
  return has?box:null;
}
function makeHoverOverlay({ color=HOVER_COLOR, opacity=HOVER_OPACITY }={}){
  const overlays=[];
  function clear(){ overlays.forEach(o=>{ try{ o.parent?.remove(o);}catch(_){ } }); overlays.length=0; }
  function overlayFor(mesh){ if(!mesh?.isMesh||!mesh.geometry) return null;
    const m=new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color, transparent:true, opacity, depthTest:false, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:1 }));
    m.renderOrder=999; m.userData.__isHoverOverlay=true; return m;
  }
  function showLink(link){ for(const m of collectMeshesIn(link)){ const ov=overlayFor(m); if(ov){ m.add(ov); overlays.push(ov);} } }
  return { clear, showLink };
}

function findAncestorLink(o, robot){
  const set=new Set(Object.values(robot?.links||{}));
  while(o){ if(set.has(o)) return o; o=o.parent; } return null;
}

export function attachInteraction({ scene, camera, renderer, controls, robot, selectMode='link' }){
  if(!scene||!camera||!renderer||!controls) throw new Error('[SelectionAndDrag] Missing core objects');
  let robotModel=robot||null;
  const raycaster=new THREE.Raycaster(); const pointer=new THREE.Vector2();
  const hover=makeHoverOverlay(); let lastHover=null;

  // Selection state
  let selectedMeshes=[];
  const selectionBox=new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-.5,-.5,-.5), new THREE.Vector3(.5,.5,.5)), new THREE.Color(HOVER_COLOR));
  selectionBox.visible=false; selectionBox.renderOrder=10001; scene.add(selectionBox);

  function refreshSelection(){
    if(!selectedMeshes.length){ selectionBox.visible=false; return; }
    const box=computeUnionBox(selectedMeshes); if(!box){ selectionBox.visible=false; return; }
    selectionBox.box.copy(box); selectionBox.updateMatrixWorld(true); selectionBox.visible=true;
  }
  function setSelectedMeshes(meshes){ selectedMeshes=(meshes||[]).filter(Boolean); refreshSelection(); }

  // Hover & pick
  function getPointer(e){ const r=renderer.domElement.getBoundingClientRect(); pointer.x=((e.clientX-r.left)/r.width)*2-1; pointer.y=-((e.clientY-r.top)/r.height)*2+1; }
  function pick(e){
    getPointer(e); raycaster.setFromCamera(pointer, camera);
    const pickables=[]; robotModel?.traverse(o=>{ if(o.isMesh && o.geometry && o.visible && !o.userData.__isHoverOverlay) pickables.push(o); });
    const hits=raycaster.intersectObjects(pickables,true); return hits.length?hits[0].object:null;
  }

  renderer.domElement.addEventListener('mousemove', (e)=>{
    const hit=pick(e); const key=hit?('mesh#'+hit.id):null;
    if(key!==lastHover){ hover.clear(); if(hit){ const link=selectMode==='link'?findAncestorLink(hit, robotModel):null; hover.showLink(link||hit); } lastHover=key; }
    const joint=hit?.userData?.__joint || null; renderer.domElement.style.cursor = (joint && isMovable(joint)) ? 'grab' : 'auto';
  }, { passive:true });

  renderer.domElement.addEventListener('click', (e)=>{
    const hit=pick(e); if(!hit){ setSelectedMeshes([]); return; }
    if(selectMode==='link'){ const link=findAncestorLink(hit, robotModel); setSelectedMeshes(link?collectMeshesIn(link):[hit]); }
    else setSelectedMeshes([hit]);
  });

  // Joint dragging (minimal; same as before)
  let dragState=null; const ROT_PER_PIXEL=0.01, PRISM_PER_PIXEL=0.003;
  function startDrag(joint, ev){
    dragState={ joint, value:getJointValue(joint), lastX:ev.clientX, lastY:ev.clientY }; controls.enabled=false; renderer.domElement.style.cursor='grabbing';
  }
  function updateDrag(ev){
    const ds=dragState; if(!ds) return; const fine = ev.shiftKey?0.35:1.0;
    const dX=(ev.clientX-(ds.lastX??ev.clientX)); const dY=(ev.clientY-(ds.lastY??ev.clientY));
    ds.lastX=ev.clientX; ds.lastY=ev.clientY;
    if(isPrismatic(ds.joint)) ds.value += -(dY*PRISM_PER_PIXEL)*fine;
    else ds.value += (dX*ROT_PER_PIXEL)*fine;
    setJointValue(robotModel, ds.joint, ds.value); refreshSelection();
  }
  function endDrag(){ dragState=null; controls.enabled=true; renderer.domElement.style.cursor='auto'; }
  renderer.domElement.addEventListener('pointerdown', ev=>{ const hit=pick(ev); const j=hit?.userData?.__joint; if(j && isMovable(j)) startDrag(j, ev); });
  renderer.domElement.addEventListener('pointermove', ev=>{ if(dragState) updateDrag(ev); });
  renderer.domElement.addEventListener('pointerup',   ev=>{ if(dragState) endDrag(); });

  // Isolation via 'i' using current selection
  let savedCam=null, savedTarget=null, isolating=false;
  function frameMeshesAnimated(meshes, pad=1.2, ms=700){
    if(!meshes?.length) return;
    const box=computeUnionBox(meshes); if(!box) return;
    const center=box.getCenter(new THREE.Vector3()); const size=box.getSize(new THREE.Vector3()); const maxDim=Math.max(size.x,size.y,size.z)||1;
    const fov=(camera.fov||60)*Math.PI/180; const dist=(maxDim*pad)/Math.tan(fov/2);
    const v=camera.position.clone().sub(controls.target.clone()); const dir=v.lengthSq()>1e-12?v.clone().normalize():new THREE.Vector3(1,0.7,1).normalize();
    const toPos=center.clone().add(dir.multiplyScalar(dist)); const toTarget=center.clone();
    // tween
    const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; const p0=camera.position.clone(), t0=controls.target.clone(); const tStart=performance.now(); controls.enabled=false;
    (function step(t){ const u=Math.min(1,(t-tStart)/ms), e=ease(u);
      camera.position.set(p0.x+(toPos.x-p0.x)*e, p0.y+(toPos.y-p0.y)*e, p0.z+(toPos.z-p0.z)*e);
      controls.target.set(t0.x+(toTarget.x-t0.x)*e, t0.y+(toTarget.y-t0.y)*e, t0.z+(toTarget.z-t0.z)*e);
      controls.update(); if(u<1) requestAnimationFrame(step); else controls.enabled=true;
    })(performance.now());
  }
  function bulkVisible(root, visible){ root?.traverse(o=>{ if(o.isMesh && o.geometry) o.visible=visible; }); }

  function isolateSelected(){
    if(isolating){ // restore
      bulkVisible(robotModel, true);
      if(savedCam && savedTarget){
        const p=savedCam, t=savedTarget; savedCam=null; savedTarget=null; isolating=false;
        // tween back
        const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; const p0=camera.position.clone(), t0=controls.target.clone(); const tStart=performance.now(); controls.enabled=false;
        (function step(ts){ const u=Math.min(1,(ts-tStart)/800), e=ease(u);
          camera.position.set(p0.x+(p.x-p0.x)*e, p0.y+(p.y-p0.y)*e, p0.z+(p.z-p0.z)*e);
          controls.target.set(t0.x+(t.x-t0.x)*e, t0.y+(t.y-t0.y)*e, t0.z+(t.z-t0.z)*e);
          controls.update(); if(u<1) requestAnimationFrame(step); else controls.enabled=true;
        })(performance.now());
      } else { controls.update(); }
      return;
    }
    if(!selectedMeshes.length) return;
    savedCam=camera.position.clone(); savedTarget=controls.target.clone();
    bulkVisible(robotModel, false);
    selectedMeshes.forEach(m=>m.visible=true);
    frameMeshesAnimated(selectedMeshes, 1.3, 800);
    isolating=true;
  }

  function handleKey(ev){
    const k=(ev.key||'').toLowerCase();
    if(k==='i'){ ev.preventDefault(); isolateSelected(); }
  }
  renderer.domElement.addEventListener('keydown', handleKey);
  (renderer.domElement.tabIndex===-1) && (renderer.domElement.tabIndex = 0);

  function destroy(){ try{ selectionBox.remove(); }catch(_){ } hover.clear(); }

  return { destroy, setSelectedMeshes, isolateSelected };
}
