// /viewer/ui/ToolsDock.js
/* global THREE */
export function createToolsDock(app, theme){
  if(!app||!app.camera||!app.controls||!app.renderer) throw new Error('[ToolsDock] Missing app.camera/controls/renderer');
  const ui={ root:document.createElement('div'), dock:document.createElement('div'), header:document.createElement('div'), title:document.createElement('div'), body:document.createElement('div'), toggleBtn:document.createElement('button') };

  // root overlay
  Object.assign(ui.root.style,{ position:'absolute', left:'0', top:'0', width:'100%', height:'100%', pointerEvents:'none', zIndex:'9999', fontFamily:'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial' });
  // dock (right)
  Object.assign(ui.dock.style,{ position:'absolute', right:'14px', top:'14px', width:'440px', background:'#fff', border:'1px solid #d7e7e7', borderRadius:'18px', boxShadow:'0 8px 24px rgba(0,0,0,0.12)', pointerEvents:'auto', overflow:'hidden', display:'none' });
  // header
  Object.assign(ui.header.style,{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 12px', borderBottom:'1px solid #d7e7e7', background:'rgba(20,184,185,0.12)' });
  ui.title.textContent='Viewer Tools'; Object.assign(ui.title.style,{ fontWeight:'800', color:'#0b3b3c' });
  Object.assign(ui.body.style,{ padding:'10px 12px' });

  // Floating toggle
  ui.toggleBtn.textContent='Open Tools';
  Object.assign(ui.toggleBtn.style,{ position:'absolute', right:'14px', top:'14px', padding:'8px 12px', borderRadius:'12px', border:'1px solid #d7e7e7', background:'#fff', color:'#0b3b3c', fontWeight:'700', boxShadow:'0 8px 24px rgba(0,0,0,0.12)', pointerEvents:'auto', zIndex:'10000' });

  ui.header.appendChild(ui.title); ui.dock.appendChild(ui.header); ui.dock.appendChild(ui.body); ui.root.appendChild(ui.dock); ui.root.appendChild(ui.toggleBtn);
  const host=(app?.renderer?.domElement?.parentElement)||document.body; host.appendChild(ui.root);

  // ---- Views with FIXED distance ----
  const mkBtn=(label)=>{ const b=document.createElement('button'); b.textContent=label; Object.assign(b.style,{ padding:'8px 12px', borderRadius:'10px', border:'1px solid #d7e7e7', background:'#fff', color:'#0b3b3c', fontWeight:'700', cursor:'pointer', pointerEvents:'auto', boxShadow:'0 4px 12px rgba(0,0,0,0.08)' }); return b; };
  const rowCam=document.createElement('div'); Object.assign(rowCam.style,{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'8px' });
  const bIso=mkBtn('Iso'), bTop=mkBtn('Top'), bFront=mkBtn('Front'), bRight=mkBtn('Right');
  rowCam.appendChild(bIso); rowCam.appendChild(bTop); rowCam.appendChild(bFront); rowCam.appendChild(bRight);
  ui.body.appendChild(rowCam);

  // Fixed distance calculator
  let FIXED_DISTANCE=null, INIT={ az: Math.PI*0.25, el: Math.PI*0.2, topEps: 1e-3 };
  function computeFixed(){ if(!app.robot) return null; const box=new THREE.Box3().setFromObject(app.robot); const size=box.getSize(new THREE.Vector3()); const maxDim=Math.max(size.x,size.y,size.z)||1; const fov=(app.camera.fov||60)*Math.PI/180; FIXED_DISTANCE=(maxDim*0.8)/Math.tan(fov/2); return FIXED_DISTANCE; }
  function dirFrom(az,el){ return new THREE.Vector3(Math.cos(el)*Math.cos(az), Math.sin(el), Math.cos(el)*Math.sin(az)).normalize(); }
  function ease(t){ return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; }
  function tween(cam,ctrl,toPos,toTarget,ms=700){ const p0=cam.position.clone(), t0=ctrl.target.clone(), tStart=performance.now(); ctrl.enabled=false; (function step(t){ const u=Math.min(1,(t-tStart)/ms), e=ease(u); cam.position.set(p0.x+(toPos.x-p0.x)*e, p0.y+(toPos.y-p0.y)*e, p0.z+(toPos.z-p0.z)*e); if(toTarget){ ctrl.target.set(t0.x+(toTarget.x-t0.x)*e, t0.y+(toTarget.y-t0.y)*e, t0.z+(toTarget.z-t0.z)*e); } ctrl.update(); app.renderer.render(app.scene,cam); if(u<1) requestAnimationFrame(step); else ctrl.enabled=true; })(performance.now()); }
  function go(kind){ const cam=app.camera, ctrl=app.controls; const box=new THREE.Box3().setFromObject(app.robot); const center=box.getCenter(new THREE.Vector3()); if(!FIXED_DISTANCE) computeFixed();
    let az=INIT.az, el=INIT.el; if(kind==='top'){ az=0; el=Math.PI/2-INIT.topEps; } if(kind==='front'){ az=Math.PI/2; el=0; } if(kind==='right'){ az=0; el=0; }
    const pos=center.clone().add(dirFrom(az,el).multiplyScalar(FIXED_DISTANCE)); tween(cam, ctrl, pos, center, 750);
  }
  bIso.addEventListener('click', ()=>go('iso')); bTop.addEventListener('click', ()=>go('top')); bFront.addEventListener('click', ()=>go('front')); bRight.addEventListener('click', ()=>go('right'));

  // Open/close
  function set(open){ ui.dock.style.display=open?'block':'none'; ui.toggleBtn.textContent=open?'Close Tools':'Open Tools'; if(open) computeFixed(); }
  ui.toggleBtn.addEventListener('click', ()=>set(ui.dock.style.display==='none'));

  // Public API
  function destroy(){ try{ ui.root.remove(); }catch(_){ } }
  return { set, destroy };
}

