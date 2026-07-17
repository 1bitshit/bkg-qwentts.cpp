from pathlib import Path
import re

src = Path('/notebooks/alpha/bkg-qwen-tts.cpp/webui/dist')
out = Path('/notebooks/alpha/bkg-qwen-tts.cpp/src/tts-web-assets.h')
index = (src / 'index.html').read_bytes()
css_path = next((src / 'assets').glob('*.css'))
js_path = next((src / 'assets').glob('*.js'))

def array(name: str, data: bytes) -> str:
    rows = []
    for i in range(0, len(data), 20):
        rows.append('    ' + ','.join(str(b) for b in data[i:i+20]))
    return f'static const unsigned char {name}[] = {{\n' + ',\n'.join(rows) + '\n};\n'

text = '#pragma once\n#include <cstddef>\n\n'
text += array('TTS_UI_HTML', index)
text += f'static constexpr size_t TTS_UI_HTML_LEN = {len(index)};\n\n'
text += array('TTS_UI_CSS', css_path.read_bytes())
text += f'static constexpr size_t TTS_UI_CSS_LEN = {css_path.stat().st_size};\n\n'
text += array('TTS_UI_JS', js_path.read_bytes())
text += f'static constexpr size_t TTS_UI_JS_LEN = {js_path.stat().st_size};\n\n'
text += f'static constexpr const char * TTS_UI_CSS_PATH = "/assets/{css_path.name}";\n'
text += f'static constexpr const char * TTS_UI_JS_PATH = "/assets/{js_path.name}";\n'
out.write_text(text)
print(out)
print(css_path.name, js_path.name)
