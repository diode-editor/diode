# Интеграция с Claude Code: стоковое расширение в терминальном режиме

Статус: **решение принято, работа не начата.** Родственные документы:
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

- [ ] `NotebookCellOutputItem` со статиками `error`/`text`/`json`/`stdout`/`stderr`
      и полем `mime` (`application/vnd.code.notebook.error` и т.д.).
- [ ] `window.registerUriHandler`, `window.setStatusBarMessage`,
      `comments.createCommentController` — честные no-op с `Disposable`.
- [ ] `ExtensionContext.extension` (`Extension<T>` c `packageJSON`, тот же объект,
      что отдаёт `extensions.getExtension`).
- [ ] `env.shell`, `env.machineId`.
- [ ] Дефолт `claudeCode.useTerminal = true` курируемой инъекцией (`curatedConfigInjection` — переопределение дефолта в общем реестре настроек):
      webview-режим у нас невозможен, пользователь не должен крутить это руками.
- [ ] Запись `Anthropic.claude-code` в реестр магазина (платформенные vsix,
      ~112 МБ — лимиты валидатора см. [JavaLSP.md](JavaLSP.md)).
- [ ] Обновить матрицу API-COVERAGE в тех же PR.

### 2. Терминал для расширений (крупное)

RPC-мост хост↔субпроцесс поверх `TerminalService` сделан для шеллов (устройство —
docs/arch/Extensions.md, «Терминалы расширений»); pty расширения
(`ExtensionTerminalOptions`) — следующим PR.

- [x] `window.createTerminal(options)`: `name`, `cwd`, `env` (`null` снимает),
      `strictEnv`, `shellPath`/`shellArgs`, `hideFromUser`, `message`;
      `location`/`color`/`isTransient` принимаются и игнорируются — терминал
      всегда в панели, рядом с шеллами человека в списке вкладок.
- [x] `Terminal.show`/`hide`/`sendText`/`dispose`, `processId`, `exitStatus`,
      `onDidCloseTerminal`, `onDidOpenTerminal`, `onDidChangeActiveTerminal`,
      `window.terminals` (все терминалы, как в эталоне), `window.activeTerminal`.
- [ ] `ExtensionTerminalOptions.pty` (`Pseudoterminal`): эмулятор на хосте, байты по
      проводу — лог BJLS у bazel-java.
- [ ] `ExtensionContext.environmentVariableCollection`: коллекции всех расширений
      вливаются в окружение **каждого** нашего терминала (так `claude`, набранный
      руками в нижней панели, тоже увидит IDE через `CLAUDE_CODE_SSE_PORT`).
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

### Раскладка

У нас один сайдбар, второго (правого), куда VS Code кладёт Claude, нет.
Терминал, который расширение просит открыть `ViewColumn.Beside`, можно
отдать нижней панели TERMINAL или вьюлету сайдбара — решить при реализации
пункта 2. Отдельно проверить ширину: TUI Claude Code в 40 колонках сайдбара.

## Порядок

1 + 2 одним заходом (после него `claude` в нашем терминале работает с выделением
и открытым файлом), затем 3, затем 4.

## Устаревшее в VISION.md

Раздел «Ограничения реальности» писался до этой пробы: «дослать ход в
запущенный `claude -p` нельзя» — теперь есть `--input-format stream-json`;
«`ide`-протокол закрыт» — верно, но реализация есть в OpenVSX-расширении, и её
можно исполнять у нас. Поправить при следующей правке VISION.
