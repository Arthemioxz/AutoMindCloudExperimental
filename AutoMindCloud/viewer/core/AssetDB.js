// AutoMindCloud/viewer/core/AssetDB.js
/* global THREE */

function normalizeKey(k) {
  return String(k)
    .replace(/^package:\/\//i, '')
    .replace(/^\.\//, '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .toLowerCase();
}

function guessMime(k) {
  k = k.toLowerCase();
  if (k.endsWith('.stl')) return 'model/stl';
  if (k.endsWith('.dae') || k.endsWith('.xml')) return 'model/vnd.collada+xml';
  if (k.endsWith('.png')) return 'image/png';
  if (k.endsWith('.jpg') || k.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

export function createAssetDB(meshDB = {}) {
  // Build lookups by relative path and by basename
  const byRel = Object.create(null);
  const byBase = Object.create(null);

  for (const rawKey of Object.keys(meshDB)) {
    const k = normalizeKey(rawKey);
    const b = k.split('/').pop();
    byRel[k] = meshDB[rawKey]; // keep original b64
    if (!(b in byBase)) byBase[b] = meshDB[rawKey];
  }

  function toDataURL(key) {
    const k = normalizeKey(key);
    const base = k.split('/').pop();
    const b64 = byRel[k] ?? byRel[base] ?? byBase[base];
    if (!b64) return null;
    const mime = guessMime(k);
    return `data:${mime};base64,${b64}`;
  }

  // Global URL interceptor for anything THREE loads (textures, DAE, etc.)
  try {
    const mgr = THREE.DefaultLoadingManager || THREE.LoadingManager?.prototype;
    if (mgr && typeof mgr.setURLModifier === 'function') {
      mgr.setURLModifier((url) => toDataURL(url) || url);
    }
  } catch (_e) { /* safe */ }

  // URDFLoader will call this to resolve mesh paths
  function loadMeshCb(url) {
    return toDataURL(url) || url;
  }

  return { loadMeshCb };
}

export default createAssetDB;
