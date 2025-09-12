import cadquery as cq
from cadquery import exporters
from IPython.display import display, SVG, Latex

# Load the STEP file
#result = cq.importers.importStep('Sketch.step')
# Function to rotate and display the object

def show_view(result,rotate_axis, rotate_angle, title=""):
    # Rotate the object
    rotated = result.rotate((0,0,0), rotate_axis, rotate_angle)
    # Export as SVG
    svg_str = exporters.getSVG(rotated.val(), opts={
            "showAxes": False})
    display(SVG(svg_str))
    display(Latex(title))

def Step_Orthographic_Render(Sketch_Name):

  Sketch_Name = Sketch_Name + str(".step")
  result = cq.importers.importStep(Sketch_Name)
  # Standard views using rotation
  show_view(result,(1,0,0), 0, "\\text{Front View}")
  show_view(result,(1,0,0), 90, "\\text{Top View}")
  show_view(result,(0,1,0), 90, "\\text{Right Side View}")
  show_view(result,(1,1,0), 45, "\\text{Isometric View}")
