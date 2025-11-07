// /viewer/urdf_viewer_main.js
// Entrypoint que compone ViewerCore + AssetDB + Interacción + UI (Tools & Components)
// Mantiene el sistema antiguo de thumbnails ("thumbalist") y corrige el parser de descripciones.

import { THEME } from './Theme.js';
import { createViewer } from './core/ViewerCore.js';
import { buildAssetDB, createLoadMeshCb } from './core/AssetDB.js';
import { attachInteraction } from './interaction/SelectionAndDrag.js';
import { createToolsDock } from './ui/ToolsDock.js';
import { createComponentsPanel } from './ui/ComponentsPanel.js';

/**
 * Opciones esperadas:
 * {
 *   container: string | HTMLElement,
 *   urdfUrl: string,
 *   basePath?: string,
 *   descEndpoint?: string,          // Endpoint de tu API de descripciones (texto/JSON)
 *   autoDescribe?: boolean,         // true para pedir descripciones a la API
 *   enableThumbalist?: boolean,     // true para generar thumbnails por pieza
 *   thumbSize?: number,             // tamaño de thumbnail (ej: 256)
 * }
 */

/**
 * Punto de entrada público principal.
 */
export async function renderUrdfViewer(options) {
  const {
    container,
    urdfUrl,
    basePath = '',
    descEndpoint = '',
    autoDescribe = true,
    enableThumbalist = true,
    thumbSize = 256
  } = options || {};

  const root = resolveContainer(container);
  if (!root) {
    console.error('[URDF] Container no encontrado:', container);
    return;
  }

  // ============================
  // 1. Crear viewer base
  // ============================
  const viewer = createViewer(root, {
    theme: THEME,
  });

  // ============================
  // 2. Cargar URDF / AssetDB
  // ============================
  const loadMeshCb = createLoadMeshCb({ basePath });
  const assetDB = await buildAssetDB({
    urdfUrl,
    basePath,
    loadMeshCb,
    viewer
  });

  // ============================
  // 3. Interacciones (selección, drag, etc.)
  // ============================
  const interactionAPI = attachInteraction({
    viewer,
    assetDB
  });

  // ============================
  // 4. Sistema antiguo: THUMBALIST
  // ============================
  let thumbMap = {};
  if (enableThumbalist) {
    try {
      thumbMap = await generateThumbalist({
        viewer,
        assetDB,
        size: thumbSize
      });
      console.info('[Thumbalist] Thumbnails generados:', Object.keys(thumbMap).length);
    } catch (err) {
      console.warn('[Thumbalist] Error generando thumbnails:', err);
      thumbMap = {};
    }
  }

  // ============================
  // 5. Descripciones automáticas de componentes
  // ============================
  let descMap = {};
  if (autoDescribe && descEndpoint) {
    try {
      const parts = getComponentIdList(assetDB);
      if (parts.length) {
        const raw = await requestDescriptions({
          endpoint: descEndpoint,
          ids: parts
        });
        descMap = extractDescMap(raw, parts);
        if (Object.keys(descMap).length === 0) {
          console.warn('[Components] Respuesta sin descripciones utilizables.', raw);
        } else {
          console.info('[Components] Mapa de descripciones listo:', descMap);
        }
      } else {
        console.info('[Components] No hay partes para describir.');
      }
    } catch (err) {
      console.warn('[Components] Error obteniendo descripciones:', err);
      descMap = {};
    }
  }

  // ============================
  // 6. UI: ToolsDock + ComponentsPanel
  // ============================
  const toolsDock = createToolsDock({
    root,
    viewer,
    assetDB,
    interactionAPI,
    thumbMap
  });

  const componentsPanel = createComponentsPanel({
    root,
    viewer,
    assetDB,
    interactionAPI,
    descMap,
    thumbMap
  });

  // API pública
  const api = {
    root,
    viewer,
    assetDB,
    interactionAPI,
    toolsDock,
    componentsPanel,
    thumbMap,
    descMap
  };

  // Compat global
  if (typeof window !== 'undefined') {
    window.__URDF_VIEWER__ = api;
  }

  return api;
}

/**
 * Alias para compatibilidad con el bootloader existente:
 * muchos scripts esperan entry.render(...)
 */
export async function render(options) {
  return renderUrdfViewer(options);
}

/* =========================================================
 * Helpers
 * =======================================================*/

/**
 * Resuelve el contenedor a HTMLElement.
 */
function resolveContainer(container) {
  if (!container) return null;
  if (container instanceof HTMLElement) return container;
  if (typeof document !== 'undefined') {
    return document.getElementById(container) || document.querySelector(container);
  }
  return null;
}

/**
 * Devuelve lista de IDs/nombres de componentes a describir.
 */
function getComponentIdList(assetDB) {
  if (!assetDB) return [];
  if (Array.isArray(assetDB.parts)) {
    return assetDB.parts.map(p => p.id || p.name).filter(Boolean);
  }
  if (Array.isArray(assetDB.links)) {
    return assetDB.links.map(l => l.name || l.id).filter(Boolean);
  }
  if (assetDB.linkNames && Array.isArray(assetDB.linkNames)) {
    return assetDB.linkNames.slice();
  }
  if (assetDB.byName && typeof assetDB.byName === 'object') {
    return Object.keys(assetDB.byName);
  }
  return [];
}

/**
 * Llama al endpoint de descripciones.
 */
async function requestDescriptions({ endpoint, ids }) {
  const body = {
    text:
      'Genera un mapa JSON con descripciones breves de piezas. ' +
      'Clave = nombre exacto de la pieza, Valor = una frase clara en español. ' +
      'Responder SOLO con JSON válido, sin texto adicional.',
    ids
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`[Components] Endpoint ${endpoint} respondió ${res.status}`);
  }

  const text = await res.text();
  console.debug('[Components] Respuesta cruda descripciones:', text);
  return text;
}

/**
 * Parser robusto para el mapa de descripciones.
 */
function extractDescMap(raw, knownIds = []) {
  try {
    if (!raw) {
      console.warn('[Components] Respuesta vacía.');
      return {};
    }

    // Si ya es objeto
    if (typeof raw === 'object') {
      if (!Array.isArray(raw)) {
        return sanitizeDescObject(raw);
      }
      console.warn('[Components] Se recibió un array, se esperaba objeto key -> desc.');
      return {};
    }

    // Si es string
    if (typeof raw === 'string') {
      const trimmed = raw.trim();

      // Intento 1: JSON directo
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const obj = JSON.parse(trimmed);
          return sanitizeDescObject(obj);
        } catch (e) {
          console.warn('[Components] JSON directo inválido, probando extracción:', e);
        }
      }

      // Intento 2: JSON embebido
      const first = trimmed.indexOf('{');
      const last = trimmed.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        const candidate = trimmed.slice(first, last + 1);
        try {
          const obj = JSON.parse(candidate);
          return sanitizeDescObject(obj);
        } catch (e) {
          console.warn('[Components] JSON embebido inválido:', e);
        }
      }

      // Intento 3: formato "pieza: desc"
      const mapFromLines = parseKeyValueLines(trimmed, knownIds);
      if (Object.keys(mapFromLines).length > 0) {
        console.info('[Components] Usando parser tipo "pieza: desc".');
        return mapFromLines;
      }

      console.warn('[Components] No se pudo interpretar la respuesta como mapa de descripciones.');
      return {};
    }

    console.warn('[Components] Tipo de respuesta no soportado:', typeof raw);
    return {};
  } catch (err) {
    console.warn('[Components] Error en extractDescMap:', err);
    return {};
  }
}

/**
 * Asegura que sea { key: string }.
 */
function sanitizeDescObject(obj) {
  const out = {};
  Object.keys(obj || {}).forEach(k => {
    const v = obj[k];
    if (v == null) return;
    const s = String(v).trim();
    if (!s) return;
    out[String(k)] = s;
  });
  return out;
}

/**
 * Construye { key: desc } desde líneas tipo:
 *  "pieza_1: Esto es una base"
 *  "pieza_2 - Motor principal"
 */
function parseKeyValueLines(text, knownIds = []) {
  const lines = text.split(/\r?\n/);
  const map = {};
  const idSet = new Set(knownIds || []);

  for (let line of lines) {
    const clean = line.trim();
    if (!clean) continue;

    const m = clean.match(/^([^:\-\–]+)\s*[:\-\–]\s*(.+)$/);
    if (!m) continue;

    let key = m[1].trim();
    let desc = m[2].trim();
    if (!desc) continue;

    if (idSet.size) {
      const match = knownIds.find(id => id.toLowerCase() === key.toLowerCase());
      if (match) key = match;
    }

    map[key] = desc;
  }

  return map;
}

/* =========================================================
 * Sistema antiguo de thumbnails ("thumbalist")
 * =======================================================*/

/**
 * Genera thumbnails por componente.
 * Devuelve: { [id]: dataURL }
 */
async function generateThumbalist({ viewer, assetDB, size = 256 }) {
  if (!viewer || !assetDB) {
    console.warn('[Thumbalist] Viewer o AssetDB no definidos.');
    return {};
  }

  const ids = getComponentIdList(assetDB);
  if (!ids.length) {
    console.warn('[Thumbalist] No hay componentes para thumbnails.');
    return {};
  }

  const renderer = viewer.renderer || (viewer.getRenderer && viewer.getRenderer());
  const camera = viewer.camera || (viewer.getCamera && viewer.getCamera());
  const scene = viewer.scene || (viewer.getScene && viewer.getScene());

  if (!renderer || !camera || !scene) {
    console.warn('[Thumbalist] Falta renderer/camera/scene para generar thumbnails.');
    return {};
  }

  const originalSize = renderer.getSize
    ? renderer.getSize(new THREE.Vector2())
    : { x: size, y: size };

  const map = {};

  const isolate = (id) => {
    if (viewer.isolateComponent) return viewer.isolateComponent(id);
    if (viewer.isolateLink) return viewer.isolateLink(id);
    if (viewer.focusOnPart) return viewer.focusOnPart(id);
  };

  const restore = () => {
    if (viewer.clearIsolation) return viewer.clearIsolation();
    if (viewer.restoreAll) return viewer.restoreAll();
  };

  for (const id of ids) {
    try {
      isolate(id);

      if (viewer.fitToObject && typeof viewer.fitToObject === 'function') {
        viewer.fitToObject(id);
      } else if (viewer.fitToSelection && typeof viewer.fitToSelection === 'function') {
        viewer.fitToSelection();
      }

      if (renderer.setSize) {
        renderer.setSize(size, size, false);
      }

      renderer.render(scene, camera);
      const dataURL = renderer.domElement.toDataURL('image/png');
      map[id] = dataURL;
    } catch (err) {
      console.warn(`[Thumbalist] Error generando thumbnail para ${id}:`, err);
    } finally {
      restore();
    }
  }

  if (renderer.setSize && originalSize && originalSize.x && originalSize.y) {
    renderer.setSize(originalSize.x, originalSize.y, false);
  }

  return map;
}

/* =========================================================
 * Exposición global para compatibilidad legacy
 * =======================================================*/

if (typeof window !== 'undefined') {
  if (!window.renderUrdfViewer) {
    window.renderUrdfViewer = renderUrdfViewer;
  }
  if (!window.render) {
    window.render = renderUrdfViewer;
  }
}
