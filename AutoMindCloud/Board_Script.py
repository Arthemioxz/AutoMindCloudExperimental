from IPython.display import HTML, display
from google.colab import output

# --- Python callback: recibe el PNG del canvas, reemplaza la salida de la celda y guarda el .ipynb
def save_canvas_to_cell(data_url_png: str):
    import base64, re
    from IPython.display import display, Image, clear_output

    m = re.match(r'^data:image/png;base64,(.*)$', data_url_png)
    b64 = m.group(1) if m else data_url_png

    path = "/content/pizarra_cell.png"
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))

    clear_output(wait=True)
    display(Image(filename=path))

    try:
        from google.colab import _message
        _message.blocking_request('notebook.save', {})
    except Exception:
        print("⚠️ No pude forzar el guardado automático del .ipynb. Usa Archivo → Guardar.")

def board():
    output.register_callback("notebook.saveCanvasToCell", save_canvas_to_cell)

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
    <button id="undoBtn">↩️ Undo</button>
    <button id="redoBtn">↪️ Redo</button>
    <button id="clearBtn">🗑️ Limpiar</button>
    <button id="savePngBtn">💾 PNG</button>
    <button id="saveToCellBtn">✅ Finalizar Dibujo</button>
  </div>

  <canvas id="board"></canvas>
  <div id="toast" class="toast">Guardado en la celda y en /content/pizarra_cell.png</div>

<script>
(function(){
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const colorEl = document.getElementById('color');
  const sizeEl  = document.getElementById('size');
  const toastEl = document.getElementById('toast');

  let drawing=false, last={x:0,y:0}, tool='pen', dpr=window.devicePixelRatio||1;

  // Historial para undo/redo
  let undoStack=[], redoStack=[];
  function saveState(){
    undoStack.push(canvas.toDataURL());
    redoStack = [];
  }
  function restoreState(stackFrom, stackTo){
    if(stackFrom.length){
      stackTo.push(canvas.toDataURL());
      let state=stackFrom.pop();
      let img=new Image();
      img.src=state;
      img.onload=function(){
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0);
      };
    }
  }

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
    saveState(); // guardar estado inicial
  }

  function resize(preserve=true){
    let tmp=null;
    if(preserve && canvas.width && canvas.height){
      tmp=document.createElement('canvas');
      tmp.width=canvas.width; tmp.height=canvas.height;
      tmp.getContext('2d').drawImage(canvas,0,0);
    }
    const w=Math.max(1, canvas.clientWidth*dpr);
    const h=Math.max(1, canvas.clientHeight*dpr);
    initCanvas(w,h);
    if(preserve && tmp) ctx.drawImage(tmp,0,0);
  }

  function clearCanvas(){
    ctx.save();
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.restore();
    saveState();
  }

  function pos(e){
    const r=canvas.getBoundingClientRect();
    return {x:(e.clientX-r.left)*dpr, y:(e.clientY-r.top)*dpr};
  }

  function line(a,b){
    ctx.save();
    ctx.globalCompositeOperation = (tool==='eraser'?"destination-out":"source-over");
    ctx.strokeStyle = (tool==='eraser'?"rgba(0,0,0,1)":colorEl.value);
    ctx.lineWidth = sizeEl.value*dpr;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    ctx.restore();
  }

  window.addEventListener('resize', ()=>resize(true));
  setTimeout(()=>resize(true), 0);

  canvas.addEventListener('pointerdown',e=>{
    canvas.setPointerCapture?.(e.pointerId);
    drawing=true; last=pos(e); line(last,last);
  });
  canvas.addEventListener('pointermove',e=>{
    if(drawing){ let p=pos(e); line(last,p); last=p; }
  });
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>{
    canvas.addEventListener(ev,()=>{
      if(drawing){ saveState(); }
      drawing=false;
    });
  });

  document.getElementById('penBtn').onclick=()=>tool='pen';
  document.getElementById('eraserBtn').onclick=()=>tool='eraser';
  document.getElementById('clearBtn').onclick=()=>clearCanvas();
  document.getElementById('undoBtn').onclick=()=>restoreState(undoStack,redoStack);
  document.getElementById('redoBtn').onclick=()=>restoreState(redoStack,undoStack);

  document.getElementById('savePngBtn').onclick=()=>{
    const a=document.createElement('a');
    a.href=canvas.toDataURL('image/png'); a.download="pizarra.png"; a.click();
  };

  document.getElementById('saveToCellBtn').onclick=()=>{
    const dataURL=canvas.toDataURL('image/png');
    try{
      google.colab.kernel.invokeFunction('notebook.saveCanvasToCell',[dataURL],{});
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
