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
  (двухпутёвая загрузка нативного аддона: dev / SEA-ассет), `shellIntegrationScripts.ts` (где скрипты shell
  integration на диске — [ниже](#shell-integration-инъекция)).
- **`contrib/terminal/common/`** — `terminalSessionFactory.ts` (DI-шов; в тестах `FakeTerminalSurface`),
  `xtermPalette.ts`, `defaultShell.ts`, переменные окружения расширений, `scripts/` (скрипты shell integration
  эталона). Порт `getShellIntegrationInjection` — `platform/terminal/node/terminalEnvironment.ts`.
- **`contrib/terminal/browser/`** — `terminalService.ts` (оркестратор инстансов: ленивый спавн, активный,
  закрытие, регистрация вкладки), `terminalPanelComponent.ts` + `terminalTabbedViewElement.ts` +
  `terminalTabsList.ts` (тело вкладки: терминал + список), `terminalEditorService.ts` /
  `terminalEditorPane.ts` (терминал вкладкой редактора), `terminalColorsService.ts`,
  `extensionTerminalAdapter.ts` (мост `window.createTerminal`), `terminalActions.ts`. Настройки —
  `workbench/common/configuration/terminalConfiguration.ts`.
- **Упаковка** — `scripts/pack-node-pty.mjs` → ассет `node-pty.bundle`, `scripts/pack-shell-integration.mjs` →
  `shell-integration.bundle`, встраивает основной
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

## Окружение процесса

`buildEnv` (`embeddedTerminalSession.ts`) повторяет `createTerminalEnvironment` эталона, слои по порядку:

1. унаследованный `process.env`, из него убраны переменные VS Code/Electron —
   `sanitizeProcessEnvironment` (`base/common/processes.ts`, шим эталона: `ELECTRON_*`, `VSCODE_*` кроме
   `PORTABLE`/`SHELL_LOGIN`/`ENV_*`, `SNAP*`, `GDK_PIXBUF_*`; `VSCODE_IPC_HOOK_CLI` сохраняется). diode,
   запущенный из терминала VS Code, не отдаёт шеллу его `VSCODE_*`;
2. `env` терминала (`null` снимает переменную) — после санитизации, явный `VSCODE_X` доходит;
3. коллекции `environmentVariableCollection` расширений; мутаторы с `applyAtShellIntegration` — ещё и в
   `VSCODE_ENV_REPLACE|PREPEND|APPEND`, их применит скрипт shell integration после rc-файлов
   ([Extensions.md](../Extensions.md));
4. `TERM_PROGRAM=vscode`, `TERM_PROGRAM_VERSION=<vscode.version>` (версия шима, не diode: потребители
   сравнивают её с версиями VS Code), `COLORTERM=truecolor` — CLI, узнающие IDE по `TERM_PROGRAM`, узнают
   diode как VS Code. Перекрывают и `env`, и коллекции;
5. наше: `TERM=xterm-256color`, без `TMUX`.

С `strictEnv` шагов 1, 3, 4 нет: окружение — ровно `env` (плюс `TERM`). Pty расширения процесса не имеет.
Нет `terminal.integrated.env.*` и `detectLocale` (`LANG`).

## Shell integration: инъекция

Шелл стартует со скриптом shell integration эталона — скрипт сам шлёт OSC 633 (начало промпта и ввода,
запуск и конец команды с кодом выхода, командная строка, cwd). Разбор — [ниже](#shell-integration-разбор-и-модель-команд),
API расширений — следующая issue волны (#1215).

- **Скрипты** — дословно из эталона, с шапкой лицензии: `contrib/terminal/common/scripts/` (зеркальный
  путь): `shellIntegration-bash.sh`, `-rc.zsh`, `-env.zsh`, `-profile.zsh`, `-login.zsh`, `shellIntegration.fish`,
  `shellIntegration.ps1`. Правка скрипта — отступление с обоснованием в PR. Каталог `psreadline/` эталона (PSReadLine
  2.4.3 для режима скринридера) не перенесён: `.ps1` берёт его только при `VSCODE_A11Y_MODE=1`, а его ставит лишь
  Windows-ветка эталона; без каталога скрипт его просто не находит (`Test-Path`).
- **Решение** — порт `getShellIntegrationInjection` (`platform/terminal/node/terminalEnvironment.ts`), с
  причинами отказа эталона: настройка выключена (`terminal.integrated.shellIntegration.enabled`, читается при
  каждом (пере)запуске) → нет исполняемого файла → терминал задачи (`isFeatureTerminal`, ставит
  `terminalTaskSystem`) → аргументы шелла не пустые и не login-набор (`-l`/`--login`, `-i` рядом
  допускается; у pwsh свои наборы, ниже) → шелл не bash/zsh/fish/pwsh по `basename` исполняемого файла (`warn` в
  лог `Terminal`). Pty расширения процесса не имеет — не
  затрагивается.
- **bash**: `--init-file <scripts>/shellIntegration-bash.sh`; login — `VSCODE_SHELL_LOGIN=1` (скрипт сам
  имитирует `-l`: `/etc/profile`, `~/.bash_profile`…); `VSCODE_STABLE=1`. Скрипт подключает `~/.bashrc` сам
  и снимает `VSCODE_INJECTION` — в живом bash переменной уже нет, видны функции `__vsc_*`.
- **zsh**: `ZDOTDIR=<realpath(tmpdir)>/<user>-diode-zsh` (`0o1700`, создаётся при отсутствии),
  `USER_ZDOTDIR` — `ZDOTDIR` окружения терминала, иначе `os.homedir()` процесса diode; четыре rc эталона
  копируются туда перед спавном (неудачная копия молча пропускается, как в эталоне), аргументы `-i`/`-il`.
  Отступление: эталон после **создания** каталога всё равно отвечает `failedToSetStickyBit`, и самый первый
  zsh стартует без интеграции; у нас созданный каталог используется. Нечитаемый tmp — отказ
  `failedToCreateTmpDir`, а не исключение.
- **fish**: `--init-command 'source "<scripts>/shellIntegration.fish"'` (путь в кавычках — каталог кэша с
  пробелами), login — `-l` первым; только `VSCODE_INJECTION=1`, `VSCODE_STABLE` эталон fish не ставит. Скрипт
  выполняется после `config.fish` и сам требует `TERM_PROGRAM=vscode` (`buildEnv`).
- **`VSCODE_PATH_PREFIX`** (эталонный `addEnvMixinPathPrefix`): склейка всех `Prepend` к `PATH` из коллекций
  расширений (`MergedEnvironmentVariableCollection.getPathPrefix` через `ITerminalEnvironmentContributor.pathPrefix`)
  — для fish всегда (`$fish_user_paths` встаёт перед `PATH`), для login bash/zsh только на macOS (`path_helper`);
  скрипт переприменяет префикс после профиля, `PATH` при этом дублируется, как в эталоне. Со `strictEnv` коллекций
  нет — нет и префикса. pwsh префикс не получает.
- **pwsh** (Linux/macOS): без аргументов или только `-nologo`/`-nol` — `-noexit -command '. "<scripts>/shellIntegration.ps1"'`;
  login (`-l`/`-login` один или рядом с `-nologo` в любом порядке) — то же с `-l` первым; иначе `unsupportedArgs`.
  `VSCODE_STABLE=1`. `$PROFILE` pwsh выполняет до `-command`. `pwsh.exe`/`powershell.exe` — Windows-ветки, не
  портированы.
- **Окружение**: `VSCODE_INJECTION=1` и остальное поверх `buildEnv` (после `TERM_PROGRAM`, со `strictEnv`
  тоже — как в эталоне); `VSCODE_NONCE` — свой на терминал (`EmbeddedTerminalSession`), один на все
  перезапуски, выставляется и без инъекции (его может взять своя интеграция расширения).
- **Где скрипты на диске** — `shellIntegrationScripts.ts`: в dev — исходники; в сборке — ассет
  `shell-integration.bundle` (`scripts/pack-shell-integration.mjs`, имена файлов без каталогов) распаковывается
  в `<userCacheDir>/shell-integration/<version>-<sha>` тем же `extractBundleToCacheSync`, что и node-pty
  (маркер `.diode-ready`, повторный запуск не пишет). Self-extract кладёт бандл рядом с `main.cjs`.
- **Окружение шелла** — `terminal.integrated.shellIntegration.environmentReporting` (дефолт `false`: эталонный
  `product.quality !== 'stable'`, мы стабильный канал; читается при (пере)запуске): включена — инъекция ставит
  `VSCODE_SHELL_ENV_REPORTING=PATH,VIRTUAL_ENV,HOME,SHELL,PWD`, и скрипт шлёт `EnvSingle*` на каждом промпте.
- Не сделано здесь: `VSCODE_PATH_PREFIX`, `ignoreShellIntegration`/
  `forceShellIntegration` (их никто не ставит), проброс эталоном своих же аргументов инъекции zsh/fish по
  идентичности массива (их сюда никто не возвращает), Windows-ветки.
- **Тесты на настоящих шеллах** (`embeddedTerminalSession.shellIntegration*.test.ts`, `e2e/sea-shellIntegration.test.ts`)
  без шелла на машине пропускаются; в CI zsh и fish ставит `apt-get`, pwsh есть в образе `ubuntu-latest`
  (шаг проверяет `command -v pwsh`).

## Shell integration: разбор и модель команд

Перенос эталона, зеркальные пути: `platform/terminal/common/xterm/shellIntegrationAddon.ts` (разбор) и
`platform/terminal/common/capabilities/` (модель). Аддон живёт в `XtermSurface` (`session.shellIntegration`) —
его получают и шелл, и pty расширения, который сам пишет 633 (как в эталоне). Nonce терминала (`VSCODE_NONCE`)
тоже у поверхности.

- **Разбор** — OSC-обработчики xterm: 633 (`A`/`B`/`C`/`D[;код]`/`E;<строка>[;nonce]`, `F`–`I`,
  `P;<ключ>=<значение>`, `EnvJson`, `EnvSingleStart/Entry/Delete/End`, `SetMark`), 133 (`A`–`D`), 7
  (`file://host/path`, percent-decoding), 1337 (`CurrentDir=`). Значения 633 — `deserializeVSCodeOscMessage`
  (`\\`, `\xAB`). Последовательности в кадр не печатаются. Неизвестный код 633/133/1337 и неизвестный ключ `P`
  — `false` (**отступление:** эталон на неизвестном `P` проваливается в `SetMark` и ставит метку).
- **Capabilities** — `TerminalCapabilityStore` (`onDidAddCapability`, `onDidAddCommandDetectionCapability`),
  ключи — имена (`commandDetection`, `cwdDetection`, `shellEnvDetection`), а не enum. Command detection
  появляется на первой «командной» последовательности (`A`–`I`, `P;IsWindows/HasRichCommandDetection/Prompt/
  ContinuationPrompt`) — это и есть «интеграция включилась», раз на процесс. Cwd без команд её не включает.
  Relaunch (`XtermSurface.relaunch`) снимает и выбрасывает все capabilities: новый процесс включает заново.
- **Команда** (`ITerminalCommand`, один объект от старта до конца): `E` даёт строку с `confidence: high`,
  `isTrusted` — nonce совпал. Без `E` строка читается из буфера от метки `B` до курсора на `C`: `medium`, если
  был `A` и `B` не в колонке 0, иначе `low`. `onCommandExecuted` — на `C`, один раз (повторный `C` молчит);
  `onCommandFinished` — на `D` с кодом (`D` без кода — `undefined`). `D` без `C` (пустой Enter, Ctrl+C) сперва
  запускает команду — у каждого конца есть старт, как в эталоне; без `B` команды нет. cwd команды — известный
  на `B`. `E` после `C` обновляет уже запущенную команду (как эталон — свою partial): fish 4 сам шлёт
  `133;C;cmdline_url=…` раньше `633;E` скрипта, и старт несёт строку из буфера, а конец — присланную. Скрипт
  fish 1.127.0 теряет nonce (`set -l` внутри `if`) — его команды недоверенные, как и в эталоне.
- **Вывод** — `shellIntegration.onDidWriteCommandOutput`: сырые куски данных процесса от `C` (сама
  последовательность — первым куском) до `D` (не входит). `feedOutput` режет чанк PTY по `C`/`D` и пишет куски
  в xterm по отдельности (эталонный `_onProcessData`); `C` запускает команду во время разбора своего куска, а
  кусок отдаётся после разбора — поэтому `C` в потоке есть; `D` заканчивает команду до отдачи своего куска —
  поэтому его нет. Последовательность, разрезанная между чанками, режется по чанку, как в эталоне. Куски не
  склеиваются: сотни КБ вывода — сотни событий, не квадратичная строка.
- **cwd** — `P;Cwd=` (доверенный при nonce; скрипты 1.127.0 шлют его без nonce — недоверенный, как в эталоне),
  OSC 7 и 1337 — всегда недоверенные; кавычки вокруг снимаются (`sanitizeCwd`). Ссылки в терминале резолвятся
  от него, когда он известен.
- **Окружение** — `EnvJson` целиком или `EnvSingle*` по переменной, изменение — одним событием в конце,
  `isTrusted` — все части с nonce.
- **Не перенесено** (служат UI и Windows): `promptInputModel`, `PartialCommandDetection`,
  `PromptTypeDetection`, `BufferMarkCapability` (`SetMark` принимается и игнорируется), эвристики Windows,
  OSC 9;9, метки на команду и `getCwdForLine`, сериализация, телеметрия и статус интеграции, `Prompt`/
  `ContinuationPrompt` (их потребитель — `promptInputModel`). 133;`B` не отличается от 633;`B` (эталон
  выбрасывает строку на конце команды).
- **Проверить руками** — Developer: Write Data to Terminal с `\x1b]633;D;1\x07` ничего не печатает; Developer:
  Record Terminal Session показывает, что последовательности приходят.

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
- Ширина списка меняется sash'ем — ниже, «Ширина списка вкладок». **Не поддержаны** ключи `tabs.showActions`, `tabs.title`/`description`/`separator` (нет трекинга процесса и
  cwd), `tabs.defaultIcon`/`defaultColor`, `tabs.enableAnimation`, `tabs.allowAgentCliTitle`,
  `confirmOnKill`.
- **Терминалы расширений** — те же инстансы сервиса: опции шелла расширения, фоновые инстансы для
  `hideFromUser`, `sendText` с нормализацией Enter, причина закрытия и код выхода — мост
  `ExtensionTerminalAdapter` ([../Extensions.md](../Extensions.md)).
- **Профили** — только шелл по умолчанию и профили расширений (`contributes.terminal.profiles`):
  **Terminal: Create New Terminal (With Profile)** (`newWithProfile`), реестр — `TerminalProfileService`
  ([../Extensions.md](../Extensions.md)). Не поддержаны `terminal.integrated.profiles.*`/`defaultProfile.*`,
  профили в выпадашке «+» и в меню пустого места списка вкладок.

### Ширина списка вкладок

Эталон — `SplitView` в `terminalTabbedView.ts` с `proportionalLayout: false`, размеры —
`TerminalTabsListSizes` (пиксели → ячейки по 8 px).

- Колонка `│` между терминалом и списком — `SashElement` (`TerminalTabbedViewElement`) с
  `restColorVar = "panel.border"`: в покое кадр тот же, при наведении — `sash.hoverBorder` после
  `workbench.sash.hoverDelay` (применяется живо), курсор `ew-resize`. Скрытый список прячет и sash.
- Протяжка левой кнопкой; ресайз панели меняет терминал, список держит ширину. Раскладка зажимает
  ширину (`terminalTabsColumns`) в [10, 62] и так, чтобы терминалу осталось ≥ 15; где 10 + 1 + 15 не
  помещается — не больше половины панели. Нижняя граница — эталонная `WideViewMinimumWidth`: узкого
  режима нет (трекер).
- Двойной клик по sash — ширина по самой широкой строке списка плюс колонка отступа
  (`TerminalTabsList.idealWidth`); уже такая — ничего (сжимать в узкий режим некуда).
- Ширина — `IStateService`, scope `global` (аналог `StorageScope.PROFILE`), ключи
  `terminal.tabs-list-width-horizontal` (терминал в панели) и `…-vertical` (в боковой или вторичной
  боковой); пишется на каждом изменении протяжкой или двойным кликом, без значения или с мусором — 20
  (`TERMINAL_TABS_WIDTH`, отступление от эталонных 120 px и narrow у вертикали). Хранится заданное
  пользователем, зажатие — только в раскладке. Ключ сверяется по `onDidChangeLocations` —
  его шлёт и стартовое восстановление расположения видов (`attachRegisteredContainers`): компонент
  терминала создаётся раньше.

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
  программа mouse-tracking (`mouseEventsActive`) — мышь её, ссылок нет. `terminalLinkService.ts` — декоратор
  поверхности (`ITerminalSurfaceDecorator`) в шве `TerminalWidgetFactoryDIToken`
  (`contrib/terminal/browser/terminalWidgetFactory.ts`): `createDecoratedTerminalWidget` оборачивает сессию
  цепочкой декораторов (ссылки, поверх них [выделение](#выделение-и-копирование)) и строит виджет над внешним; им
  пользуются и панель, и вкладка-терминал. `enableFileLinks` читается один раз на инстанс («только в новых
  терминалах»).
- Буфер для детектора — `ITerminalSession.buffer` (`common/terminalBuffer.ts`, структурное подмножество
  `IBuffer` xterm; есть у `XtermSurface`, у фейков — нет, и ссылок там нет). Декоратор обязан отдавать `buffer`
  внутренней поверхности наружу: по нему работает следующий в цепочке.
- **cwd для относительных путей** — cwd из shell integration (`cwdDetection`), пока его нет —
  `ITerminalSession.getCwd()`: `/proc/<pid>/cwd` шелла, иначе его начальный cwd, у pty расширения — `cwd`
  запуска; потом корни воркспейса.
- **Отступления.** cwd берётся текущий, а не на строку ссылки (эталонный `getCwdForLine` держит метки команд,
  их нет). Модификатор — всегда Ctrl (ключа `editor.multiCursorModifier` нет, Cmd до
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

## Выделение и копирование

Выделение `SelectionService` xterm.js (#1087, #1088), в `contrib/terminalContrib/selection/`:

- `common/terminalSelection.ts` — чистая модель: диапазон от нажатия до указателя в любую сторону (первая строка —
  до края, средние целиком, последняя — до указателя, ячейки включительно), начало на правой половине широкого
  символа берёт его целиком; текст — `translateToString` по строкам, soft wrap склеивается без `\n`, хвостовые
  пробелы и пустые ячейки отрезаются у каждой строки, NBSP → пробел. Якорь выделения словом или строкой — всё
  слово/строка (`anchorEnd`): голова до якоря берёт его конец, после — начало. `wordRangeAt` (`_getWordAt`) — слово
  до ближайшего разделителя из `terminal.integrated.wordSeparators` или края логической строки, сквозь soft wrap;
  правая половина широкого символа — часть слова, щель на краю строки от перенесённого широкого символа
  пропускается; ячейка, куда ничего не писали (`getChars() === ""`: справа от текста, щель от табуляции), — не
  слово и конец слова. `lineRangeAt` (`_selectLineAt`) — все строки логической строки от края до края.
- `browser/terminalSelectionSurface.ts` — декоратор поверх ссылок. Левое нажатие + протяжка выделяют, клик без
  протяжки (нажатие и отпускание в одной ячейке) снимает выделение и нового не делает. Номер клика в серии —
  `TerminalMouseEventData.detail` движка (`MouseEvent.detail`: та же кнопка в той же ячейке того же элемента за
  300 мс): 2 — слово (`SelectionMode.WORD`), 3 и больше — строка (`LINE`), протяжка дальше растёт целыми словами
  или строками; двойной клик там, где слова нет, — обычная протяжка от ячейки. С Ctrl слова нет: Ctrl+клик —
  ссылки. Shift+клик при выделении над шеллом (`_handleIncrementalClick`) переносит конец выделения в ячейку
  клика и тянет дальше по ячейкам от прежнего якоря; без выделения — обычный клик. Разделители читаются на
  каждом двойном клике — смена настройки действует сразу. `onDidFinishSelection` — жест мыши (отпускание протяжки,
  двойного/тройного клика, Shift+клика) или Select All оставил выделение: как `onSelectionChange` xterm, который
  стреляет на отпускании, а не на каждом шаге протяжки. События идут и дальше — в
  ссылки (Ctrl+клик открывает, Ctrl+протяжка выделяет). Программа включила mouse-tracking — мышь её (двойной и
  тройной клик тоже, с `detail`), выделяют только жесты с `Shift` — протяжка, двойной и тройной клик (как
  `shouldForceSelection` эталона; Shift+клик тут начинает новое выделение, а не продлевает), и ни одно событие
  такого жеста до программы не доходит. В `readCell` выделенные ячейки
  получают `terminal.selectionBackground` (без фокуса — `terminal.inactiveSelectionBackground`), полупрозрачный цвет
  композитится над фоном ячейки (`compositeOver`; для фона по умолчанию — `terminal.background` из var-scope
  виджета, так что и цвет хоста при `colorSource: "host"`); `terminal.selectionForeground` — только если задан.
  Цвета и фокус поверхность берёт у виджета (`attach`: `styleVar`, `isFocused`).
- Строки выделения — строки буфера, не экрана: колесо и новый вывод его не сдвигают. Когда скролбэк полон, xterm
  срезает строки сверху и номера сдвигаются — поэтому с выделением регистрируется маркер на строке курсора
  (`ITerminalBuffer.registerMarker`, `registerMarker(0)` xterm) и сдвиг берётся из его `line`; срезанное сверху
  выделение начинается с верха буфера, срезан сам маркер — выделение снято. Снимают выделение: ввод в шелл (`write`,
  как `onUserInput` xterm — и вставка), смена буфера на alternate (`ITerminalBuffer.type`), ресайз.
- Протяжка за верхний/нижний край виджета (виджет `capturesPointer`, события приходят и снаружи) крутит скролбэк
  таймером раз в 50 мс (`DRAG_SCROLL_INTERVAL` эталона) на столько строк, на сколько указатель за краем; конец
  выделения — начало верхней строки или конец нижней.
- `browser/terminalSelectionService.ts` — декоратор для фабрики + контрибьютор ключей: `terminalTextSelected` —
  выделение у активного терминала (`getActiveInstanceAcrossHosts`), `terminalTextSelectedInFocused` — у
  сфокусированного. Ключи ставятся и опросом, и сразу на смену выделения (как `onSelectionChange` эталона):
  команда, вызванная сразу после протяжки, их уже видит. `terminal.integrated.copyOnSelection` — на
  `onDidFinishSelection` текст уходит в `IClipboard` (как `TerminalClipboardContribution` эталона); простой клик,
  снявший выделение, буфер не трогает.
- `browser/terminalSelectionActions.ts`: `copySelection` (`Ctrl+Shift+C`), `copyAndClearSelection` (`Ctrl+C`),
  `selectAll` (без клавиши), `clearSelection` (`Escape` при `terminalFocus && terminalTextSelected`). Все четыре — в
  `DEFAULT_COMMANDS_TO_SKIP_SHELL`, поэтому с фокусом в терминале клавиша достаётся им; ложный `when` (нет
  выделения) — и `Ctrl+C`/`Escape` уходят в шелл. Копия — `IClipboard` (OSC 52), как у редактора.
- **Отступления.** `Ctrl+C` с выделением копирует и снимает его на всех платформах (в эталоне — только на Windows):
  `Ctrl+Shift+C` на tier `legacy` неотличим от `Ctrl+C`, а хост-терминалы обычно берут его себе. `terminalFocusInAny`
  и `terminalFindVisible` нет — `Escape` гейтится `terminalFocus` (он и так любой терминал: панель и вкладка). Цвет
  `terminal.inactiveSelectionBackground` — запечённый hex от дефолта `editor.selectionBackground` с альфой 0x80
  (выражений `transparent()` в реестре нет): тема, задавшая только `terminal.selectionBackground`, неактивный цвет
  не меняет. `selectionForeground` в hc эталона чёрный/белый, у нас hc-слотов нет — `null`. Выделение живёт в
  поверхности виджета: терминал, переехавший между панелью и вкладкой, начинает без выделения. Двойной клик по
  разделителю выделяет только его, по пустому месту — ничего (спека #1088; xterm берёт всю серию пробелов и
  соседние слова вокруг не-пробельного разделителя). Протяжка после Shift+клика идёт по ячейкам, а не в режиме
  прошлого жеста. `wordSeparators` пока влияет только на двойной клик: word-ссылок нет. Колоночного выделения,
  `copySelectionAsHtml`, `minimumContrastRatio`, `rightClickBehavior`, `macOptionClickForcesSelection`,
  `altClickMovesCursor` нет.

## Цвета

Токены `terminal.ansi*` (дефолты dark/light эталона) → `TerminalColorsService` → палитра сессии
(`setAnsiColors`: palette-индексы разворачиваются по `buildXtermPalette`) + фон/текст хоста в var-scope
виджета поверх `terminal.background/foreground`. Смена темы перекрашивает и уже выведенное (буфер хранит
индексы). **Отступление — `terminal.integrated.colorSource: "host"`**: цвета хост-терминала
спрашиваются один раз (`ITerminalBackend.probeHostColors` tuidom: OSC 10/11 + 16×OSC 4), неотвеченное
берётся из темы. Опрос — не раньше фазы `restored`, когда tty уже в raw-режиме: из конструктора сервиса
ответы печатались эхом на основной экран и оставались мусором в шелле (v0.9.0). Гейт —
`e2e/sea-terminalQueries.test.ts`.

## Команды разработчика

`contrib/terminalContrib/developer/` — две команды `terminal.developer.contribution.ts` эталона, чтобы
руками видеть байты, идущие через терминал (проверка волны shell integration, #1217):

- **Developer: Write Data to Terminal** (`workbench.action.terminal.writeDataToTerminal`) — строка из поля
  ввода (`\n`, `\r`, `\xHH`, остальное буквально) уходит в эмулятор активного терминала (`printMessage`), в
  процесс — нет. Нет терминала — создаётся в месте по умолчанию; терминал во вкладке редактора — вкладка
  показывается снова.
- **Developer: Record Terminal Session** (`workbench.action.terminal.recordSession`) — новый терминал и
  запись слева в статус-баре; события `resize` (сразу текущий размер, потом `onDidChangeDimensions`),
  `command` (`CommandRegistry.onWillExecuteCommand`), `output` (`onWillData` — сырой выход процесса до
  разбора, с escape-последовательностями), `sendText` (`onDidSendText`), `input` (`onDidWriteData` — ввод
  через эмулятор: клавиши, мышь, ответы эмулятора). Через 5 с тишины — `JSON.stringify(events, null, 2)` в
  буфер обмена. **Отступление:** `promptInputChange` нет — нет `promptInputModel`.

Свой текст (`printMessage`: сообщения, Write Data) — не выход процесса: `onWillData` и строки (`onLineData`)
его не видят. Остальные команды developer-контрибуции (`showTextureAtlas`, `restartPtyHost`, `devMode`) не
перенесены: им не на что действовать.
