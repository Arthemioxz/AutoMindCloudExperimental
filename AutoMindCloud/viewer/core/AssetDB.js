// /viewer/core/AssetDB.js
// Build a normalized in-memory asset DB + loadMeshCb + snapshots
/* global THREE */

const ALLOWED_MESH_EXTS = new Set(['dae', 'stl', 'step', 'stp']);
const ALLOWED_TEX_EXTS  = new Set(['png', 'jpg', 'jpeg']);
const EXT_PRIORITY = { dae: 3, stl: 2, step: 1, stp: 1 };

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  stl: 'model/stl',
  dae: 'model/vnd.collada+xml',
  step: 'model/step',
  stp: 'model/step'
};

/* ---------- helpers ---------- */

function normKey(s) {
  return String(s || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
}
function dropPackagePrefix(k) {
  return k.startsWith('package://') ? k.slice('package://'.length) : k;
}
function basenameNoQuery(p) {
  const q = String(p || '').split('?')[0].split('#')[0];
  return q.split('/').pop();
}
function extOf(p) {
  const q = String(p || '').split('?')[0].split('#')[0];
  const i = q.lastIndexOf('.');
  return i >= 0 ? q.slice(i + 1).toLowerCase() : '';
}
function approxBytesFromB64(b64) {
  return Math.floor(String(b64 || '').length * 3 / 4);
}
function variantsFor(path) {
  const out = new Set();
  const p = normKey(path);
  const pkg = dropPackagePrefix(p);
  const base = basenameNoQuery(p);

  out.add(p);
  out.add(pkg);
  out.add(base);

  const parts = pkg.split('/');
  for (let i = 1; i < parts.length; i++) {
    out.add(parts.slice(i).join('/'));
  }
  return Array.from(out);
}
function dataURLFor(ext, b64) {
  const mime = MIME[ext] || 'application/octet-stream';
  return `data:${mime};base64,${b64}`;
}

const textDecoder = new TextDecoder();
function b64ToUint8(b64) {
  const bin = atob(String(b64 || ''));
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64ToText(b64) {
  return textDecoder.decode(b64ToUint8(b64));
}

/* ---------- public: buildAssetDB ---------- */

/**
 * Normaliza claves y crea índices de búsqueda.
 * @param {Object.<string,string>} meshDB
 */
export function buildAssetDB(meshDB = {}) {
  const byKey = {};
  const byBase = new Map();

  Object.keys(meshDB).forEach((rawKey) => {
    const b64 = meshDB[rawKey];
    if (!b64) return;

    const k = normKey(rawKey);
    const kNoPkg = dropPackagePrefix(k);
    const base = basenameNoQuery(k);

    if (!byKey[k]) byKey[k] = b64;
    if (kNoPkg !== k && !byKey[kNoPkg]) byKey[kNoPkg] = b64;

    const arr = byBase.get(base) || [];
    arr.push(k);
    if (kNoPkg !== k) arr.push(kNoPkg);
    byBase.set(base, Array.from(new Set(arr)));
  });

  return {
    byKey,
    byBase,
    has(key) {
      const ks = variantsFor(key);
      return !!ks.find((k) => !!byKey[k]);
    },
    get(key) {
      const ks = variantsFor(key);
      for (const k of ks) {
        if (byKey[k]) return byKey[k];
      }
      const base = basenameNoQuery(key);
      const arr = byBase.get(base) || [];
      for (const k of arr) {
        if (byKey[k]) return byKey[k];
      }
      return undefined;
    },
    keys() { return Object.keys(byKey); }
  };
}

/* ---------- internal: best key ---------- */

function pickBestKey(tryKeys, assetDB) {
  const groups = new Map();
  for (const kk of tryKeys) {
    const k = normKey(kk);
    const b64 = assetDB.byKey[k];
    if (!b64) continue;
    const ext = extOf(k);
    if (!ALLOWED_MESH_EXTS.has(ext)) continue;
    const base = basenameNoQuery(k);
    const arr = groups.get(base) || [];
    arr.push({
      key: k,
      ext,
      prio: EXT_PRIORITY[ext] ?? 0,
      bytes: approxBytesFromB64(b64)
    });
    groups.set(base, arr);
  }
  for (const [, arr] of groups) {
    arr.sort((a, b) => (b.prio - a.prio) || (b.bytes - a.bytes));
    if (arr[0]) return arr[0].key;
  }
  return null;
}

/* ---------- public: createLoadMeshCb ---------- */

/**
 * URDFLoader.loadMeshCb compatible
 */
export function createLoadMeshCb(assetDB, hooks = {}) {
  const daeCache = new Map();

  function tagAll(obj, key) {
    obj.userData.__assetKey = key;
    obj.traverse((o) => {
      if (o && o.isMesh && o.geometry) {
        o.userData.__assetKey = key;
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  function makeEmpty() {
    return new THREE.Mesh();
  }

  return function loadMeshCb(path, _manager, onComplete) {
    try {
      const tries = variantsFor(path);
      const bestKey = pickBestKey(tries, assetDB);
      if (!bestKey) {
        onComplete(makeEmpty());
        return;
      }

      const ext = extOf(bestKey);
      const b64 = assetDB.byKey[bestKey];
      if (!b64) {
        onComplete(makeEmpty());
        return;
      }

      if (ext === 'step' || ext === 'stp') {
        onComplete(makeEmpty());
        return;
      }

      if (ext === 'stl') {
        const bytes = b64ToUint8(b64);
        const loader = new THREE.STLLoader();
        const geom = loader.parse(bytes.buffer);
        geom.computeVertexNormals?.();
        const mesh = new THREE.Mesh(
          geom,
          new THREE.MeshStandardMaterial({
            color: 0x7fd4d4,
            roughness: 0.85,
            metalness: 0.12,
            side: THREE.DoubleSide
          })
        );
        tagAll(mesh, bestKey);
        hooks.onMeshTag?.(mesh, bestKey);
        onComplete(mesh);
        return;
      }

      if (ext === 'dae') {
        if (daeCache.has(bestKey)) {
          const obj = daeCache.get(bestKey).clone(true);
          tagAll(obj, bestKey);
          hooks.onMeshTag?.(obj, bestKey);
          onComplete(obj);
          return;
        }

        const daeText = b64ToText(b64);

        let scale = 1.0;
        const m = /<unit[^>]*meter\s*=\s*"([\d.eE+\-]+)"/i.exec(daeText);
        if (m) {
          const meter = parseFloat(m[1]);
          if (isFinite(meter) && meter > 0) scale = meter;
        }

        const mgr = new THREE.LoadingManager();
        mgr.setURLModifier((url) => {
          const v = variantsFor(url);
          const k = v.find((x) => assetDB.byKey[x]);
          if (k) {
            const e = extOf(k);
            const b = assetDB.byKey[k];
            return dataURLFor(e, b);
          }
          return url;
        });

        const loader = new THREE.ColladaLoader(mgr);
        const collada = loader.parse(daeText, '');
        const obj = (collada && collada.scene) ? collada.scene : new THREE.Object3D();
        if (scale !== 1.0) obj.scale.setScalar(scale);

        daeCache.set(bestKey, obj);
        const clone = obj.clone(true);

        tagAll(clone, bestKey);
        hooks.onMeshTag?.(clone, bestKey);
        onComplete(clone);
        return;
      }

      onComplete(makeEmpty());
    } catch (_e) {
      try { onComplete(makeEmpty()); } catch (_ee) {}
    }
  };
}

/* ---------- optional ---------- */
export const ALLOWED_EXTS = {
  mesh: ALLOWED_MESH_EXTS,
  tex: ALLOWED_TEX_EXTS
};

/* ---------- NEW: snapshotAllAssets (thumbnails low-res) ---------- */

/**
 * Genera thumbnails por __assetKey.
 * - maxSize: tamaño máximo (ancho=alto) en px
 * - Devuelve [{ key, image_b64 }]
 */
export async function snapshotAllAssets(viewer, { maxSize = 224 } = {}) {
  if (!viewer || !viewer.renderer || !viewer.scene || !viewer.camera || !viewer.controls) {
    console.warn('[AssetDB] snapshotAllAssets: viewer incompleto.');
    return [];
  }
  const robot = viewer.robot;
  if (!robot) {
    console.warn('[AssetDB] snapshotAllAssets: robot no definido (aún).');
    return [];
  }

  const renderer = viewer.renderer;
  const camera = viewer.camera;
  const controls = viewer.controls;
  const scene = viewer.scene;

  const origSize = renderer.getSize(new THREE.Vector2());
  const origPixelRatio = renderer.getPixelRatio();
  const origTarget = renderer.getRenderTarget();
  const origCamPos = camera.position.clone();
  const origCamTarget = controls.target.clone();

  // Agrupa meshes por __assetKey
  const groups = new Map();
  robot.traverse((o) => {
    const k = o.userData && o.userData.__assetKey;
    if (k && o.isMesh && o.geometry) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
  });

  const entries = [];
  if (!groups.size) {
    console.warn('[AssetDB] snapshotAllAssets: no hay __assetKey en meshes.');
    return entries;
  }

  const rtSize = maxSize;
  const rt = new THREE.WebGLRenderTarget(rtSize, rtSize, { samples: 0 });

  const canvas = document.createElement('canvas');
  canvas.width = rtSize;
  canvas.height = rtSize;
  const ctx = canvas.getContext('2d');

  const pad = 1.35;
  const isoDir = new THREE.Vector3(1, 0.9, 1).normalize();
  const tmpBox = new THREE.Box3();
  const tmpCenter = new THREE.Vector3();
  const tmpSize = new THREE.Vector3();

  for (const [key, meshes] of groups.entries()) {
    tmpBox.makeEmpty();
    for (const m of meshes) tmpBox.expandByObject(m);
    if (tmpBox.isEmpty()) continue;

    tmpBox.getCenter(tmpCenter);
    tmpBox.getSize(tmpSize);
    const maxDim = Math.max(tmpSize.x, tmpSize.y, tmpSize.z) || 1;
    const dist = maxDim * pad;

    const pos = tmpCenter.clone().add(isoDir.clone().multiplyScalar(dist));
    camera.position.copy(pos);
    controls.target.copy(tmpCenter);
    camera.lookAt(tmpCenter);
    camera.updateProjectionMatrix();
    controls.update();

    renderer.setPixelRatio(1);
    renderer.setSize(rtSize, rtSize, false);
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);

    const buffer = new Uint8Array(rtSize * rtSize * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, rtSize, rtSize, buffer);

    const imgData = ctx.createImageData(rtSize, rtSize);
    for (let y = 0; y < rtSize; y++) {
      const srcRow = (rtSize - 1 - y) * rtSize * 4;
      const dstRow = y * rtSize * 4;
      imgData.data.set(buffer.subarray(srcRow, srcRow + rtSize * 4), dstRow);
    }
    ctx.putImageData(imgData, 0, 0);

    const b64 = canvas.toDataURL('image/png').split(',')[1] || '';
    entries.push({ key, image_b64: b64 });
  }

  // Restore
  renderer.setRenderTarget(origTarget);
  renderer.setPixelRatio(origPixelRatio);
  renderer.setSize(origSize.x, origSize.y, false);
  camera.position.copy(origCamPos);
  controls.target.copy(origCamTarget);
  camera.lookAt(origCamTarget);
  controls.update();
  rt.dispose();

  console.log(`[AssetDB] 📸 Thumbnails generados: ${entries.length} (maxSize=${maxSize})`);
  return entries;
}
