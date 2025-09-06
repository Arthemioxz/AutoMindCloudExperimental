from IPython.display import HTML, display
from google.colab import output
import IPython
import requests, urllib.parse, re

# -------- TEXTO --------
def polli_text(prompt: str) -> str:
    url = "https://text.pollinations.ai/" + urllib.parse.quote(prompt, safe="")
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.text  # respuesta en texto plano

def show_latex_paragraph(s: str):
    # 1) Quitar bloques ```latex ... ```
    s = re.sub(r"```(?:latex)?|```", "", s, flags=re.IGNORECASE).strip()
    # 2) Si todo viene envuelto en \text{ ... }, desenvolver
    if s.startswith(r"\text{") and s.endswith("}"):
        s = s[6:-1]
    # 3) Convertir saltos LaTeX "\\" a saltos de línea Markdown
    s = s.replace(r"\\ ", "  \n").replace(r"\\", "  \n")
    # 4) Mostrar como párrafo Markdown (MathJax renderiza \( ... \), \[ ... \], $$ ... $$)
    return IPython.display.Markdown(s)

# --- Python callback: recibe el PNG (y opcionalmente un JPEG comprimido),
#     reemplaza la salida de la celda, guarda el .ipynb,
#     y luego consulta Pollinations y muestra el párrafo LaTeX.
def save_canvas_to_cell(data_url_png: str, data_url_jpeg_preview: str = None):
    import base64
    from IPython.display import display, Image, clear_output

    # --- Guardar PNG a disco ---
    m = re.match(r'^data:image/(?:png|jpeg);base64,(.*)$', data_url_png)
    b64_png = m.group(1) if m else data_url_png
    png_path = "/content/pizarra_cell.png"
    with open(png_path, "wb") as f:
        f.write(base64.b64decode(b64_png))

    # Reemplaza la salida con la imagen PNG
    clear_output(wait=True)
    display(Image(filename=png_path))

    # --- Forzar guardado del notebook (best effort) ---
    try:
        from google.colab import _message
        _message.blocking_request('notebook.save', {})
    except Exception:
        print("⚠️ No pude forzar el guardado automático del .ipynb. Usa Archivo → Guardar.")

    # --- Preparar el "photo" para el prompt (intentando ser livianos) ---
    photo_for_prompt = data_url_jpeg_preview or data_url_png
    prompt = f"{photo_for_prompt} Was is drawed in this photo?: "

    try:
        txt = polli_text(prompt)
    except Exception as e:
        txt = f"\\text{{No pude contactar Pollinations: {e}}}"

    # Mostrar párrafo (Markdown compatible con LaTeX inline)
    display(show_latex_paragraph(txt))

def board():
    # Registrar callback para JS -> Python
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
  <div id="toast" class="toast">Guardado en la celda, analizando con Pollinations…</div>

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
    try { undoStack.push(canvas.toDataURL('image/png')); } catch(e){ undoStack.push(canvas.toDataURL()); }
    redoStack = [];
  }
  function restoreState(stackFrom, stackTo){
    if(stackFrom.length){
      try { stackTo.push(canvas.toDataURL('image/png')); } catch(e){ stackTo.push(canvas.toDataURL()); }
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
    const dataURL_PNG  = canvas.toDataURL('image/png');
    // Versión JPEG comprimida para el prompt (más liviana que PNG)
    let dataURL_JPEG;
    try {
      dataURL_JPEG = canvas.toDataURL('image/jpeg', 0.6);
    } catch(e) {
      dataURL_JPEG = null;
    }
    try{
      // Pasamos ambos data URLs (PNG para guardar/mostrar y JPEG para el prompt)
      google.colab.kernel.invokeFunction('notebook.saveCanvasToCell',[dataURL_PNG, dataURL_JPEG],{});
      showToast("Guardado en la celda y en /content/pizarra_cell.png. Analizando…");
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
