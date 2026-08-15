# Integrated Terminal

Встроенный терминал (аналог integrated terminal в VS Code): панель, в которой крутится
интерактивный шелл. Статус: **интегрировано**. Вкладка **TERMINAL** в нижней Panel (всегда
присутствует, placeholder «No active terminal.» до первого открытия), сервис
`TerminalService` + view-владелец `TerminalPanelComponent` (Workbench), команды
`workbench.action.terminal.toggleTerminal` / `…terminal.new`,
SEA-упаковка нативного node-pty — в **основном** пайплайне сборки (`npm run build:sea`).
Остаётся кросс-платформенность и UX-надстройки (см. «Дальнейшие шаги»).

> Найденные e2e-тестированием дефекты (фокус на скрытом/умершем терминале, Toggle Terminal
> после смерти шелла, скролл колесом) вынесены в отдельную задачу —
> [TerminalPanelBugs.md](TerminalPanelBugs.md).

## Где что лежит

- **TUIDom (чистый слой)** — `tuidom/ui/terminal/`:
  - `ITerminalSurface.ts` — абстрактная cell-модель терминала (шов, чтобы TUIDom не знал про PTY/эмулятор).
  - `TerminalViewElement.ts` — виджет-«клиент»: рендерит `ITerminalSurface`, пробрасывает ввод/мышь/ресайз.
  - `encodeKeyForPty.ts` — чистая функция «клавиша → байты PTY».
- **Workbench (glue с нативом)** — `src/vs/workbench/Services/Terminal/`:
  - `EmbeddedTerminalSession.ts` — реализация `ITerminalSurface`: node-pty + `@xterm/headless` (in-process «tmux»).
  - `TerminalSessionFactory.ts` — DI-шов (`TerminalSessionFactoryDIToken`); в тестах — `FakeTerminalSurface`.
  - `loadNodePty.ts` — двухпутёвая загрузка нативного аддона (dev / SEA-ассет).
  - `xtermPalette.ts` — palette-индекс xterm → `0xRRGGBB`.
  - `TerminalService.ts` — headless-оркестратор: список инстансов, ленивый спавн, регистрация вкладки TERMINAL в `PanelService`.
  - `TerminalPanelComponent.ts` (в `src/vs/workbench/Components/Panel/`) — виджеты `TerminalViewElement` по инстансам, вкидывание активного в вкладку.
- **Упаковка** — `scripts/pack-node-pty.mjs` (пакует рантайм-раскладку node-pty в ассет `node-pty.bundle`),
  встраивается основным `scripts/build-sea.mjs`.
- **Демо-песочница** — `src/demos/terminal/terminalHost.ts` (`npm run demo:terminal`) — потребляет те же
  интегрированные модули.
- **E2E-скриншот-сценарий** — `e2e/scenarios/terminal.scenario.ts`.

## Архитектура — однопанельный in-process tmux

Настоящий терминал = связка «реальный PTY + VT-эмулятор + рендер». Мы собираем то же, что делает
tmux-сервер, но в одном процессе:

| tmux | Diode |
|---|---|
| `forkpty()` + master fd — ядро выдаёт настоящий TTY (`isatty`, job control, сигналы) | **node-pty** (`pty.spawn`) |
| per-pane VT-эмулятор (`grid`) — парсит вывод программы в сетку ячеек | **@xterm/headless** (`Terminal`, читаем `terminal.buffer.active`) |
| сервер считает дифф экрана → клиент рисует | `TerminalViewElement` → `RenderContext.setCell` → наш double-buffer `TerminalRenderer` |
| клиент шлёт клавиши в master PTY | `encodeKeyForPty` → `pty.write` |
| `ioctl(TIOCSWINSZ)` + SIGWINCH при ресайзе | `pty.resize()` в `performLayout` контрола |

Ключевой шов — `ITerminalSurface`: `TerminalViewElement` (TUIDom) рендерит **только** через него и
ничего не знает про PTY/эмулятор, а реальная связка (`EmbeddedTerminalSession`) реализует поверхность
уровнем выше, в Workbench. Поэтому под `src/vs/base/browser/` не протекают импорты `@xterm/headless`/`node-pty`,
а виджет тестируется скриптованным `FakeTerminalSurface`. Реализовано в контроле: ввод (энкодер клавиш),
**мышь** (проброс в `coreMouseService` эмулятора — работает в htop/vim/tmux, когда программа включила
mouse-tracking), цвета (truecolor/palette/default), стили, wide-chars, курсор, ресайз. Важный нюанс:
`term.write()` асинхронный — `emitUpdate` дёргается в его колбэке, иначе картинка отстаёт на одно событие.

Интерактивность берётся из **реального PTY** (ядро), а не из либы. Поэтому нативность node-pty
неизбежна: PTY — объект ядра (`posix_openpt`/`forkpty`), доступен только нативным кодом. Чисто-JS
пути нет (хаки через системный `script`/`socat` непортабельны — отвергнуты). @xterm/headless, наоборот,
чистый JS без нативного кода.

## Решение по упаковке (ADR) — embed + runtime-extract

node-pty на Unix — это `pty.node` (нативный аддон) + бинарь `spawn-helper`. Для single-executable
(`build:sea`) вопрос не «нативный ли», а «как везём нативные файлы».

**Зафиксировано и реализовано: embed + runtime-extract.** Нативные артефакты вшиваются
в SEA как ассет `node-pty.bundle` (тот же формат, что `diode.bundle` — magic+header+data, см.
`Common/Assets/` и `scripts/pack-assets.mjs`); на первом запуске распаковываются в
`os.tmpdir()/diode-embedded-pty-<size>/` и грузятся через `createRequire` (нативный `.node` требует
файл на диске для `process.dlopen`). Сохраняет модель «один файл» ценой записи в tmp на первом
запуске; повторные запуски переиспользуют распакованное (маркер `.diode-ready`).

Реализация:
- `src/vs/workbench/contrib/terminal/node/loadNodePty.ts` — dev: `require("node-pty")`; SEA: `sea.getAsset` → распаковка → `createRequire`.
- `scripts/pack-node-pty.mjs` — пакует `package.json` + рантайм-JS (`lib/**`) + нативы (`build/Release/*`)
  в ассет `node-pty.bundle`; виртуальные пути с префиксом `node-pty/` совпадают с ожиданиями `loadNodePty.ts`.
- **Основной** `scripts/build-sea.mjs` встраивает `node-pty.bundle` рядом с `diode.bundle` в один бинарь
  `dist/diode` (отдельного `build:sea:terminal` больше нет). На macOS он же делает codesign бинаря.
- Проверено на linux-x64: `spawn-helper` не нужен (guard `__APPLE__` в `pty.cc`), достаточно
  `build/Release/pty.node` + `lib/**` + `package.json`.

Альтернативы (для протокола):
- **Sidecar** (как VS Code — нативные файлы рядом с бинарём): надёжно, но ломает «один файл».
- Компиляция на install отвергнута в пользу prebuilt: под платформы берём бинарники CI-матрицей
  либо prebuilt-форком `@homebridge/node-pty-prebuilt-multiarch` (уже предложен в `E2E.md`).

## Как запустить / проверить

- **dev** (быстрее итерировать): `npm run demo:terminal` — `tsx`, node-pty/@xterm/headless из node_modules;
  демо потребляет интегрированные модули (`EmbeddedTerminalSession` + `TerminalViewElement`).
- **приложение**: `npm start` → Toggle Terminal (Ctrl+` на tier `kitty`/`csi-u`, иначе палитра команд →
  «Terminal: Toggle Terminal») открывает вкладку TERMINAL и лениво спавнит шелл в папке воркспейса.
- **SEA** (один бинарь): `npm run build:sea` → `./dist/diode`.
- **e2e-скриншот**: `e2e/scenarios/terminal.scenario.ts` (в `npm run test:e2e` и `npm run screenshots`) —
  гоняет настоящий бинарь headless, открывает терминал через палитру команд (в legacy-tier `Ctrl+``/`Ctrl+Shift+P`
  не кодируются, поэтому вход через меню View → Command Palette), печатает `echo` и ждёт вывод в шелле.
  Юнит/интеграция — `TerminalService.test.ts`, `TerminalPanelComponent.test.ts`, `Workbench.Terminal.test.ts`,
  `EmbeddedTerminalSession.test.ts`, `TerminalViewElement.*.test.ts`, `encodeKeyForPty.test.ts`.

## Кросс-платформенность и тестирование

Интеграция и упаковка проверены **только на linux-x64**. Риск делится на две части:

**Переносимо «бесплатно» (чистый JS, одинаково везде):** @xterm/headless (эмуляция, буфер,
mouse-энкодер), наш рендер/цвета/стили/wide-chars/курсор, `encodeKeyForPty`, проброс мыши,
механизм распаковки (`os.tmpdir()` + `createRequire`; `chmod +x` на Windows — безвредный no-op).

**Требует работы и проверки на целевой ОС — PTY и упаковка:**
- **SEA пер-платформенный по природе** — нативный код вшивается под конкретную ОС/арх; билд гоняется
  на каждой цели (CI-матрица `ubuntu/macos/windows`), кросс-компиляции у Node SEA нет.
- **Упаковщик нативы берёт везде, но проверен только на Linux.** `scripts/pack-node-pty.mjs`
  повторяет резолв самого node-pty (`lib/utils.js`: `build/Release` → `prebuilds/<platform>-<arch>`)
  и пакует оба каталога, какие есть. На Linux это скомпилированный на install `build/Release/pty.node`;
  на macOS/Windows install кладёт готовые `prebuilds/<platform>-<arch>` прямо из npm-пакета
  (`.pdb` отсекаем — это виндовые debug-символы на десятки МБ). Что уезжает в бандл по факту:
  - **macOS**: `pty.node` **+ `spawn-helper`** (на Mac реально используется — guard `__APPLE__`);
    экстрактор (`loadNodePty.ts`) ставит ему `+x`. Codesign самого бинаря в `build-sea.mjs` уже есть,
    но **распакованный в tmp `pty.node` под Gatekeeper не проверялся**.
  - **Windows**: ConPTY-комплект целиком (`pty.node`, `conpty.node`, `conpty_console_list.node`,
    `winpty-agent.exe`, `winpty.dll` + папка `conpty/` с `OpenConsole.exe`/`conpty.dll`).
  Итог: сборка на всех трёх ОС проходит, но **живой шелл на macOS/Windows не проверялся**
  (e2e-сценарий там пропускается) — нужен прогон харнесса на `macos-latest`/`windows-latest`.
- **Рантайм node-pty отличается:**
  - **дефолтный шелл**: сейчас `SHELL ?? "bash"` — на Windows `SHELL` пуст → упадёт; нужно
    `win32 → COMSPEC/powershell`.
  - **ConPTY-причуды** (уже задокументированы в `e2e/helpers/runDiode.ts`): инъекции очищающих
    последовательностей при resize, `onExit` может не срабатывать, иной kill — проверить resize-путь на Win.
  - мелочи: Backspace `\x7f` vs `\b` на cmd.

**Как тестировать без своего Mac:** вся верификация **headless-драйвится** (PTY-харнесс на `AnsiScreen`,
без GUI), поэтому те же проверки один-в-один переносятся на **GitHub Actions `macos-latest`** (реальное
Apple-железо, лицензионно чисто; Apple Silicon). Локальная Mac-VM на Windows — нельзя (Apple SLA + x86 не
виртуализирует Apple Silicon). Для «пощупать руками» — почасовая аренда реального Mac (AWS EC2 Mac,
Scaleway, MacStadium, MacinCloud). Windows тестируется локально (`prebuilds/win32-x64` подтянется на install).

## Ключевые технические выводы (сводка)

- Настоящий PTY невозможен без нативного кода (объект ядра); tmux — тот же паттерн на C.
  Выбор не «нативный/нет», а «как упаковать нативное».
- xterm truecolor `getFgColor()` = уже `0xRRGGBB` (= наш `packRgb`); default = `-1` (= `DEFAULT_COLOR`);
  palette = индекс → таблица `xtermPalette.ts`. `isBold()` и т.п. возвращают число (по truthiness).
- `@xterm/headless` — CJS: под нативным ESM-загрузчиком (tsx/esm) named-import **не работает** в
  рантайме → default-import значения + `import type` для типов.
- **`term.write()` асинхронный** → `emitUpdate` только в его колбэке (иначе лаг на одно событие).
- Мышь — через приватный `terminal._core.coreMouseService.triggerMouseEvent(...)`: сам решает по
  активному режиму программы и кодирует (X10/SGR) → уходит в PTY через `term.onData`.
- linux-x64: `spawn-helper` не нужен (guard `__APPLE__`); node-addon-api — build-time, в рантайме не тянется.
- Toggle Terminal: только tier `csi-u`/`kitty` однозначно кодирует Ctrl+` (в legacy это NUL = Ctrl+Space),
  поэтому legacy-бинда нет — вход через палитру команд.

## Дальнейшие шаги

- **Кросс-платформенная упаковка + CI-матрица**: `pack-node-pty.mjs` берёт `build/Release/*` **и**
  `prebuilds/<platform>-<arch>/*` (spawn-helper для macOS; ConPTY-набор для Windows); выбор дефолтного
  шелла по ОС (`win32 → COMSPEC/powershell`); GitHub Actions workflow `ubuntu/macos/windows` (сборка SEA +
  прогон headless-харнесса), проверка resize-пути ConPTY на Windows.
- **UX шелла**: скролбэк/выделение/копирование, кликабельные ссылки, bracketed-paste.
- **Multiple-terminals UI**: контроллер уже держит список инстансов — добавить список/дропдаун переключения
  и Kill Terminal (сейчас доступен только «активный» + `terminal.new`).
- **Тема-реактивная ANSI-палитра**: `xtermPalette.ts` статичен; палитру 16/256 брать из активной темы
  (`terminal.ansi*`) и рефлоу при смене темы (сейчас реактивны только `terminal.background/foreground`).
- **Проброс клавиш à la `terminal.integrated.commandsToSkipShell`**: список команд, которые перехватывает
  редактор, а остальное уходит в шелл (сейчас фокус в терминале съедает почти весь ввод).
