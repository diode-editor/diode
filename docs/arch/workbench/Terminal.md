# Встроенный терминал

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).
Открытое — [../../TODO/IntegratedTerminal.md](../../TODO/IntegratedTerminal.md).

Аналог integrated terminal VS Code: вкладка **TERMINAL** в нижней панели (всегда есть, «No active
terminal.» до первого открытия), несколько терминалов со списком вкладок, терминалы вкладками в области
редакторов, терминалы расширений и задач.

## Где что лежит

- **Виджет (tuidom)** — `@tuidom/elements/terminal/`: `ITerminalSurface` (абстрактная cell-модель —
  шов, чтобы движок не знал про PTY и эмулятор), `TerminalViewElement` (рендерит поверхность,
  пробрасывает ввод, мышь, ресайз), энкодер «клавиша → байты PTY».
- **`contrib/terminal/node/`** — `embeddedTerminalSession.ts` (реализация `ITerminalSurface`: node-pty +
  `xtermSurface.ts` поверх `@xterm/headless`), `extensionPtySession.ts` (pty расширения), `loadNodePty.ts`
  (двухпутёвая загрузка нативного аддона: dev / SEA-ассет).
- **`contrib/terminal/common/`** — `terminalSessionFactory.ts` (DI-шов; в тестах `FakeTerminalSurface`),
  `xtermPalette.ts`, `defaultShell.ts`, переменные окружения расширений.
- **`contrib/terminal/browser/`** — `terminalService.ts` (оркестратор инстансов: ленивый спавн, активный,
  закрытие, регистрация вкладки), `terminalPanelComponent.ts` + `terminalTabbedViewElement.ts` +
  `terminalTabsList.ts` (тело вкладки: терминал + список), `terminalEditorService.ts` /
  `terminalEditorPane.ts` (терминал вкладкой редактора), `terminalColorsService.ts`,
  `extensionTerminalAdapter.ts` (мост `window.createTerminal`), `terminalActions.ts`. Настройки —
  `workbench/common/configuration/terminalConfiguration.ts`.
- **Упаковка** — `scripts/pack-node-pty.mjs` → ассет `node-pty.bundle`, встраивает основной
  `scripts/build-sea.mjs`. Демо-песочница — `src/demos/terminal/terminalHost.ts` (`npm run demo:terminal`).

## Однопанельный in-process tmux

Настоящий терминал = реальный PTY + VT-эмулятор + рендер — то же, что tmux-сервер, но в одном процессе:

| tmux | Diode |
|---|---|
| `forkpty()` + master fd — настоящий TTY (`isatty`, job control, сигналы) | **node-pty** (`pty.spawn`) |
| per-pane VT-эмулятор — парсит вывод в сетку ячеек | **@xterm/headless** (`terminal.buffer.active`) |
| сервер считает дифф экрана → клиент рисует | `TerminalViewElement` → `RenderContext.setCell` |
| клиент шлёт клавиши в master PTY | энкодер клавиш → `pty.write` |
| `TIOCSWINSZ` + SIGWINCH | `pty.resize()` в `performLayout` контрола |

- Виджет рендерит **только** через `ITerminalSurface`, поэтому импорты `@xterm/headless`/`node-pty` не
  протекают ниже workbench, а виджет тестируется скриптованной поверхностью.
- **Нативность node-pty неизбежна**: PTY — объект ядра (`posix_openpt`/`forkpty`); хаки через `script`/
  `socat` непортабельны. @xterm/headless — чистый JS.
- **`term.write()` асинхронный** — `emitUpdate` только в его колбэке, иначе картинка отстаёт на событие.
- `@xterm/headless` — CJS: под нативным ESM-загрузчиком named-import не работает → значения из `default`
  пространства имён `import()` + `import type`. Сам пакет — ленивый кусок бандла (`loadXterm()`,
  [../Common.md](../Common.md)): вывод до загрузки копится в очереди.
- Truecolor `getFgColor()` — уже `0xRRGGBB` (наш `packRgb`), default — `-1`, palette — индекс в
  `xtermPalette.ts`; `isBold()` и т.п. возвращают число.
- **Мышь** — через приватный `terminal._core.coreMouseService.triggerMouseEvent(...)`: эмулятор сам
  решает по режиму программы и кодирует (X10/SGR) — работает в htop/vim/tmux.
- **Toggle Terminal** (Ctrl+`) однозначно кодируется только на tier `csi-u`/`kitty` (в legacy это NUL =
  Ctrl+Space), legacy-бинда нет — вход через палитру. e2e открывают терминал тир-независимо: View-меню
  (Alt+V) → Command Palette → Toggle Terminal.
- Фокус и жизненный цикл панели (фокус на скрытом или умершем терминале, Toggle после смерти шелла,
  персист активной вкладки) — `PanelFocusContribution`, шов `ITerminalFocusFallback`, состояние вьюпорта
  (скролбэк) — в `ITerminalSurface`.

## Упаковка нативного: embed + runtime-extract

node-pty на Unix — `pty.node` + бинарь `spawn-helper` (нужен только на macOS, guard `__APPLE__`).
Нативные артефакты вшиваются в SEA ассетом `node-pty.bundle` (формат `diode.bundle`: magic+header+data),
на первом запуске распаковываются в `<userCacheDir>/node-pty/<version>-<sha>` (`packagedAsset.ts` +
`extractBundleToCacheSync`, маркер `.diode-ready`) и грузятся через `createRequire` — `process.dlopen`
требует файл на диске. Модель «один файл» ценой записи в кэш на первом запуске. Упаковщик повторяет
резолв самого node-pty (`build/Release` → `prebuilds/<platform>-<arch>`, `.pdb` отсекается): на macOS
едет `spawn-helper` (экстрактор ставит `+x`), на Windows — ConPTY-комплект целиком. Отвергнуто: sidecar
(как VS Code — ломает «один файл»), компиляция на install (берём prebuilt). SEA пер-платформенный по
природе: кросс-компиляции у Node SEA нет, сборка — на каждой ОС.

## Несколько терминалов

Форма эталонная (`terminalTabbedView.ts`, `terminalTabsList.ts`):

- Тело вкладки — терминал плюс список сбоку (`tabs.location`, справа), скрыт по `tabs.hideCondition`
  (пока терминал один). Заголовок вкладки — имя активного терминала (`tabs.showActiveTerminal`), клик —
  меню `MenuId.TerminalTabContext`; при `tabs.enabled: false` — дропдаун `N: имя`. Кнопки New/Kill —
  пункты `ViewTitle`.
- Список: клик и стрелки делают терминал активным без кражи фокуса, Enter и двойной клик фокусируют
  (`tabs.focusMode`), Delete — `killActiveTab`.
- Kill и выход шелла — активным становится сосед с тем же индексом (`removeGroup` эталона); последний
  закрытый прячет панель (`hideOnLastClosed`). Имя — `basename` шелла, без дедупликации, как у эталона.
- Групп (сплитов) нет: группа эталона здесь — один терминал (`singleGroup` = `singleTerminal`).
- Ширина списка фиксирована (`TERMINAL_TABS_WIDTH`), узкого иконочного режима и sash'а нет. **Не
  поддержаны** ключи `tabs.showActions`, `tabs.title`/`description`/`separator` (нет трекинга процесса и
  cwd), `tabs.defaultIcon`/`defaultColor`, `tabs.enableAnimation`, `tabs.allowAgentCliTitle`,
  `confirmOnKill`.
- **Терминалы расширений** — те же инстансы сервиса: опции шелла расширения, фоновые инстансы для
  `hideFromUser`, `sendText` с нормализацией Enter, причина закрытия и код выхода — мост
  `ExtensionTerminalAdapter` ([../Extensions.md](../Extensions.md)).

## Терминал в области редакторов (`TerminalLocation.Editor`)

Как `TerminalEditorService` + `TerminalEditorInput` эталона: так стоковый Claude Code открывает `claude`
справа (`viewColumn: Beside`).

- Место инстанса — `ITerminalInstance.target` (`panel`/`editor`); редакторные — отдельным списком: вид
  TERMINAL их не видит, активным терминалом они не становятся; `moveToEditor`/`moveToPanel` переселяют
  инстанс без процесса.
- Вкладка — `TerminalEditorPane` (ресурс `vscode-terminal:/<id>`, метка — имя терминала, цвета панели).
  Колонка — `columnToEditorGroup`, общий с `showTextDocument`. Жизни связаны: закрыли вкладку — процесс
  убит; процесс вышел — вкладка закрыта. Сплит и копия вкладки заводят НОВЫЙ шелл; рестарт вкладка не
  переживает.
- Клавиши: `Ctrl+W` во вкладке-терминале закрывает её (`terminalEditorFocus`), в виде TERMINAL уходит
  шеллу; `focusNext`/`focusPrevious` терминалов — только в виде.
- `terminal.integrated.defaultLocation` (`view`/`editor`) — куда ставят New Terminal и `createTerminal`
  без `location`. **Отступления:** вкладка-терминал не становится активным терминалом, нет
  `confirmOnKill`, иконки терминала на вкладке, окон.

## Терминал задачи

Как `TerminalInstance` эталона: `waitOnExit` (процесс вышел — инстанс остаётся, сообщение о коде и текст
ожидания, любая клавиша закрывает), `onDidExitInstance` (выход процесса раньше снятия инстанса — по нему
кончается задача), `relaunchInstance` (`reuseTerminal`: новый процесс в том же эмуляторе, вывод прежнего
выше или стёрт при `clear`). Перезапускается только ждущий инстанс.

## Цвета

Токены `terminal.ansi*` (дефолты dark/light эталона) → `TerminalColorsService` → палитра сессии
(`setAnsiColors`: palette-индексы разворачиваются по `buildXtermPalette`) + фон/текст хоста в var-scope
виджета поверх `terminal.background/foreground`. Смена темы перекрашивает и уже выведенное (буфер хранит
индексы). **Отступление — `terminal.integrated.colorSource: "host"`**: цвета хост-терминала
спрашиваются один раз (`ITerminalBackend.probeHostColors` tuidom: OSC 10/11 + 16×OSC 4), неотвеченное
берётся из темы. Опрос — не раньше фазы `restored`, когда tty уже в raw-режиме: из конструктора сервиса
ответы печатались эхом на основной экран и оставались мусором в шелле (v0.9.0). Гейт —
`e2e/sea-terminalQueries.test.ts`.
