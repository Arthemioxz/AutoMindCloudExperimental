import IPython

from IPython.display import Image

display(Image(url="https://i.gyazo.com/30a9ecbd8f1a0483a7e07a10eaaa8522.png"))

import requests

url = "https://raw.githubusercontent.com/ArtemioA/AutoMindCloudExperimental/main/AutoMindCloud/click_sound.mp3"
local_filename = "click_sound.mp3"

response = requests.get(url)
if response.status_code == 200:
    with open(local_filename, "wb") as f:
        f.write(response.content)

