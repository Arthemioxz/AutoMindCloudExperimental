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















# -------- TEXTO --------
import requests, base64, mimetypes, re, html, urllib.parse
from pathlib import Path
from IPython.display import display, HTML

# =====================================
# 🔹 POLLI_TEXT: función local (no llama tu API)
# =====================================
def polli_text(prompt: str) -> str:
    # En tu caso, puedes dejarlo vacío si no quieres llamar nada
    # o conectar esto a tu modelo local / API si lo deseas.
    # Ejemplo de uso directo de tu API Cloud Run:
  
    API_URL = "https://gpt-proxy-github-619255898589.us-central1.run.app/infer"
    r = requests.post(API_URL, json={"text": prompt})
    r.raise_for_status()
    return r.text

# =====================================
# 🔹 Función de renderizado con MathJax
# =====================================
_num_pat = re.compile(r'^\s*(\d+)[\.\)]\s+(.*)')

def _escape_keep_math(s: str) -> str:
    parts = re.split(r'(\$\$.*?\$\$|\$.*?\$|\\\(.*?\\\))', s, flags=re.S)
    out = []
    for p in parts:
        if p.startswith('$') or p.startswith('\\('):
            out.append(p)
        else:
            out.append(html.escape(p))
    return ''.join(out)

def auto_wrap_latex(text: str) -> str:
    chunks = re.split(r'(\$\$.*?\$\$|\$.*?\$|\\\(.*?\\\))', text, flags=re.S)
    latex_cmd = re.compile(r'\\[a-zA-Z]+(?:\s*\{.*?\})*')
    def wrap(seg: str) -> str:
        def repl(m): return r'\(' + m.group(0) + r'\)'
        return latex_cmd.sub(repl, seg)
    return ''.join(part if (part.startswith('$') or part.startswith('\\(')) else wrap(part)
                   for part in chunks)

def _split_summary_and_steps(text: str):
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    summary_lines, steps, current = [], [], None
    for line in lines:
        if line.lower().startswith('pasos'):
            continue
        m = _num_pat.match(line)
        if m:
            if current is not None:
                steps.append(current.strip())
            current = m.group(2)
        else:
            if current is None:
                summary_lines.append(line)
            else:
                current += ' ' + line
    if current is not None:
        steps.append(current.strip())
    return ' '.join(summary_lines).strip(), steps

# =====================================
# 🔹 Render con fuentes y colores
# =====================================
def _render_html(summary: str, steps: list, font_type: str):
    css = f"""
<link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Fira+Sans&family=Roboto+Mono&display=swap" rel="stylesheet">
<link href="https://fonts.cdnfonts.com/css/latin-modern-roman" rel="stylesheet">

<style>
  .calc-wrap {{
    max-width: 980px; margin: 6px auto; padding: 4px 2px;
    font-family: '{font_type}', serif; color: #000;
  }}
  .title {{
    font-family: 'Anton', sans-serif; color: teal; font-size: 22px;
    font-weight: 700; margin: 6px 0 10px;
  }}
  .p {{ font-size: 18px; line-height: 1.6; margin: 8px 0; }}
  .step {{ margin: 10px 0; }}
  .idx {{ margin-right: 8px; font-weight: 700; }}
</style>

<script>
  window.MathJax = {{
    tex: {{inlineMath: [['$', '$'], ['\\\\(', '\\\\)']], displayMath: [['$$','$$']] }},
    options: {{ skipHtmlTags: ['script','noscript','style','textarea','pre','code'] }}
  }};
</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js" async></script>
"""
    body = f"""
<div class="calc-wrap">
  <div class="title">Resumen general</div>
  <p class="p">{_escape_keep_math(summary)}</p>
  <div class="title">Pasos</div>
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
def CalculusSummary(numero, font_type="Latin Modern Roman"):
    import re
    global documento

    base = (
        "Escribe en español, tono académico e impersonal (tercera persona). "
        "Empieza directamente con el contenido. "
        "Estructura la salida en dos partes: "
        "(1) un párrafo de resumen; "
        "(2) luego una enumeración con pasos numerados 1., 2., 3., etc."
    )

    if numero == 1:
        detalle = " Resumen general, formal y preciso sin entrar al detalle técnico fino."
    elif numero == 2:
        detalle = " Resumen muy preciso con detalles relevantes (mínimo 15 pasos)."
    elif numero == 3:
        detalle = " Resumen extremadamente preciso (mínimo 30 pasos, usa notación LaTeX cuando corresponda)."
    else:
        detalle = ""

    prompt = base + detalle + " Contenido a resumir:\n\n"
    raw_text = polli_text(prompt + documento)

    def _dechat(s: str) -> str:
        s = s.lstrip()
        patrones_inicio = [
            r"^(claro|por supuesto|aquí tienes|a continuación).*?\n+",
            r"^(este (documento|resumen|texto)[^.\n]*\.)\s+",
        ]
        for pat in patrones_inicio:
            s = re.sub(pat, "", s, flags=re.IGNORECASE | re.MULTILINE)
        return s.strip()

    raw_text = _dechat(raw_text)
    raw_text = auto_wrap_latex(raw_text)
    summary, steps = _split_summary_and_steps(raw_text)
    display(HTML(_render_html(summary, steps, font_type)))



