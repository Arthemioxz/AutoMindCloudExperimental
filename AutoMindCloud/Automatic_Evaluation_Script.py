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

# --- Detecta "1. ..." o "1) ..." al inicio de líneas ---
_num_pat = re.compile(r'^\s*(\d+)[\.\)]\s+(.*)')

def _escape_keep_math(s: str) -> str:
    """
    Escapa HTML pero conserva segmentos $...$ y $$...$$ para que MathJax los procese.
    """
    parts = re.split(r'(\$\$.*?\$\$|\$.*?\$)', s, flags=re.S)
    out = []
    for p in parts:
        if p.startswith('$'):
            out.append(p)   # mantener math intacto
        else:
            out.append(html.escape(p))
    return ''.join(out)

def auto_wrap_latex(text: str) -> str:
    """
    Rodea expresiones LaTeX típicas (\frac, \sin, \alpha, etc.) con $...$
    si no estaban ya dentro de $...$ o $$...$$.
    """
    # separar regiones matemáticas y no matemáticas
    chunks = re.split(r'(\$\$.*?\$\$|\$.*?\$)', text, flags=re.S)
    def wrap_in_non_math(segment: str) -> str:
        # En segmentos no-math, envolver patrones LaTeX simples
        def repl(m):
            expr = m.group(0)
            return f"${expr}$"
        # Evitar rutas tipo \Users\... (muy raro en tus textos, pero por si acaso):
        return re.sub(r'\\[a-zA-Z]+(?:\{.*?\})*', repl, segment)
    out = []
    for part in chunks:
        if part.startswith('$'):
            out.append(part)      # ya es math
        else:
            out.append(wrap_in_non_math(part))
    return ''.join(out)

def _split_summary_and_steps(text: str):
    """
    Separa el primer bloque (resumen) de los pasos numerados.
    Soporta pasos en múltiples líneas.
    """
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    summary_lines, steps, current = [], [], None

    for line in lines:
        # Ignorar encabezados tipo "Pasos:", "Pasos generales:", etc.
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

    summary = ' '.join(summary_lines).strip()
    return summary, steps

def _render_html(summary: str, steps: list):
    """
    HTML con títulos en Anton (teal) y cuerpo en Computer Modern.
    """
    css = """
<link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet">
<link href="https://fonts.cdnfonts.com/css/computer-modern" rel="stylesheet">
<style>
  .calc-wrap { max-width: 980px; margin: 6px auto; padding: 4px 2px; }
  .title     { font-family: 'Anton', sans-serif; font-weight: 700; color: teal;
               font-size: 22px; margin: 6px 0 10px; letter-spacing: 0.3px; }
  .cm        { font-family: 'Computer Modern', 'CMU Serif', 'Latin Modern Roman',
               'Times New Roman', serif; color: #222; }
  .p         { font-size: 18px; line-height: 1.6; margin: 8px 0; }
  .step      { margin: 10px 0; }
  .idx       { margin-right: 8px; font-weight: 700; }
</style>
"""
    s_sum = _escape_keep_math(summary)
    step_html = []
    for i, s in enumerate(steps, 1):
        step_html.append(
            '<p class="p cm step"><span class="idx">%d.</span>%s</p>' %
            (i, _escape_keep_math(s))
        )

    html_doc = css + """
<div class="calc-wrap">
  <div class="title">Resumen general</div>
  <p class="p cm">""" + s_sum + """</p>
  <div class="title">Pasos</div>
  """ + "\n".join(step_html) + """
</div>
<script>
  // Re-tipografiar con MathJax si está disponible (Colab suele cargarlo)
  if (window.MathJax && window.MathJax.typeset) { window.MathJax.typeset(); }
</script>
"""
    return html_doc

# -----------------------------
# Tu función principal
# -----------------------------
def CalculusSummary(numero):
    global documento  # definido por ti en otro lado

    if numero == 1:
        prompt = ("(RECUERDA usar $$ para renderizar el latex en markdown si es que vas a usar) "
                  "Primero haz un resumen general formalmente de lo que crees que hacen los calculos sin entrar al detalle, "
                  "no digas palabras como probablemente, di que son las funciones concretamente. "
                  "Después haz una enumeración explicando paso por paso de forma general sin entrar al detalle "
                  "(y pon un espacio entre cada enumeración): ")
    elif numero == 2:
        prompt = ("(RECUERDA usar $$ para renderizar el latex en markdown) "
                  "Primero haz un resumen formalmente muy preciso de lo que crees que hacen los calculos entrando al detalle, "
                  "no digas palabras como probablemente, di que son las funciones concretamente. "
                  "Después haz una enumeración más precisa explicando paso por paso "
                  "(y pon un espacio entre cada enumeración): ")
    elif numero == 3:
        prompt = ("(RECUERDA usar $$ para renderizar el latex en markdown) "
                  "Primero haz un resumen formalmente muy preciso de lo que crees que hacen los calculos entrando al detalle, "
                  "no digas palabras como probablemente, di que son las funciones concretamente. "
                  "Después haz una enumeración extremadamente precisa explicando paso por paso "
                  "(y pon un espacio entre cada enumeración). (v): ")
    else:
        prompt = ""

    # 1) Obtener texto desde tu pipeline
    raw_text = polli_text(prompt + documento)

    # 2) Auto-envolver LaTeX suelto (\frac, \sin, etc.)
    raw_text = auto_wrap_latex(raw_text)

    # 3) Separar resumen y pasos
    summary, steps = _split_summary_and_steps(raw_text)

    # 4) Renderizar en HTML (Computer Modern en cuerpo, títulos Anton teal)
    html_out = _render_html(summary, steps)
    display(HTML(html_out))

