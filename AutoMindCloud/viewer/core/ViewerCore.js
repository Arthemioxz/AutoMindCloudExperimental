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

function safeDecodeURIComponent(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

function stripQueryHash(s) {
  return String(s || "").replace(/[?#].*$/, "");
}

// For absolute URLs, keep only the pathname (so we can match local keys like "meshes/foo.png").
// For relative paths, returns the input unchanged.
function urlToPathname(s) {
  const str = String(s || "");
  if (/^(data:|blob:)/i.test(str)) return str;
  try {
    return new URL(str, window.location.href).pathname || str;
  } catch (e) {
    return str;
  }
}

function stripFileScheme(s) {
  let out = String(s || "");
  out = out.replace(/^file:(\/\/\/)?/i, "");     // file:///...
  out = out.replace(/^\/+[A-Za-z]:\//, "");      // /C:/...
  out = out.replace(/^[A-Za-z]:\//, "");         // C:/...
  return out;
}

// Normalize a path-like string:
// - removes query/hash
// - converts backslashes to slashes
// - collapses repeated slashes
// - resolves "." and ".."
// - removes leading "/" and leading "./"
// - optionally decodes %XX
function normalizePathLike(input, { decode = true } = {}) {
  let s = urlToPathname(input);
  if (/^(data:|blob:)/i.test(String(input || ""))) return String(input || "");
  s = stripFileScheme(stripQueryHash(s));
  if (decode) s = safeDecodeURIComponent(s);

  s = s.replace(/\\/g, "/");
  s = s.replace(/^\.\/+/, "");
  s = s.replace(/\/{2,}/g, "/");

  const isAbs = s.startsWith("/");
  const parts = s.split("/");

  const out = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!isAbs) out.push("..");
      continue;
    }
    out.push(part);
  }

  let norm = (isAbs ? "/" : "") + out.join("/");
  norm = norm.replace(/^\/+/, ""); // keep keys relative
  return norm;
}

function extOf(p) {
  const s = stripQueryHash(urlToPathname(p));
  const m = s.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : "";
}

function normKey(path) {
  return normalizePathLike(path, { decode: true }).toLowerCase();
}

function basenameNoQuery(path) {
  const s = normalizePathLike(path, { decode: true });
  const parts = s.split("/");
  return parts[parts.length - 1] || "";
}

function basenameNoQueryRaw(path) {
  const s = normalizePathLike(path, { decode: false });
  const parts = s.split("/");
  return parts[parts.length - 1] || "";
}

// "package://pkg/.../file.ext" -> ".../file.ext"
function dropPackagePrefix(k) {
  return k.replace(/^package:\/\//i, "").replace(/^[^/]+\//, "");
}

// Generate variants for a requested URL so we can find it in meshDB,
// even when exporters add prefixes, absolute paths, URL-encoding, etc.
function variantsFor(path) {
  const raw = String(path || "");
  if (/^(data:|blob:)/i.test(raw)) return [raw];

  const out = new Set();

  const add = (p) => {
    const k = normKey(p);
    if (k) out.add(k);
  };

  // decoded + normalized
  add(raw);

  // raw (no decode) variants (useful if the DAE contains percent-encoded names)
  const rawNorm = normalizePathLike(raw, { decode: false }).toLowerCase();
  if (rawNorm) out.add(rawNorm);

  // base names (decoded + raw)
  const bDec = basenameNoQuery(raw);
  if (bDec) out.add(normKey(bDec));
  const bRaw = basenameNoQueryRaw(raw);
  if (bRaw) out.add(normalizePathLike(bRaw, { decode: false }).toLowerCase());

  // drop "package://<pkg>/" if present
  add(dropPackagePrefix(raw));
  out.add(dropPackagePrefix(rawNorm));

  // also try stripping the first path segment (common when "meshes/" is omitted in keys)
  const strip1 = (p) => {
    const s = normalizePathLike(p, { decode: false });
    const i = s.indexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  };
  out.add(strip1(raw).toLowerCase());
  out.add(strip1(rawNorm).toLowerCase());

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
  }
  return null;
}

/* ---------- public: createLoadMeshCb ---------- */

/**
 * Crea un callback compatible con URDFLoader.loadMeshCb(path, manager, onComplete)
 * que renderiza STL/DAE desde base64 + resuelve subrecursos embebidos (texturas).
 *
 * @param {*} assetDB - resultado de buildAssetDB()
 * @param {Object} [hooks]
 * @param {(meshOrGroup:THREE.Object3D, assetKey:string)=>void} [hooks.onMeshTag] - se llama tras crear el objeto
 * @returns {(path:string, manager:THREE.LoadingManager, onComplete:(obj:THREE.Object3D)=>void)=>void}
 */
export function createLoadMeshCb(assetDB, hooks = {}) {
  const daeCache = new Map();

  function tagAll(obj, key) {
    obj.userData.__assetKey = key;
    obj.traverse((o) => {
      if (o && o.isMesh && o.geometry) {
        o.userData.__assetKey = key;
        // sombras quedan off por defecto (lo decide UI/Core)
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  function makeEmpty() {
    return new THREE.Mesh(); // placeholder neutral
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

      // STEP/STP no se soporta en Three sin parser extra — devolvemos placeholder
      if (ext === 'step' || ext === 'stp') {
        onComplete(makeEmpty());
        return;
      }

      // STL binario
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

      // DAE texto + subrecursos
      if (ext === 'dae') {
        // Cache por key para reusar escenas clonadas
        if (daeCache.has(bestKey)) {
          const obj = daeCache.get(bestKey).clone(true);
          tagAll(obj, bestKey);
          hooks.onMeshTag?.(obj, bestKey);
          onComplete(obj);
          return;
        }

        const daeText = b64ToText(b64);

        // Extrae unidad <unit meter="..."> para escalar correcto
        let scale = 1.0;
        const m = /<unit[^>]*meter\s*=\s*"([\d.eE+\-]+)"/i.exec(daeText);
        if (m) {
          const meter = parseFloat(m[1]);
          if (isFinite(meter) && meter > 0) scale = meter;
        }

        // Manager que mapea URLs a data: desde assetDB (texturas, otras DAEs, etc.)
        // IMPORTANTE: esperamos a que terminen de cargar las texturas antes de llamar onComplete,
        // para que las capturas/thumbnails salgan con texturas (no en blanco).
        const mgr = new THREE.LoadingManager();

        let started = false;
        let finished = false;

        mgr.onStart = () => { started = true; };
        mgr.onLoad = () => {
          if (finished) return;
          finished = true;
        };

        mgr.setURLModifier((url) => {
          const v = variantsFor(url);             // prueba varias formas
          const k = v.find((x) => assetDB.byKey[x]);
          if (k) {
            const e = extOf(k);
            const b = assetDB.byKey[k];
            return dataURLFor(e, b);
          }
          return url; // fallback: deja URL original (por si acaso)
        });

        const loader = new THREE.ColladaLoader(mgr);
        const collada = loader.parse(daeText, '');
        const obj = (collada && collada.scene) ? collada.scene : new THREE.Object3D();
        if (scale !== 1.0) obj.scale.setScalar(scale);

        const finalize = () => {
          // Cachea el original y devuelve un clon para no compartir refs
          if (!daeCache.has(bestKey)) daeCache.set(bestKey, obj);
          const clone = obj.clone(true);
          tagAll(clone, bestKey);
          hooks.onMeshTag?.(clone, bestKey);
          onComplete(clone);
        };

        // Si ColladaLoader inició cargas (texturas), esperamos a onLoad.
        // Si no inició nada, finalizamos de inmediato.
        // Nota: onLoad podría no dispararse si no hubo ningún itemStart.
        Promise.resolve().then(() => {
          if (!started) {
            finalize();
            return;
          }
          if (finished) {
            finalize();
            return;
          }
          // Esperar a que el manager termine
          const prevOnLoad = mgr.onLoad;
          mgr.onLoad = () => {
            try { prevOnLoad?.(); } catch (_) {}
            finalize();
          };
        });

        return;
      }

      // Ext desconocido (o no permitido): placeholder
      onComplete(makeEmpty());
    } catch (_e) {
      try { onComplete(makeEmpty()); } catch (_ee) {}
    }
  };
}

/* ---------- (opcional) export ALLOWED sets if UI wants them ---------- */
export const ALLOWED_EXTS = {
  mesh: ALLOWED_MESH_EXTS,
  tex: ALLOWED_TEX_EXTS
};
