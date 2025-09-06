# ==== Board persistente en el propio .ipynb (sin Google Drive) ====
from IPython.display import HTML, display
from google.colab import output
import re, base64, os, json

_SNAPSHOT_HANDLES = {}          # serial -> DisplayHandle (bloque externo oculto con display_id)
_REGISTERED_CALLBACKS = set()   # callbacks registrados

def _sanitize_serial(s: str) -> str:
    s = (s or "board").strip()
    s = re.sub(r'[^A-Za-z0-9_]+', '_', s)
    return s or "board"

def _file_to_dataurl(path: str) -> str:
    if not os.path.exists(path):
        return ""
    try:
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        return "data:image/png;base64," + b64
    except Exception:
        return ""

def _extract_snapshot_from_ipynb(serial: str) -> str:
    """
    Busca en TODO el notebook el último <img> persistido y retorna su dataURL.
    (IDs posibles: base, ext, int; tomamos el Último que aparezca)
    """
    try:
        from google.colab import _message
        nbwrap = _message.blocking_request('get_ipynb', {}) or {}
        nb = nbwrap.get('ipynb', nbwrap) or {}

        ids = [
            f"amc_persisted_snapshot_ext_{serial}",
            f"amc_persisted_snapshot_{serial}",
            f"amc_persisted_snapshot_int_{serial}",
        ]
        pat = re.compile(
            r'id=["\'](' + '|'.join(map(re.escape, ids)) + r')["\'][^>]*?src=["\'](data:image/[^"\']+)["\']',
            re.IGNORECASE | re.DOTALL
        )

        last_src = ""
        for cell in nb.get('cells', []):
            for out in (cell.get('outputs', []) or []):
                data = out.get('data', {})
                html = None
                if 'text/html' in data:
                    v = data['text/html']
                    html = ''.join(v) if isinstance(v, list) else (v or '')
                elif 'text' in data:
                    v = data['text']
                    html = ''.join(v) if isinstance(v, list) else (v or '')
                if not html:
                    continue
                for m in pat.finditer(html):
                    src = m.group(2)
                    if src.startswith('data:image/'):
                        last_src = src
        return last_src
    except Exception:
        return ""

def _make_snapshot_callback(serial: str):
    """
    1) Guarda PNG en /content (rápido)
    2) Crea/actualiza bloque EXTERNO **OCULTO** persistente (queda en el .ipynb)
    3) Fuerza guardado del notebook
    """
    ext_container_id = f"amc_persisted_snapshot_ext_container_{serial}"
    ext_img_id       = f"amc_persisted_snapshot_ext_{serial}"
    png_path         = f"/content/pizarra_cell_{serial}.png"

    def _cb(data_url_png: str):
        # 1) /content
        m = re.match(r'^data:image/png;base64,(.*)$', data_url_png or '')
        if m:
            try:
                with open(png_path, "wb") as f:
                    f.write(base64.b64decode(m.group(1)))
            except Exception:
                pass
        # 2) EXTERNO oculto (persistente)
        html = f"""
        <div id="{ext_container_id}" style="display:none">
          <img id="{ext_img_id}" src="{data_url_png}" />
        </div>
        """
        handle = _SNAPSHOT_HANDLES.get(serial)
        if handle is None:
            _SNAPSHOT_HANDLES[serial] = display(HTML(html), display_id=True)
        else:
            handle.update(HTML(html))
        # 3) Guardar notebook
        try:
            from google.colab import _message
            _message.blocking_request('notebook.save', {})
        except Exception:
            pass
        return {"ok": True}
    return _cb

def _ensure_callback_registered(serial: str):
    name = f"persist.pushSnapshot.{serial}"
    if name not in _REGISTERED_CALLBACKS:
        output.register_callback(name, _make_snapshot_callback(serial))
        _REGISTERED_CALLBACKS.add(name)
    return name

def board(serial: str = "board"):
    serial = _sanitize_serial(serial)
    cb_name = _ensure_callback_registered(serial)

    # IDs y rutas
    STORAGE_KEY   = f"amc_pizarra_snapshot_dataurl_{serial}"
    INT_IMG_ID    = f"amc_persisted_snapshot_int_{serial}"      # oculto dentro del board
    INT_CONT_ID   = f"amc_persisted_snapshot_int_container_{serial}"
    EXT_IMG_ID    = f"amc_persisted_snapshot_ext_{serial}"      # oculto externo persistente
    EXT_CONT_ID   = f"amc_persisted_snapshot_ext_container_{serial}"
    BOARD_ID      = f"board_{serial}"
    PNG_PATH      = f"/content/pizarra_cell_{serial}.png"

    # Controles
    PEN_ID    = f"penBtn_{serial}"
    ERASER_ID = f"eraserBtn_{serial}"
    CLEAR_ID  = f"clearBtn_{serial}"
    UNDO_ID   = f"undoBtn_{serial}"
    REDO_ID   = f"redoBtn_{serial}"
    COLOR_ID  = f"color_{serial}"
    SIZE_ID   = f"size_{serial}"
    SAVE_BTN  = f"saveBtn_{serial}"
    DL_BTN    = f"downloadBtn_{serial}"
    STATUS_ID = f"status_{serial}"

    # Fuentes de rehidratación
    ipynb_data_url = _extract_snapshot_from_ipynb(serial) or ""
    png_data_url   = _file_to_dataurl(PNG_PATH) or ""

    # ----- JS plantilla (sin f-strings) -----
    js_tmpl = r"""
<script>
(function(){
  const STORAGE_KEY   = __STORAGE_KEY__;
  const CALLBACK_NAME = __CALLBACK_NAME__;
  const INT_IMG_ID    = __INT_IMG_ID__;
  const EXT_IMG_ID    = __EXT_IMG_ID__;
  const BOARD_ID      = __BOARD_ID__;
  const COLOR_ID      = __COLOR_ID__;
  const SIZE_ID       = __SIZE_ID__;
  const PEN_ID        = __PEN_ID__;
  const ERASER_ID     = __ERASER_ID__;
  const CLEAR_ID      = __CLEAR_ID__;
  const UNDO_ID       = __UNDO_ID__;
  const REDO_ID       = __REDO_ID__;
  const SAVE_BTN      = __SAVE_BTN__;
  const DL_BTN        = __DL_BTN__;
  const STATUS_ID     = __STATUS_ID__;

  const IPYNB_DATA_URL= __IPYNB_DATA_URL__;
  const PNG_DATA_URL  = __PNG_DATA_URL__;

  const MAX_HISTORY = 40;
  const canvas  = document.getElementById(BOARD_ID);
  const ctx     = canvas.getContext('2d');
  const colorEl = document.getElementById(COLOR_ID);
  const sizeEl  = document.getElementById(SIZE_ID);
  const statusEl= document.getElementById(STATUS_ID);
  let drawing=false, last={x:0,y:0}, tool='pen', dpr=window.devicePixelRatio||1;

  function setStatus(t){ if(statusEl) statusEl.textContent=t; }

  // ---- Layout primero ----
  function initCanvas(w,h){ canvas.width=w; canvas.height=h; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h); }
  (function firstLayout(){ const w=Math.max(1,canvas.clientWidth*dpr), h=Math.max(1,canvas.clientHeight*dpr); initCanvas(w,h); })();
  window.addEventListener('resize', ()=>{
    const w=Math.max(1,canvas.clientWidth*dpr), h=Math.max(1,canvas.clientHeight*dpr);
    const tmp=document.createElement('canvas'); tmp.width=canvas.width; tmp.height=canvas.height; tmp.getContext('2d').drawImage(canvas,0,0);
    initCanvas(w,h); ctx.drawImage(tmp,0,0,w,h);
  });

  // ---- Utils ----
  function drawFromDataURL(data){ if(!data) return; const im=new Image(); im.onload=()=>{ ctx.save(); ctx.globalCompositeOperation='source-over'; ctx.drawImage(im,0,0,im.naturalWidth,im.naturalHeight,0,0,canvas.width,canvas.height); ctx.restore(); }; im.src=data; }
  const undoStack=[], redoStack=[];
  function pushHistory(dataURL=null){ try{ const snap=dataURL||canvas.toDataURL('image/png'); undoStack.push(snap); while(undoStack.length>MAX_HISTORY) undoStack.shift(); redoStack.length=0; }catch(_ ){} }
  function pos(e){ const r=canvas.getBoundingClientRect(); return {x:(e.clientX-r.left)*dpr, y:(e.clientY-r.top)*dpr}; }
  function line(a,b){ ctx.save(); ctx.globalCompositeOperation=(tool==='eraser'?'destination-out':'source-over'); ctx.strokeStyle=(tool==='eraser'?'rgba(0,0,0,1)':colorEl.value); ctx.lineWidth=sizeEl.value*dpr; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); ctx.restore(); }

  // ---- Dibujo ----
  canvas.addEventListener('pointerdown', e=>{ drawing=true; pushHistory(); last=pos(e); line(last,last); });
  canvas.addEventListener('pointermove', e=>{ if(drawing){ const p=pos(e); line(last,p); last=p; } });
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>canvas.addEventListener(ev,()=>{ if(drawing){ schedulePersist(); } drawing=false; }));

  document.getElementById(PEN_ID).onclick=()=>tool='pen';
  document.getElementById(ERASER_ID).onclick=()=>tool='eraser';
  document.getElementById(CLEAR_ID).onclick=()=>{ pushHistory(); ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); schedulePersist(); };
  document.getElementById(UNDO_ID).onclick=()=>{ if(!undoStack.length) return; const cur=canvas.toDataURL('image/png'); const prev=undoStack.pop(); redoStack.push(cur); drawFromDataURL(prev); schedulePersist(); };
  document.getElementById(REDO_ID).onclick=()=>{ if(!redoStack.length) return; const cur=canvas.toDataURL('image/png'); const nxt=redoStack.pop(); undoStack.push(cur); drawFromDataURL(nxt); schedulePersist(); };

  // ---- Persistencia ----
  let persistTimer=null;
  function schedulePersist(){ clearTimeout(persistTimer); persistTimer=setTimeout(pushSnapshot, 450); }

  async function pushSnapshot(){
    try{
      const dataURL = canvas.toDataURL('image/png');

      // 1) Interno oculto (esta celda)
      try{ const intEl=document.getElementById(INT_IMG_ID); if(intEl) intEl.src=dataURL; }catch(_){}

      // 2) localStorage (no cruza PC)
      try{ localStorage.setItem(STORAGE_KEY, dataURL); }catch(_){}

      // 3) EXTERNO oculto persistente (requiere kernel) + autosave
      if (window.google?.colab?.kernel?.invokeFunction) {
        try{
          setStatus('Guardando en notebook...');
          await google.colab.kernel.invokeFunction(CALLBACK_NAME, [dataURL], {});
          setStatus('Guardado en notebook ✅');
        }catch(_){
          setStatus('No se pudo guardar en notebook');
        }
      } else {
        setStatus('Sin kernel: no se puede guardar en notebook');
      }
    }catch(e){ console.error(e); }
  }

  // Botón Guardar en Notebook
  document.getElementById(SAVE_BTN).addEventListener('click', ()=>{
    pushSnapshot();
  });

  // Botón Descargar PNG
  document.getElementById(DL_BTN).addEventListener('click', ()=>{
    try{
      const dataURL = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g,'-');
      a.href = dataURL; a.download = 'pizarra_' + ts + '.png';
      document.body.appendChild(a); a.click();
      setTimeout(()=>{ try{ document.body.removeChild(a); }catch(_ ){} }, 0);
    }catch(e){ console.error(e); alert('No se pudo descargar la imagen'); }
  });

  // ---- Rehidratación ----
  (function loadPersisted(){
    // 1) desde el propio .ipynb (EXTERNO oculto persistente)
    const extNodes = Array.from(document.querySelectorAll('#'+EXT_IMG_ID));
    const ext = extNodes.length ? extNodes[extNodes.length-1] : null;
    if (ext && ext.src && ext.src.startsWith('data:image/')) { drawFromDataURL(ext.src); pushHistory(ext.src); setStatus('Cargado desde notebook'); return; }

    // 2) desde /content (inyectado por Python)
    if (PNG_DATA_URL && PNG_DATA_URL.startsWith('data:image/')) { drawFromDataURL(PNG_DATA_URL); pushHistory(PNG_DATA_URL); setStatus('Cargado desde /content'); return; }

    // 3) interno de esta celda
    const intEl = document.getElementById(INT_IMG_ID);
    if (intEl && intEl.src && intEl.src.startsWith('data:image/')) { drawFromDataURL(intEl.src); pushHistory(intEl.src); setStatus('Cargado interno'); return; }

    // 4) localStorage
    try{
      const ls = localStorage.getItem(STORAGE_KEY);
      if (ls && ls.startsWith('data:image/')) { drawFromDataURL(ls); pushHistory(ls); setStatus('Cargado desde localStorage'); return; }
    }catch(_){}

    setStatus('Nuevo lienzo');
  })();

})();
</script>
"""

    # ----- HTML plantilla -----
    html_tmpl = r"""
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Pizarra __SERIAL__</title>
<style>
  :root{ --muted:#e2e8f0; }
  *{ box-sizing:border-box; }
  body{ margin:0; font-family:ui-sans-serif,system-ui; background:#f8fafc; }
  .toolbar{ display:flex; gap:10px; flex-wrap:wrap; margin:12px; align-items:center; }
  .toolbar button{ padding:8px 12px; border:1px solid var(--muted); border-radius:8px; cursor:pointer; background:#fff; }
  .toolbar input[type="color"], .toolbar input[type="range"]{ height:36px; }
  canvas{ border:1px solid var(--muted); border-radius:12px; width:100%; height:460px; touch-action:none; cursor:crosshair; background:#fff; }
  .serial{ margin:8px 12px; font:12px/1.2 ui-sans-serif,system-ui; color:#64748b; }
  .status{ margin-left:8px; font:12px/1.2 ui-sans-serif,system-ui; color:#475569; }
</style>
</head>
<body>
  <div class="serial">Board: <strong>__SERIAL__</strong> <span id="__STATUS_ID__" class="status">—</span></div>

  <div class="toolbar">
    <button id="__PEN_ID__">✏️ Lápiz</button>
    <button id="__ERASER_ID__">🧹 Borrador</button>
    <label>Color <input id="__COLOR_ID__" type="color" value="#0f172a"></label>
    <label>Grosor <input id="__SIZE_ID__" type="range" min="1" max="50" value="8"></label>
    <button id="__UNDO_ID__">↩️ Undo</button>
    <button id="__REDO_ID__">↪️ Redo</button>
    <button id="__CLEAR_ID__">🗑️ Limpiar</button>
    <button id="__SAVE_BTN__">💾 Guardar en Notebook</button>
    <button id="__DL_BTN__">⬇️ Descargar PNG</button>
  </div>

  <!-- Interno oculto para rehidratación local -->
  <div id="__INT_CONT_ID__" style="display:none">
    <img id="__INT_IMG_ID__" src="" />
  </div>

  <canvas id="__BOARD_ID__"></canvas>

  __JS_CODE__
</body>
</html>
"""

    # Construir JS con reemplazos seguros
    js_code = (js_tmpl
        .replace("__STORAGE_KEY__",   json.dumps(STORAGE_KEY))
        .replace("__CALLBACK_NAME__", json.dumps(cb_name))
        .replace("__INT_IMG_ID__",    json.dumps(INT_IMG_ID))
        .replace("__EXT_IMG_ID__",    json.dumps(EXT_IMG_ID))
        .replace("__BOARD_ID__",      json.dumps(BOARD_ID))
        .replace("__COLOR_ID__",      json.dumps(COLOR_ID))
        .replace("__SIZE_ID__",       json.dumps(SIZE_ID))
        .replace("__PEN_ID__",        json.dumps(PEN_ID))
        .replace("__ERASER_ID__",     json.dumps(ERASER_ID))
        .replace("__CLEAR_ID__",      json.dumps(CLEAR_ID))
        .replace("__UNDO_ID__",       json.dumps(UNDO_ID))
        .replace("__REDO_ID__",       json.dumps(REDO_ID))
        .replace("__SAVE_BTN__",      json.dumps(SAVE_BTN))
        .replace("__DL_BTN__",        json.dumps(DL_BTN))
        .replace("__STATUS_ID__",     json.dumps(STATUS_ID))
        .replace("__IPYNB_DATA_URL__",json.dumps(ipynb_data_url))
        .replace("__PNG_DATA_URL__",  json.dumps(png_data_url))
    )

    html = html_tmpl
    replacements = {
        "__SERIAL__": serial,
        "__STATUS_ID__": STATUS_ID,
        "__PEN_ID__": PEN_ID,
        "__ERASER_ID__": ERASER_ID,
        "__COLOR_ID__": COLOR_ID,
        "__SIZE_ID__": SIZE_ID,
        "__UNDO_ID__": UNDO_ID,
        "__REDO_ID__": REDO_ID,
        "__CLEAR_ID__": CLEAR_ID,
        "__SAVE_BTN__": SAVE_BTN,
        "__DL_BTN__": DL_BTN,
        "__INT_CONT_ID__": INT_CONT_ID,
        "__INT_IMG_ID__": INT_IMG_ID,
        "__BOARD_ID__": BOARD_ID,
        "__JS_CODE__": js_code,
    }
    for k, v in replacements.items():
        html = html.replace(k, v)

    # 1) Si YA existe un snapshot persistido en el .ipynb, aseguramos que el bloque externo oculto exista.
    #    Si no existe aún, lo creará el callback al primer guardado.
    if ipynb_data_url and serial not in _SNAPSHOT_HANDLES:
        ext_html = f"""
        <div id="{EXT_CONT_ID}" style="display:none">
          <img id="{EXT_IMG_ID}" src="{ipynb_data_url}" />
        </div>
        """
        _SNAPSHOT_HANDLES[serial] = display(HTML(ext_html), display_id=True)

    # 2) Render del board
    display(HTML(html))
