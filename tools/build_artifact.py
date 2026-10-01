# Собирает игру в один HTML-файл (для публикации как артефакт):
# все модули из src/ склеиваются в один <script type="module">, CSS встраивается.
# Запуск: python3 tools/build_artifact.py  ->  dist/boltgun.html
import re, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
order = ['collision', 'sprites', 'arena', 'audio', 'effects', 'input', 'player', 'weapon', 'enemies', 'waves', 'hud', 'main']

js = ["import * as THREE from 'three';"]
for name in order:
    src = (root / 'src' / f'{name}.js').read_text()
    src = re.sub(r"^import .*?;\n", "", src, flags=re.M | re.S)  # убираем импорты
    src = re.sub(r"^export ", "", src, flags=re.M)                 # и слово export
    js.append(f"// ===== {name}.js =====\n{src}")

html = (root / 'index.html').read_text()
body = html[html.index('<body>') + 6: html.index('</body>')]
body = re.sub(r'<script type="module" src="src/main.js"></script>', '', body)
css = (root / 'style.css').read_text()

out = f'''<title>Boltgun Prototype</title>

<meta name="theme-color" content="#120c0c">
<style>
:root {{ color-scheme: dark; }}
{css}
</style>
<script type="importmap">
  {{ "imports": {{ "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js" }} }}
</script>
{body.strip()}
<script type="module">
{chr(10).join(js)}
</script>
'''
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist' / 'boltgun.html').write_text(out)
print('dist/boltgun.html', len(out), 'bytes')
