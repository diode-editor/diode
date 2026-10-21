# Стоковые расширения: заметки по конкретным

Что надо знать о конкретных сторонних расширениях, которые работают в Diode: их особенности,
курируемые дефолты, на чём они спотыкались. Общая механика расширений —
[Extensions.md](Extensions.md), магазин — [Marketplace.md](Marketplace.md), конвенция тестов на
сток (расширение берётся из магазина, версию не пиним) —
[TESTING.md](../TESTING.md#тесты-на-стоковые-расширения--из-магазина-конвенция).

## Записи магазина

Критерий записи `proxy-openvsx`: расширение реально работает в Diode, а где есть смоук в
`e2e/marketplace/checks.ts` — он зелёный. Обновление версии — PR с новой записью в `versions[]`;
замена стока нашим форком — смена артефакта в новой версии, схему не трогает. Сьюты, e2e и
сценарии на эти расширения берут их ИЗ МАГАЗИНА.

- **`detachhead.basedpyright`** — смоук: undercurl «is not assignable» на `.py`. Приложение держит
  курируемый дефолт `basedpyright.importStrategy: "useBundled"` (`curatedConfigInjection` в
  `main.ts`) — без него активация падает на API `ms-python.python`; смоук магазина доказывает, что
  дефолт применяется и при установке из реестра.
- **`charliermarsh.ruff`** (#305) — первая запись с **платформенными артефактами**: universal-сборки
  нет, шесть записей одной версии с `targetPlatform` (linux/darwin/win32 × x64/arm64; alpine/armhf
  не включены — таких хостов у diode нет) и гейт `engines.diode`. Внутри vsix — нативный бинарь
  `bundled/libs/bin/ruff`, его исполняемость восстанавливает `installVsix` (exec-бит из
  zip-атрибутов). Курируемый дефолт `ruff.importStrategy: "useBundled"` — детерминированный
  нативный сервер без Python. Смоук — undercurl F401.
- **`dbaeumer.vscode-eslint`** — universal. Расширение НЕ бандлит линтер: eslintServer резолвит
  библиотеку eslint из `node_modules` открытого проекта, поэтому тестовые обвязки доносят её сами
  (`eslintFixture.ts`: кэшируемый `npm install eslint` + симлинк в воркспейс; закоммитить такую
  фикстуру нельзя). Смоук — undercurl `no-extra-semi`; e2e — fix on save.
- **`Catppuccin.catppuccin-vsc`** (#84) — первая цветовая тема: четыре темы через
  `contributes.themes` (Mocha / Macchiato / Frappé — `vs-dark`, Latte — `vs`), `tokenColors` inline,
  141 цвет с альфой из 564 — носитель для композитинга tuidom. Runtime-часть (`dist/main.cjs`,
  перегенерация тем из настроек) не используется: файлы тем читаются из vsix как есть. Смоук —
  `"workbench.colorTheme": "Catppuccin Mocha"` → фон редактора в кадре равен `editor.background` из
  `themes/mocha.json`, тема есть в пикере.
- **`golang.go`** (сайт#19) — universal, гейт `engines.diode: ">=0.9.2"` (до #657 активация падала на
  `vscode.debug`). `support: partial`: отладчика нет, Testing view и code lens'ов пока нет,
  welcome/pprof — webview; требование Go toolchain — пунктом в `limits` и в readme (решение человека,
  как JDK у `redhat.java`). gopls в vsix нет — расширение ставит его само `go install`; смоук кладёт
  заранее собранный gopls в GOBIN (в CI — `.github/actions/go-tools`), без Go кейс пропускается
  (`requires` у чека). Open VSX пишет id как `golang/Go` — см. открытый пункт про регистр id в
  [TODO/Extensions.md](../TODO/Extensions.md#магазин).
- **`Anthropic.claude-code`** (сайт#20) — шесть платформенных vsix по 125–138 МБ (внутри бинарь CLI;
  universal на Open VSX нет). Гейт `engines.diode: ">=0.9.5"` — терминал вкладкой справа (#675),
  `config.*` в when (#676) и `editor/title` (#677); решение человека — запись опубликована до
  релиза, у 0.9.4 она «несовместима», dev-сборки ставят. Лицензия проприетарная — в `license`
  дословная строка манифеста, байты не хостим. `support: partial`: webview-чат, `Ctrl+Esc` только с
  kitty-протоколом; нужен `claude` CLI в PATH — терминальный режим набирает голое `claude`, вшитый
  бинарь не использует. Смоук — пункт статус-бара, лок с `ideName: "Diode"` и MCP `initialize`
  пробным клиентом (настоящий CLI не запускается — [TESTING.md](../TESTING.md)).
- **`EditorConfig.EditorConfig`** — прокси на сток; смоук — `[*.tabbed] indent_size=3` применяется.
  **`maptz.regionfolder`** — на Open VSX не опубликован, немодифицированный vsix перевыложен в
  `artifacts/` реестра (`kind: "proxy-hosted"`, MIT).

## Python: `detachhead.basedpyright` и `charliermarsh.ruff`

Оба — настоящие vsix с open-vsx как есть, ни строчки нашего кода расширения; маршрут «сторонний
vsix», а не строка в таблице builtin-клиента. Сьюты `extensionHost.pythonLsp*`,
`extensionHost.ruffLsp*` и `extensionHost.pythonDuo` (оба сервера разом: диагностики сливаются,
формат отдаёт ruff).

- **basedpyright** форкает `process.execPath` сам (`TransportKind.ipc`) — под SEA это diode-бинарь,
  отсюда env-фикс `DIODE_RUN_AS_NODE` ([Extensions.md](Extensions.md), грабли LSP). Манифестный
  `fromEnvironment` зовёт API `ms-python.python` без try/catch и роняет активацию — курируемый
  дефолт `importStrategy: "useBundled"`. Folding у Python — indentation-based ядра: сервер
  `textDocument/foldingRange` не реализует.
- **ruff**: линт-диагностики — pull с re-pull на правку буфера; quickfix по диагностике (safe-фикс
  `isPreferred`); `source.organizeImports.ruff` / `source.fixAll.ruff` (иерархический матч kinds);
  формат документа и выделения — от нативного `ruff server`, Python не нужен. `importStrategy:
  "useBundled"`: манифестный `fromEnvironment` сканирует окружение, bundled детерминирован, а
  `nativeServer: "auto"` сам выбирает native (bundled заведомо ≥ 0.5.3). Нюанс фикстур: дефолтный
  набор правил ruff 0.16 включает F401/I001, но НЕ E711 (и фикс E711 — unsafe, Fix All его не берёт).

## JavaScript: `dbaeumer.vscode-eslint`

Маршрут «библиотека из проекта»: eslintServer резолвит eslint из `node_modules` открытого проекта
(нет библиотеки или конфига — нет линта, честное сообщение расширения). `Files.resolve()`
vscode-languageserver'а форкает `execPath` с `execArgv: ["-e", <скрипт>]` — runAsNode обязан понимать
eval-режим node, иначе расширение молча не линтит. Диагностики — push (`publishDiagnostics`, а не pull,
как у basedpyright/ruff), quickfix по правилу (`isPreferred`), `source.fixAll.eslint` руками и через
`editor.codeActionsOnSave`. Первый жилец middleware `workspace/configuration` — однопапочного
`getConfiguration(section)` (scope игнорируется) хватает. `eslint.format.enable` не проверялся
(формат закрыт ruff и prettier).

## Java: `redhat.java` (Eclipse JDT LS)

- **Транспорт** — `vscode-languageclient@10`, по умолчанию `TransportKind.pipe` (unix-сокет
  `--pipe=/tmp/lsp-<hash>.sock`): форка `execPath` нет, грабля `DIODE_RUN_AS_NODE` здесь ни при чём.
  Переключается настройкой `java.transport`.
- **Сервер** — `java -jar server/plugins/org.eclipse.equinox.launcher_*.jar -configuration <dir>
  -data <jdt_ws> --pipe=<sock>`, 114 osgi-плагинов в vsix. Проектную модель строит сам сервер (m2e
  для maven, Buildship для gradle), клиент знает о ней только из кастомных нотификаций.
- **`java.server.launchMode: "Hybrid"` (дефолт) — два JVM**: «syntax server» (`config_ss_linux`,
  `ss_ws`) для мгновенной подсветки и параллельно «standard server» (`config_linux`, `jdt_ws`); после
  готовности второго первый выходит сам. Дефолт `-Xmx2G`, на gradle-проектах третьим JVM —
  gradle-демон. Самый тяжёлый LSP из имеющихся (отсюда тяжёлая полоса e2e,
  [TESTING.md](../TESTING.md#прогон-сборка-воркеры-автоповтор-уборка)).
- **Каталоги состояния — из `ExtensionContext`**: `-configuration` копируется в
  `globalStorageUri/<версия>/config_linux` (должен быть записываемым), `-data` =
  `storagePath/jdt_ws`; без `storagePath` — фолбэк в `os.tmpdir()/vscodesws_<rand>`. Состояние сервера
  кэшируется вместе с AppCDS-архивом `jdtls.jsa`: настройка, влияющая на компиляцию, может не
  подхватиться, пока не пересоздан `jdt_ws`.
- **Список проектов — не TreeView.** Вид «Java Projects» живёт в другом расширении
  (`vscjava.vscode-java-dependency`); у `redhat.java` состав проектов виден через
  `setContext("java.projects", […])`, статус-бар / `createLanguageStatusItem` («Java: Ready») и
  `withProgress`.
- **Переимпорт**: клиент через dynamic registration просит watcher'ы на `**/pom.xml`, `**/*.gradle*`,
  `**/.classpath`, `**/src/**`, … — `createFileSystemWatcher` их принимает. Дефолт
  `java.configuration.updateBuildConfiguration: "interactive"` оставлен эталонным: вопрос
  «Synchronize now / Never» у нас отвечаем, подменять его значило бы молча забрать решение у человека.
- **JRE для сервера**: bundled `extension/jre/*/bin/java` → `java.jdt.ls.java.home` →
  `JAVA_HOME`/`PATH`. Минимум JDK 21 (25 при `java.jdt.ls.javac.enabled: "on"`). Платформенные vsix
  (133 МБ) несут JRE 21, `universal` (54 МБ) — нет; на `universal` без JDK расширение падает на
  активации с `showErrorMessage`.
- **Курируемый дефолт `java.jdt.ls.lombokSupport.enabled: false`**: lombok-агент в связке jdt.ls 1.57
  + JDK 21 ломает компиляцию (`Lombok can't parse this source: NoSuchFieldError …
  ConstructorDeclaration.constructorCall`, вместо диагностик — «Internal compiler error»). Дефект
  lombok/JDT, не наш; снять — [TODO/LanguageServers.md](../TODO/LanguageServers.md#java).
- **Не будет (webview)**: редактор настроек форматтера (`contributes.customEditors`; регистрация —
  инертный no-op, иначе падала вся активация), markdown-превью документации, диалог Change Signature.
  Отладка, тесты, «Java Projects» — отдельные расширения Extension Pack for Java.
- Inlay hints, code lens, outline, workspace symbols, call/type hierarchy, selection range, on-type
  formatting сервер умеет — Java получит их сама по мере закрытия `register*Provider`
  ([API-COVERAGE](../public/API-COVERAGE.md)). Классов-ловушек у этого клиента не всплыло: ошибок
  конвертации в `client.outputChannel` за прогоны нет. Активация → готовность на игрушечном проекте
  с тёплыми кэшами ≈ 19 с.

## Go: `golang.go` (gopls)

- **Активация** — `onLanguage:go` (+ `go.mod`, `go.sum`, `go.work`, `gotmpl`, `go.asm`) и неявные
  `onCommand:`. В `activate()` `startLanguageServer` идёт **до** регистрации дебаггера — поэтому до
  null-объекта `vscode.debug` gopls жил, а ~60 команд `go.*` не появлялись.
- **gopls в vsix нет.** Расширение ищет `go` (`go.goroot` → `GOROOT` → `PATH`) и отсутствующий gopls
  ставит само `go install golang.org/x/tools/gopls@latest` в `GOBIN` — без вопроса, с логом в канале
  «Go»; транспорт — stdio. Платформенных vsix не нужно, но пользователю нужен Go toolchain, а первая
  установка gopls — сеть и минута-две сборки. Без `go` в PATH — эталонный тост «Failed to find the
  "go" binary…» с кнопкой «Go to Download Page», активация отказывает (так же в VS Code). Фикстура
  тестов ставит gopls заранее в кэшируемый GOBIN, авто-установку закрывает один e2e (`goLsp.test.ts`).
- **vscode-go при `isIncomplete: true` ставит ВСЕМ пунктам `filterText` первого** (фильтрует gopls,
  клиент обязан перезапрашивать на каждый символ); gopls кладёт авто-импорт в `additionalTextEdits`
  сразу, resolve-провайдера у него нет.
- **Решения человека:** отладчик не делаем (`vscode.debug` — null-объект); фичи, которых ядро ещё не
  умеет (CodeLens, inlay hints, outline, Go to Implementation, call hierarchy, Testing view, деревья
  `go.explorer`/package outline, when-фильтр палитры), ради Go отдельно не делаем — заработают сами
  с ядром. Welcome-страница и pprof — webview, не будет.
- Спайк заново: `PATH=<go>/bin:$PATH npm run -s drive -- start --seed e2e/fixtures/goSample --install
  golang.go --open main.go`, лог — `drive -- output extensions.golang.go.go`.

## Terraform: `hashicorp.terraform`

Платформенный vsix со вшитым `terraform-ls`. Активация падала цепочкой, и каждое звено — урок про
стабы вообще:

1. **Загрузка модуля** — `Class extends value undefined`: 16 классов бандла наследуются от
   `vscode.TreeItem`, в конструкторах — `ThemeIcon`; значения-классы обязаны существовать уже на
   импорте.
2. Первая строка `activate()` — `context.extension.packageJSON`.
3. `env.createTelemetryLogger is not a function` — `@vscode/extension-telemetry` строит логгер в
   конструкторе репортера; статический скан бандла вызов не видит: обращение идёт через
   `this.vscodeAPI`.
4. Конструкторы панелей до старта LS — `authentication.*` и `createTreeView`/`registerTreeDataProvider`
   (null-объекты — [Extensions.md](Extensions.md)).

Классы-значения, которые бандл использует, но в рантайме их нет (`DocumentSymbol`, `SelectionRange`,
`Color*`, `CallHierarchy*Call`, `InlineValue*`, …), для активации не нужны — их зовут конвертеры
languageclient только при вызове провайдера, а соответствующие `register*Provider` у нас no-op;
понадобятся вместе с провайдерами. Автодополнение по схеме AWS работает из вшитых схем без terraform
CLI и `terraform init`; форматирование требует terraform в PATH (`Terraform (CLI) is required`) —
окружение, а не Diode. Запись магазина гейтится `engines.diode >=0.7.3`.

## Форматирование: `esbenp.prettier-vscode`

Своего форматтера у ядра нет намеренно — форматирует только провайдер расширения. Prettier закрывает
то, что не покрывает ни один LSP (markdown, JSON, YAML, CSS, HTML).

- **ESM-расширение.** prettier с 12.x — `"type": "module"` с `import … from "vscode"`; поддержка ESM
  в extension host (правило эталона `isEsmEntry` + `module.registerHooks` рядом с CJS-стабом)
  появилась ради него. Грабля отладки — [TESTING.md](../TESTING.md#extensiontestharness-testutilsextensiontestharnessts).
- **`TextDocument.positionAt`** — prettier строит минимальную правку через него; пока метод был
  объявлен в `vscode.d.ts`, но не реализован, вызов бросал, языковой шов глотал, и формат выглядел как
  «менять нечего». С тех пор сбой провайдера формата уходит в лог.
- **Библиотека из проекта**: расширение ищет `prettier` в `node_modules` воркспейса, читает его
  `package.json` и грузит динамическим `import()`; при сбое загрузки НЕ откатывается на вшитый, а
  перестаёт форматировать (`Prettier could not be loaded`), старая версия — тост «Version … is
  outdated», нет `node_modules` — вшитый.
- **Кто форматирует `.ts` при двух провайдерах.** Ядро берёт первый подходящий по порядку
  РЕГИСТРАЦИИ (`languagesNamespace.ts`, `provideFormattingEdits`). prettier регистрирует провайдер
  синхронно в `activate()`, LSP-клиент — после хендшейка с сервером, секундами позже, поэтому на
  `.ts` выигрывает prettier при любом разумном прогреве (замерено на бинаре). Пользователь, поставивший
  prettier, этого и хочет; выбор форматтера — в трекере.

## Claude Code: `Anthropic.claude-code` в терминальном режиме

**Решение.** Из четырёх вариантов (терминал с `claude` в сайдбаре; стоковое расширение; своя
чат-панель поверх `claude -p --input-format stream-json`; свой MCP-сервер + хуки) взято **стоковое
расширение в режиме `claudeCode.useTerminal`** (курируемый дефолт `true`):

- расширение лежит в Open VSX, версии в лок-степе с CLI; пользователь ставит его из магазина, мы
  ничего не бандлим;
- в терминальном режиме `ide`-MCP-сервер (WebSocket, лок `~/.claude/ide/<port>.lock`) хостит само
  расширение, CLI к нему подключается: закрытый протокол реализован их кодом — мы его не реверсим, а
  только даём расширению API VS Code (принцип VISION);
- авторизация — пользовательский `claude` с его подпиской: вход claude.ai предлагаем не мы;
- своя чат-панель отвергнута: гонка с UX харнесса, серая зона авторизации, а главное — Claude Code
  сам TUI, «нативный UI» и «терминальный режим» у нас совпадают.

**Что даёт терминальный режим:** выделение и открытый файл уходят в CLI (`selection_changed`,
`at_mentioned` по `Ctrl+Alt+K`), диагностики по запросу (`getDiagnostics`), `openFile`, а правка при
запросе разрешения открывается **дифф-вкладкой** с ✓/↺. Инлайн-предложения в стиле Copilot есть
только у webview-режима, в TUI невозможного. Условия на стороне CLI: `/config` → «Diff tool» = `auto`
(пункт виден только при подключённой IDE), режим разрешений `default` (в accept-edits/bypass дифф не
показывается), подключение проверяется `/ide`. В `-p` режиме CLI к IDE не подключается вовсе.

**Как CLI находит IDE.** Белого списка имён IDE в CLI нет: валидация — совпадение порта из окружения
(`CLAUDE_CODE_SSE_PORT`, его кладёт `environmentVariableCollection` в окружение каждого нашего
терминала) с локом либо `pid` лока в предках процесса `claude`. Лок пишется с `ideName: "Diode"`.
Сервер держит одного клиента: новое подключение выбивает прежнее.

**Раскладка.** Все точки входа терминального режима (пункт статус-бара «✻ Claude Code», кнопка
`editor/title` с `when: config.claudeCode.useTerminal`, `Ctrl+Esc` →
`claude-vscode.terminal.open.keyboard`, палитра) зовут `claude-vscode.terminal.open` →
`createTerminal({ location: { viewColumn: ViewColumn.Beside }, isTransient: true })` — терминал
вкладкой в группе справа; это и есть «правая панель» в VS Code. Вторичная боковая панель у
расширения — только для webview-чата. Свой терминал через `tabGroups`/`TabInputTerminal` оно не
ищет. `Ctrl+Esc` жив только с kitty/csi-u (в legacy это Esc).

**Грабли активации** (порядок падений): `NotebookCellOutputItem.error(...).mime` на верхнем уровне
модуля (без класса модуль не грузится) → `window.registerUriHandler` → `context.extension.packageJSON`
→ `context.environmentVariableCollection`; позже — `onDidChangeTerminalShellIntegration` (ждёт 3 с и
уходит в `sendText`), `comments.createCommentController` (тред на ханк диффа — у нас инертный),
`languages.onDidChangeDiagnostics` — без него расширение рвало каждое подключение CLI
(`DiagnosticStreamManager.startStreaming` бросал в `.catch` подключения, и тот закрывал сокет: `/ide`
видит IDE, но ни выделения, ни at-mention не приходит). Стек ошибки активации теряется на RPC
(`rpcEndpoint.ts` шлёт только `message`); экспорты esbuild-бандла — геттеры, так что
`module.exports.activate = …` для полифила молча игнорируется.

**Контекст.** Выделение — через 300 мс дебаунса расширения `selection_changed` с текстом, путём и
диапазоном; на подключении расширение досылает последнее выделение через 500 мс. Открытый файл —
тем же событием с пустым выделением на любое движение каретки (своего
`onDidChangeActiveTextEditor` у расширения нет), поэтому возврат на вкладку с сохранённым выделением
обязан слать `onDidChangeTextEditorSelection`, как эталон после `restoreState` (в активной группе —
после смены активного редактора, иначе фильтр `textEditor === activeTextEditor` его отбросит).
`Ctrl+Alt+K` (`claude-code.insertAtMentioned`) — at-mention терминального CLI; `Alt+K`
(`claude-vscode.insertAtMention`) — путь webview-чата и у нас молчит, как и `Open in New
Window/Tab/Side Bar`.

**Протокол предложенного диффа** (MCP-инструмент `openDiff`, сверено с 2.1.304): правая сторона
кладётся в ФС расширения со схемой `_claude_fs_right` (`_claude_vscode_fs_*` — путь webview-чата),
левая — файл с диска (у грязного буфера — копия с диска в `_claude_fs_left`), открывается
`vscode.diff(left, right, title, { preview: false })`. Ключ `claude-code.viewingProposedDiff` зажигается
по видимости сторон диффа (`visibleTextEditors`), кнопки ✓/↺ — `claude-code.{accept,reject}ProposedDiff`
в `editor/title`. Дальше гонка исходов: ✓ и сохранение правой стороны (с правками человека) —
`FILE_SAVED` с её текстом, ↺ и закрытие вкладки — `DIFF_REJECTED`; сохранение принимается только при
`files.autoSave === "off"`; `close_tab`/`closeAllDiffTabs` CLI сначала сохраняет правую сторону
(`TextDocument.save()`), потом `tabGroups.close` — без диалога. Идентичность `Tab` расширению не нужна:
оно сравнивает `input.modified` по строке. Нужное от нас — провайдер ФС с записью и **редактируемым**
документом на чужой схеме ([Extensions.md](Extensions.md), «Провайдеры ФС расширений»), настоящий
`TextDocument.save()`, `files.autoSave`. Перехват команды `type` расширение делает в try/catch — не
поддерживаем.
