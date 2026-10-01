#!/usr/bin/env python3
"""Список и загрузка публичных папок Google Drive (для CC0-паков Quaternius).
gdrive.py list <folder_id> [depth]       — дерево файлов
gdrive.py get <folder_id> <out_dir> [pattern] — скачать файлы, имя которых содержит pattern
"""
import re, subprocess, sys, os, html

def curl(url, out=None):
    args = ['curl', '-sL', '-m', '120', url]
    if out: args += ['-o', out]
    return subprocess.run(args, capture_output=True).stdout.decode('utf-8', 'replace')

def entries(fid):
    h = curl(f'https://drive.google.com/embeddedfolderview?id={fid}')
    res = []
    for m in re.finditer(r'id="entry-([A-Za-z0-9_-]+)".*?href="([^"]+)".*?flip-entry-title">([^<]+)', h, re.S):
        eid, href, title = m.group(1), m.group(2), html.unescape(m.group(3))
        res.append((eid, 'folder' in href, title))
    return res

def walk(fid, path='', depth=9):
    for eid, isdir, title in entries(fid):
        p = f'{path}/{title}'
        if isdir:
            if depth > 0: yield from walk(eid, p, depth - 1)
            else: yield (eid, True, p)
        else: yield (eid, False, p)

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'list':
        for eid, isdir, p in walk(sys.argv[2], '', int(sys.argv[3]) if len(sys.argv) > 3 else 9):
            print(('D ' if isdir else 'F ') + p, eid)
    elif cmd == 'get':
        out, pat = sys.argv[3], (sys.argv[4] if len(sys.argv) > 4 else '')
        for eid, isdir, p in walk(sys.argv[2]):
            if isdir or pat not in p: continue
            dst = os.path.join(out, p.lstrip('/'))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            curl(f'https://drive.usercontent.google.com/download?id={eid}&export=download&confirm=t', dst)
            print(dst, os.path.getsize(dst))
