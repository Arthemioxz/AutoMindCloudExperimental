import IPython 

from IPython.display import Image

from IPython.display import Image, display

display(Image(
    url="https://i.gyazo.com/fc67eb75c04d4a87db559b961dda9786.png",
    width=700,   # change this
    height=None  # or use height instead
))

import requests

url = "https://raw.githubusercontent.com/ArtemioA/AutoMindCloudExperimental/main/AutoMindCloud/click_sound.mp3"
local_filename = "click_sound.mp3"

response = requests.get(url)
if response.status_code == 200:
    with open(local_filename, "wb") as f:
        f.write(response.content)

