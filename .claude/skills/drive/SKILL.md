---
name: drive
description: Запустить ЖИВОЙ diode и водить его как браузер — `npm run drive -- <команда>` с сессией между вызовами (старт из исходников или бинаря, клавиши/набор/вставка/мышь, ожидания, кадр текстом, ячейки и цвета, дерево узлов, OUTPUT и логи, команда по id, палитра, пост-мортем, остановка и уборка, CPU-профиль правок на живом бинаре). Использовать, когда надо запустить/показать приложение, посмотреть кадр, проверить фичу или баг руками перед «готово» (пункт «Запусти приложение» в AGENTS.md), воспроизвести баг в живом редакторе, снять скриншот, прочитать OUTPUT расширения.
---

# Живой прогон: `npm run drive`

Харнесс фейкает рендер и ввод — ровно там и живут баги. Перед «готово» редактор
запускают по-настоящему и смотрят на кадр. Инструмент держит headless-сессию между
вызовами Bash: каждый шаг — отдельная команда, результат — текст.

```bash
npm run -s drive -- start --file src/a.ts='const greeting = "hi";\nconsole.log(greeting);\n' --open src/a.ts
npm run -s drive -- screen --numbered          # кадр с номерами строк и линейкой колонок
npm run -s drive -- key Ctrl+End
npm run -s drive -- type 'greeting.'           # посимвольно, как пользователь
npm run -s drive -- wait node '#suggestWidget'
npm run -s drive -- palette "View: Toggle Panel Visibility"
npm run -s drive -- exec workbench.action.files.save
npm run -s drive -- output Extensions --tail 20
npm run -s drive -- stop                       # и ни одного процесса/каталога после
```

`-s` у npm глушит его шапку. Справка по всем командам — `npm run -s drive -- help`.

## Жизнь сессии

- `start` по умолчанию — **из исходников** (`node --import tsx src/vs/diode/main.ts`,
  встроенные расширения пересобираются перед стартом, `--no-build` — пропустить).
  Возвращается, когда редактор **готов** (`Diode.whenReady`: extension host
  активирован, фаза `eventually`) — слепой `sleep 10` не нужен. ~10 с из исходников.
- `--binary` — собранный `dist/diode` (`--binary-path P` — другой). Сборка бинаря —
  тяжёлый прогон, только под лизу: `claude-lease run -- npm run build:sea` (скилл `heavy-run`).
- Всё изолировано: временный корень `$TMPDIR/diode-drive-<имя>-*` с
  `user-data-dir/`, `home/` (HOME/XDG), `workspace/` (cwd и папка воркспейса).
  `--file rel=текст` (`\n` — перевод строки) и `--seed DIR` наполняют воркспейс,
  `--open` — что открыть (относительно воркспейса; папка воркспейса открывается
  всегда, если среди `--open` нет каталога), `--settings`/`--keybindings` — JSON или
  `@файл`, `--install <id|vsix>` — расширение тем же путём, что `--install-extension`
  (id ходит в магазин), `--arg <флаг>` — любой флаг diode (`--arg --verbose`).
- Несколько сессий — `-s <имя>` у каждой команды. Реестр — `.drive/sessions/` этого
  checkout'а: соседний worktree твоих сессий не видит.
- `stop` — вежливый выход, потом добивание всего с маркером сессии (субпроцесс
  расширений, языковые серверы), удаление корня. `--keep` — оставить корень для
  разбора. `stop --all` — все сессии checkout'а.
- Сессия умерла (код 3 у любой команды) — `dump` (запись, хвост stderr и
  `diode.log`), потом `gc`. `gc` убирает мёртвые сессии, сирот и брошенные корни —
  в том числе от убитых агентов соседних worktree, но живые чужие не трогает.
  Корни, сохранённые `--keep`, — только `gc --kept`.

**Оставил сессию — оставил процесс на общей маленькой машине.** Закончил — `stop`.

## Ловушки (каждая стоила кому-то часов)

- **`paste` ≠ набор.** `paste` — bracketed paste одним блоком: попап автодополнения
  на нём НЕ открывается, авто-закрытие скобок и on-type-форматирование тоже ведут себя
  иначе. Проверяешь то, что делает пользователь клавиатурой, — `type`.
- **Попап автодополнения крадёт Enter/Escape/стрелки.** После `type` в коде (особенно
  `function fib`, `const greeting`, `console.l`) попап `#suggestWidget` может стоять
  открытым, и Enter примет подсказку вместо перевода строки. Перед Enter:
  `wait gone '#suggestWidget'` или явно `key Escape` и проверка. Ядро сценария
  проверяй однословным текстом в plaintext-файле, где попапа нет.
- **Палитра — только после `wait node '#quickInput'`.** Команда `palette` ждёт сама;
  руками (`key F1`/`Ctrl+Shift+P`) — жди узел, иначе первые символы уйдут в редактор.
  Пункты матчатся с начала заголовка: «View: Toggle Panel Visibility», не «Toggle Panel».
  Не знаешь заголовок — `commands <фильтр>`; знаешь id — `exec <id>` надёжнее палитры.
- **Клавиши — имена DSL tuidom:** `ArrowDown`, не `Down`; `Escape`; `Ctrl+Shift+p`;
  `Alt+F` — мнемоника меню (меню открывается Alt+буква). Незнакомое имя `key`
  отвергает с подсказкой — движок молча набрал бы буквы `D o w n`.
  `Ctrl+Shift+Z` в legacy-терминале неотличим от `Ctrl+Z` — redo проверяй `exec redo`.
- **Тосты стоковых расширений закрывают низ экрана** (правый нижний угол, над
  статус-баром) — панель OUTPUT/PROBLEMS под ними не читается.
  `exec notifications.clearAll`. Сообщения расширений смотри в `output`, а не на экране.
- **`reloadWindow` меняет процесс.** Окно перезапускается новым процессом на том же
  порту, старое какое-то время ещё отвечает — `wait ready` сразу после перезагрузки
  может ответить СТАРЫМ окном. Правильно: `exec workbench.action.reloadWindow`
  (вернёт «окно закрылось») → `wait reload` (ждёт окно с новым pid и его готовность).
  Грязный буфер — сначала диалог «Save changes?»: `click --text "Don't Save"`.
- **Не открывай сам репозиторий или большие фикстуры.** Watcher обходит дерево и
  грузит CPU (на маленькой машине — минуты), git-расширение сканирует репо. Нужны
  файлы — `--file`/`--seed` во временный воркспейс. Открыть каталог репо как
  `--open /abs/path` можно, но только осознанно.
- **Ожидания — предикатом, не временем.** `wait text|node|gone|focus|idle|ready`
  с `--timeout`; при таймауте печатается кадр и путь фокуса. `idle` — устоялся
  только рендер: хвосты extension host/LSP жди предикатом (`wait text`, `output`).
- **Координаты** — 0-based ячейки, те же, что в `screen --numbered` и в `box` узлов
  `tree`. Лучше `click --node SEL` или `click --text "…"`, чем литерал.
- **Глифы codicon'ов в тексте кадра неразличимы** — смотри `cell x y` (код-пойнт,
  fg/bg `#rrggbb`, стиль: `undercurl` = живая диагностика LSP). Иконки nerd-font
  (PUA) в текстовом дампе теряются, и целое дерево файлов выглядит сдвинутым —
  выравнивание проверяй по ячейкам, а не по тексту (ложный диагноз «дерево
  выглядит вложенным» стоил так одного захода).
- **`extension host subprocess did not become ready in 5000ms`** в канале Extensions
  при старте из исходников — субпроцесс расширений под tsx не уложился в зашитые 5 с
  (`readyTimeoutMs` в `extensionHost.ts`): машину грузит чужой тяжёлый прогон
  (`uptime`, `claude-lease status`). Расширений в сессии нет вовсе. Дождись, пока
  нагрузка спадёт, или временно подними таймаут локально — и верни перед коммитом.
- **Мерцание drive не видит.** `screen` — последний устоявшийся кадр, а мигание —
  это лишний кадр между двумя нормальными (попап закрылся и через 10 мс открылся).
  Ловится только сырым потоком: у человека — `script -q -T fl.tm -O fl.out -c 'diode f.txt'`
  (macOS: `script -q -r fl.rec …`), у себя — diode в `node-pty` с записью `onData`;
  поток прогоняется через `@xterm/headless`, и каждый `CSI ?2026h…l` — один кадр.
  Повтори ввод человека дословно: мерцание попапа автодополнения жило только на **кириллице**, на
  латинице и с любыми расширениями его не было.
- **Заголовок терминала (OSC 0/2) drive не видит** — у headless-сессии нет настоящего
  терминала. Заголовок проверяют diode в **отдельном tmux-сервере**, чтобы не трогать
  tmux человека: `tmux -L t new-session -d -x 120 -y 40 "diode --profile Work myproj"`,
  затем `tmux -L t display -p '#{pane_title}'`, в конце `tmux -L t kill-server`. Так же
  смотрят всё, что зависит от tmux (DCS passthrough, `TMUX` в окружении — его герметичная
  сессия drive вырезает).
- **Шум dev-режима:** `vscode.git-base: failed to register … out/extension.js` в
  канале Extensions из исходников — известное (у стокового git-base нет сборки в
  dev), к твоей правке не относится.

## Чтение состояния

| Что | Команда |
|---|---|
| кадр | `screen [--numbered]`, `screenshot out.png` |
| ячейка, курсор | `cell x y`, `cursor` |
| дерево / узел / фокус | `tree [SEL] [--depth N] [--state]`, `node SEL`, `focus` |
| OUTPUT | `output --list`, `output <id или подпись> [--tail N]` |
| логи процесса | `logs [--tail N]` (stderr; `diode.log` — только из исходников) |
| контекст-ключи | `context <ключ>`, `when "<выражение>"` |
| команды | `commands [фильтр]`, `exec <id> [json-арг]... [--no-await]` |

Селекторы `tree`/`node`/`wait`/`click --node`: `Type`, `#id`, `@role`, `A B` —
потомок. `--json` у большинства команд — для разбора скриптом.

`exec` ждёт промис команды до `--timeout` (10 с): команда, ждущая ответа
пользователя (quick pick, диалог), вернёт «запущена» — отвечай следующими вызовами.

## Скрипт сценария

Длинный прогон удобно положить в shell-скрипт: команды — обычные процессы,
`set -e` останавливает на первом провале (код 1 — ошибка/таймаут, 2 — usage,
3 — нет сессии). В конце — `stop` в `trap`, чтобы упавший скрипт не бросил редактор:

```bash
set -e
d() { npm run -s drive -- "$@"; }
trap 'd stop' EXIT
d start --file notes.txt='alpha\n' --open notes.txt
d type 'Xx'
d wait text 'Xxalpha'
```

## CPU-профиль правок на живом бинаре

`bench:open` меряет время клавиши, но не говорит, куда оно ушло, а главный процесс
бенч убивает — профиль не дописывается. Профиль снимают через drive: `NODE_OPTIONS`
наследуется в бинарь, а вежливый `stop` даёт V8 записать `.cpuprofile`.

```bash
OUT=/путь/к/prof && mkdir -p "$OUT"
d() { npm run -s drive -- -s prof "$@"; }
trap 'd stop' EXIT
NODE_OPTIONS="--cpu-prof --cpu-prof-interval=100 --cpu-prof-dir=$OUT" \
  npm run -s drive -- -s prof start --binary-path dist/diode --seed ./seed --open big.ts
d wait text 'export function' --timeout 60000
cut -d' ' -f1 /proc/uptime > "$OUT/mark"     # окно правок — отрезать открытие в профиле
for i in $(seq 1 15); do d type 'x'; d wait idle; done
for i in $(seq 1 15); do d key Enter; d wait idle; done
d stop                                       # именно stop, не kill: иначе профиля нет
```

- Профилей несколько — `NODE_OPTIONS` получают все node-процессы (extension host,
  tsserver). Главный — самый крупный (pid процесса есть в имени файла).
- Смотреть — DevTools (Performance → Load profile) или self-time по функциям
  скриптом над `nodes`/`samples`/`timeDeltas`, начиная с отметки `mark`.
- **Часы профиля — монотонные, с загрузки машины** (`startTime` в микросекундах ≈
  `/proc/uptime` × 10⁶), не эпоха: отметка `date +%s%3N` в профиле не найдётся. Отметки —
  из `/proc/uptime`, либо режь окно по структуре: кадр — непрерывная серия сэмплов с
  `renderFrame` в стеке (сэмплы `(garbage collector)` внутри кадра — его часть), время кадра
  — сумма их `timeDeltas`; так считают медиану/p90 кадра до и после.
- Бинарь — `npm run build:sea` под node 26.12 (системный 25.x его ломает).
- Одна такая сессия за раз: две drive-сессии с tsserver на 13 МБ файле умирали,
  похоже, от памяти.
- **Профиль старта — совмещать с вехами, а не с `timeOrigin`.** Профайлер запускается
  на ~55 мс позже `timeOrigin`, поэтому профиль сводят с трассой `DIODE_STARTUP_TRACE`
  по вехам `frame` (конец сэмплов `TracingNodeTerminalBackend.renderFrame`); числа
  inclusive.
- **Компиляция против исполнения.** `--log-function-events` в `NODE_OPTIONS` не пускают,
  а с `--cpu-prof` V8 его глушит. Тот же `main.cjs` поднимают голым node 26 из снапшота
  (`node --snapshot-blob snap.blob --build-snapshot main.cjs`, рядом с бандлом — копия
  `node`: `import.meta.url` в режиме снапшота указывает на бинарь) и сводят с трассой по
  `first-execution` функции `mark` и вехе `main:start`. Ленивая компиляция в главном
  потоке — `parse-function` + `interpreter` + `baseline` + `parse`; код, уходящий с пути
  старта, уносит и свою компиляцию — выигрыш переноса считать по обеим.

Устройство (реестр, маркер процессов, методы `Diode.*`) —
[docs/arch/DevTooling.md](../../../docs/arch/DevTooling.md#toolsdrive).
