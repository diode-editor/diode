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
Open in Terminal`) открывает `claude` **вкладкой редактора в группе справа**,
как в VS Code (`location: { viewColumn: Beside }`, проверено вживую на
2.1.304). `Ctrl+Esc` и кнопка в заголовке редактора пока мертвы — пункты 3–4.

## Осталось (19.10.2026)

Сводка открытых пунктов; подробности — в разделах ниже.

1. [x] **Живая проверка контекста** (19.10.2026, 2.1.303) — подробности в
   «Живая проверка контекста» ниже. Нашёлся блокер: без
   `languages.onDidChangeDiagnostics` расширение рвало каждое подключение CLI,
   и `claude` не получал от IDE ничего; закрыт вместе с пунктом 6. Вторая
   дыра — нет события выделения при возврате на вкладку — закрыта следом.
   Теперь `selection_changed` (и на смене вкладки), `at_mentioned`
   (`Ctrl+Alt+K`) и `getDiagnostics` доходят. Глазами в настоящем `claude`
   («что выделено?») — за человеком: агенту запуск вложенного `claude`
   запрещён.
2. ~~**Терминал вкладкой в области редакторов**~~ — сделано: `location`
   терминала (`TerminalLocation.Editor`, `{ viewColumn }`, `{ parentTerminal }`),
   `claude` открывается вкладкой справа. См. «Раскладка».
3. ~~**When-ключи `config.*`**~~ — сделано: `Ctrl+Esc`
   (`claude-vscode.terminal.open.keyboard`) жив — в kitty/csi-u, в legacy это Esc.
4. ~~**Точка меню `editor/title`**~~ — сделано: панель действий справа от
   вкладок; accept/reject диффа — кнопки ✓/↺, `Open in Terminal` (SVG-иконка) —
   в «⋯».
5. [x] **Предложенный дифф** (20.10.2026, 2.1.304) — подробности в «3.
   Предложенный дифф» ниже. `openDiff` открывает дифф-вкладку с ✓/↺; все
   исходы доходят до CLI: сохранение (с правками человека) и ✓ — `FILE_SAVED`,
   ↺ и закрытие вкладки — `DIFF_REJECTED`; `close_tab`/`closeAllDiffTabs`
   закрывают без диалога. Глазами в настоящем `claude` — за человеком.
6. [x] **Диагностики** (пункт 4): `languages.getDiagnostics`,
   `onDidChangeDiagnostics` — обратный путь из `MarkerService` в субпроцесс.
7. [x] **Магазин и стоковый e2e** (20.10.2026): запись
   `Anthropic.claude-code@2.1.304` в реестре (сайт#20; шесть платформенных vsix,
   `engines.diode >=0.9.5`, `support: partial`). В `limits` предложенный дифф —
   отдельным пунктом «Proposed edits are not shown as a diff tab…»: закрыв
   пункт 5, его снять (и сказать о вкладке в `works`/readme). Тесты ставят
   расширение по id из магазина: смоук в `e2e/marketplace/checks.ts`, e2e
   `claudeCode.test.ts` (лок, MCP, выделение, `Ctrl+Alt+K`, `getDiagnostics`,
   `openDiff` — ✓/↺, правка + Ctrl+S, Ctrl+W,
   вкладка `claude` справа, `CLAUDE_CODE_SSE_PORT` в терминале панели),
   сценарий `claude-code`. Вместо CLI — пробный клиент и подставной `claude`
   (docs/TESTING.md, «Claude Code без настоящего CLI»).
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
выделение и открытый файл уходят в CLI (`selection_changed`, `at_mentioned`
по `Ctrl+Alt+K`), диагностики по запросу (`getDiagnostics`), `openFile`, а правки при
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
- [x] Запись `Anthropic.claude-code` в реестр магазина (платформенные vsix,
      125–138 МБ — в лимите 256 МиБ валидатора и клиента) — пункт 7 сводки.
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

Сверено с бандлом 2.1.304 (20.10.2026): в терминальном режиме (MCP-инструмент
`openDiff`) схемы — `_claude_fs_left`/`_claude_fs_right` (`_claude_vscode_fs_*`
— путь webview-чата), ключ — `claude-code.viewingProposedDiff`, команды —
`claude-code.{accept,reject}ProposedDiff`. Левая сторона — файл с диска (у
грязного буфера — копия с диска в `_claude_fs_left`), сохранение принимается
только при `files.autoSave === "off"`, `close_tab` CLI сначала сохраняет
правую сторону (`TextDocument.save()`), потом `tabGroups.close`.

- [x] `registerFileSystemProvider` с записью и **редактируемым** документом на
      чужой схеме: `writeFile`/`stat` через хост, `isReadonly`, ресурс пишущей
      схемы — живая сторона диффа под своим uri (правка, сохранение с
      will-save, перечитка по `onDidChangeFile`); `openTextDocument` по схеме
      провайдера; настоящий `TextDocument.save()`. Устройство —
      [docs/arch/Extensions.md](../arch/Extensions.md), «Провайдеры ФС
      расширений».
- [x] `tabGroups` с `TabInputTextDiff` и закрытием дифф-вкладки — уже было;
      идентичность `Tab` расширению не нужна (сравнивает `input.modified` по
      строке, закрывает устаревшим `Tab` — адрес `(groupId, uri)` живой).
      Не хватало другого: стороны диффа не были `visibleTextEditors`, и ключ
      `claude-code.viewingProposedDiff` не зажигался — теперь стороны-модели
      видимой дифф-вкладки видимы, как два редактора диффа эталона.
- [x] Настройка `files.autoSave` (дословно эталон, действует только `off`) —
      без неё расширение не считало сохранение принятием.
- [x] Вклад `editor/title` из `contributes.menus` с `when`
      `claude-vscode.viewingProposedDiff` — кнопки accept/reject у вкладки
      (`setContext` есть) — см. «Раскладка».
- [ ] Перехват команды `type`/`default:type` расширение делает в try/catch —
      допустимо не поддерживать.
- [ ] `comments.createCommentController` (треды на ханках) — у нас инертный
      (#627), диффу не мешает; тредов в диффе нет.

Проверка: стоковый кейс `openDiff` в e2e `claudeCode.test.ts`, e2e-сценарий
`proposed-diff` (фикстурное расширение `proposed-diff-demo` повторяет `openDiff` 2.1.304: провайдер, гонка исходов,
ключ по видимости) и вживую на стоковом vsix пробным WebSocket-клиентом к
ide-серверу (как в «Живой проверке контекста»): `openDiff` → правка правой
стороны + Ctrl+S → `FILE_SAVED` с правленым текстом; ✓ → `FILE_SAVED`; ↺ и
Ctrl+W → `DIFF_REJECTED`; `close_tab`/`closeAllDiffTabs` → вкладка закрыта
без диалога, ключ гаснет.

### 4. Диагностики

- [x] `languages.getDiagnostics(uri?)` и `onDidChangeDiagnostics` — обратный
      путь из `MarkerService` в субпроцесс (`DiagnosticsCustomer`, зеркало
      чужих маркеров в субпроцессе; устройство — docs/arch/Extensions.md,
      «Сток диагностик»). Оказался блокером всего контекста: 2.1.303 на каждом
      подключении CLI подписывается на `onDidChangeDiagnostics`
      (`DiagnosticStreamManager.startStreaming`), исключение уходит в
      `.catch` подключения, и тот закрывает сокет — `/ide` видит IDE, но ни
      выделения, ни at-mention не приходит. Вживую: инструмент `getDiagnostics`
      отдаёт ошибки TypeScript, `diagnostics_changed` приходит на правку.

### Живая проверка контекста (19.10.2026)

Стенд: `npm run drive` из ветки, `Anthropic.claude-code@2.1.303`
(linux-x64 vsix из OpenVSX, `--install <vsix>` — в реестре магазина его нет,
пункт 7). Вместо CLI к ide-серверу подключался пробный WebSocket-клиент
(порт и `authToken` из `~/.claude/ide/<port>.lock`, заголовок
`x-claude-code-ide-authorization`, MCP `initialize`), который пишет каждое
уведомление сервера, — так видны точные полезные нагрузки. Сервер держит
одного клиента: новое подключение выбивает прежнее (проба и `claude`
одновременно не живут).

- **Выделение** — работает: Shift+стрелки в редакторе → через 300 мс
  (дебаунс расширения) `selection_changed` с текстом, `filePath`/`fileUrl` и
  диапазоном. На подключении расширение через 500 мс досылает последнее
  известное выделение.
- **Открытый файл** — работает через то же событие: `selection_changed` с
  пустым выделением и путём файла приходит на любое движение каретки (клик в
  файле). Своего слушателя `onDidChangeActiveTextEditor` у расширения нет.
  При возврате на вкладку с сохранённым выделением эталон шлёт
  `onDidChangeTextEditorSelection` (курсор восстанавливается `restoreState`,
  `CursorsController.restoreState` → `MainThreadTextEditor`); у нас этого не
  было, и `claude` думал, что открыт прошлый файл, пока каретка не сдвинется.
  Починено: субпроцесс шлёт событие, когда вкладка становится видимой с
  выделением не в 1:1 (в активной группе — после смены активного редактора,
  иначе фильтр расширения `textEditor === activeTextEditor` его отбросит).
  Проверено вживую: возврат на вкладку → `selection_changed` с её выделением.
  У свежеоткрытого файла (каретка в 1:1) события нет и в эталоне; смена фокуса
  между видимыми группами — тоже не событие.
- **At-mention** — в 2.1.303 у терминального CLI это **`Ctrl+Alt+K`**
  (`claude-code.insertAtMentioned`, `when: editorTextFocus`): `at_mentioned`
  с `filePath` и `lineStart`/`lineEnd` (0-based) выделения, без выделения —
  только файл. Работает. **`Alt+K`** (`claude-vscode.insertAtMention`) — путь
  webview-чата: ищет видимую панель чата, иначе открывает
  `claude-vscode.editor.openLast` → `createWebviewPanel` (у нас no-op с
  предупреждением в канале Extensions). Так устроено само расширение, у VS
  Code в терминальном режиме `Alt+K` тоже уходит в webview; к `config.*`
  (пункт 3) отношения не имеет, оба кейбиндинга — только `editorTextFocus`.
- **Настоящий `claude`** в терминале diode агентом не запускался (в его
  сессии запуск вложенного агента запрещён); проверка «выдели строки — спроси
  claude, что выделено» — руками: `claude` в TERMINAL, `/ide` → Diode,
  выделить строки, спросить.

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
- [x] **Терминал вкладкой в области редакторов** (`TerminalLocation.Editor`,
      `{ viewColumn }`, `{ parentTerminal }`) — устройство в
      [IntegratedTerminal.md](IntegratedTerminal.md#терминал-в-области-редакторов-terminallocationeditor);
      вживую: «✻ Claude Code» → `claude` вкладкой справа, `Ctrl+W` закрывает
      вкладку с процессом. Исходный план: `location` по проводу на хост;
      у инстанса `TerminalService` место «панель/редактор» (в
      `window.terminals` — оба, в списке панели — только панельные);
      `TerminalEditorPane` (`vscode-terminal:/<id>`, метка — имя терминала,
      закрыть вкладку = убить процесс, выход процесса закрывает вкладку,
      `show()` — показать вкладку, фабрика singleton, `isTransient` — без
      рестора); `Beside` — группа правее активной (нет — сплит), `One` — первая.
      Проверить клавиши области редакторов внутри терминала (`Ctrl+W`,
      `Ctrl+Tab`). Побочно — эталонные `Terminal: Create New Terminal in Editor
      Area` / `Move Terminal into Editor Area`.
- [x] **When-ключи `config.*`** (`ConfigAwareContextValuesContainer` эталона)
      — [WhenContext.md](WhenContext.md); `Ctrl+Esc` жив, и больше не срабатывают
      ветки `!config.claudeCode.useTerminal` (фокус несуществующего webview).
- [x] **Точка меню `editor/title`**: панель действий справа от вкладок
      группы, `MenuId.EditorTitle` — [Workbench.md](../arch/Workbench.md),
      «`EditorTitle` — панель действий группы». Иконка `$(codicon)` команды —
      кнопка (accept/reject диффа: ✓/↺, видны по
      `claude-vscode.viewingProposedDiff`); SVG-иконку не нарисовать — пункт
      уходит подписью в «⋯» (правило заголовков view: кнопкой — только пункт с
      иконкой), так `Claude Code: Open in Terminal` открывается из «⋯».
- [ ] **SVG-иконки команд** (`icon: { light, dark }` или путь к `.svg`):
      сейчас такой пункт `navigation` уходит в «⋯» — решение принято как
      временное, «Open in Terminal» Claude Code должен стать кнопкой. Варианты:
      свой глиф для известных команд, растр SVG в символ (kitty graphics /
      sixel — только где терминал умеет), короткая текстовая кнопка.
- [x] Настоящая правая боковая панель с переносом видов (Terminal) —
      задача [SecondarySideBar](SecondarySideBar.md), стек #649/#654/#660/#661.
      Расширение само её не использует; она — чтобы
      держать терминал с `claude` справа рядом со сплитом из первого пункта,
      не трогая область редакторов.

## Порядок

1 + 2 — сделаны; 4 — сделан по ходу живой проверки контекста (был её
блокером). Раскладка (терминал вкладкой справа → `config.*` →
`editor/title`) сделана (#675, #676 и PR панели действий), от неё остались
SVG-иконки команд. Дальше 3.

## Устаревшее в VISION.md

Раздел «Ограничения реальности» писался до этой пробы: «дослать ход в
запущенный `claude -p` нельзя» — теперь есть `--input-format stream-json`;
«`ide`-протокол закрыт» — верно, но реализация есть в OpenVSX-расширении, и её
можно исполнять у нас. Поправить при следующей правке VISION.
