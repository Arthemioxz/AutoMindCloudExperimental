from IPython.display import HTML, display
from google.colab import output

# --- Python callback: recibe el PNG del canvas, reemplaza la salida de la celda y guarda el .ipynb (en silencio)
def save_canvas_to_cell(data_url_png: str):
    import base64, re
    from IPython.display import display, Image, clear_output

    # Extrae base64 del data URL
    m = re.match(r'^data:image/png;base64,(.*)$', data_url_png)
    b64 = m.group(1) if m else data_url_png

    # Guarda PNG a disco
    path = "/content/pizarra_cell.png"
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))

    # Reemplaza la salida de esta celda solo con la imagen (sin mensajes)
    clear_output(wait=True)
    display(Image(filename=path))

    # Intenta guardar el notebook de forma silenciosa
    try:
        from google.colab import _message
        _message.blocking_request('notebook.save', {})
    except Exception:
        # Si falla, muestra una advertencia mínima (no interrumpe el flujo)
        print("⚠️ No pude forzar el guardado automático del .ipynb. Usa Archivo → Guardar.")

def board():
    # Hacer el callback invocable desde JS
    output.register_callback("notebook.saveCanvasToCell", save_canvas_to_cell)

    # --- HTML/JS UI
    html = r"""
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Pizarra (Lápiz y Borrador)</title>
<style>
  :root{ --muted:#e2e8f0; --ink:#0f172a; }
  *{ box-sizing:border-box; }
  body{ margin:0; font-family:ui-sans-serif,system-ui; background:#f8fafc; }
  .toolbar{ display:flex; gap:10px; flex-wrap:wrap; margin:12px; }
  .toolbar button{ padding:8px 12px; border:1px solid var(--muted); border-radius:8px; cursor:pointer; background:#fff; }
  .toolbar input[type="color"], .toolbar input[type="range"]{ height:36px; }
  canvas{ border:1px solid var(--muted); border-radius:12px; width:100%; height:500px; touch-action:none; cursor:crosshair; background:#fff; }

  .badge{
    position: fixed; right: 14px; bottom: 12px; z-index: 9999;
    user-select: none; pointer-events: none; opacity: 0.95;
  }
  .badge img{ max-height: 44px; display:block; }

  .toast{
    position: fixed; left:50%; transform:translateX(-50%);
    bottom: 20px; background:#111827; color:#fff; padding:8px 12px;
    border-radius:8px; font-size:14px; opacity:0; transition:opacity .2s ease;
    z-index: 10000;
  }
  .toast.show{ opacity:0.95; }
</style>
</head>
<body>
  <div class="toolbar">
    <button id="penBtn">✏️ Lápiz</button>
    <button id="eraserBtn">🧹 Borrador</button>
    <input id="color" type="color" value="#0f172a" title="Color">
    <input id="size" type="range" min="1" max="50" value="8" title="Grosor">
    <button id="clearBtn">🗑️ Limpiar</button>
    <button id="savePngBtn">💾 PNG</button>
    <button id="saveToCellBtn">✅ Finalizar Dibujo</button>
  </div>

  <canvas id="board"></canvas>

  <div class="badge">
    <img src="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png" alt="badge">
  </div>

  <div id="toast" class="toast">Guardado en la celda y en /content/pizarra_cell.png</div>

<script>
(function(){
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const colorEl = document.getElementById('color');
  const sizeEl  = document.getElementById('size');
  const toastEl = document.getElementById('toast');

  let drawing=false, last={x:0,y:0}, tool='pen', dpr=window.devicePixelRatio||1;

  function showToast(msg){
    toastEl.textContent = msg || "Guardado.";
    toastEl.classList.add('show');
    setTimeout(()=>toastEl.classList.remove('show'), 1400);
  }

  function initCanvas(w, h){
    ctx.save();
    canvas.width  = w;
    canvas.height = h;
    ctx.fillStyle="#fff";
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.lineJoin="round"; ctx.lineCap="round";
    ctx.restore();
  }

  function resize(preserve=true){
    // Guarda contenido si vamos a preservar
    let tmp = null;
    if(preserve && canvas.width && canvas.height){
      tmp = document.createElement('canvas');
      tmp.width = canvas.width; tmp.height = canvas.height;
      tmp.getContext('2d').drawImage(canvas, 0, 0);
    }
    const w = Math.max(1, canvas.clientWidth * dpr);
    const h = Math.max(1, canvas.clientHeight * dpr);
    initCanvas(w, h);
    if (preserve && tmp) ctx.drawImage(tmp, 0, 0);
  }

  function clearCanvas(){
    // Limpia SIN restaurar contenido
    ctx.save();
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.restore();
  }

  function pos(e){
    const r=canvas.getBoundingClientRect();
    return {x:(e.clientX-r.left)*dpr, y:(e.clientY-r.top)*dpr};
  }

  function line(a,b){
    ctx.save();
    ctx.globalCompositeOperation = (tool==='eraser'?"destination-out":"source-over");
    ctx.strokeStyle = (tool==='eraser'?"rgba(0,0,0,1)":colorEl.value);
    ctx.lineWidth = sizeEl.value * dpr;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    ctx.restore();
  }

  window.addEventListener('resize', ()=>resize(true));
  // sizing inicial
  setTimeout(()=>resize(true), 0);

  canvas.addEventListener('pointerdown',e=>{
    canvas.setPointerCapture?.(e.pointerId);
    drawing=true; last=pos(e); line(last,last);
  });
  canvas.addEventListener('pointermove',e=>{
    if(drawing){ let p=pos(e); line(last,p); last=p; }
  });
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>{
    canvas.addEventListener(ev,()=>{ drawing=false; });
  });

  document.getElementById('penBtn').onclick = ()=>tool='pen';
  document.getElementById('eraserBtn').onclick = ()=>tool='eraser';

  // 🔧 AHORA SÍ: limpiar realmente borra
  document.getElementById('clearBtn').onclick = ()=>{ clearCanvas(); };

  document.getElementById('savePngBtn').onclick=()=>{
    const a=document.createElement('a');
    a.href=canvas.toDataURL('image/png'); a.download="pizarra.png"; a.click();
  };

  // ✅ Finalizar Dibujo: guarda en la salida de la celda y solicita guardado del notebook
  document.getElementById('saveToCellBtn').onclick=()=>{
    const dataURL = canvas.toDataURL('image/png');  // con fondo blanco
    try{
      google.colab.kernel.invokeFunction('notebook.saveCanvasToCell', [dataURL], {});
      showToast("Guardado en la celda y en /content/pizarra_cell.png");
    }catch(e){
      console.error(e);
      showToast("No se pudo invocar el guardado. Revisa la consola.");
    }
  };
})();
</script>
</body>
</html>
"""
    display(HTML(html))
