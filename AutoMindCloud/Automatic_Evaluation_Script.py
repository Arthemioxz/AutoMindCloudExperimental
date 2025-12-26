import sympy

from re import I

import IPython

from AutoMindCloud.Latemix2 import *

global DatosList,Orden,Color

DatosList = []

Orden = 0

global documento

documento = []

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
  
  dentro = False#Supongamos que el elemento no esté dentro

  for elemento in DatosList:
    if elemento[0] == c_componente[0]:# si el componente esta adentro, entonces
      dentro = True

  if c_componente[1] == None:
    c_componente[1] = c_componente[0]
    
  if dentro == False:
    DatosList.append(c_componente)#Si el elemento no estaba adentro, simplemente lo agregamos.
    dentro = True

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
  else:
    Tipo = "Expresion"
  
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

  if Tipo == "Expresion":

    exp = sympy.latex(elemento)

    texto = exp
    #texto = texto.replace("text", Estilo)

    documento += "$\\textcolor{"+Color+"}{"+texto+"}$"
    IPython.display.display(IPython.display.Latex("$\\textcolor{"+Color+"}{"+texto+"}$"))
  

def R(string):
  #global DatosList,Orden,Color#Documento

  global documento

  #documento += "$\\textcolor{"+Color+"}{"+string+"}$"
  documento += string
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




























































# =========================================================
# IA_CalculusSummary (FULL) + Copy API OUTPUT Button (with hover animation)
# - Button copies EXACT raw text returned by the API (/infer)
# - Hover animation like your ComponentsPanel.js (translate + scale + teal faint)
# =========================================================

import requests, re, html, json, uuid
from IPython.display import display, HTML

# Optional: if you don't define Color elsewhere, this fallback is used
try:
    Color
except NameError:
    Color = "#0ea5a6"


# =========================================================
# 🔹 POLLI_TEXT: cliente robusto
# =========================================================
def polli_text(
    prompt: str,
    url: str = "https://gpt-proxy-github-619255898589.us-central1.run.app/infer",
    timeout: int = 60,
) -> str:
    # IMPORTANTE: tu backend /infer debe aceptar {"text": "..."}
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
_num_pat = re.compile(r"^\s*(\d+)[\.\)]\s+(.*)")

_heading_patterns = [
    r"^\s*\(?\s*1\s*\)?\s*\.?\s*Resumen\s*:?\s*$",
    r"^\s*Resumen\s*:?\s*$",
    r"^\s*RESUMEN\s*:?\s*$",
    r"^\s*\(?\s*2\s*\)?\s*\.?\s*Pasos\s*:?\s*$",
    r"^\s*Pasos\s*:?\s*$",
    r"^\s*PASOS\s*:?\s*$",
]
_heading_regexes = [re.compile(p, re.IGNORECASE) for p in _heading_patterns]


def _looks_like_heading(line: str) -> bool:
    line = re.sub(r"[*_`~]+", "", line)
    line = re.sub(r"<[^>]+>", "", line)
    return any(rx.match(line.strip()) for rx in _heading_regexes)


# ========= FUNCIÓN CLAVE: evita texto pegado y corrige "\ (" =========
def _escape_keep_math(s: str) -> str:
    s = s.replace("\\ (", "\\(").replace("\\ )", "\\)")

    math_pattern = re.compile(r"(\$\$.*?\$\$|\$.*?\$|\\\[.*?\\\]|\\\(.*?\\\))", re.S)
    math_ops_re = re.compile(r"(\\[a-zA-Z]+|[_^=+\-*/=])")

    def _maybe_unmath(seg: str) -> str:
        if seg.startswith("$$") and seg.endswith("$$"):
            return seg

        if seg.startswith("\\(") and seg.endswith("\\)"):
            inner = seg[2:-2]
        elif seg.startswith("\\[") and seg.endswith("\\]"):
            inner = seg[2:-2]
        elif seg.startswith("$") and seg.endswith("$"):
            inner = seg[1:-1]
        else:
            return seg

        inner_stripped = inner.strip()
        if not inner_stripped:
            return ""

        tokens = inner_stripped.replace("\n", " ").split()
        has_math_ops = bool(math_ops_re.search(inner_stripped))

        if len(tokens) >= 6 and not has_math_ops:
            return html.escape(inner_stripped)

        letters_digits = re.sub(r"[^A-Za-z0-9]+", "", inner_stripped)
        if letters_digits:
            letters_count = sum(c.isalpha() for c in letters_digits)
            letters_ratio = letters_count / len(letters_digits)
        else:
            letters_ratio = 0.0

        if len(tokens) >= 4 and not has_math_ops and letters_ratio > 0.6:
            return html.escape(inner_stripped)

        return seg

    parts = math_pattern.split(s)
    out = []
    for p in parts:
        if not p:
            continue
        if math_pattern.fullmatch(p):
            out.append(_maybe_unmath(p))
        else:
            out.append(html.escape(p))
    return "".join(out)


def _strip_boilerplate(s: str) -> str:
    s = s.lstrip()
    s = re.sub(
        r"^(claro|por supuesto|aquí tienes|a continuación).*?\n+",
        "",
        s,
        flags=re.IGNORECASE,
    )
    lines = [l.rstrip() for l in s.splitlines()]
    lines = [l for l in lines if not _looks_like_heading(l)]
    return "\n".join(lines).strip()


def _split_summary_and_steps(text: str):
    text = _strip_boilerplate(text)
    lines = [re.sub(r"\s+", " ", l).strip() for l in text.splitlines() if l.strip()]

    lines = [
        re.sub(r"^\s*\(?\s*1\s*\)?\s*\.?\s*Resumen\s*:?\s*", "", l, flags=re.IGNORECASE)
        for l in lines
    ]
    lines = [
        re.sub(r"^\s*\(?\s*2\s*\)?\s*\.?\s*Pasos\s*:?\s*", "", l, flags=re.IGNORECASE)
        for l in lines
    ]

    first_idx = None
    for i, line in enumerate(lines):
        if _num_pat.match(line):
            first_idx = i
            break

    if first_idx is None:
        return " ".join(lines).strip(), []

    summary = " ".join(lines[:first_idx]).strip()
    steps = []
    current = None

    for line in lines[first_idx:]:
        m = _num_pat.match(line)
        if m:
            if current:
                steps.append(current.strip())
            current = m.group(2)
        else:
            if current:
                current += " " + line

    if current:
        steps.append(current.strip())

    steps = [re.sub(r"^\s*[-–•]\s*", "", s).strip() for s in steps]
    return summary, steps


def _safe_textarea_payload(s: str) -> str:
    # Prevent rare edge case where the model outputs "</textarea>"
    s = (s or "").replace("</textarea>", "</text_area>")
    return html.escape(s)


# =====================================
# 🔹 Render con fuentes + MathJax + COPY API OUTPUT BUTTON
# =====================================
def _render_html(summary: str, steps: list, font_type: str, language: str, raw_api_output: str):
    global Color

    uid = uuid.uuid4().hex[:10]
    copy_src_id = f"copy_src_{uid}"
    btn_id = f"copy_btn_{uid}"
    msg_id = f"copy_msg_{uid}"

    lang = (language or "spanish").strip().lower()
    if lang.startswith("en"):
        title_resumen = "Summary"
        title_pasos = "Steps"
        copy_label = "Copy API output"
        copied_label = "Copied!"
        copy_fail_label = "Copy failed"
    else:
        title_resumen = "Resumen"
        title_pasos = "Pasos"
        copy_label = "Copiar salida (API)"
        copied_label = "¡Copiado!"
        copy_fail_label = "No se pudo copiar"

    # Colors inspired by your viewer theme feel
    TEAL = Color or "#0ea5a6"
    TEAL_FAINT = "rgba(14,165,166,0.12)"
    STROKE = "rgba(0,0,0,0.15)"
    BG_PANEL = "rgba(255,255,255,0.90)"

    css = f"""
<link href="https://fonts.googleapis.com/css2?family=Anton:wght@400;700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;600&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
<link href="https://fonts.cdnfonts.com/css/latin-modern-roman" rel="stylesheet">
<style>
  .calc-wrap {{
    max-width:980px;
    margin:8px auto;
    padding:8px 4px;
    font-family:'{font_type}','Fira Sans',system-ui;
    position:relative;
  }}

  .title-row {{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    margin:8px 0 10px;
  }}

  .title {{
    font-family:'Anton',sans-serif;
    color:{TEAL};
    font-size:22px;
    font-weight:700;
    letter-spacing:1.5px;
    margin:0;
  }}

  .copy-wrap {{
    display:flex;
    align-items:center;
    gap:10px;
  }}

  /* Base styling like your viewer buttons */
  .copy-btn {{
    padding:8px 12px;
    border-radius:12px;
    border:1px solid {STROKE};
    background:{BG_PANEL};
    color:#111;
    font-weight:800;
    cursor:pointer;
    transition:all .12s ease;
    user-select:none;
    -webkit-tap-highlight-color: transparent;
  }}

  .copy-msg {{
    font-size:12px;
    opacity:0.85;
    color:{TEAL};
    min-width:110px;
  }}

  .p {{
    font-size:18px;
    line-height:1.6;
    margin:8px 0;
  }}

  .summary {{
    color:{TEAL};
  }}

  .step {{
    margin:10px 0;
    color:{TEAL};
  }}

  .idx {{
    margin-right:8px;
    font-weight:900;
  }}

  /* Hidden textarea for robust copying */
  .copy-src {{
    position:absolute;
    left:-9999px;
    top:-9999px;
    width:1px;
    height:1px;
    opacity:0;
  }}
</style>

<script>
window.MathJax={{tex:{{inlineMath:[['$','$'],['\\\\(','\\\\)']],
displayMath:[['$$','$$'],['\\\\[','\\\\]']]}},
options:{{skipHtmlTags:['script','noscript','style','textarea','pre','code']}}}};
</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js" async></script>

<script>
(function() {{
  const TEAL_FAINT = "{TEAL_FAINT}";
  const TEAL = "{TEAL}";
  const STROKE = "{STROKE}";
  const BG_PANEL = "{BG_PANEL}";

  function setMsg(text) {{
    const el = document.getElementById("{msg_id}");
    if (!el) return;
    el.textContent = text || "";
    if (text) {{
      clearTimeout(el.__t);
      el.__t = setTimeout(() => el.textContent = "", 1200);
    }}
  }}

  async function copyApiOutput() {{
    const ta = document.getElementById("{copy_src_id}");
    if (!ta) return;
    const text = ta.value || "";

    try {{
      if (navigator.clipboard && window.isSecureContext) {{
        await navigator.clipboard.writeText(text);
        setMsg("{copied_label}");
        return;
      }}
    }} catch (e) {{
      // fallback below
    }}

    try {{
      ta.style.opacity = "1";
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand("copy");
      ta.style.opacity = "0";
      setMsg(ok ? "{copied_label}" : "{copy_fail_label}");
    }} catch (e) {{
      setMsg("{copy_fail_label}");
    }}
  }}

  // Hover animation like your ComponentsPanel.js
  function wireHover() {{
    const btn = document.getElementById("{btn_id}");
    if (!btn) return;

    btn.addEventListener("mouseenter", () => {{
      btn.style.transform = "translateY(-1px) scale(1.02)";
      btn.style.background = TEAL_FAINT;
      btn.style.borderColor = TEAL;
    }});
    btn.addEventListener("mouseleave", () => {{
      btn.style.transform = "none";
      btn.style.background = BG_PANEL;
      btn.style.borderColor = STROKE;
    }});

    btn.addEventListener("click", () => copyApiOutput());
  }}

  // Wait a tick to ensure DOM exists
  setTimeout(wireHover, 0);
}})();
</script>
"""

    textarea = f"""
<textarea id="{copy_src_id}" class="copy-src" readonly>{_safe_textarea_payload(raw_api_output)}</textarea>
"""

    body = f"""
<div class="calc-wrap">
  <div class="title-row">
    <div class="title">{title_resumen}</div>
    <div class="copy-wrap">
      <button id="{btn_id}" class="copy-btn">{copy_label}</button>
      <span id="{msg_id}" class="copy-msg"></span>
    </div>
  </div>

  {textarea}

  <p class="p summary">{_escape_keep_math(summary)}</p>

  {"<div class='title' style='margin-top:14px;'>" + title_pasos + "</div>" if steps else ""}
  {''.join(
      f'<p class="p step"><span class="idx">{i}.</span>{_escape_keep_math(s)}</p>'
      for i, s in enumerate(steps, 1)
  )}
</div>
"""
    return css + body


# =====================================
# 🔹 Función principal con idioma
# =====================================
def IA_CalculusSummary(
    numero: int,
    language: str = "spanish",
    font_type: str = "Latin Modern Roman",
):
    """
    IA_CalculusSummary(numero, language="spanish"/"english", font_type=...)
    Usa la variable global 'documento' como entrada.
    """
    global documento

    lang = (language or "spanish").strip().lower()

    if lang.startswith("en"):
        base = (
            "Write in English, academic tone, formal and impersonal (third person). "
            "Start directly with the content. "
            "Structure the output in two parts: "
            "(1) one summary paragraph; "
            "(2) then a numbered list of steps 1., 2., 3., etc. "
            "IMPORTANT: All mathematical notation MUST be correctly delimited: "
            "use \\( ... \\) for inline formulas and \\[ ... \\] for display equations. "
            "Use LaTeX ONLY for short mathematical expressions, never for whole sentences. "
            "If the model tries to wrap an entire sentence with \\( ... \\) or $ ... $, rewrite it so that "
            "only the specific mathematical expressions are in LaTeX."
        )
    else:
        base = (
            "Escribe en español, tono académico, formal e impersonal (tercera persona). "
            "Empieza directamente con el contenido. "
            "Estructura la salida en dos partes: "
            "(1) un párrafo de resumen; "
            "(2) luego una enumeración con pasos numerados 1., 2., 3., etc. "
            "IMPORTANTE: Toda notación matemática DEBE ir delimitada correctamente: "
            "usa \\( ... \\) para fórmulas en línea y \\[ ... \\] para ecuaciones en bloque. "
            "Usa LaTeX SOLO para expresiones matemáticas cortas, nunca para oraciones completas. "
            "Si el modelo intenta rodear una oración completa con \\( ... \\) o $ ... $, "
            "reformula la oración para que únicamente las expresiones matemáticas específicas "
            "aparezcan en LaTeX."
        )

    if numero == 1:
        detalle = " Redacta un resumen conciso (5-7 líneas) y 7 pasos generales sin fórmulas."
    elif numero == 2:
        detalle = " Redacta un resumen preciso (7-9 líneas) y 15 pasos con detalles clave."
    elif numero == 3:
        detalle = " Redacta un resumen muy preciso (9-12 líneas) y 30 pasos con notación LaTeX."
    else:
        detalle = " Redacta un resumen breve y pasos razonables."

    prompt = f"{base}{detalle}\n\nContenido a resumir / Content to summarize:\n\n{documento}"

    # RAW output from API (this is what the button will copy)
    raw = polli_text(prompt)

    # Parsed output for display
    summary, steps = _split_summary_and_steps(raw)

    html_out = _render_html(summary, steps, font_type, language, raw_api_output=raw)
    display(HTML(html_out))

