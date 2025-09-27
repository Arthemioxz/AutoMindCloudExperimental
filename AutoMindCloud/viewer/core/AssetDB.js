// /viewer/core/AssetDB.js
// Build a normalized in-memory asset DB and a URDFLoader-compatible loadMeshCb.
// Three r132 + urdf-loader 0.12.6
/* global THREE */

const ALLOWED_MESH_EXTS = new Set(['dae', 'stl', 'step', 'stp']);
const ALLOWED_TEX_EXTS  = new Set(['png', 'jpg', 'jpeg']);
const EXT_PRIORITY = { dae: 3, stl: 2, step: 1, stp: 1 };

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  stl: 'model/stl',                    // informative; we parse from bytes
  dae: 'model/vnd.collada+xml',
  step:'model/step',
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

  // también probamos sin el primer segmento (por si hay carpeta "meshes/")
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
  // atob → bytes
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
 * @param {Object.<string,string>} meshDB  — mapa key(base/path) → base64
 * @returns {{
 *   byKey: Object.<string,string>,
 *   byBase: Map<string, string[]>,
 *   has(key: string): boolean,
 *   get(key: string): string|undefined,
 *   keys(): string[]
 * }}
 */
export function buildAssetDB(meshDB = {}) {
  const byKey = {};
  const byBase = new Map();

  // 1) Normaliza y duplica entradas útiles (sin package://)
  Object.keys(meshDB).forEach((rawKey) => {
    const b64 = meshDB[rawKey];
    if (!b64) return;

    const k = normKey(rawKey);
    const kNoPkg = dropPackagePrefix(k);
    const base = basenameNoQuery(k);

    // Registra k
    if (!byKey[k]) byKey[k] = b64;

    // Registra variante sin package://
    if (kNoPkg !== k && !byKey[kNoPkg]) byKey[kNoPkg] = b64;

    // También permite lookup por basename (no exclusivo; puede haber duplicados)
    const arr = byBase.get(base) || [];
    arr.push(k);               // guardamos la key "completa" como referencia principal
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
      // último recurso: basename
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

/* ---------- internal: choose best asset among candidates ---------- */

function pickBestKey(tryKeys, assetDB) {
  // Agrupa por basename y elige por prioridad de extensión y tamaño aprox
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
  // Devuelve el mejor del primer grupo con contenido
  for (const [, arr] of groups) {
    arr.sort((a, b) => (b.prio - a.prio) || (b.bytes - a.bytes));
    if (arr[0]) return arr[0].key;
 
