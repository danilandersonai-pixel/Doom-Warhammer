# Собирает игру в один HTML-файл (для публикации как артефакт).
# Каждый модуль из src/ заворачивается в свою область видимости (IIFE), импорты заменяются
# ссылками на экспорты других модулей, порядок — по зависимостям. Three.js остаётся с CDN (importmap).
# Запуск: python3 tools/build_artifact.py  ->  dist/iron-crusade.html
import re, pathlib, base64, json

root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'src'

IMPORT_RE = re.compile(r"^import\s+(.+?)\s+from\s+'([^']+)';\s*$", re.M | re.S)
EXPORT_DECL_RE = re.compile(r"^export\s+(?:async\s+)?(function|class|const|let)\s+(.+)$", re.M)

def mod_id(path):
    return '__m_' + path.stem

def parse(path):
    code = path.read_text()
    deps, lines = [], []
    for m in IMPORT_RE.finditer(code):
        what, frm = m.group(1).strip(), m.group(2)
        if frm == 'three':
            continue  # THREE импортируется один раз наверху сборки
        dep = (path.parent / frm).resolve()
        deps.append(dep)
        if what.startswith('{'):
            names = [n.strip() for n in what.strip('{} ').split(',') if n.strip()]
            parts = [f"{a.split(' as ')[0].strip()}: {a.split(' as ')[1].strip()}" if ' as ' in a else a for a in names]
            lines.append(f"const {{ {', '.join(parts)} }} = {mod_id(dep)};")
        else:
            raise SystemExit(f'Неподдержанный импорт в {path.name}: {what}')
    body = IMPORT_RE.sub('', code)
    exports = []
    for m in EXPORT_DECL_RE.finditer(body):
        kind, rest = m.group(1), m.group(2)
        if kind in ('function', 'class'):
            exports.append(re.match(r'([A-Za-z_$][\w$]*)', rest).group(1))
        else:
            decl = rest.split(';')[0]
            for part in decl.split(','):
                mm = re.match(r'\s*([A-Za-z_$][\w$]*)\s*=', part)
                if mm:
                    exports.append(mm.group(1))
    body = re.sub(r'^export\s+', '', body, flags=re.M)
    return deps, '\n'.join(lines) + '\n' + body, exports

# обход зависимостей от main.js
order, seen, parsed = [], set(), {}
def visit(p):
    p = p.resolve()
    if p in seen:
        return
    seen.add(p)
    parsed[p] = parse(p)
    for d in parsed[p][0]:
        visit(d)
    order.append(p)
visit(src / 'main.js')

chunks = ["import * as THREE from 'three';"]
for p in order:
    _, body, exports = parsed[p]
    ret = f"return {{ {', '.join(exports)} }};" if exports else ''
    chunks.append(f"// ===== {p.name} =====\nconst {mod_id(p)} = await (async () => {{\n{body}\n{ret}\n}})();")

# запечённые атласы и CC0-текстуры встраиваем как data URL (артефакт — один файл)
def data_url(p):
    return 'data:image/png;base64,' + base64.b64encode(p.read_bytes()).decode()
sprites = {p.stem: {'png': data_url(p), 'meta': json.loads(p.with_suffix('.json').read_text())} for p in sorted((root / 'assets/sprites').glob('*.png'))}
textures = {p.stem: data_url(p) for p in sorted((root / 'assets/textures').glob('*.png'))}
embedded = f"<script>window.__SPRITES = {json.dumps(sprites)};\nwindow.__TEXTURES = {json.dumps(textures)};</script>"

html = (root / 'index.html').read_text()
body = html[html.index('<body>') + 6: html.index('</body>')]
body = body.replace('<script type="module" src="src/main.js"></script>', '')
css = (root / 'style.css').read_text()

out = f'''<title>Iron Crusade</title>
<meta name="theme-color" content="#a9bcd6">
<style>
{css}
</style>
<script type="importmap">
  {{ "imports": {{ "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js" }} }}
</script>
{body.strip()}
{embedded}
<script type="module">
{chr(10).join(chunks)}
</script>
'''
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist' / 'iron-crusade.html').write_text(out)
print('dist/iron-crusade.html', len(out), 'bytes,', len(order), 'modules:', ', '.join(p.stem for p in order))
