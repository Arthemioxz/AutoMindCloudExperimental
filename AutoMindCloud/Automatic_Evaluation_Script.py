import sympy

from re import I

import IPython

#global DatosList,Documento,Orden,Color

#DatosList = []

#Documento = []

#Orden = 0

#global Color

#Color = "black"

#https://widdowquinn.github.io/coding/update-pypi-package/

#_print_Symbol

#from AutoMindCloud import *

#from AutoMindCloud.AutoMindCloud.render import *

  
from AutoMindCloud.Latemix2 import *

global DatosList,Orden,Color

DatosList = []

Orden = 0

global documento

documento = []
# -------- TEXTO --------
import requests, urllib.parse

def polli_text(prompt: str) -> str:
    url = "https://text.pollinations.ai/" + urllib.parse.quote(prompt, safe="")
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.text  # respuesta en texto plano

#print(polli_text("Explícame SymPy en bullets y un ejemplo al final."))

# -------- IMAGEN --------
def polli_image(prompt: str, outfile="imagen.jpg"):
    url = "https://pollinations.ai/p/" + urllib.parse.quote(prompt, safe="")
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    with open(outfile, "wb") as f:
        f.write(r.content)
    return outfile

# Ejemplo:
#fn = polli_image("futuristic humanoid robot in a lab, ultra detailed, cinematic lighting")
#print("Imagen guardada en:", fn)

Color = ""

def Inicializar(n,color):
  
  global DatosList,Orden,Color#Documento

  global documento

  documento = ""
  
  DatosList = []

  Orden = n

  Color = color

  return DatosList

def search(symbolo,DatosList):

  #display(DatosList)

  #global DatosList,Orden,Color#Documento
  #global DatosList
  
  for c_element in DatosList:
    if c_element[0] == symbolo:
      if isinstance(c_element[1],float):#Si tenemos un numero
          return "("+str(c_element[1])+")"
      elif isinstance(c_element[1],int):#Si tenemos un float
          return "("+str(c_element[1])+")"
      elif c_element[1] != None:#Si tenemos una expresión
          return "("+sympy.latex(c_element[1])+")"
      else:
        return sympy.latex(symbolo)#Si es None
  return sympy.latex(symbolo)


def Redondear(expr):#Redondeamos la expresión.
  if isinstance(expr, sympy.Expr) or isinstance(expr, sympy.Float):
    Aproximacion = expr.xreplace(sympy.core.rules.Transform(lambda x: x.round(Orden), lambda x: isinstance(x, sympy.Float)))
  elif isinstance(expr,float) or isinstance(expr,int):
    Aproximacion = round(expr,Orden)
  else:
    Aproximacion = expr
  return Aproximacion

def S(c_componente):#Guardar
  global DatosList,Orden,Color#Documento
  dentro = False
  for element in DatosList:

    #Si es un elemento None, entonces guardamos de forma especial:
    if element[1] == None:
      element[1] = element[0]

    if element[0] == c_componente[0]:
      element[1] = c_componente[1]
      dentro = True#Si el elemento ha sido guardado antes, entonces no lo volvemos a ingresar. Sino que sobre escribimos lo que dicho
      #componente significaba con el valor actual que se desea guardar.

      
  if dentro == False:
    
    DatosList.append(c_componente)#Si el elemento no estaba adentro, simplemente lo agregamos.

  #Renderizado Gris
  if c_componente[1] == None or dentro == False:
    D(c_componente)#Hacemos un print renderizado en color gris para indicar que el elemento ha sido definido/guardado
  else:
    D(c_componente)#Hacemos un print renderizado en color gris para indicar que el elemento ha sido definido/guardado

def D(elemento):#Por default se imprime en rojo, para indicar que es un derivado.
  #global DatosList,Orden,Color#Documento

  global documento
  
  print("")
  Tipo = None
  if isinstance(elemento,sympy.core.relational.Equality):#Si el elemento ingresado es una ecuación, entonces la identificamos
    Tipo = "Ecuacion"
  elif isinstance(elemento,list):#Si el elemento ingresado es un componente, entonces lo identificamos.
    Tipo = "Componente"
    c_componente = elemento
  
  if Tipo == "Ecuacion":#Si hemos identificado el elemento ingresado como una ecuación, entonces la imprimimos en rojo

    a = sympy.latex(elemento.args[0])

    b = "="

    c = sympy.latex(elemento.args[1])

    texto = a + b + c
    #texto = texto.replace("text", Estilo)

    documento += "$\\textcolor{"+Color+"}{"+texto+"}$"
    IPython.display.display(IPython.display.Latex("$\\textcolor{"+Color+"}{"+texto+"}$"))
    #Documento.append(texto)

  if Tipo == "Componente":#Si hemos identificado el elemento ingresado como un componente, entonces lo imprimimos en rojo


    #if not isinstance(c_componente[0],str):#isinstance(c_componente[0],sy.core.symbol.Symbol) or isinstance(c_componente[0],sy.core.symbol.Symbol) :
    a = sympy.latex(c_componente[0])

    b = " = "

    if c_componente[1] == c_componente[0]:#== None:<---------------------------------------------------------------------------------------------------------------------------
      c = "None"
    else:
      c = sympy.latex(Redondear(c_componente[1]))
    
    texto = a + b + c
      #texto = texto.replace("text", Estilo)

    documento += "$\\textcolor{"+Color+"}{"+texto+"}$"
    
    IPython.display.display(IPython.display.Latex("$\\textcolor{"+Color+"}{"+texto+"}$"))
    #Documento.append(texto)


def R(string):
  #global DatosList,Orden,Color#Documento

  global documento

  documento += "$\\textcolor{"+Color+"}{"+string+"}$"
  IPython.display.display(IPython.display.Latex("$\\textcolor{"+Color+"}{"+string+"}$"))
  
def E(expr):
  
  print("")

  global DatosList,Orden,Color#Documento
  
  #display(DatosList)
  #display(Orden)
  #display(Color)

  #IPython.display.display(IPython.display.Latex("$\\textcolor{"+Color+"}{"+"400"+"}$"))
  global documento
  
  if isinstance(expr,sympy.core.relational.Equality):#Si tenemos una igualdad
    izquierda = expr.args[0]
    derecha = expr.args[1]
    #texto = RenderLatex(izquierda) + " = " + RenderLatex(derecha)
    texto = RenderLatex([izquierda,DatosList]) + " = " + RenderLatex([derecha,DatosList])

    

    documento += "$\\textcolor{"+Color+"}{"+texto+"}$"
    
    return IPython.display.display(IPython.display.Latex("$\\textcolor{"+Color+"}{"+texto+"}$"))
  elif isinstance(expr,list):#Si tenemos un componente
    texto = sympy.latex(expr[0]) + " = " + RenderLatex([expr[1],DatosList])

    documento += "$\\textcolor{"+Color+"}{"+texto+"}$"
    return IPython.display.display(IPython.display.Latex("$\\textcolor{"+Color+"}{"+texto+"}$"))
  elif isinstance(expr,sympy.core.mul.Mul):
    texto = RenderLatex([expr,DatosList])#latemix(expr)

    documento += "$\\textcolor{"+Color+"}{"+texto+"}$"
    
    return IPython.display.display(IPython.display.Latex("$\\textcolor{"+Color+"}{"+texto+"}$"))

def DocumentoStr():
  global documento

  return documento

import re
from IPython.display import display, Markdown














import requests, base64, mimetypes, re, html, urllib.parse, json
from pathlib import Path
from IPython.display import display, HTML

# =========================================================
# 🔹 POLLI_TEXT: cliente robusto (devuelve SIEMPRE un string)
# =========================================================
def polli_text(prompt: str, url: str = "https://gpt-proxy-github-619255898589.us-central1.run.app/infer", timeout: int = 60) -> str:
    """
    Llama a tu API intermedia y devuelve SIEMPRE un string.
    Tolera varios formatos JSON: {"text": "..."} o {"output": "..."} o {"choices":[{"text":"..."}]}
    """
    r = requests.post(url, json={"text": prompt}, timeout=timeout)
    r.raise_for_status()
    try:
        data = r.json()
    except Exception:
        return r.text.strip()

    if isinstance(data, str):
        return data.strip()
    if isinstance(data, dict):
        if "text" in data and isinstance(data["text"], str):
            return data["text"].strip()
        if "output" in data and isinstance(data["output"], str):
            return data["output"].strip()
        if "choices" in data and isinstance(data["choices"], list) and data["choices"]:
            ch = data["choices"][0]
            if isinstance(ch, dict):
                for k in ("text", "message", "content"):
                    if k in ch and isinstance(ch[k], str):
                        return ch[k].strip()
        return json.dumps(data, ensure_ascii=False)
    return str(data).strip()


# =====================================
# 🔹 Utilidades de limpieza y parsing
# =====================================
_num_pat = re.compile(r'^\s*(\d+)[\.\)]\s+(.*)')

# Encabezados que hay que "barrer", p. ej. "(1) Resumen:", "(2) Pasos:", "Resumen:", "PASOS:", etc.
_heading_patterns = [
    r'^\s*\(?\s*1\s*\)?\s*\.?\s*Resumen\s*:?\s*$',     # (1) Resumen:
    r'^\s*Resumen\s*:?\s*$',                           # Resumen:
    r'^\s*RESUMEN\s*:?\s*$',                           # RESUMEN:
    r'^\s*\(?\s*2\s*\)?\s*\.?\s*Pasos\s*:?\s*$',       # (2) Pasos:
    r'^\s*Pasos\s*:?\s*$',                             # Pasos:
    r'^\s*PASOS\s*:?\s*$',                             # PASOS:
]

_heading_regexes = [re.compile(pat, flags=re.IGNORECASE) for pat in _heading_patterns]

def _looks_like_heading(line: str) -> bool:
    line_clean = re.sub(r'[*_`~]+', '', line).strip()  # quita negritas/markdown simples
    # también elimina etiquetas HTML simples <b>Resumen:</b>
    line_clean = re.sub(r'<[^>]+>', '', line_clean).strip()
    return any(rx.match(line_clean) for rx in _heading_regexes)

def _escape_keep_math(s: str) -> str:
    """Escapa HTML pero conserva $...$, \( ... \), \[ ... \] intactos."""
    parts = re.split(r'(\$\$.*?\$\$|\$.*?\$|\\\[.*?\\\]|\\\(.*?\\\))', s, flags=re.S)
    out = []
    for p in parts:
        if p.startswith('$') or p.startswith('\\(') or p.startswith('\\['):
            out.append(p)
        else:
            out.append(html.escape(p))
    return ''.join(out)

def _strip_boilerplate(s: str) -> str:
    """Quita frases de arranque típicas de asistentes y encabezados molestos."""
    s = s.lstrip()
    patrones = [
        r"^(claro|por supuesto|aquí tienes|a continuación|según el texto|de acuerdo con el enunciado).*?\n+",
        r"^(este (documento|resumen|texto)[^.\n]*\.)\s+",
    ]
    for pat in patrones:
        s = re.sub(pat, "", s, flags=re.IGNORECASE | re.MULTILINE)

    # Quita encabezados únicos tipo "(1) Resumen:" y "(2) Pasos:" en líneas separadas
    lines = [l.rstrip() for l in s.splitlines()]
    lines = [l for l in lines if not _looks_like_heading(l)]
    return '\n'.join(lines).strip()

def _split_summary_and_steps(text: str):
    """
    Divide la salida del modelo en:
    - summary: primer bloque (no numérico) limpio
    - steps: lista de elementos numerados (1., 2., 3., ...)
    Mantiene el resumen 'puro' sin contaminarlo con ítems.
    """
    text = _strip_boilerplate(text)

    # Cortamos por líneas útiles y normalizamos espacios
    lines = [re.sub(r'\s+', ' ', l).strip() for l in text.splitlines() if l.strip()]

    # Elimina IN-LINE encabezados "Resumen:" / "Pasos:" si vienen pegados al contenido
    lines = [re.sub(r'^\s*\(?\s*1\s*\)?\s*\.?\s*Resumen\s*:?\s*', '', l, flags=re.IGNORECASE) for l in lines]
    lines = [re.sub(r'^\s*\(?\s*2\s*\)?\s*\.?\s*Pasos\s*:?\s*',   '', l, flags=re.IGNORECASE) for l in lines]

    # Buscar el primer ítem numerado; todo lo anterior es RESUMEN
    first_idx = None
    for i, line in enumerate(lines):
        if _num_pat.match(line):
            first_idx = i
            break

    if first_idx is None:
        # Si el modelo no enumeró, todo es resumen
        return ' '.join(lines).strip(), []

    summary_text = ' '.join(lines[:first_idx]).strip()

    # Parseo de pasos estrictamente numerados
    steps, current = [], None
    for line in lines[first_idx:]:
        m = _num_pat.match(line)
        if m:
            if current is not None:
                steps.append(current.strip())
            current = m.group(2)
        else:
            if current is None:
                continue  # texto suelto, lo ignoramos para no romper el resumen
            current += ' ' + line
    if current is not None:
        steps.append(current.strip())

    # Limpieza final de bullets/guiones que algunos modelos anteponen
    steps = [re.sub(r'^\s*[-–•]\s*', '', s).strip() for s in steps]

    return summary_text, steps


# =====================================
# 🔹 Render con fuentes + MathJax
# =====================================
def _render_html(summary: str, steps: list, font_type: str):
    css = f"""
<link href="https://fonts.googleapis.com/css2?family=Anton:wght@400;700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;600&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
<link href="https://fonts.cdnfonts.com/css/latin-modern-roman" rel="stylesheet">

<style>
  .calc-wrap {{
    max-width: 980px; margin: 8px auto; padding: 8px 4px;
    font-family: '{font_type}', 'Fira Sans', system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    color: #000;
  }}
  .title {{
    font-family: 'Anton', sans-serif; color: teal; font-size: 22px;
    font-weight: 700; margin: 8px 0 10px;
  }}
  .p {{ font-size: 18px; line-height: 1.6; margin: 8px 0; }}
  .step {{ margin: 10px 0; }}
  .idx {{ margin-right: 8px; font-weight: 700; }}
</style>

<script>
  window.MathJax = {{
    tex: {{
      inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
      displayMath: [['$$','$$'], ['\\\\[','\\\\]']]
    }},
    options: {{ skipHtmlTags: ['script','noscript','style','textarea','pre','code'] }}
  }};
</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js" async></script>
"""
    body = f"""
<div class="calc-wrap">
  <div class="title">Resumen</div>
  <p class="p">{_escape_keep_math(summary)}</p>
  {"<div class='title'>Pasos</div>" if steps else ""}
  {''.join(
      f'<p class="p step"><span class="idx">{i}.</span>{_escape_keep_math(s)}</p>'
      for i, s in enumerate(steps, 1)
    )}
</div>
"""
    return css + body


# =====================================
# 🔹 Función principal: CalculusSummary
# =====================================
def CalculusSummary(numero: int, documento: str, font_type: str = "Latin Modern Roman"):
    """
    Genera (1) Resumen y (2) Pasos sin que el (2) contamine el (1).
    - 'numero' regula el nivel de detalle.
    - 'documento' es el texto fuente a resumir (string).
    - 'font_type' (opcional) cambia la fuente del cuerpo.
    """
    base = (
        "Escribe en español, tono académico, formal e impersonal (tercera persona). "
        "Empieza directamente con el contenido. "
        "Estructura la salida en dos partes: "
        "(1) un párrafo de resumen; "
        "(2) luego una enumeración con pasos numerados 1., 2., 3., etc. "
        "IMPORTANTE: Toda notación matemática DEBE ir delimitada correctamente: "
        "usa \\( ... \\) para fórmulas en línea y \\[ ... \\] para ecuaciones en bloque. "
        "Nunca escribas comandos LaTeX fuera de esos delimitadores. "
        "Asegura que \\left y \\right siempre aparezcan en parejas completas. "
        "No utilices negritas con **. "
    )

    if numero == 1:
        detalle = " Redacta un resumen conciso (máximo 5-7 líneas) y 7 pasos generales sin fórmulas."
    elif numero == 2:
        detalle = " Redacta un resumen preciso (máximo 7-9 líneas) y 10 pasos con detalles clave."
    elif numero == 3:
        detalle = " Redacta un resumen muy preciso (9-12 líneas) y 18 pasos; usa notación LaTeX cuando proceda."
    else:
        detalle = " Redacta un resumen breve y una lista de pasos razonable."

    prompt = f"{base}{detalle}\n\nContenido a resumir:\n\n{documento}"

    # Llamada a la API (robusta en formato de retorno)
    raw = polli_text(prompt)

    # Limpieza + segmentación SIN mezclar (para no arruinar el resumen)
    raw = _strip_boilerplate(raw)
    summary, steps = _split_summary_and_steps(raw)

    # Render
    html_out = _render_html(summary, steps, font_type)
    display(HTML(html_out))


# ======================================================================
# 🔹 Ejemplo de uso (descomenta y edita 'contenido' para probar en Colab)
# ======================================================================
# contenido = \"\"\"Se presentan las características físicas y mecánicas de un fluido en dos estaciones,
# junto con parámetros hidráulicos para una red de tuberías con líneas de impulsión y aspiración...
# La conservación de masa..., Bernoulli extendida..., Reynolds en función del caudal..., Colebrook..., Darcy...
# Finalmente, altura hidráulica en función del caudal con términos de pérdidas distribuidas y singulares.\"\"\"
# CalculusSummary(2, contenido)






