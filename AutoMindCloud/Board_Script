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
        # Si falla, muestra una advertencia mínima
        print("⚠️ No pude forzar el guardado automático del .ipynb. Usa Archivo → Guardar.")

def board():
    # Hacer el callback invocable desde JS
    output.register_callback("notebook.saveCanvasToCell", save_canvas_to_cell)

    # --- HTML/JS UI (con ícono en esquina inferior derecha y botón 'Finalizar Dibujo')
    html = r"""
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Pizarra (Lápiz y Borrador)</title>
<style>
  :root{ --muted:#e2e8f0; }
  *{ box-sizing:border-box; }
  body{ margin:0; font-family:ui-sans-serif,system-ui; background:#f8fafc; }
  .toolbar{ display:flex; gap:10px; flex-wrap:wrap; margin:12px; }
  .toolbar button{ padding:8px 12px; border:1px solid var(--muted); border-radius:8px; cursor:pointer; background:#fff; }
  .toolbar input[type="color"], .toolbar input[type="range"]{ height:36px; }
  canvas{ border:1px solid var(--muted); border-radius:12px; width:100%; height:500px; touch-action:none; cursor:crosshair; background:#fff; }

  /* Badge (icono) en esquina inferior derecha */
  .badge{
    position: fixed;
    right: 14px;
    bottom: 12px;
    z-index: 9999;
    user-select: none;
    pointer-events: none; /* no bloquea el dibujo */
    opacity: 0.95;
  }
  .badge img{ max-height: 44px; display:block; }
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

  <!-- Ícono en esquina inferior derecha -->
  <div class="badge">
    <img src="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png" alt="badge">
  </div>

<script>
(function(){
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  let drawing=false, last={x:0,y:0}, tool='pen', dpr=window.devicePixelRatio||1;

  function resize(){
    // Preserva contenido durante el resize
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width; tmp.height = canvas.height;
    tmp.getContext('2d').drawImage(canvas, 0, 0);

    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;

    // Fondo blanco
    ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.lineJoin="round"; ctx.lineCap="round";

    // Restaura contenido
    if (tmp.width && tmp.height){
      ctx.drawImage(tmp, 0, 0);
    }
  }
  function pos(e){
    const r=canvas.getBoundingClientRect();
    return {x:(e.clientX-r.left)*dpr, y:(e.clientY-r.top)*dpr};
  }
  function line(a,b){
    ctx.save();
    ctx.globalCompositeOperation = (tool==='eraser'?"destination-out":"source-over");
    ctx.strokeStyle = (tool==='eraser'?"rgba(0,0,0,1)":document.getElementById('color').value);
    ctx.lineWidth = document.getElementById('size').value * dpr;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    ctx.restore();
  }

  window.addEventListener('resize', resize);
  setTimeout(resize, 0); // sizing inicial

  canvas.addEventListener('pointerdown',e=>{drawing=true; last=pos(e); line(last,last);});
  canvas.addEventListener('pointermove',e=>{if(drawing){let p=pos(e); line(last,p); last=p;}});
  ['pointerup','pointerleave'].forEach(ev=>canvas.addEventListener(ev,()=>{drawing=false;}));

  document.getElementById('penBtn').onclick=()=>tool='pen';
  document.getElementById('eraserBtn').onclick=()=>tool='eraser';
  document.getElementById('clearBtn').onclick=()=>{ resize(); };

  document.getElementById('savePngBtn').onclick=()=>{
    const a=document.createElement('a');
    a.href=canvas.toDataURL('image/png'); a.download="pizarra.png"; a.click();
  };

  // Finalizar Dibujo: guarda como salida de la celda y solicita guardado del notebook (sin mensajes)
  document.getElementById('saveToCellBtn').onclick=()=>{
    const dataURL = canvas.toDataURL('image/png');  // con fondo blanco
    google.colab.kernel.invokeFunction('notebook.saveCanvasToCell', [dataURL], {});
  };
})();
</script>
</body>
</html>
"""
    display(HTML(html))
