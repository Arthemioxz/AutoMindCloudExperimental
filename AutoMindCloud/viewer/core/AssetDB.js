// AssetDB.js — utilidades para normalizar llaves y leer dataURLs desde meshDB

export function normalizeKey(k) {
  if (!k) return '';
  let s = String(k).replace(/\\/g, '/').trim();
  if (s.startsWith('package://')) s = s.slice('package://'.length);
  s = s.replace(/^\.?\//, '');
  return s.toLowerCase();
}

export function resolveMesh(pathLike, meshDB) {
  if (!pathLike || !meshDB) return null;
  const raw = normalizeKey(pathLike);
  const byTry = [
    raw,
    raw.replace(/^\.?\//, ''),
    raw.split('/').pop()
  ];
  for (const key of byTry) {
    if (key in meshDB) return meshDB[key];
  }
  return null;
}
