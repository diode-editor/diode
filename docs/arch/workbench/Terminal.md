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
  без `location`. Вкладка — свой хост активного терминала: активный редактор-терминал становится
  `activeTerminal` для расширений ([Extensions.md](../Extensions.md)), активный инстанс вида TERMINAL
  он не меняет. **Отступления:** нет `confirmOnKill`, иконки терминала на вкладке, окон.

## Клавиши в фокусе терминала

Как `attachCustomKeyEventHandler` эталона (`terminalInstance.ts`): в фокусе терминала (вид или вкладка)
клавиша — шелла, редактор забирает только своё. `TerminalKeyRouting`
(`contrib/terminal/browser/terminalKeyRouting.ts`) ставит хук `isKeyForFocusedWidget` диспетчера
([Commands.md](Commands.md)); диспетчер спрашивает его вне аккорда, передав `softResolveKey` — что
клавиша сделала бы. Порядок:

1. идёт аккорд или клавиша его начинает (`allowChords`, не Escape) → редактору;
2. `sendKeybindingsToShell` выключен, бинд найден и (Meta **или** команда в skip-наборе) → редактору;
3. `allowMnemonics`, клавиатура не Mac, зажат Alt → редактору (мнемоники меню);
4. иначе шеллу — если терминал её кодирует. Отданную терминалу клавишу не видят и мнемоники.

Skip-набор — `DEFAULT_COMMANDS_TO_SKIP_SHELL` эталона вместе с командами `terminalContrib`
(`common/configuration/terminalCommandsToSkipShell.ts`, дословно, включая id, которых у нас нет) ±
`terminal.integrated.commandsToSkipShell` (`-<id>` убирает). Настройки применяются на лету.
**Отступление:** к набору добавлен наш `notifications.focusMessage` — у эталона F6 это `focusNextPart` из
набора, а у нас F6 — единственный путь с клавиатуры к кнопкам тоста-вопроса (#856).
**Отступление:** в наборе и `workbench.view.explorer`/`search`/`scm` (Ctrl+Shift+E/F/G). В легаси их терминал не
кодирует, и они всплывают к редактору — у эталона тоже; но под kitty-протоколом они кодируются в `CSI u`, и эталон
отдал бы их программе. У нас они остаются редактору в обоих режимах (#857).
**Отступление:** xterm.js нет — «терминал не кодирует» значит `TerminalViewElement.encodeKey(event) === ""`
(tuidom, `encodeKeyForPty` в режиме DECCKM поверхности): такая клавиша (Ctrl+, , Ctrl+Shift+буква, Meta+стрелка)
достаётся бинду редактора, как всплывший из xterm keydown. Сама кодировка — легаси xterm.js
`evaluateKeyboardEvent` (#856): Shift+Tab → `CSI Z`, модификаторы в `CSI 1;<mod>X` у стрелок/Home/End/F-клавиш,
F1–F12, в режиме application cursor keys (`XtermSurface.applicationCursorKeys` ← `term.modes`) голые стрелки —
`SS3`.

**Kitty keyboard protocol** (#857, `terminal.integrated.enableKittyKeyboardProtocol`, по умолчанию включён, как у
эталона). Программа включает его сама (`CSI > flags u`), и пока флаги ненулевые, `encodeKeyForPty` кодирует
перенос xterm.js `KittyKeyboard.evaluate` (tuidom `encodeKittyKey`): Shift+Enter → `CSI 13;2u`, Ctrl+I →
`CSI 105;5u`; с флагом 2 виджет шлёт и отпускание — если хост доставил `keyup`, то есть внешний терминал сам
говорит по kitty, и только для клавиши, чьё нажатие ушло в PTY: отпускание префикса аккорда (Ctrl+K) или
шортката редактора программа не видит, как и у эталона. Повтора (`:2`) нет: у `TUIKeyboardEvent` нет признака повтора, повтор уходит как нажатие.
**Отступление:** `@xterm/headless` 6.0 протокола не знает, а в 6.1-beta флаги лежат только в приватном `_core`;
поэтому состояние ведёт `XtermSurface` (`common/kittyKeyboardState.ts`) через публичные `parser.registerCsiHandler`
(`CSI = / ? / > / < u`, DECSTR) и `registerEscHandler` (RIS), экран — по `buffer.onBufferChange`. Семантика —
xterm.js `InputHandler.kittyKeyboard*`: свой стек у main и alt (до 16, старейший вытесняется), `CSI ? u` отвечает
`CSI ? flags u` во ввод pty, RIS и DECSTR сбрасывают всё. Настройка меняется на живых терминалах
(`TerminalService` → `session.setKittyKeyboardEnabled`); выключили — последовательности игнорируются без ответа,
флаги сброшены. Выйдет стабильная 6.1 с флагами в публичном API — перейти на `vtExtensions.kittyKeyboard`.
Нет `TabFocus`-режима и Alt+F4 на Windows.

## Терминал задачи

Как `TerminalInstance` эталона: `waitOnExit` (процесс вышел — инстанс остаётся, сообщение о коде и текст
ожидания, любая клавиша закрывает), `onDidExitInstance` (выход процесса раньше снятия инстанса — по нему
кончается задача), `relaunchInstance` (`reuseTerminal`: новый процесс в том же эмуляторе, вывод прежнего
выше или стёрт при `clear`). Перезапускается только ждущий инстанс.

## Ссылки на файлы

Как `terminalContrib/links` эталона, только локальные пути (URL, word-ссылок, OSC 8 и
`registerTerminalLinkProvider` нет). Живёт в `contrib/terminalContrib/links/`:

- `common/terminalLinkParsing.ts` + тесты — шим эталона дословно (суффиксы `:line:col`, `(line, col)`,
  `", line N"` и т. д.); `terminalLinkHelpers.ts` — перевод строковых индексов в ячейки с учётом wide-символов
  и переносов; `terminalLocalLinkDetector.ts` — кандидаты из wrapped-строки, `fallbackMatchers`, лимиты
  эталона; `terminalLinkResolver.ts` — `stat` через `IFileService` с кэшем на 10 с (ключ — абсолютный путь,
  не текст: тот же `x.ts` после `cd` — другой файл); `terminalLinkProvider.ts` — склейка wrapped-строк вокруг
  строки буфера.
- `browser/terminalLinkSurface.ts` — декоратор `ITerminalSurface` между сессией и виджетом: мышь с Ctrl
  подчёркивает ссылку (`StyleFlags.Underline` в `readCell`, цвет не трогает), Ctrl+клик левой открывает
  (`terminalLinkOpener.ts`: файл — `openUri` + позиция из суффикса, папка воркспейса — Explorer). Включила
  программа mouse-tracking (`mouseEventsActive`) — мышь её, ссылок нет. `terminalLinkService.ts` строит виджет
  через шов `TerminalWidgetFactoryDIToken` (`contrib/terminal/browser/terminalWidgetFactory.ts`) — им пользуются
  и панель, и вкладка-терминал; `enableFileLinks` читается один раз на инстанс («только в новых терминалах»).
- Буфер для детектора — `ITerminalSession.buffer` (`common/terminalBuffer.ts`, структурное подмножество
  `IBuffer` xterm; есть у `XtermSurface`, у фейков — нет, и ссылок там нет).
- **Отступления.** cwd для относительных путей — не shell integration (её нет), а
  `ITerminalSession.getCwd()`: `/proc/<pid>/cwd` шелла, иначе его начальный cwd, у pty расширения — `cwd`
  запуска; потом корни воркспейса. Модификатор — всегда Ctrl (ключа `editor.multiCursorModifier` нет, Cmd до
  нас в отчёте мыши не доходит), подсказки «Follow link» нет. Папка вне воркспейса — не ссылка. Прохода по
  атрибутам ячеек (`getXtermRangesByAttr`) нет. Голый Ctrl — не событие мыши: нажатие и отпускание без
  движения видны только на tier `kitty` (keydown/keyup `Control`), на остальных подчёркивание следует за
  Ctrl-битом следующего движения мыши.

### Open Detected Link (`Ctrl+Shift+O`)

С клавиатуры ссылки открываются quick pick'ом эталона (`terminalLinkQuickpick.ts` + `terminalLinkActions.ts`,
#817) — нужно там, где хост-терминал съедает Ctrl+клик:

- `workbench.action.terminal.openDetectedLink` — `Ctrl+Shift+O` при `terminalFocus` (вес `WorkbenchContrib + 1`),
  `enablement: terminalHasBeenCreated` (ключ эталона, ставит `TerminalService`: выданный id = терминал был).
  Цель — `getActiveInstanceAcrossHosts()`: терминал панели или вкладки, что активировали или сфокусировали последним (фокус виджета — `host.onDidFocusInstance` эталона: `setFocusedPanelInstance` / `setActiveEditorInstance`).
  `workbench.action.terminal.openFileLink` («Open Last Local File Link») — без клавиши и без списка.
- Сбор — `common/terminalDetectedLinks.ts` по `TerminalLinkManager.getLinks` эталона: видимая область снизу
  вверх (ссылки строки — справа налево), затем ниже неё и выше неё. Одна ссылка — один раз, хотя её отдаёт каждая
  строка wrapped-строки. «Последняя» ссылка — первая ссылка самой нижней строки со ссылкой на файл, поиск от конца
  буфера до верха вьюпорта, скролбэк выше вьюпорта не смотрится (как `openRecentLink` эталона).
- Список: метка — `basename` + суффикс `:row[-rowEnd][:col[-colEnd]]`, описание — каталог относительно папки
  воркспейса (вне её — абсолютный), дубли по «метка + каталог» схлопнуты. Активный пункт подчёркнут
  в терминале (`TerminalLinkSurface.setRevealedLink`, отдельно от Ctrl-наведения) и, если вне экрана, прокручен на
  четверть вьюпорта от верха (`revealRange` эталона; для этого у `ITerminalBuffer` есть `rows`). Закрытие —
  Enter или Escape — возвращает прокрутку (`scrollOffset`) и снимает подчёркивание; Enter открывает ссылку тем же
  `TerminalLinkOpener`, что и Ctrl+клик, в микрозадаче — остаток Enter не уходит в шелл.
- **Отступления.** Разделителей в нашем пикере нет — «File»/«Folder» стоят подсказкой на первой строке группы
  (как у задач). Сначала всегда только видимая область, весь буфер — с первым вводом (эталон ждёт весь буфер до
  500 мс и, если успел, показывает сразу его). Активный файл не открывается превью в редакторе
  (`PickerEditorState` эталона). URL, word-ссылок и accessible view (`Ctrl+Shift+G`) нет. На tier `legacy`
  `Ctrl+Shift+O` неотличим от `Ctrl+O` (у bash — operate-and-get-next), поэтому бинд гейтится `kitty`/`csi-u`, а
  там команда — из палитры.

## Цвета

Токены `terminal.ansi*` (дефолты dark/light эталона) → `TerminalColorsService` → палитра сессии
(`setAnsiColors`: palette-индексы разворачиваются по `buildXtermPalette`) + фон/текст хоста в var-scope
виджета поверх `terminal.background/foreground`. Смена темы перекрашивает и уже выведенное (буфер хранит
индексы). **Отступление — `terminal.integrated.colorSource: "host"`**: цвета хост-терминала
спрашиваются один раз (`ITerminalBackend.probeHostColors` tuidom: OSC 10/11 + 16×OSC 4), неотвеченное
берётся из темы. Опрос — не раньше фазы `restored`, когда tty уже в raw-режиме: из конструктора сервиса
ответы печатались эхом на основной экран и оставались мусором в шелле (v0.9.0). Гейт —
`e2e/sea-terminalQueries.test.ts`.
