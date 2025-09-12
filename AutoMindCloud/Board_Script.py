# Replace or merge this function into your existing AutoMindCloud/Board_Script.py
import json
from IPython.display import HTML, display
from google.colab import output
import re, base64, os
from binascii import b2a_base64
from typing import Optional

# ... keep your existing helper functions and globals (_SNAPSHOT_HANDLES, _REGISTERED_CALLBACKS, etc.)

def board(serial: str = "board", click_sound_path: Optional[str] = None):
    """
    Safe implementation that avoids f-string brace interpolation issues.
    If click_sound_path is provided it will embed the audio and play it on button clicks.
    """
    serial = _sanitize_serial(serial)
    cb_name = _ensure_callback_registered(serial)
    button_cb_name = _ensure_button_pressed_registered(serial)

    STORAGE_KEY  = f"amc_pizarra_snapshot_dataurl_{serial}"
    IMG_ID       = f"amc_persisted_snapshot_{serial}"
    CONTAINER_ID = f"amc_persisted_snapshot_container_{serial}"
    PNG_PATH     = f"/content/pizarra_cell_{serial}.png"

    initial_data_url = _extract_snapshot_from_ipynb(serial) or _file_to_dataurl(PNG_PATH)

    # Prepare audio data URL if a path is provided
    audio_data_url = ""
    audio_mime = "audio/mpeg"
    if click_sound_path:
        try:
            with open(click_sound_path, "rb") as f:
                raw = f.read()
            b64 = b2a_base64(raw, newline=False).decode("ascii")
            audio_data_url = f"data:{audio_mime};base64,{b64}"
        except Exception:
            audio_data_url = ""

    # Use json.dumps to produce properly quoted JS string literals
    js_initial_data = json.dumps(initial_data_url or "")
    js_audio_src = json.dumps(audio_data_url or "")
    js_storage_key = json.dumps(STORAGE_KEY)
    js_callback_name = json.dumps(cb_name)
    js_button_cb_name = json.dumps(button_cb_name)
    js_img_id = json.dumps(IMG_ID)
    # Note: element ids include serial which is safe (sanitized earlier)

    # JS template: every literal JS brace must be doubled for Python str.format() to keep it.
    js_template = r"""
<script>
(function(){{
  const STORAGE_KEY   = {js_storage_key};
  const CALLBACK_NAME = {js_callback_name};
  const BUTTON_CB_NAME = {js_button_cb_name};
  const IMG_ID        = {js_img_id};
  const INITIAL_DATA_URL = {js_initial_data};
  const AUDIO_SRC = {js_audio_src};
  const MAX_HISTORY = 40;

  const canvas = document.getElementById('board_{serial}');
  const ctx = canvas.getContext('2d');
  const colorEl = document.getElementById('color_{serial}');
  const sizeEl  = document.getElementById('size_{serial}');
  let drawing=false, last={{x:0,y:0}}, tool='pen', dpr=window.devicePixelRatio||1;

  const undoStack = [];
  const redoStack = [];

  function pushHistory(dataURL=null){{ 
    try {{ 
      const snap = dataURL || canvas.toDataURL('image/png');
      undoStack.push(snap);
      while (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack.length = 0;
    }} catch(_) {{}} 
  }}

  function drawFromDataURL(dataURL){{ 
    if(!dataURL) return;
    const im = new Image();
    im.onload = () => {{
      ctx.save();
      ctx.globalCompositeOperation='source-over';
      ctx.drawImage(im,0,0,im.naturalWidth,im.naturalHeight,0,0,canvas.width,canvas.height);
      ctx.restore();
    }};
    im.src = dataURL;
  }}

  function doUndo(){{ 
    if (undoStack.length === 0) return;
    const current = canvas.toDataURL('image/png');
    const prev = undoStack.pop();
    redoStack.push(current);
    drawFromDataURL(prev);
    schedulePersist();
  }}

  function doRedo(){{ 
    if (redoStack.length === 0) return;
    const current = canvas.toDataURL('image/png');
    const next = redoStack.pop();
    undoStack.push(current);
    drawFromDataURL(next);
    schedulePersist();
  }}

  function initCanvas(w,h){{ canvas.width=w; canvas.height=h; ctx.lineJoin="round"; ctx.lineCap="round"; ctx.fillStyle="#fff"; ctx.fillRect(0,0,w,h); }}
  function firstLayout(){{ const w=Math.max(1,canvas.clientWidth*dpr); const h=Math.max(1,canvas.clientHeight*dpr); initCanvas(w,h); }}
  function resize(){{ const w=Math.max(1,canvas.clientWidth*dpr); const h=Math.max(1,canvas.clientHeight*dpr); const tmp = document.createElement('canvas'); tmp.width = canvas.width; tmp.height = canvas.height; tmp.getContext('2d').drawImage(canvas,0,0); initCanvas(w,h); ctx.drawImage(tmp,0,0,w,h); }}
  setTimeout(firstLayout,0); window.addEventListener('resize', resize);

  function pos(e){{ const r=canvas.getBoundingClientRect(); return {{x:(e.clientX-r.left)*dpr, y:(e.clientY-r.top)*dpr}}; }}
  function line(a,b){{ ctx.save(); ctx.globalCompositeOperation=(tool==='eraser'?'destination-out':'source-over'); ctx.strokeStyle=(tool==='eraser'? 'rgba(0,0,0,1)':colorEl.value); ctx.lineWidth=sizeEl.value*dpr; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); ctx.restore(); }}

  canvas.addEventListener('pointerdown', e=>{{ drawing=true; pushHistory(); last=pos(e); line(last,last); }});
  canvas.addEventListener('pointermove', e=>{{ if(drawing){{ const p=pos(e); line(last,p); last=p; }} }});
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>canvas.addEventListener(ev,()=>{{ if(drawing){{ schedulePersist(); }} drawing=false; }}));

  document.getElementById('penBtn_{serial}').onclick=()=>tool='pen';
  document.getElementById('eraserBtn_{serial}').onclick=()=>tool='eraser';
  document.getElementById('clearBtn_{serial}').onclick=()=>{{ pushHistory(); ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); schedulePersist(); }};
  document.getElementById('undoBtn_{serial}').onclick=doUndo;
  document.getElementById('redoBtn_{serial}').onclick=doRedo;

  document.getElementById('downloadBtn_{serial}').onclick = () => {{
    try {{
      const dataURL = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataURL;
      const now = new Date();
      const pad = n => String(n).padStart(2,'0');
      const fname = "pizarra_{serial}_" +
                    now.getFullYear() + "-" + pad(now.getMonth()+1) + "-" + pad(now.getDate()) + "_" +
                    pad(now.getHours()) + "-" + pad(now.getMinutes()) + "-" + pad(now.getSeconds()) + ".png";
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }} catch(e) {{
      console.error(e);
      alert('No se pudo descargar la imagen.');
    }}
  }};

  window.addEventListener('keydown', (e)=>{{ const z=(e.key==='z'||e.key==='Z'); const cm=e.ctrlKey||e.metaKey; if(!cm||!z) return; e.preventDefault(); if(e.shiftKey) doRedo(); else doUndo(); }});

  let persistTimer=null;
  function schedulePersist(){{ clearTimeout(persistTimer); persistTimer=setTimeout(pushSnapshot, 500); }}
  async function pushSnapshot(){{ 
    try {{
      const dataURL = canvas.toDataURL('image/png');
      try {{ const snapEl = document.getElementById( {js_img_id} ); if (snapEl && dataURL) snapEl.src = dataURL; }} catch(_){{}}
      try {{ localStorage.setItem(STORAGE_KEY, dataURL); }} catch(_){{}}
      if (window.google?.colab?.kernel?.invokeFunction) {{
        await google.colab.kernel.invokeFunction(CALLBACK_NAME, [dataURL], {{}} );
      }}
    }} catch(e) {{ console.error(e); }}
  }}

  function loadPersisted(){{ 
    if (INITIAL_DATA_URL) {{ drawFromDataURL(INITIAL_DATA_URL); pushHistory(INITIAL_DATA_URL); return; }}
    let snap = document.getElementById( {js_img_id} );
    if (snap && snap.src && snap.src.startsWith('data:image/')) {{ drawFromDataURL(snap.src); pushHistory(snap.src); return; }}
    try {{ const ls = localStorage.getItem(STORAGE_KEY); if (ls && ls.startsWith('data:image/')) {{ drawFromDataURL(ls); pushHistory(ls); }} }} catch(_){{}}
  }}
  setTimeout(loadPersisted, 30);

  // AUDIO handling
  let clickAudio = null;
  if (AUDIO_SRC) {{
    try {{
      clickAudio = document.createElement('audio');
      clickAudio.id = 'amc_click_audio_{serial}';
      clickAudio.src = AUDIO_SRC;
      clickAudio.preload = 'auto';
      clickAudio.style.display = 'none';
      document.body.appendChild(clickAudio);
    }} catch(e) {{
      console.warn('failed to create click audio', e);
      clickAudio = null;
    }}
  }}

  function playClickSound() {{
    if (!clickAudio) return;
    try {{
      try {{ clickAudio.currentTime = 0; }} catch(_){}
      clickAudio.play().catch(_=>{{}});
    }} catch(e) {{
      console.warn('playClickSound failed', e);
    }}
  }}

  // Attach handlers to toolbar buttons: play sound and call kernel callback
  function invokePythonButtonPressed() {{
    try {{ playClickSound(); }} catch(_){}
    try {{
      if (window.google?.colab?.kernel?.invokeFunction) {{
        google.colab.kernel.invokeFunction(BUTTON_CB_NAME, [], {{}} );
        return;
      }}
    }} catch(e) {{ console.warn('colab invoke failed', e); }}
    try {{
      if (window.Jupyter && window.Jupyter.notebook && window.Jupyter.notebook.kernel) {{
        window.Jupyter.notebook.kernel.execute("print('button pressed')");
        return;
      }}
    }} catch(e) {{ console.warn('jupyter fallback failed', e); }}
    console.log("button pressed (no kernel available)");
  }}

  try {{
    const toolbar = document.querySelector('.toolbar');
    if (toolbar) {{
      const btns = toolbar.querySelectorAll('button');
      btns.forEach(b => {{
        b.addEventListener('click', () => {{
          invokePythonButtonPressed();
        }});
      }});
    }}
  }} catch(e) {{ console.warn('attach toolbar listeners failed', e); }}

}})();
</script>
"""

    # Format the template: note that the template uses doubled braces for JS literals;
    # we only substitute the python-generated JSON-strings and the serial placeholder.
    js_code = js_template.format(
        js_storage_key=js_storage_key,
        js_callback_name=js_callback_name,
        js_button_cb_name=js_button_cb_name,
        js_img_id=js_img_id,
        js_initial_data=js_initial_data,
        js_audio_src=js_audio_src,
        serial=serial
    )

    html = f"""<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /><title>Pizarra {serial}</title>
<style>
  :root{{ --muted:#e2e8f0; }} *{{ box-sizing:border-box; }}
  body{{ margin:0; font-family:ui-sans-serif,system-ui; background:#f8fafc; }}
  .toolbar{{ display:flex; gap:10px; flex-wrap:wrap; margin:12px; align-items:center; }}
  .toolbar button{{ padding:8px 12px; border:1px solid var(--muted); border-radius:8px; cursor:pointer; background:#fff; }}
  .toolbar input[type="color"], .toolbar input[type="range"]{{ height:36px; }}
  canvas{{ border:1px solid var(--muted); border-radius:12px; width:100%; height:460px; touch-action:none; cursor:crosshair; background:#fff; }}
  .serial{{ margin:8px 12px; font:12px/1.2 ui-sans-serif,system-ui; color:#64748b; }}
</style>
</head>
<body>
  <div class="serial">Board: <strong>{serial}</strong></div>

  <div class="toolbar">
    <button id="penBtn_{serial}">✏️ Lápiz</button>
    <button id="eraserBtn_{serial}">🧹 Borrador</button>
    <label>Color <input id="color_{serial}" type="color" value="#0f172a"></label>
    <label>Grosor <input id="size_{serial}" type="range" min="1" max="50" value="8"></label>
    <button id="undoBtn_{serial}">↩️ Undo</button>
    <button id="redoBtn_{serial}">↪️ Redo</button>
    <button id="clearBtn_{serial}">🗑️ Limpiar</button>
    <button id="downloadBtn_{serial}">⬇️ Descargar PNG</button>
  </div>

  <div id="{CONTAINER_ID}" style="display:none">
    <img id="{IMG_ID}" src="{initial_data_url or ''}" />
  </div>

  <canvas id="board_{serial}"></canvas>
  {js_code}
</body>
</html>
"""

    # update hidden snapshot block in the notebook
    snapshot_html = f"""
    <div id="{CONTAINER_ID}" aria-hidden="true"
         style="position:fixed; left:-9999px; top:-9999px; width:1px; height:1px; opacity:0; overflow:hidden; padding:0; margin:0; border:0; user-select:none; pointer-events:none;">
      <div style="font:0/0; height:0; overflow:hidden">Último dibujo (persistente)</div>
      <img id="{IMG_ID}" src="{initial_data_url or ''}" alt="persisted snapshot" style="width:1px; height:1px; border:0; display:block" />
    </div>
    """
    if serial not in _SNAPSHOT_HANDLES:
        _SNAPSHOT_HANDLES[serial] = display(HTML(snapshot_html), display_id=True)
    else:
        _SNAPSHOT_HANDLES[serial].update(HTML(snapshot_html))

    display(HTML(html))
