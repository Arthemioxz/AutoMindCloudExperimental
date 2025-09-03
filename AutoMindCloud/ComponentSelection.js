/* urdf_viewer.js - URDFViewer with bottom-right button; isolate-on-click */
(function (root) {
  'use strict';

  const URDFViewer = {};
  let state = null;

  // ---------- Helpers ----------
  console.log("Actualizado 1");
  
  function normKey(s){ return String(s||'').replace(/\\/g,'/').toLowerCase(); }
  function variantsFor(path){
    const out = new Set(), p = normKey(path);
    out.add(p); out.add(p.replace(/^package:\/\//,''));
    const bn = p.split('/').pop();
    out.add(bn); out.add(bn.split('?')[0].split('#')[0]);
    const parts = p.split('/'); for (let i=1;i<parts.length;i++) out.add(parts.slice(i).join('/'));
    return Array.from(out);
  }

  function applyDoubleSided(obj){
    obj?.traverse?.(n=>{
      if (n.isMesh && n.geometry){
        if (Array.isArray(n.material)) n.material.forEach(m=>m.side=THREE.DoubleSide);
        else if (n.material) n.material.side = THREE.DoubleSide;
        n.castShadow = n.receiveShadow = true;
        n.geometry.computeVertexNormals?.();
      }
    });
  }

  function rectifyUpForward(obj){
    if (!obj || obj.userData.__rectified) return;
    obj.rotateX(-Math.PI/2); // ROS Z-up -> Three Y-up
    obj.userData.__rectified = true;
    obj.updateMatrixWorld(true);
  }

  function fitAndCenter(camera, controls, object){
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x,size.y,size.z)||1;
    const dist   = maxDim * 1.8;
    camera.near = Math.max(maxDim/1000,0.001);
    camera.far  = Math.max(maxDim*1000,1000);
    camera.updateProjectionMatrix();
    camera.position.copy(center.clone().add(new THREE.Vector3(dist, dist*0.9, dist)));
    controls.target.copy(center); controls.update();
  }

  function findAncestorLink(o, linkSet){
    while (o){
      if (linkSet && linkSet.has(o)) return o;
      o = o.parent;
    }
    return null;
  }

  function markLinksAndJoints(robot){
    const linkSet = new Set(Object.values(robot.links||{}));
    return linkSet;
  }

  // ---------- Visibility helpers ----------
  function showOnlyLink(api, link, camera, controls, renderer, scene){
    api.robotModel.traverse(o=>{
      if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay){
        const inSelected = (link && (link === findAncestorLink(o, api.linkSet)));
        o.visible = !!inSelected;
      }
    });
    fitAndCenter(camera, controls, link || api.robotModel);
    renderer.render(scene, camera);
  }
  function showAllLinks(api, camera, controls, renderer, scene){
    api.robotModel.traverse(o=>{
      if (o.isMesh && o.geometry && !o.userData.__isHoverOverlay) o.visible = true;
    });
    fitAndCenter(camera, controls, api.robotModel);
    renderer.render(scene, camera);
  }

  // ---------- Public API ----------
  URDFViewer.render = function(opts){
    if (state) URDFViewer.destroy();
    const container = opts?.container || document.body;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    const bg = (opts && opts.background!==undefined) ? opts.background : 0xf0f0f0;
    const descriptions = (opts && opts.descriptions) || {};

    const scene = new THREE.Scene();
    if (bg!=null) scene.background = new THREE.Color(bg);

    const camera = new THREE.PerspectiveCamera(
      75,
      Math.max(1e-6, (container.clientWidth||1)/(container.clientHeight||1)),
      0.01,
      10000
    );
    camera.position.set(0,0,3);

    const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
    renderer.setPixelRatio(window.devicePixelRatio||1);
    renderer.setSize(container.clientWidth||1, container.clientHeight||1);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(2,2,2); scene.add(dirLight);

    const urdfLoader = new URDFLoader();
    const textDecoder = new TextDecoder();
    const b64ToUint8 = (b64)=>Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
    const b64ToText  = (b64)=>textDecoder.decode(b64ToUint8(b64));
    const MIME = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', stl:'model/stl', dae:'model/vnd.collada+xml' };
    const meshDB = (opts && opts.meshDB) || {};
    const daeCache = new Map();
    let pendingMeshes = 0, fitTimer=null;

    function scheduleFit(){
      if (fitTimer) clearTimeout(fitTimer);
      fitTimer = setTimeout(()=>{
        if (pendingMeshes===0 && api.robotModel){
          rectifyUpForward(api.robotModel);
          fitAndCenter(camera, controls, api.robotModel);
        }
      },80);
    }

    urdfLoader.loadMeshCb = (path, manager, onComplete)=>{
      const tries = variantsFor(path);
      let keyFound=null;
      for (const k of tries){ const kk=normKey(k); if (meshDB[kk]){ keyFound=kk; break; } }
      if (!keyFound){ onComplete(new THREE.Mesh()); return; }
      pendingMeshes++;
      const done=(mesh)=>{
        applyDoubleSided(mesh);
        onComplete(mesh);
        pendingMeshes--; scheduleFit();
      };
      const ext = keyFound.split('.').pop();
      try{
        if (ext==='stl'){
          const bytes=b64ToUint8(meshDB[keyFound]);
          const loader=new THREE.STLLoader();
          const geom=loader.parse(bytes.buffer);
          geom.computeVertexNormals();
          done(new THREE.Mesh(geom,new THREE.MeshStandardMaterial({color:0x8aa1ff,roughness:0.85,metalness:0.15,side:THREE.DoubleSide})));
          return;
        }
        if (ext==='dae'){
          if (daeCache.has(keyFound)){ done(daeCache.get(keyFound).clone(true)); return; }
          const daeText=b64ToText(meshDB[keyFound]);
          const loader=new THREE.ColladaLoader();
          const collada=loader.parse(daeText,'');
          const obj=collada.scene || new THREE.Object3D();
          daeCache.set(keyFound, obj);
          done(obj.clone(true));
          return;
        }
        done(new THREE.Mesh());
      }catch(_e){ done(new THREE.Mesh()); }
    };

    const api = { scene, camera, renderer, controls, robotModel:null, linkSet:null };

    function loadURDF(urdfText){
      if (api.robotModel){ scene.remove(api.robotModel); api.robotModel=null; }
      pendingMeshes=0;
      try{
        const robot = urdfLoader.parse(urdfText||'');
        if (robot?.isObject3D){
          api.robotModel=robot; scene.add(api.robotModel);
          rectifyUpForward(api.robotModel);
          api.linkSet = markLinksAndJoints(api.robotModel);
          setTimeout(()=>fitAndCenter(camera, controls, api.robotModel), 50);
        }
      } catch(_e){}
    }

    function animate(){
      state.raf = requestAnimationFrame(animate);
      controls.update(); renderer.render(scene, camera);
    }

    // ---------- UI ----------
    function createUI(){
      const root = document.createElement('div');
      Object.assign(root.style,{
        position:'absolute',left:0,top:0,width:'100%',height:'100%',
        pointerEvents:'none',zIndex:9999,fontFamily:'Inter,system-ui'
      });

      const btn = document.createElement('button');
      btn.textContent = 'Components';
      Object.assign(btn.style,{
        position:'absolute',
        right:'14px', bottom:'14px',
        padding:'10px 16px',
        borderRadius:'14px',
        background:'#fff',border:'1px solid #ccc',
        boxShadow:'0 4px 12px rgba(0,0,0,0.15)',
        fontWeight:'700',cursor:'pointer',
        pointerEvents:'auto', textAlign:'center'
      });

      const panel = document.createElement('div');
      Object.assign(panel.style,{
        position:'absolute',right:'14px',bottom:'64px',
        width:'320px',maxHeight:'65%',
        background:'#fff',border:'1px solid #ddd',
        borderRadius:'12px',boxShadow:'0 4px 12px rgba(0,0,0,0.15)',
        overflow:'hidden',display:'none',pointerEvents:'auto'
      });

      const header = document.createElement('div');
      header.textContent = 'Components';
      Object.assign(header.style,{padding:'10px 14px',fontWeight:'800',borderBottom:'1px solid #eee',background:'#fafafa'});

      const showAllBtn = document.createElement('button');
      showAllBtn.textContent = 'Show all';
      Object.assign(showAllBtn.style,{float:'right',padding:'4px 8px',fontSize:'12px',marginTop:'-2px'});
      showAllBtn.addEventListener('click',(e)=>{e.stopPropagation();showAllLinks(api,camera,controls,renderer,scene);});

      header.appendChild(showAllBtn);

      const list = document.createElement('div');
      Object.assign(list.style,{overflowY:'auto',maxHeight:'calc(65vh - 40px)',padding:'10px'});

      panel.appendChild(header);
      panel.appendChild(list);
      root.appendChild(panel);
      root.appendChild(btn);
      container.appendChild(root);

      btn.addEventListener('click', async ()=>{
        panel.style.display = (panel.style.display==='none')?'block':'none';
        if (panel.style.display==='block' && list.childElementCount===0){
          await buildGallery(list);
        }
      });
    }

    async function buildGallery(listEl){
      listEl.innerHTML = '';
      if (!api.robotModel || !api.linkSet || api.linkSet.size===0){
        listEl.textContent = 'No components.'; return;
      }

      async function snapshotLink(link){
        // Hide others temporarily
        const vis=[]; api.robotModel.traverse(o=>{if(o.isMesh&&o.geometry){vis.push([o,o.visible]);}});
        api.robotModel.traverse(o=>{if(o.isMesh&&o.geometry){o.visible=(link===findAncestorLink(o,api.linkSet));}});
        fitAndCenter(camera,controls,link);
        renderer.render(scene,camera);
        await new Promise(r=>setTimeout(r,0));
        const url=renderer.domElement.toDataURL('image/png');
        vis.forEach(([o,v])=>o.visible=v);
        return url;
      }

      for(const link of api.linkSet){
        const row=document.createElement('div');
        Object.assign(row.style,{display:'flex',alignItems:'center',gap:'10px',
          padding:'6px',marginBottom:'6px',border:'1px solid #eee',borderRadius:'8px',cursor:'pointer'});
        const img=document.createElement('img');
        Object.assign(img.style,{width:'80px',height:'60px',objectFit:'contain',background:'#fafafa',border:'1px solid #eee',borderRadius:'6px'});
        const meta=document.createElement('div');
        meta.innerHTML=`<div style="font-weight:700;font-size:14px">${link.name||'(unnamed link)'}</div>
                        <div style="color:#555;font-size:12px;margin-top:2px">${descriptions[link.name]||'Hello world'}</div>`;
        row.appendChild(img); row.appendChild(meta);
        listEl.appendChild(row);
        row.addEventListener('click',()=>{showOnlyLink(api,link,camera,controls,renderer,scene);});
        (async()=>{img.src=await snapshotLink(link);})();
      }
    }

    // ---------- Start ----------
    api.linkSet=null;
    if (opts && opts.urdfContent) loadURDF(opts.urdfContent);
    createUI();
    animate();

    state={scene,camera,renderer,controls,api};
    return {get robot(){return api.robotModel;},showAll:()=>showAllLinks(api,camera,controls,renderer,scene)};
  };

  URDFViewer.destroy=function(){try{cancelAnimationFrame(state?.raf);}catch{}; state=null;};

  root.URDFViewer=URDFViewer;

})(typeof window!=='undefined'?window:this);
