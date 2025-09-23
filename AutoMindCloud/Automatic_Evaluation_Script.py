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
import requests, urllib.parse

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

#def CalculusSummary(numero):
#  global documento
#
#  if numero == 1:
    
#    IPython.display.display(show_latex_paragraph(polli_text("(RECUERDA usar $$ para renderizar el latex en markdown si es que vas a usar) Primero haz un resumen general formalmente de lo que crees que hacen los calculos sin entrar al detalle, no digas palabras como probablemente, di que son las funciones concretamente. Después haz una enumeración explicando paso por paso de forma general sin entrar al detalle (y pon un espacio entre cada enumeración): "+ documento)))
#  elif numero ==2:
#    IPython.display.display(show_latex_paragraph(polli_text("(RECUERDA usar $$ para renderizar el latex en markdown) Primero haz un resumen formalmente muy preciso de lo que crees que hacen los calculos entrando al detalle, no digas palabras como probablemente, di que son las funciones concretamente. Después haz una enumeración más precisa explicando paso por paso (y pon un espacio entre cada enumeración): "+ documento)))
#  elif numero ==3:
#    IPython.display.display(show_latex_paragraph(polli_text("(RECUERDA usar $$ para renderizar el latex en markdown) Primero haz un resumen formalmente muy preciso de lo que crees que hacen los calculos entrando al detalle, no digas palabras como probablemente, di que son las funciones concretamente. Después haz una enumeración extremadamente precisa explicando paso por paso (y pon un espacio entre cada enumeración). (v): "+ documento)))

import re, html
from IPython.display import display, HTML

# ---------- Utils ----------
_num_pat = re.compile(r'^\s*(\d+)[\.\)]\s+(.*)')

def _escape_keep_math(s: str) -> str:
    """Escapa HTML pero conserva $...$, $$...$$ y \(...\) para que MathJax los procese."""
    parts = re.split(r'(\$\$.*?\$\$|\$.*?\$|\\\(.*?\\\))', s, flags=re.S)
    out = []
    for p in parts:
        if p.startswith('$') or p.startswith('\\('):
            out.append(p)
        else:
            out.append(html.escape(p))
    return ''.join(out)

def auto_wrap_latex(text: str) -> str:
    """Envuelve comandos LaTeX sueltos (\frac, \sin, etc.) con \(...\) fuera de delimitadores."""
    chunks = re.split(r'(\$\$.*?\$\$|\$.*?\$|\\\(.*?\\\))', text, flags=re.S)
    latex_cmd = re.compile(r'\\[a-zA-Z]+(?:\s*\{.*?\})*')

    def wrap(seg: str) -> str:
        def repl(m):
            return r'\(' + m.group(0) + r'\)'
        return latex_cmd.sub(repl, seg)

    return ''.join(part if (part.startswith('$') or part.startswith('\\(')) else wrap(part)
                   for part in chunks)

def _split_summary_and_steps(text: str):
    """Separa el primer bloque (resumen) de los pasos numerados."""
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

# ---------- Render con fuente seleccionada ----------
def _render_html(summary: str, steps: list, font_type: str):
    css = f"""
<!-- Anton para títulos -->
<link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet">

<!-- Algunas fuentes comunes -->
<link href="https://fonts.googleapis.com/css2?family=Fira+Sans&family=Fira+Mono&family=Inconsolata&family=Roboto+Slab&family=Roboto+Mono&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=STIX+Two+Text&display=swap" rel="stylesheet">
<link href="https://fonts.cdnfonts.com/css/latin-modern-roman" rel="stylesheet">

<style>
  .calc-wrap {{
    max-width: 980px; margin: 6px auto; padding: 4px 2px;
    font-family: '{font_type}', serif;
    color: #000;
    -webkit-font-smoothing: antialiased;
    font-synthesis: none;
  }}
  .title {{
    font-family: 'Anton', sans-serif;
    font-weight: 700;
    color: teal;
    font-size: 22px;
    margin: 6px 0 10px;
    letter-spacing: .3px;
  }}
  .p   {{ font-size: 18px; line-height: 1.6; margin: 8px 0; }}
  .step{{ margin: 10px 0; }}
  .idx {{ margin-right: 8px; font-weight: 700; }}
  .calc-wrap .mjx-container {{ color: #000 !important; }}
</style>

<!-- MathJax v3 -->
<script>
  window.MathJax = {{
    tex: {{
      inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
      displayMath: [['$$', '$$']],
      processEscapes: true
    }},
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

# ---------- Función principal ----------
def CalculusSummary(numero, font_type="Latin Modern Roman"):
    """
    Usa la variable global `documento` y la función `polli_text(...)`.
    Render: títulos teal (Anton); cuerpo con fuente configurable; ecuaciones LaTeX en negro.
    Ejemplo: CalculusSummary(1, "Fira Sans")
    """
    import re
    global documento

    # --- Plantilla común para forzar estilo formal e impersonal ---
    base = (
        "Escribe en español, tono académico e impersonal (tercera persona). "
        "No uses saludos ni frases introductorias o metadiscursivas como "
        "'aquí tienes', 'claro', 'a continuación', 'este documento', 'este resumen', "
        "'en este texto', 'se presenta', 'vamos a', ni te dirijas al lector. "
        "Empieza directamente con el contenido. "
        "No uses 'probablemente' ni expresiones especulativas. "
        "Estructura la salida en dos partes: "
        "(1) un párrafo de resumen; "
        "(2) luego una enumeración con pasos numerados 1., 2., 3., etc. "
        "No incluyas viñetas adicionales ni conclusiones."
    )

    if numero == 1:
        detalle = (
            " Redacta un resumen general, formal y preciso sin entrar al detalle técnico fino. "
            "Tras el resumen, da una enumeración general paso por paso (un paso por línea). "
        )
    elif numero == 2:
        detalle = (
            " Redacta un resumen muy preciso entrando en detalles relevantes (fórmulas o símbolos clave cuando aporte claridad). "
            "Tras el resumen, da una enumeración precisa paso por paso (un paso por línea). "
        )
    elif numero == 3:
        detalle = (
            " Redacta un resumen extremadamente preciso con el máximo nivel de especificidad "
            "(incluye notación y ecuaciones LaTeX cuando corresponda). "
            "Tras el resumen, da una enumeración extremadamente precisa y larga paso por paso (un paso por línea). "
        )
    else:
        detalle = " Redacta un resumen formal y una enumeración paso por paso."

    prompt = base + detalle + " Contenido a resumir:\n\n"

    # --- Llamada al modelo ---
    raw_text = polli_text(prompt + documento)

    # --- Limpieza de muletillas si aparecieran por error ---
    def _dechat(s: str) -> str:
        # Elimina frases introductorias comunes al inicio
        s = s.lstrip()
        patrones_inicio = [
            r"^(claro[,:\s]|por supuesto[,:\s]|aquí tienes[,:\s]|a continuación[,:\s]).*?\n+",
            r"^(este (documento|resumen|texto)[^.\n]*\.)\s+",
            r"^(en (este|el) (documento|resumen|texto)[^.\n]*\.)\s+",
        ]
        for pat in patrones_inicio:
            s = re.sub(pat, "", s, flags=re.IGNORECASE | re.MULTILINE)
        # Quita espacios extra
        return s.strip()

    raw_text = _dechat(raw_text)

    # --- Ajuste de LaTeX si corresponde ---
    raw_text = auto_wrap_latex(raw_text)

    # --- Separación y render ---
    summary, steps = _split_summary_and_steps(raw_text)
    display(HTML(_render_html(summary, steps, font_type)))



