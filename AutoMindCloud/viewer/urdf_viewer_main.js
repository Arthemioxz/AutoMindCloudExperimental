// /viewer/urdf_viewer_main.js
import { THEME } from './Theme.js';
import { createViewer } from './core/ViewerCore.js';
import { buildAssetDB, createLoadMeshCb } from './core/AssetDB.js';
import { attachInteraction } from './interaction/SelectionAndDrag.js';
import { createToolsDock } from './ui/ToolsDock.js';
import { createComponentsPanel } from './ui/ComponentsPanel.js';

/**
 * Public entry: render the URDF viewer.
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {string} opts.urdfContent
 * @param {Object.<string,string>} opts.meshDB
 * @param {'link'|'mesh'} [opts.selectMode='link']
 * @param {number|null} [opts.background=THEME.colors.canvasBg]
 * @param {string|null} [opts.clickAudioDataURL]
 */
export function render(opts={}){
  const { container, urdfContent='', meshDB={}, selectMode='link', background=(THEME.colors?.canvasBg ?? 0xffffff), clickAudioDataURL=null } = opts;

  // Core viewer
  const core = createViewer({ container, background });

  // Assets + loadMeshCb
  const assetDB = buildAssetDB(meshDB);
  const assetToMeshes = new Map();
  const loadMeshCb = createLoadMeshCb(assetDB, {
    onMeshTag(obj, assetKey){
      const list = assetToMeshes.get(assetKey) || [];
      obj.traverse(o=>{ if(o?.isMesh && o.geometry) list.push(o); });
      assetToMeshes.set(assetKey, list);
    }
  });

  // Load URDF
  const robot = core.loadURDF(urdfContent, { loadMeshCb });

  // Interaction
  const inter = attachInteraction({
    scene: core.scene, camera: core.camera, renderer: core.renderer, controls: core.controls, robot, selectMode
  });

  // App facade for UI
  const app = {
    ...core, robot,
    assets: {
      list: () => {
        const items=[]; assetToMeshes.forEach((arr, key)=>{ if(!arr?.length) return;
          const clean=String(key||'').split('?')[0].split('#')[0]; const base=clean.split('/').pop(); const dot=base.lastIndexOf('.');
          items.push({ assetKey:key, base: dot>=0?base.slice(0,dot):base, ext: dot>=0?base.slice(dot+1).toLowerCase():'', count:arr.length });
        });
        items.sort((a,b)=>a.base.localeCompare(b.base, undefined, { numeric:true, sensitivity:'base' }));
        return items;
      },
      thumbnail: async (assetKey) => null // thumbnails omitted to keep exactly the same system (no extras)
    },
    isolate: {
      asset: (assetKey) => {
        const meshes = assetToMeshes.get(assetKey) || [];
        if (!meshes.length) return;
        // Hide all then show selected asset meshes & frame
        if (core.robot) core.robot.traverse(o=>{ if(o.isMesh && o.geometry) o.visible=false; });
        meshes.forEach(m=>m.visible=true);
        // Frame
        const box=new THREE.Box3(); const tmp=new THREE.Box3(); let has=false;
        meshes.forEach(m=>{ if(!m) return; tmp.setFromObject(m); if(!has){box.copy(tmp); has=true;} else box.union(tmp); });
        if(has){
          const center=box.getCenter(new THREE.Vector3()); const size=box.getSize(new THREE.Vector3()); const maxDim=Math.max(size.x,size.y,size.z)||1;
          const fov=(core.camera.fov||60)*Math.PI/180; const dist=maxDim/Math.tan(Math.max(1e-6,fov/2));
          const dir=new THREE.Vector3(1,0.7,1).normalize();
          core.camera.position.copy(center.clone().add(dir.multiplyScalar(dist))); core.controls.target.copy(center); core.controls.update();
        }
      },
      clear: () => { if (core.robot) core.robot.traverse(o=>{ if(o.isMesh && o.geometry) o.visible=true; }); core.fitAndCenter(core.robot, 1.06); }
    },
    showAll: () => { if (core.robot) core.robot.traverse(o=>{ if(o.isMesh && o.geometry) o.visible=true; }); core.fitAndCenter(core.robot, 1.06); }
  };

  // UI
  const tools = createToolsDock(app, THEME);
  const comps = createComponentsPanel(app);

  // Key 'h' toggles the Tools dock (exact behavior)
  function handleKey(e){ const k=(e.key||'').toLowerCase(); if(k==='h'){ e.preventDefault(); tools.set?.(document.querySelector('.amc-open-flag')?false:true); } }
  (container||document).addEventListener('keydown', handleKey, true);

  // Mark when open (used by the 'h' handler)
  const origSet = tools.set; tools.set = function(open){ try{ document.querySelector('.amc-open-flag')?.remove(); }catch(_){}
    if(open){ const flag=document.createElement('i'); flag.className='amc-open-flag'; flag.style.display='none'; document.body.appendChild(flag); }
    origSet.call(tools, open);
  };

  return { ...app, destroy: ()=>{ try{ comps.destroy(); }catch(_){ } try{ tools.destroy(); }catch(_){ } try{ inter.destroy?.(); }catch(_){ } try{ core.destroy(); }catch(_){ } }, openTools:(open=true)=>tools.set(!!open) };
}
