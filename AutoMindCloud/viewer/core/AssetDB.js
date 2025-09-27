// /viewer/core/AssetDB.js
/* global THREE */
const ALLOWED_MESH_EXTS = new Set(['dae','stl']);
const MIME = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', stl:'model/stl', dae:'model/vnd.collada+xml' };

const textDecoder = new TextDecoder();
const norm = s => String(s||'').replace(/\\/g,'/').replace(/^\.\//,'').toLowerCase();
const dropPkg = k => k.startsWith('package://') ? k.slice('package://'.length) : k;
const baseNoQ = p => String(p||'').split('?')[0].split('#')[0].split('/').pop();
const extOf   = p => { const q=String(p||'').split('?')[0].split('#')[0]; const i=q.lastIndexOf('.'); return i>=0?q.slice(i+1).toLowerCase():''; };
const approxBytes = b64 => Math.floor(String(b64||'').length*3/4);
const dataURLFor = (ext,b64) => `data:${MIME[ext]||'application/octet-stream'};base64,${b64}`;

function variantsFor(path){
  const out=new Set(); const p=norm(path); const pkg=dropPkg(p); const base=baseNoQ(p);
  out.add(p); out.add(pkg); out.add(base);
  const parts=pkg.split('/'); for(let i=1;i<parts.length;i++) out.add(parts.slice(i).join('/'));
  return Array.from(out);
}

function b64ToUint8(b64){ const bin=atob(String(b64||'')); const n=bin.length; const out=new Uint8Array(n); for(let i=0;i<n;i++) out[i]=bin.charCodeAt(i); return out; }
function b64ToText(b64){ return textDecoder.decode(b64ToUint8(b64)); }

export function buildAssetDB(meshDB={}){
  const byKey={}, byBase=new Map();
  Object.keys(meshDB).forEach(raw=>{
    const b64=meshDB[raw]; if(!b64) return;
    const k=norm(raw), k2=dropPkg(k), base=baseNoQ(k);
    if(!byKey[k]) byKey[k]=b64;
    if(k2!==k && !byKey[k2]) byKey[k2]=b64;
    const arr=byBase.get(base)||[]; arr.push(k); if(k2!==k) arr.push(k2); byBase.set(base, Array.from(new Set(arr)));
  });
  return {
    byKey, byBase,
    get(key){
      for(const k of variantsFor(key)) if(byKey[k]) return byKey[k];
      const arr=byBase.get(baseNoQ(key))||[]; for(const k of arr) if(byKey[k]) return byKey[k];
      return undefined;
    },
    keys(){ return Object.keys(byKey); }
  };
}

function pickBest(tryKeys, db){
  const groups=new Map();
  for(const kk of tryKeys){
    const k=norm(kk), b64=db.byKey?.[k]; if(!b64) continue;
    const ext=extOf(k); if(!ALLOWED_MESH_EXTS.has(ext)) continue;
    const base=baseNoQ(k);
    const arr=groups.get(base)||[]; arr.push({k, ext, prio:(ext==='dae'?2:1), bytes:approxBytes(b64)}); groups.set(base, arr);
  }
  for(const [,arr] of groups){ arr.sort((a,b)=>(b.prio-a.prio)||(b.bytes-a.bytes)); if(arr[0]) return arr[0].k; }
  return null;
}

export function createLoadMeshCb(assetDB, hooks={}){
  const daeCache=new Map();
  function tagAll(obj,key){
    obj.userData.__assetKey = key;
    obj.traverse(o=>{ if(o?.isMesh && o.geometry){ o.userData.__assetKey=key; o.castShadow=false; o.receiveShadow=false; } });
    hooks.onMeshTag?.(obj, key);
  }
  function empty(){ return new THREE.Mesh(); }

  return function loadMeshCb(path, _manager, onComplete){
    try{
      const tries=variantsFor(path);
      const key=pickBest(tries, { byKey: { ...assetDB.byKey }, byBase: assetDB.byBase });
      if(!key){ onComplete(empty()); return; }
      const ext=extOf(key); const b64=assetDB.byKey?.[key]; if(!b64){ onComplete(empty()); return; }

      if(ext==='stl'){
        const bytes=b64ToUint8(b64); const loader=new THREE.STLLoader(); const geom=loader.parse(bytes.buffer); geom.computeVertexNormals?.();
        const mesh=new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color:0x7fd4d4, roughness:0.85, metalness:0.12, side:THREE.DoubleSide }));
        tagAll(mesh, key); onComplete(mesh); return;
      }
      if(ext==='dae'){
        let text=daeCache.get(key); if(!text){ text=b64ToText(b64); daeCache.set(key,text); }
        const loader=new THREE.ColladaLoader();
        loader.loadAsync = undefined; // ensure legacy parse path
        const collada=loader.parse(text, './');
        const obj=collada.scene || collada; tagAll(obj, key); onComplete(obj); return;
      }
      onComplete(empty());
    }catch(e){ console.warn('[AssetDB.loadMeshCb]', e); try{ onComplete(empty()); }catch(_){ } }
  };
}
