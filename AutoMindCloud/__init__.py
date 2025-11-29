import IPython 

from IPython.display import Image

from IPython.display import Image, display

display(Image(
    url="https://i.gyazo.com/075a65994e032c0dc0551fcd76d77f51.jpg",
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

