import cadquery as cq
from cadquery import exporters
from IPython.display import display, SVG

# Load the STEP file
#result = cq.importers.importStep('Sketch.step')
# Function to rotate and display the object

def show_view(result,rotate_axis, rotate_angle, title="Orthographic View"):
    # Rotate the object
    rotated = result.rotate((0,0,0), rotate_axis, rotate_angle)
    # Export as SVG
    svg_str = exporters.getSVG(rotated.val())
    display(SVG(svg_str))
    Ipython.display.Latex("\\text{"+title+"}")

def Step_Orthographic_Render(Sketch_Name):

  Sketch_Name = Sketch_Name + str(".step")
  result = cq.importers.importStep(Sketch_Name)
  # Standard views using rotation
  show_view(result,(1,0,0), 0, Ipython.display.Latex("\\text{Front View))
  show_view(result,(1,0,0), 90, Ipython.display.Latex("\\text{Top View)))
  show_view(result,(0,1,0), 90, Ipython.display.Latex("\\text{Right Side View)))
