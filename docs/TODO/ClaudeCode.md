# Интеграция с Claude Code: стоковое расширение в терминальном режиме

Статус: **в работе**. Пункты 1 и 2 сделаны: стоковое `Anthropic.claude-code`
2.1.300 активируется, поднимает MCP-сервер, `claude` из нижней панели видит IDE
(`CLAUDE_CODE_SSE_PORT`). Что осталось — сводный список «Осталось» ниже.

**Сделано (16.10.2026):**
- #627 — `window.setStatusBarMessage`, `env.shell`/`onDidChangeShell`/`machineId`,
  `NotebookCellOutputItem`, `comments` (инертный), события shell integration,
  дефолт `claudeCode.useTerminal`.
- #629 — `window.registerUriHandler`, событие `onUri`, `Developer: Open URL`,
  настройка `extensions.confirmedUriHandlerExtensionIds`.
- #631 — `ExtensionContext.environmentVariableCollection`: коллекции всех
  расширений в окружении каждого процесса терминала, хранение в состоянии
  воркспейса.
- #630 — встроенный терминал снова открывается при запуске из исходников
  (нашлось по ходу живой проверки).

Как сейчас выглядит: «✻ Claude Code» в статус-баре (и палитра `Claude Code:
Open in Terminal`) открывает `claude` в **нижней панели** TERMINAL — `location`
терминала мы пока выбрасываем.

## Осталось (19.10.2026)

Сводка открытых пунктов; подробности — в разделах ниже.

1. **Живая проверка контекста.** API под `selection_changed`/`at_mentioned`
   есть (`onDidChangeTextEditorSelection`, `activeTextEditor`, ключ
   `editorTextFocus` для `Alt+K`/`Ctrl+Alt+K`), но что `claude` реально
   получает выделение и открытый файл, вживую не проверено — до сих пор
   смотрели только подключение (`/ide`).
2. **Терминал вкладкой в области редакторов** (`TerminalLocation.Editor`,
   `ViewColumn.Beside`) — сейчас `location` выбрасывается, `claude`
   открывается в нижней панели. См. «Раскладка».
3. **When-ключи `config.*`** — без них мёртв `Ctrl+Esc`
   (`claude-vscode.terminal.open.keyboard`) и кнопка в заголовке редактора.
4. **Точка меню `editor/title`** — кнопка Claude у вкладок и accept/reject диффа.
5. **Предложенный дифф** (пункт 3): запись в ФС провайдера расширения и
   редактируемый документ на чужой схеме, `tabGroups` с `TabInputTextDiff` и
   закрытием дифф-вкладки.
6. **Диагностики** (пункт 4): `languages.getDiagnostics`,
   `onDidChangeDiagnostics` — обратный путь из `MarkerService` в субпроцесс.
7. **Магазин и стоковый e2e**: запись `Anthropic.claude-code` в реестр
   (платформенные vsix), стоковый сценарий через `fetchStockVsix`.
8. **Стоковые тесты терминала**: Code Runner, direnv, сьют по образцу
   Terminals Manager (пункт 2).
9. **`claude` во вторичной боковой панели** — сама панель влита (#649, #654,
   #660, #661: Secondary Side Bar, перенос видов, живые терминал/Output/Problems
   на новом месте). Осталось проверить вживую `claude` в терминале,
   перенесённом вправо: ширина, фокус, ввод, переживание перезапуска.
10. Открытый вопрос: обрезка сообщений `setStatusBarMessage` в статус-баре
    (отложено).
11. Поправить устаревшее в VISION.md (раздел в конце).

Родственные документы:
[VISION.md](../VISION.md) (направления B и C), [IntegratedTerminal.md](IntegratedTerminal.md),
[DiffEditable.md](DiffEditable.md), [Marketplace.md](Marketplace.md),
матрица [API-COVERAGE.md](../public/API-COVERAGE.md).

## Решение

Из четырёх вариантов (терминал с `claude` в сайдбаре; стоковое расширение;
своя чат-панель поверх `claude -p --input-format stream-json`; свой MCP-сервер +
хуки) берём **стоковое расширение `Anthropic.claude-code` в режиме
`claudeCode.useTerminal`**. Почему:

- Расширение лежит в OpenVSX (легальный для нас источник), версии в лок-степе с
  CLI, внутри свой бинарник CLI. Пользователь ставит его из магазина как любое
  другое; мы ничего не бандлим.
- В терминальном режиме `ide`-MCP-сервер (WebSocket, лок-файл
  `~/.claude/ide/<port>.lock`) хостит **само расширение**, CLI к нему
  подключается. Закрытый протокол реализован их кодом — мы его не реверсим, а
  только даём расширению API VS Code. Принцип VISION «не реверсим закрытые
  протоколы» соблюдён.
- Авторизация — пользовательский `claude` с его подпиской. Стены «третьим лицам
  нельзя предлагать вход claude.ai» нет, потому что вход предлагаем не мы.
- Своя чат-панель отвергнута: гонка с UX харнесса, серая зона авторизации, и
  главное — Claude Code сам уже TUI, «нативный UI» и «терминальный режим» у нас
  совпадают.

Что даёт терминальный режим (сверено с бандлом 2.1.283 и живым VS Code):
выделение и открытый файл уходят в CLI (`selection_changed`, `at_mentioned`,
Alt+K), диагностики по запросу (`getDiagnostics`), `openFile`, а правки при
запросе разрешения открываются **дифф-вкладкой** через `vscode.diff` с
accept/reject — инлайн-предложения в стиле Copilot есть только у webview-режима,
который в TUI невозможен. Условия на стороне CLI: `/config` → «Diff tool» =
`auto` (пункт виден только при подключённой IDE), режим разрешений `default`
(в accept-edits/bypass дифф не показывается), подключение проверяется `/ide`.

## Проба 30.09.2026

`Anthropic.claude-code@2.1.283` поставлен через `--install-extension` в
scratch-профиль; недостающие члены API подложены полифилами в копию
`extension.js` (репозиторий не трогался). Результат: расширение активируется,
поднимает `ide`-сервер, пишет лок с `ideName: "Diode"`; интерактивный `claude`
с `CLAUDE_CODE_SSE_PORT=<port>` подключается («New WS connection», «Registered
diagnostic client»). Белого списка имён IDE в CLI нет: валидация — совпадение
порта из окружения с локом либо `pid` лока в предках процесса `claude`. В `-p`
режиме CLI к IDE не подключается вовсе (только интерактив).

Порядок падений до полифилов: `NotebookCellOutputItem.error(...).mime` на
верхнем уровне модуля (10 вызовов, без него модуль не грузится) →
`window.registerUriHandler` → `context.extension.packageJSON` →
`context.environmentVariableCollection`. Webview-члены гасятся нашим no-op.
Нюансы пробы: стек ошибки активации теряется на RPC (`rpcEndpoint.ts` шлёт
только `message`); esbuild-экспорты расширения через геттеры, так что
`module.exports.activate = …` молча игнорируется.

## Фронт работ

### 1. Мелочи (разблокируют активацию)

Сверено с бандлом 2.1.300 (15.10.2026): к списку пробы добавились
`onDidChangeTerminalShellIntegration` (ждёт 3 с и уходит в `sendText`),
`comments.createCommentController` (тред на каждый ханк диффа — лениво, на
первом диффе), `languages.getDiagnostics`/`onDidChangeDiagnostics`.

- [x] `NotebookCellOutputItem` — эталонный класс со всеми статиками и нормализацией mime.
- [x] `window.setStatusBarMessage` — эталонный общий пункт полосы со стеком сообщений.
- [x] `comments.createCommentController` — декларации подняты, рантайм инертный
      (тред с эталонными дефолтами, строка в Output); enum'ы — значения.
- [x] Shell integration: три события `window` валидные и молчат,
      `Terminal.shellIntegration` — `undefined` (контракт «не активировалась»).
- [x] `ExtensionContext.extension` — был сделан раньше.
- [x] `env.shell` (шелл встроенного терминала), `env.onDidChangeShell`,
      `env.machineId` (sha256 MAC, кэш `telemetry.machineId` в application-состоянии)
      — семенем `env.initialize` до первой активации.
- [x] Дефолт `claudeCode.useTerminal = true` курируемой инъекцией; id в
      `curatedConfigInjection` теперь сравнивается без учёта регистра.
- [x] `window.registerUriHandler` — настоящий, по эталону (`ExtHostUrls` +
      `ExtensionUrlHandler`): обработчик по `diode://<publisher.name>/…`, буфер
      до активации и `onUri:<id>`, вопрос человеку с доверием через
      `extensions.confirmedUriHandlerExtensionIds`, источник — `Developer: Open URL`
      (`workbench.action.url.openUrl`). Без галочки «больше не спрашивать» и без
      установки отсутствующего расширения (отступления — в матрице). Протокол ОС
      и `--open-url` не подключены: у TUI нет регистрации `diode://` в системе.
- [ ] Запись `Anthropic.claude-code` в реестр магазина (платформенные vsix,
      ~120 МБ — лимиты валидатора см. [JavaLSP.md](JavaLSP.md)). Без неё
      стоковый e2e-сценарий не скачать через `fetchStockVsix`.
- [x] Матрица API-COVERAGE обновлена.

### 2. Терминал для расширений (крупное)

RPC-мост хост↔субпроцесс поверх `TerminalService` сделан — и для шеллов, и для
pty расширения (устройство — docs/arch/Extensions.md, «Терминалы расширений»).

- [x] `window.createTerminal(options)`: `name`, `cwd`, `env` (`null` снимает),
      `strictEnv`, `shellPath`/`shellArgs`, `hideFromUser`, `message`;
      `location`/`color`/`isTransient` принимаются и игнорируются — терминал
      всегда в панели, рядом с шеллами человека в списке вкладок.
- [x] `Terminal.show`/`hide`/`sendText`/`dispose`, `processId`, `exitStatus`,
      `onDidCloseTerminal`, `onDidOpenTerminal`, `onDidChangeActiveTerminal`,
      `window.terminals` (все терминалы, как в эталоне), `window.activeTerminal`.
- [x] `ExtensionTerminalOptions.pty` (`Pseudoterminal`): эмулятор на хосте, байты по
      проводу — лог BJLS у bazel-java. Не поддержаны `onDidOverrideDimensions`,
      `onDidChangeName`; `open` получает начальный размер, настоящий — следом.
- [x] `ExtensionContext.environmentVariableCollection`: коллекции всех расширений
      вливаются в окружение **каждого** нашего терминала (так `claude`, набранный
      руками в нижней панели, тоже увидит IDE через `CLAUDE_CODE_SSE_PORT` —
      проверено вживую на 2.1.300). Сохранение между запусками, `strictEnv`,
      область папки — как у эталона; отступления — в матрице.
- [ ] Shell integration не делаем: у расширения фоллбэк на `sendText` через 2 с.
      События `onDidChangeTerminalShellIntegration`/`onDidStart…`/`onDidEnd…`
      — no-op-события. Link/profile-провайдеры — «позже».
- [ ] Стоковые тесты (все из OpenVSX): демо-сценарий на **Code Runner**
      (`formulahendry.code-runner`, `runInTerminal: true`: `createTerminal`,
      `sendText`, `show`, `onDidCloseTerminal`) и **direnv** (`mkhl.direnv` —
      единственный потребитель `environmentVariableCollection`; нужен бинарник
      `direnv`); герметичный юнит-сьют на опции `createTerminal` по образцу
      **Terminals Manager** (`fabiospampinato.vscode-terminals`: `name`, `cwd`,
      `env`, `shellPath`, `window.terminals`, `exitStatus`). Jest Runner
      (`firsttris.vscode-jest-runner`) — переиспользование терминала,
      `processId`. `ms-python.python` («Run Python File in Terminal», venv через
      коллекцию) — потом, как реальную выплату пользователям.

### 3. Предложенный дифф (крупное)

`openDiff` расширения: правая сторона кладётся в его файловую систему со
схемой `_claude_vscode_fs_right`, открывается `vscode.diff(left, right, title,
{preview: false})`, дальше гонка трёх исходов — команда accept/reject, закрытие
вкладки (= reject), сохранение документа (= FILE_SAVED с текстом правой
стороны, которую пользователь мог править).

- [ ] `registerFileSystemProvider` с записью и **редактируемым** документом на
      чужой схеме (сейчас только читающая часть; `onDidChangeTextDocument`,
      `onWillSaveTextDocument` уже есть).
- [ ] `tabGroups` с `TabInputTextDiff` и отслеживанием закрытия дифф-вкладки
      (сейчас снимки без гарантии идентичности); расширение опрашивает
      `tabGroups.all`.
- [ ] Вклад `editor/title` из `contributes.menus` с `when`
      `claude-vscode.viewingProposedDiff` — кнопки accept/reject у вкладки
      (`setContext` есть). Минимум — команды в палитре.
- [ ] Перехват команды `type`/`default:type` расширение делает в try/catch —
      допустимо не поддерживать.

### 4. Диагностики

- [ ] `languages.getDiagnostics(uri?)` и `onDidChangeDiagnostics` — обратный
      путь из `MarkerService` в субпроцесс (сейчас диагностики идут только
      субпроцесс → хост). Без этого инструмент `getDiagnostics` у Claude пуст.

### Раскладка — Claude вкладкой справа (разведка 16.10.2026)

Как делает стоковое расширение (2.1.289/2.1.300):
- Правая (вторая) боковая панель у него только для **webview** — нативного
  чата (`secondarySidebar` → `claudeVSCodeSidebarSecondary`). В режиме
  `useTerminal` терминала в боковой панели нет.
- Все точки входа режима терминала зовут `claude-vscode.terminal.open`, а тот —
  `createTerminal({ name: "Claude Code", location: { viewColumn: ViewColumn.Beside },
  isTransient: true, … })`: **терминал-вкладка в области редакторов, в группе
  справа**. Это и есть «правая панель» в VS Code. Вариант «window» —
  `ViewColumn.One` + `moveEditorToNewWindow` (для TUI не нужен).
- Точки входа: пункт статус-бара «✻ Claude Code»; кнопка в заголовке
  редактора (`editor/title`, `when: config.claudeCode.useTerminal`);
  `Ctrl+Esc` → `claude-vscode.terminal.open.keyboard` (тот же `when`);
  палитра. Свой терминал через `tabGroups`/`TabInputTerminal` не ищет.

Что есть у нас:
- `TerminalOptions.location` в d.ts поднят, но в рантайме выбрасывается —
  терминал всегда в панели (`terminalNamespace.ts`).
- Вкладки редактора подключаемые (`IEditorPane` + `IEditorPaneFactory`:
  текст, дифф, Keyboard Shortcuts, страница расширения); `TerminalViewElement(session)`
  самостоятельный; `terminalFocus` считается по типу элемента в фокусе; группы
  и `ViewColumn.Beside` для `showTextDocument` есть.
- When-ключей `config.*` нет (проверено вживую: `config.claudeCode.useTerminal`
  — `false` при включённой настройке) → мертвы `Ctrl+Esc` и кнопка в заголовке.
- Точки меню `editor/title` нет («неизвестная точка меню»), панели действий
  справа от вкладок — тоже.

План, по убыванию пользы:
- [ ] **Терминал вкладкой в области редакторов** (`TerminalLocation.Editor`,
      `{ viewColumn }`, `{ parentTerminal }`): `location` по проводу на хост;
      у инстанса `TerminalService` место «панель/редактор» (в
      `window.terminals` — оба, в списке панели — только панельные);
      `TerminalEditorPane` (`vscode-terminal:/<id>`, метка — имя терминала,
      закрыть вкладку = убить процесс, выход процесса закрывает вкладку,
      `show()` — показать вкладку, фабрика singleton, `isTransient` — без
      рестора); `Beside` — группа правее активной (нет — сплит), `One` — первая.
      Проверить клавиши области редакторов внутри терминала (`Ctrl+W`,
      `Ctrl+Tab`). Побочно — эталонные `Terminal: Create New Terminal in Editor
      Area` / `Move Terminal into Editor Area`.
- [ ] **When-ключи `config.*`** (`ConfigurationContextKeys` эталона) —
      оживляет `Ctrl+Esc` и пригодится всем расширениям.
- [ ] **Точка меню `editor/title`**: панель действий справа от вкладок
      группы, `MenuId.EditorTitle`, группа `navigation`; SVG-иконку в TUI не
      нарисовать — фоллбэк на кодикон или заголовок. Тот же вклад нужен
      пункту 3 (кнопки accept/reject диффа).
- [x] Настоящая правая боковая панель с переносом видов (Terminal) —
      задача [SecondarySideBar](SecondarySideBar.md), стек #649/#654/#660/#661.
      Расширение само её не использует; она — чтобы
      держать терминал с `claude` справа рядом со сплитом из первого пункта,
      не трогая область редакторов.

## Порядок

1 + 2 — сделаны. Дальше живая проверка контекста, раскладка (терминал
вкладкой справа → `config.*` → `editor/title`), затем 3, затем 4.

## Устаревшее в VISION.md

Раздел «Ограничения реальности» писался до этой пробы: «дослать ход в
запущенный `claude -p` нельзя» — теперь есть `--input-format stream-json`;
«`ide`-протокол закрыт» — верно, но реализация есть в OpenVSX-расширении, и её
можно исполнять у нас. Поправить при следующей правке VISION.
