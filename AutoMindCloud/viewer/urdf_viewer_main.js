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
 *   descEndpoint?: string,
 *   autoDescribe?: boolean,
 *   enableThumbalist?: boolean,
 *   thumbSize?: number,
 * }
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

  // 1) Crear viewer base
  const viewer = createViewer(root, { theme: THEME });

  // 2) Normalizar core desde viewer
  const core = getViewerCore(viewer);
  if (!core) {
    console.error('[URDF] No se pudo inicializar core del viewer (scene/camera/renderer/controls/domElement).');
    return;
  }

  // 3) Cargar URDF / AssetDB
  const loadMeshCb = createLoadMeshCb({ basePath });
  const assetDB = await buildAssetDB({
    urdfUrl,
    basePath,
    loadMeshCb,
    viewer
  });

  // 4) Interacciones (Selection & Drag)
  let interactionAPI = {};
  try {
    interactionAPI = attachInteraction({
      scene: core.scene,
      camera: core.camera,
      renderer: core.renderer,
      controls: core.controls,
      domElement: core.domElement,
      assetDB,
      viewer
    });
  } catch (err) {
    console.error('[SelectionAndDrag] Error al adjuntar interacción:', err);
    interactionAPI = {};
  }

  // 5) Thumbnails (sistema antiguo thumbalist)
  let thumbMap = {};
  if (enableThumbalist) {
    try {
      thumbMap = await generateThumbalist({
        core,
        assetDB,
        size: thumbSize
      });
      console.info('[Thumbalist] Thumbnails generados:', Object.keys(thumbMap).length);
    } catch (err) {
      console.warn('[Thumbalist] Error generando thumbnails:', err);
      thumbMap = {};
    }
  }

  // 6) Descripciones automáticas
  let descMap = {};
  if (autoDescribe && descEndpoint) {
    try {
      const ids = getComponentIdList(assetDB);
      if (ids.length) {
        const raw = await requestDescriptions({
          endpoint: descEndpoint,
          ids
        });
        descMap = extractDescMap(raw, ids);
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

  // 7) Armar "app" que esperan ToolsDock y ComponentsPanel
  const app = {
    root,
    viewer,
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    controls: core.controls,
    domElement: core.domElement,
    assetDB,
    interactionAPI,
    thumbMap,
    descMap
  };

  // 8) UI: ToolsDock + ComponentsPanel usando la API clásica (app.*)
  let toolsDock = null;
  let componentsPanel = null;

  try {
    toolsDock = createToolsDock(app);
  } catch (err) {
    console.error('[ToolsDock] Error al inicializar:', err);
  }

  try {
    componentsPanel = createComponentsPanel(app);
  } catch (err) {
    console.error('[ComponentsPanel] Error al inicializar:', err);
  }

  // Completar app con refs a UI
  app.toolsDock = toolsDock;
  app.componentsPanel = componentsPanel;

  // Exponer global para depuración / legacy
  if (typeof window !== 'undefined') {
    window.__URDF_VIEWER__ = app;
  }

  return app;
}

/**
 * Alias para compatibilidad con bootloader existente:
 * muchos scripts llaman entry.render(...)
 */
export async function render(options) {
  return renderUrdfViewer(options);
}

/* =========================================================
 * Helpers core
 * =======================================================*/

function resolveContainer(container) {
  if (!container) return null;
  if (container instanceof HTMLElement) return container;
  if (typeof document !== 'undefined') {
    return document.getElementById(container) || document.querySelector(container);
  }
  return null;
}

/**
 * Extrae scene, camera, renderer, controls y domElement desde el viewer.
 * Se adapta a varias firmas típicas de ViewerCore.
 */
function getViewerCore(viewer) {
  if (!viewer) return null;

  const scene =
    viewer.scene ||
    (typeof viewer.getScene === 'function' && viewer.getScene());

  const camera =
    viewer.camera ||
    (typeof viewer.getCamera === 'function' && viewer.getCamera());

  const renderer =
    viewer.renderer ||
    (typeof viewer.getRenderer === 'function' && viewer.getRenderer());

  const controls =
    viewer.controls ||
    (typeof viewer.getControls === 'function' && viewer.getControls());

  const domElement =
    viewer.domElement ||
    viewer.canvas ||
    (renderer && renderer.domElement) ||
    (typeof viewer.getDomElement === 'function' && viewer.getDomElement());

  if (!scene || !camera || !renderer || !controls || !domElement) {
    console.error('[URDF] Viewer incompleto para core:', {
      hasScene: !!scene,
      hasCamera: !!camera,
      hasRenderer: !!renderer,
      hasControls: !!controls,
      hasDomElement: !!domElement
    });
    return null;
  }

  return { viewer, scene, camera, renderer, controls, domElement };
}

/**
 * Devuelve lista de IDs/nombres de componentes.
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

/* =========================================================
 * Descripciones
 * =======================================================*/

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
    headers: { 'Content-Type': 'application/json' },
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
 * Parser robusto de mapa de descripciones.
 */
function extractDescMap(raw, knownIds = []) {
  try {
    if (!raw) {
      console.warn('[Components] Respuesta vacía.');
      return {};
    }

    if (typeof raw === 'object') {
      if (!Array.isArray(raw)) return sanitizeDescObject(raw);
      console.warn('[Components] Se recibió un array, se esperaba objeto key -> desc.');
      return {};
    }

    if (typeof raw === 'string') {
      const trimmed = raw.trim();

      // 1) JSON directo
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          return sanitizeDescObject(JSON.parse(trimmed));
        } catch (e) {
          console.warn('[Components] JSON directo inválido:', e);
        }
      }

      // 2) JSON embebido
      const first = trimmed.indexOf('{');
      const last = trimmed.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        try {
          return sanitizeDescObject(JSON.parse(trimmed.slice(first, last + 1)));
        } catch (e) {
          console.warn('[Components] JSON embebido inválido:', e);
        }
      }

      // 3) Formato "pieza: desc"
      const mapFromLines = parseKeyValueLines(trimmed, knownIds);
      if (Object.keys(mapFromLines).length) {
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

function parseKeyValueLines(text, knownIds = []) {
  const lines = text.split(/\r?\n/);
  const map = {};
  const idSet = new Set(knownIds || []);

  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;

    const m = clean.match(/^([^:\-\–]+)\s*[:\-\–]\s*(.+)$/);
    if (!m) continue;

    let key = m[1].trim();
    const desc = m[2].trim();
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
 * Thumbalist
 * =======================================================*/

async function generateThumbalist({ core, assetDB, size = 256 }) {
  if (!core || !assetDB) {
    console.warn('[Thumbalist] Core o AssetDB no definidos.');
    return {};
  }

  const ids = getComponentIdList(assetDB);
  if (!ids.length) {
    console.warn('[Thumbalist] No hay componentes para thumbnails.');
    return {};
  }

  const { renderer, camera, scene, viewer } = core;
  if (!renderer || !camera || !scene || !renderer.domElement) {
    console.warn('[Thumbalist] Falta renderer/camera/scene/domElement para thumbnails.');
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
 * Exposición global legacy
 * =======================================================*/

if (typeof window !== 'undefined') {
  if (!window.renderUrdfViewer) window.renderUrdfViewer = renderUrdfViewer;
  if (!window.render) window.render = renderUrdfViewer;
}
