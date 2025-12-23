// /viewer/core/AssetDB.js
// Build a normalized in-memory asset DB and a URDFLoader-compatible loadMeshCb.
// Three r132 + urdf-loader 0.12.6
/* global THREE */

const ALLOWED_MESH_EXTS = new Set(['dae', 'stl', 'step', 'stp']);
const ALLOWED_TEX_EXTS = new Set(['png', 'jpg', 'jpeg']);
const EXT_PRIORITY = { dae: 3, stl: 2, step: 1, stp: 1 };

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  stl: 'model/stl', // informative; we parse from bytes
  dae: 'model/vnd.collada+xml',
  step: 'model/step',
  stp: 'model/step',
};

/* ---------- helpers ---------- */

function normKey(s) {
  return String(s || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim()
    .toLowerCase();
}

function dropPackagePrefix(k) {
  // package://pkg/meshes/x.dae  -> pkg/meshes/x.dae
  // también soporta Package://
  return String(k || '').toLowerCase().startsWith('package://')
    ? String(k).slice('package://'.length)
    : k;
}

function stripQueryHash(p) {
  return String(p || '').split('?')[0].split('#')[0];
}

function basenameNoQuery(p) {
  const q = stripQueryHash(p);
  return q.split('/').pop();
}

function extOf(p) {
  const q = stripQueryHash(p);
  const i = q.lastIndexOf('.');
  return i >= 0 ? q.slice(i + 1).toLowerCase() : '';
}

function approxBytesFromB64(b64) {
  return Math.floor((String(b64 || '').length * 3) / 4);
}

/**
 * Genera variantes de lookup MUY robustas:
 * - mantiene path completo
 * - sin package://
 * - basename
 * - "meshes/<basename>"
 * - desde el segmento "/meshes/..."
 * - subpaths quitando prefijos
 */
function variantsFor(path) {
  const out = new Set();

  const raw = String(path || '');
  if (!raw) return [];

  const rawNoQ = stripQueryHash(raw);
  const p0 = normKey(rawNoQ);
  const p = dropPackagePrefix(p0); // si era package://

  if (p0) out.add(p0);
  if (p) out.add(p);

  const base0 = basenameNoQuery(p0);
  const base = basenameNoQuery(p);
  if (base0) out.add(normKey(base0));
  if (base) out.add(normKey(base));

  // intentar "meshes/<base>"
  if (base) out.add(normKey('meshes/' + base));
  if (base0) out.add(normKey('meshes/' + base0));

  // si contiene "/meshes/", tomar desde ahí: "meshes/xxx"
  const idx = p.indexOf('/meshes/');
  if (idx >= 0) {
    const sub = p.slice(idx + 1); // "meshes/xxx"
    if (sub) out.add(normKey(sub));
    const subBase = basenameNoQuery(sub);
    if (subBase) out.add(normKey(subBase));
    out.add(normKey('meshes/' + subBase));
  }

  // también probar sin el primer segmento (por si meshDB guarda "meshes/x" o "x")
  const parts = p.split('/').filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    out.add(normKey(parts.slice(i).join('/')));
  }

  return Array.from(out).filter(Boolean);
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
 * @param {Object.<string,string>} meshDB  — mapa key(base/path) → base64
 * @returns {{
 *   byKey: Object.<string,string>,
 *   byBase: Map<string, string[]>,
 *   has(key: string): boolean,
 *   get(key: string): string|undefined,
 *   resolve(key: string): string|null,
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

    const k = normKey(stripQueryHash(rawKey));
    const kNoPkg = normKey(dropPackagePrefix(k));
    const base = normKey(basenameNoQuery(kNoPkg || k));

    if (!byKey[k]) byKey[k] = b64;
    if (kNoPkg && kNoPkg !== k && !byKey[kNoPkg]) byKey[kNoPkg] = b64;

    // lookup por basename (pueden haber duplicados)
    if (base) {
      const arr = byBase.get(base) || [];
      arr.push(k);
      if (kNoPkg && kNoPkg !== k) arr.push(kNoPkg);
      byBase.set(base, Array.from(new Set(arr)));
    }
  });

  function resolve(key) {
    const tries = variantsFor(key);
    for (const t of tries) {
      if (byKey[t]) return t;
    }
    const base = normKey(basenameNoQuery(key));
    const arr = byBase.get(base) || [];
    for (const k of arr) {
      if (byKey[k]) return k;
    }
    return null;
  }

  return {
    byKey,
    byBase,
    has(key) {
      return !!resolve(key);
    },
    get(key) {
      const k = resolve(key);
      return k ? byKey[k] : undefined;
    },
    resolve,
    keys() {
      return Object.keys(byKey);
    },
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
      bytes: approxBytesFromB64(b64),
    });
    groups.set(base, arr);
  }

  for (const [, arr] of groups) {
    arr.sort((a, b) => b.prio - a.prio || b.bytes - a.bytes);
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
 * @param {(meshOrGroup:THREE.Object3D, assetKey:string)=>void} [hooks.onMeshTag]
 * @returns {(path:string, manager:THREE.LoadingManager, onComplete:(obj:THREE.Object3D)=>void)=>void}
 */
export function createLoadMeshCb(assetDB, hooks = {}) {
  const daeCache = new Map();

  function tagAll(obj, key) {
    obj.userData = obj.userData || {};
    obj.userData.__assetKey = key;
    obj.traverse((o) => {
      if (o && o.isMesh && o.geometry) {
        o.userData = o.userData || {};
        o.userData.__assetKey = key;
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
      // 🔑 Resolver path -> key REAL en assetDB (base64)
      // Entra: package://pkg/meshes/base.dae
      // Sale: base.dae o meshes/base.dae (lo que exista en meshDB)
      const tries = variantsFor(path);

      // Si AssetDB tiene resolve() usamos eso también (más directo)
      const resolved = typeof assetDB.resolve === 'function' ? assetDB.resolve(path) : null;
      if (resolved) tries.unshift(resolved);

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

      // STEP/STP no soportado sin parser extra
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
            side: THREE.DoubleSide,
          }),
        );

        tagAll(mesh, bestKey);
        try {
          hooks.onMeshTag?.(mesh, bestKey);
        } catch (_) {}
        onComplete(mesh);
        return;
      }

      // DAE texto + subrecursos
      if (ext === 'dae') {
        // Cache por key para reusar escenas clonadas
        if (daeCache.has(bestKey)) {
          const obj = daeCache.get(bestKey).clone(true);
          tagAll(obj, bestKey);
          try {
            hooks.onMeshTag?.(obj, bestKey);
          } catch (_) {}
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

        // Manager que mapea URLs a data: desde assetDB (texturas, etc.)
        // ✅ FIX: resolver URLs de texturas con el MISMO sistema robusto (package://, basename, meshes/)
        const mgr = new THREE.LoadingManager();

        let itemStarted = false;
        let loaded = false;

        mgr.onStart = () => {
          itemStarted = true;
        };
        mgr.onLoad = () => {
          loaded = true;
        };

        mgr.setURLModifier((url) => {
          // url puede venir como "base.png", "textures/base.png", "package://.../textures/base.png"
          const texTries = variantsFor(url);
          // Si el archivo está en meshDB, devolver dataURL
          for (const k of texTries) {
            const kk = normKey(k);
            if (assetDB.byKey[kk]) {
              const e = extOf(kk);
              if (ALLOWED_TEX_EXTS.has(e)) return dataURLFor(e, assetDB.byKey[kk]);
              // si no es textura igual podría ser subasset, lo devolvemos igual:
              return dataURLFor(e, assetDB.byKey[kk]);
            }
          }
          // último recurso: basename directo
          const base = normKey(basenameNoQuery(url));
          const arr = assetDB.byBase?.get?.(base) || [];
          for (const kk of arr) {
            const e = extOf(kk);
            if (assetDB.byKey[kk] && ALLOWED_TEX_EXTS.has(e)) {
              return dataURLFor(e, assetDB.byKey[kk]);
            }
          }
          return url; // fallback: deja URL original
        });

        const loader = new THREE.ColladaLoader(mgr);
        const collada = loader.parse(daeText, '');
        const obj = collada && collada.scene ? collada.scene : new THREE.Object3D();
        if (scale !== 1.0) obj.scale.setScalar(scale);

        const finalize = () => {
          if (!daeCache.has(bestKey)) daeCache.set(bestKey, obj);
          const clone = obj.clone(true);
          tagAll(clone, bestKey);
          try {
            hooks.onMeshTag?.(clone, bestKey);
          } catch (_) {}
          onComplete(clone);
        };

        // Si no hubo ningún item start (no texturas), finalizamos ya.
        // Si hubo cargas, esperamos a que termine el manager.
        Promise.resolve().then(() => {
          if (!itemStarted) {
            finalize();
            return;
          }
          if (loaded) {
            finalize();
            return;
          }
          const prevOnLoad = mgr.onLoad;
          mgr.onLoad = () => {
            try {
              prevOnLoad?.();
            } catch (_) {}
            finalize();
          };
        });

        return;
      }

      onComplete(makeEmpty());
    } catch (_e) {
      try {
        onComplete(makeEmpty());
      } catch (_ee) {}
    }
  };
}

/* ---------- (opcional) export ALLOWED sets if UI wants them ---------- */
export const ALLOWED_EXTS = {
  mesh: ALLOWED_MESH_EXTS,
  tex: ALLOWED_TEX_EXTS,
};
