# Источники и лицензии

## 3D-модели (CC0 1.0, Quaternius — https://quaternius.com)
Лицензия каждого пака лежит рядом с моделями (`assets/models/*/License.txt`): CC0 1.0 Universal, общественное достояние.
Модели перекрашены и дополнены своими деталями (рога, светящиеся глаза, балахоны, тесак, противогаз, наплечники, ядро, пушка),
пропорции изменены масштабом костей; в игру попадают только запечённые пиксельные спрайты (`assets/sprites/`).

| Модель | Пак | Во что превращена |
|---|---|---|
| `chars/Ninja_Sand.gltf` | Ultimate Animated Character Pack | Фанатик: багровый балахон, рога, зелёные глаза, тесак |
| `chars/Soldier_Male.gltf` | Ultimate Animated Character Pack | Стрелок: латы, противогаз, наплечники, накидка, тяжёлое ружьё |
| `monsters/Orc_Skull.gltf` (+ `Atlas_Monsters.png`) | Ultimate Monsters | Тяжёлый демон: кожа перекрашена в багровый, рога, шипы, горящие глаза |
| `mech/Mike.gltf` | Animated Mech Pack | Босс «Колосс»: багровая броня с латунью, пылающее ядро, шипы, пушка |

Ссылки на паки: https://quaternius.com/packs/ultimatedanimatedcharacter.html, https://quaternius.com/packs/ultimatemonsters.html, https://quaternius.com/packs/animatedmech.html

## Оружие и руки от первого лица
Модели собраны самостоятельно из примитивов three.js (`tools/bake/fp.js`) — свой дизайн, сторонних ассетов нет.

## Текстуры (CC0 1.0, ambientCG — https://ambientcg.com)
Уменьшены до 256 px, палитра 24 цвета без дизеринга (`tools/make_textures.sh`), перекрашены и дополнены
процедурными деталями (лужи, копоть, ржавые потёки, заклёпки, рамки) в `src/textures.js`.

| Файл | Источник |
|---|---|
| `assets/textures/floor.png` | PavingStones138 |
| `assets/textures/cobble.png` | PavingStones128 |
| `assets/textures/metal.png` | MetalPlates013 |
| `assets/textures/rust.png` | Metal041B (грязь и потёки на резном камне) |
| `assets/textures/rock.png` | Rock051 |

Остальные текстуры (резной камень, контейнеры, ящики, бочки, знамёна) — процедурные.

## Звук и музыка
Генерируются кодом игры (`src/audio.js`).

## Библиотеки
three.js r160 (MIT) — https://threejs.org
