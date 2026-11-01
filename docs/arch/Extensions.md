# Extensions

Часть архитектуры Diode — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).

Загрузка VS Code-совместимых расширений. Сейчас поддержаны `contributes.languages`,
`contributes.grammars`, `contributes.themes` и
`contributes.semanticTokenTypes`/`semanticTokenModifiers`/`semanticTokenScopes` (классификация
семантических токенов, `registerExtensionSemanticTokens`) для builtin (`extensions/` — 48 языковых
паков из microsoft/vscode, импорт verbatim скриптом с пином тега) и user-расширений
(`<userData>/extensions/<publisher>.<name>-<version>/`). Остальные contribution points — отдельные
фазы (см. [../TODO/Extensions.md](../TODO/Extensions.md)).

Контракты/швы:
- **`IExtension`** — `{ id, manifest, location, isBuiltin }`. `ExtensionScanner` парсит `package.json` через `IAssetAccess`; `mergeExtensions` разруливает конфликты id (builtin побеждает user).
- **NLS манифеста (`extensionNls.ts`)** — любая строка `package.json` расширения может быть ключом
  `"%java.clean%"`, а текст лежит в `package.nls[.<locale>].json`. Резолв делает `ExtensionScanner`
  сразу за парсингом — **одним проходом по всему дереву манифеста**, как `localizeManifest` эталона,
  а не точечно у команд: те же ключи сидят в `displayName`/`description`, в `label` тем, в
  заголовках и описаниях настроек. Поэтому у потребителей (`ExtensionThemeContributor`,
  `collectCommandMeta` в `extensionRegistration.ts`, `packageJSON` в `vscode.extensions`) манифест
  уже локализованный, и своего резолва им не нужно. Бандл читается тем же `IAssetAccess`, что и
  манифест, — у builtin'а файла на диске нет, он внутри SEA-бандла. Выбор файла —
  `nlsFileCandidates(locale)`: `package.nls.<locale>.json` → базовый язык (`pt-br` → `pt`) →
  `package.nls.json`; локаль одна на редактор — `UI_LOCALE`
  (`platform/environment/common/uiLocale.ts`), оттуда же берётся `vscode.env.language`. Краевые
  случаи эталонные и **не роняют загрузку**: нет ключа — строка остаётся ключом плюс одна строка в
  лог на расширение (молча подставленная пустота не отлаживается), нет/битый бандл — расширение
  грузится с нерезолвленными строками, нестроковые значения не трогаются.
  `ExtensionInstaller.listInstalledExtensions` локализует себе `displayName`/`description` сам: он
  работает с физическими каталогами, мимо `IAssetAccess`.
- **`LanguageRegistry implements ILanguageService`** — собирает `contributes.languages`, резолвит
  language по пути файла. Неочевидное правило разрешения: приоритет `filenames` → `filenamePatterns`
  (мини-glob) → `extensions`; при конфликте одного `.ext` побеждает **зарегистрированный позже**
  (user поверх builtin, как в VS Code). Seed'ит core-язык `plaintext` как fallback.
- **`ExtensionThemeContributor`** — регистрирует цветовые темы из `contributes.themes` в
  `ThemeRegistry`. В отличие от грамматик — **eager**: `await apply()` в `main.ts` идёт после
  сканирования и ДО выбора активной темы и первого кадра (файлы тем — килобайты, а пикеру нужен
  синхронный `resolve`, и тема из `workbench.colorTheme` обязана быть в первом кадре). Ключ —
  `label` манифеста, `uiTheme` → тип, JSONC и `include` — см. [Theme.md](Theme.md). Битая тема (нет
  файла, битый JSON, цикл `include`) — ошибка в лог с id расширения и label, пропуск; расширение и
  старт не падают. `dispose()` снимает регистрации.
- **`ExtensionTokenizationContributor`** — регистрирует грамматики из всех `contributes.grammars` в
  `TokenizationRegistry`. `apply()` синхронный и без I/O: кладёт **ленивые фабрики**
  (`registerLazy`), а `.tmLanguage.json` парсится при первом `TokenizationRegistry.load(languageId)`
  — его дёргает `EditorComponent.ensureTokenizerForLanguage`, когда язык реально понадобился
  документу (наш аналог `onLanguage`; к activation-events extension host'а отношения не имеет —
  языковые паки декларативные, без `main`). Пока грамматика едет, документ работает на
  `PlainTextTokenizer`, а подъехавший support пересаживается через `onDidChange`. Мотив: 77
  builtin-грамматик — 6.6 MB JSON, ~420 мс на полную загрузку; раньше всё это лежало на пути к
  первому кадру с содержимым файла.

Две вещи прикрывают ленивость, чтобы подсветка не ждала загрузки грамматики:
- **Стартовые файлы** — `main.ts` через `preloadGrammarsForFiles` грузит грамматики именно тех
  файлов, что сейчас откроются (обычно один язык, ~2 мс), **до** `openFile`, а сама токенизация идёт
  **после** первого кадра: до него `TokenizationRegistry` придержан (`hold()` в `startWorkbench`,
  отпуск — тем же `onDidChange`). Первый кадр — текст без подсветки, как у эталона (он токенизирует
  вьюпорт после рендера), цвет — следующим кадром. Причина — цена первой токенизации: она
  компилирует regex'ы грамматики, у TypeScript это ~160 мс на вьюпорт (замер 2026-10-14,
  [OpenPerformance.md](../TODO/OpenPerformance.md)); решение человека 2026-10-14 — текст раньше
  цвета. Пути берутся из CLI либо из `WorkbenchComponent.getOpenEditorsToRestore()` — тот же список,
  что откроет `restoreOpenEditors()`, чтобы знание о восстанавливаемой сессии не расползалось по
  бутстрапу.
- **Остальные грамматики** — фоновый `preloadAll()` (`setImmediate` после первого кадра), чтобы переключение вкладки на другой язык не ждало парсинга.
- **`ExtensionInstaller`** — установка/список из `.vsix` (CLI `--install-extension` и т.п., до подъёма TUI): распаковка с защитой от zip-slip + атомарный `rename` в каталог `<id>-<version>`, который ждёт `ExtensionScanner`. Прочие версии того же id **не трогает**; ту же версию заменяет, как эталон («Installing a VSIX extension shall replace the existing extension always», решение В3): старый каталог сначала переименовывается в `<имя>.<hex>.vsctmp` (`DELETED_FOLDER_POSTFIX` эталона), потом удаляется, неудаленный уходит в `.obsolete`. Временный каталог распаковки — `.vsix-install-<pid>-*`: по pid уборка отличает брошенный от идущей установки другого процесса.
- **Каталог расширений и `.obsolete` (`obsoleteExtensions.ts`)** — в `extensions/` может лежать
  **несколько версий** одного id (`<id>-<version>/`); какую берёт профиль, решает его запись. Версия,
  на которую не ссылается ни один профиль, **не удаляется сразу** — живой extension host ещё может
  лениво грузить из неё модули, грамматики, бинари LSP. Она помечается в `extensions/.obsolete`
  (`{ "<имя каталога>": true }`, формат эталона) и удаляется на **старте редактора**
  (`cleanUpExtensions` в `openProfiles`, до скана расширений; CLI не чистит никогда): битый файл или
  нечитаемый профиль — `error` в лог и ничего не удаляется; ошибка удаления одного каталога — `warn`,
  ключ остаётся до следующего старта; каталог, на который снова ссылается профиль, не удаляется, ключ
  снимается (профиль сильнее пометки — и в `list()`). Затем, как `deleteExtensionsNotInProfiles`
  эталона, помечаются **сироты** — каталоги с манифестом, на которые не ссылается ни один профиль
  (упавшая установка, положенное руками); удаляет их следующий старт, чтобы не обогнать установку в
  другом процессе, которая пишет запись профиля сразу после распаковки. Заодно сметаются `*.vsctmp` и
  `.vsix-install-<pid>-*` мёртвых процессов. Поэтому каждый старт читает листинг `extensions/` и
  профили. **Аренды (решение В1, отступление от
  эталона):** у эталона уборка идёт на старте shared process, когда других окон нет; у нас каждое
  окно — свой процесс, и второе окно снесло бы каталог, на котором работает первое. Поэтому процесс
  редактора пишет `extensions/.inuse/<pid>.json` — список загруженных каталогов — и удаляет его на
  выходе и перед reload (первый reload превращает процесс в супервизора, который ничего не грузит);
  уборка не трогает каталоги живых pid (`process.kill(pid, 0)`), аренды мёртвых удаляет, нечитаемая
  аренда живого pid защищает всё. Риск переиспользования pid принят: аренда мёртвого окна, чей pid
  достался чужому процессу, только откладывает удаление, данные не теряются. Межпроцессной блокировки `.obsolete` и `extensions.json` нет —
  гонка CLI и окна может потерять пометку (хвост в [TODO/Extensions.md](../TODO/Extensions.md)).
- **Состав по профилю (`profileExtensions.ts`, `platform/extensionManagement/node/`)** — каталог
  `extensions/` один на установку, а какие расширения включены и **какой версии**, решает
  `extensions.json` профиля (аналог `extensionsProfileScannerService` эталона): у именованного —
  `User/profiles/<id>/extensions.json`, у Default — `<extensionsDir>/extensions.json`
  (`getDefaultProfileExtensionsLocation` эталона). Запись —
  `{ identifier: { id }, version, relativeLocation, metadata? }`; `metadata.pinned: true` — версию
  выбрал пользователь (`installGivenVersion` эталона: пикер версий, `--install-extension id@version`,
  `.vsix`); обычная установка/обновление сохраняет прежнее значение, зависимости не закрепляются,
  удаление стирает запись вместе с пометкой, прочие поля записи при перезаписи `add` сохраняются.
  Каталог — по `relativeLocation`, у записей
  старых версий — `<id>-<version>`, нет и его — единственный каталог этого id, при нескольких —
  наибольшая semver с `warn` (файл при этом не переписывается). Каталог другого id не берётся
  никогда; каталог, на который ссылается профиль, в `list` попадает и помеченный (профиль сильнее
  пометки, как решает и уборка), а запасной выбор US-0.9 идёт только среди непомеченных. Версия — **по профилю, как у
  эталона (решение В2)**: обновление в одном профиле не трогает запись другого, оба каталога живут,
  пока на них кто-то ссылается. Кто читает: `main.ts` фильтрует скан пользовательских расширений по
  каталогам из `list()` (не по id: версий на диске может быть несколько) **до** всех вкладов (темы,
  языки, грамматики, конфигурация, extension host видят один набор); смена профиля — перезагрузка
  окна, то есть новый скан, отдельного перезапуска host'а нет. Кто пишет: `ProfileExtensions` —
  `add` (установка из магазина и `--install-extension`, `{ pinned }` для заданной версии: запись указывает на **только что
  поставленный** каталог, `extensionDependencies` — с диска: уже записанная в профиле зависимость
  сохраняет запись, новая берёт наибольшую непомеченную версию), `remove` (Uninstall,
  `--uninstall-extension`: из профиля), `list` (Extensions view, `--list-extensions`). После `add` и
  `remove` — `markUnusedExtensions` по затронутым id: версии, на которые не ссылается ни один профиль,
  помечаются, на которые ссылаются — снимаются с `.obsolete` (возврат на помеченную версию, US-0.5);
  «все профили» = реестр ∪ `User/profiles/*` на диске, нечитаемый файл профиля блокирует пометку. CLI
  берёт профиль из `--profile <имя>` (неизвестное — ошибка), иначе Default, и пишет `Previous
  version(s) will be removed on next start: …`. Удаление профиля помечает то, что стало никому не
  нужно (`markUnusedExtensions` на `onDidChangeProfiles` в `main.ts`). Миграция
  (`migrateProfileExtensions`, окно и CLI): профиль без файла получает все установленные, по одной
  (наибольшей) версии на id — так обновление с версии с общими расширениями ничего не прячет; новый
  профиль файл `[]` получает при создании.
- **Установка по id из реестра** (`platform/extensionManagement/`) — `installFromRegistry` поверх
  того же `installVsix`: мета → совместимая версия (`engines` ↔
  `DIODE_VERSION`/`VSCODE_SHIM_VERSION`; платформенные записи — по `targetPlatform` ↔
  `currentTargetPlatform()`, universal — фолбэк) → артефакт → `sha256` → установка. Источник за швом
  `IExtensionRegistrySource`: каталог (`FileExtensionRegistrySource`) или сеть
  (`HttpExtensionRegistrySource`); выбирает `createRegistrySource` по значению `--registry`, без
  флага — публичный реестр. Формат и политика наполнения —
  [Marketplace.md](Marketplace.md).
  - **`extensionDependencies` ставятся вместе с расширением** — без вопросов, как VS Code
    (`getAllDepsAndPackExtensions`), и из CLI, и кнопкой Install на странице. Сначала всё
    **готовится** (версия, артефакт, `sha256`, манифест прямо из `.vsix` — `readVsixManifest`,
    сверка id), и только потом ставится — зависимости раньше, расширение последним. Поэтому отказ
    ничего не трогает на диске, а прежняя версия расширения при сбое остаётся. Транзитивно, без
    дублей; уже установленная зависимость (любой версии, id без учёта регистра) не трогается; цикл
    не зацикливает. Зависимость **найдена, но поставить нельзя** (нет совместимой версии, `sha256`,
    чужой артефакт) — отказ всей установки с причиной, как у эталона. Зависимости **нет в реестре**
    — расширение всё равно ставится (у эталона галерея её просто не вернёт), а отказ случится на
    активации тостом «depends on unknown extension». Зависимость на встроенное расширение VS Code
    (`vscode.*`) в магазине не ищется и пропавшей не считается — то же отступление, что на
    активации. Поставленные зависимости получают в Extensions view тот же бейдж Reload. CLI печатает
    строку на каждую зависимость и предупреждение о пропавших — отступление: эталонный CLI о
    зависимостях молчит. `--install-extension foo.vsix` тоже тянет зависимости из реестра; сбой —
    предупреждение, само расширение остаётся (как у эталона для VSIX). `extensionPack` пока не
    ставится.

## Extensions/Host/ — extension host (real subprocess)
**Журнал вызовов API** (`DIODE_API_TRACE=<файл>`, `api/common/apiTrace.ts`, запись — `api/node/apiTraceFile.ts`): слой поверх оверлея расширения для отметки «подтверждён» в матрице. Без переменной не создаётся ни одна обёртка. Формат, виды записей и границы → [docs/extensions/README.md](../extensions/README.md#журнал-вызовов).

Изоляция кода расширений от ядра. Host форкает **один subprocess** (тот же бинарь / `main.ts` с env `DIODE_EXTENSION_HOST=1`) и общается с ним через **RPC поверх Node IPC**. Отступление от эталона: VS Code гоняет extension host по своему `RPCProtocol` (сокет, `MessageBuffer`/`VSBuffer`, JSON со спецслучаями для буферов и `$mid`-revive), у нас — канал Node. Швы:
- **`IMessageChannel`** — транспортно-агностичный двунаправленный канал. Реализации: `IpcMessageChannel` (Node IPC) и `createInProcessChannelPair()` (unit-тесты).
  **Формат провода — структурный клон** (`serialization: "advanced"` у форка роли в `spawnSelfAsRole`,
  `v8.serialize`; watcher остаётся на JSON): sync документа 13 МБ стоит главному потоку ~10 мс вместо
  ~55 у JSON. Отличия от JSON, на которые нельзя опираться: `undefined`-поля и `Map`/`Set`/`Date`/typed
  arrays доходят как есть, `toJSON()` не зовётся (у `vscode.Uri` на провод уходят собственные поля
  `scheme/authority/path/query/fragment`, не `$mid` — `reviveWireUri` принимает обе формы), прототипы
  теряются. Парсеры провода сравнивают `!== undefined`, а не наличие поля. **Предохранитель:** клон
  бросает на функции, символе, Proxy, Promise — там, где JSON молча выбрасывал. `IpcMessageChannel`
  отличает это от закрытого канала по `endpoint.connected`, шлёт сообщение повторно его JSON-образом
  (`JSON.parse(JSON.stringify(...))` — ровно байты старого транспорта) и пишет `warn` с конвертом
  (`notif window.statusBarItem.update`); если и JSON его не берёт (цикл рядом с функцией) — `error` и
  сообщение отброшено, канал жив. Ни одно сообщение не теряется молча; в субпроцессе лог идёт в stderr
  с префиксом `[ext-host]` и попадает в канал Extensions хоста. In-process пара зеркалит то же
  (`structuredClone` → JSON-образ).
- **`RpcEndpoint`** — request/response/notification поверх канала, **симметричный** (запросы шлют обе стороны).
- **Сторона ядра — фасад и customers** (`services/extensions/node/`, как `mainThread*` эталона).
  `ExtensionHost` — фасад с прежним публичным API: держит реестр и активацию (таблица фаз
  `ExtensionPhases` — все регистрации, ожидающие активации, активные; журнал событий и активации в
  полёте), оркестрацию спавна и делегаторы. Процесс — `ExtensionHostProcess` (spawn, stdio, ready,
  выключение host.shutdown → SIGTERM → SIGKILL). Каждая поверхность API — customer в `customers/`
  (`secrets`, `env`, `window`, `diagnostics`, `decorations`, `fileSystem`, `commands`, `editor`,
  `configuration`, `documents`, `languageFeatures`, `terminal`, `tasks`, `treeViews`) с контрактом
  `IExtensionHostCustomer.attach(ctx): IDisposable` (`common/extensionHostCustomer.ts`): объект
  customer'а живёт столько же, сколько хост, а всё состояние одного спавна — обработчики RPC,
  подписки на ядро, handle'ы — заводится в `attach` и снимается возвращённым disposable вместе со
  `spawnStore`. Набор customers — явный массив, который хост собирает в конструкторе из опций.
  Семена handshake (настройки → окружение хоста `env.initialize` с `env.machineId`/`env.shell`/`env.appRoot` →
  полоса групп и активный редактор → тема → каталог → открытые документы → чужие маркеры
  `diagnostics.markersChanged`) хост шлёт сам в этом порядке, зовя `pushInitialState` нужных
  customers. Стоки окна (`DiagnosticsSink`, `IProgressSink` и соседи) — порты в
  `api/common/iExtensionWindowSinks.ts`, приёмник document sync — `IDocumentSyncTarget`: адаптеры
  `api/browser` слой node не импортируют.
- **Загрузка точки входа:** CJS или ESM, решает `isEsmEntry` правилом эталона (`_isESM` в
  `abstractExtHostExtensionService`): `.mjs` — всегда модуль, `.cjs` — всегда CJS, иначе — `"type"`
  из `package.json` расширения (хост отдаёт его в `host.activateExtension` как `moduleType`). CJS
  грузится `createRequire(mainPath)`, ESM — `importModule` (`base/node/importModule.ts`): `import()`
  из синтетического CJS-модуля, скомпилированного в памяти, потому что прямой `import()` из вшитого
  SEA-main перехватывается embedder-хуком и умеет только builtin'ы. Тот же приём и у `runAsNode`.
  ESM-расширения не экзотика: `esbenp.prettier-vscode` с 12.x — `"type": "module"`.
- **vscode-стаб:** subprocess патчит `Module._cache["vscode"]` + `Module._resolveFilename`
  (`installVscodeStub`), поэтому `require("vscode")` расширения отдаёт нашу поверхность. Для ESM тот
  же `installVscodeStub` ставит `module.registerHooks` (`resolve` + `load`): CJS-кэш ESM-loader'у не
  виден, и `import … from "vscode"` без хука падает на `ERR_MODULE_NOT_FOUND`. Хук отдаёт
  сгенерированный модуль с именованным export'ом на каждый член namespace'а (`buildVscodeEsmShim`),
  значения он читает из `globalThis` — замыканием их в исходник не передать; эталон держит эти два
  механизма рядом по той же причине. Сама поверхность собрана в `workbench/api/common/` — тонкий
  ассемблер `buildVscodeNamespace(rpc)` над общим контекстом
  (`window`/`workspace`/`languages`/`commands` + value-типы `Position`/`Range`/`Uri`/enum'ы).
  Документы держат **стабильную идентичность** (`DocumentRegistry`: один объект на `fileName`,
  обновления мутируют его на месте — нужно для `activeTextEditor.document === doc`).
- **Идентичность расширения (G7):** `vscode` раздаётся ПО ИМПОРТЁРУ. Субпроцесс держит индекс корней
  расширений (`api/common/extensionPaths.ts`: самый длинный корень-предок по сегментам пути, корень
  за симлинком — под обоими именами), наполняемый из каталога `extensions.catalog` и в
  `host.activateExtension` до загрузки модуля. CJS-патч `_resolveFilename` отдаёт `vscode:<id>` по
  `parent.filename` и лениво кладёт под этот ключ API расширения; ESM-хук `resolve` —
  `diode-vscode:api/<id>` по `context.parentURL` (на Node с `registerHooks` этот же хук видит и
  `require`). Builtin, скомпилированный в памяти, опознаётся по синтетическому `filename`. API
  расширения — **тонкий оверлей** поверх общего namespace (`api/common/extensionApiFactory.ts`), а
  не своя копия неймспейсов: собственные свойства — дескрипторы общего (геттеры вроде
  `window.activeTextEditor` живые, value-типы общие: `api1.Position === api2.Position`), перекрыты
  лишь `window`/`languages`/`commands`, где явный список синхронных «создающих» членов
  (`createOutputChannel`, `createStatusBarItem`, активные `register*Provider`,
  `createDiagnosticCollection`, `registerCommand`, …) обёрнут в `ExtensionOwner.runAs(id, …)` —
  «окружающего владельца» из общего контекста (`IVscodeHostContext.owner`). Импортёр вне известных
  корней получает общий namespace и одно предупреждение в stderr. Полную фабрику API на расширение
  (как `createApiFactoryAndRegisterActors` эталона) не делаем: обработчики RPC живут внутри фабрик
  неймспейсов, и копия на расширение их бы размножила — переписывание тысяч строк ради того, что
  оверлей даёт за пару сотен. Автоснятия регистраций при деактивации нет, как и у эталона (только
  `subscriptions`): живой выгрузки расширения у нас нет. Атрибуция по стеку (`unhandledRejection`,
  `console.*` расширения → канал `extensions.host.<id>`) не сделана — открытый пункт в [индексе
  TODO](../TODO/README.md#extension-host).
- **Языковые провайдеры — реестр ядра (G2, как upstream
  `MainThreadLanguageFeatures`/`ExtHostLanguageFeatures`):** селекторы и скоринг живут в ядре —
  `editor/common/languageSelector.ts` (`score`: 10 точное совпадение, 5 — `*`, у массива максимум;
  `RelativePattern`, `exclusive`), `editor/common/languageFeatureRegistry.ts`
  (`register/has/ordered/onDidChange`: по убыванию score, при равном — более поздняя регистрация
  первой, `onDidChange` на КАЖДУЮ регистрацию и снятие),
  `editor/common/services/languageFeatures.ts` (`ILanguageFeaturesService` — реестр на фичу: hover,
  definition, references, signatureHelp, completion, documentFormatting/documentRangeFormatting,
  codeAction, foldingRange, inlineCompletions, documentSemanticTokens/documentRangeSemanticTokens;
  биндинг в `tokenizationModule`). Субпроцесс на каждый `register*Provider` выдаёт handle и шлёт
  `languages.register {handle, kind, selector, …metadata}` (селектор — DTO `toWireLanguageFilters`:
  строка → `{language}`, `RelativePattern` → `{base: fsPath, pattern}`; метаданные — триггер-символы
  completion/signatureHelp, `providedCodeActionKinds`, легенда семантических токенов и
  `hasOnDidChange`), dispose — `languages.unregister {handle}`. Хост держит регистрации
  (`getLanguageProviders`/`onLanguageProvidersChanged`) и снимает их все на смерти/остановке
  субпроцесса; `api/browser/languageFeaturesAdapter.ts` (порт `IExtensionLanguageFeaturesBridge`)
  регистрирует в реестрах прокси `{provideX: (req) => host.provideX(handle, req)}` — подключён один
  раз в `extensionHostModule.ts` и `ExtensionTestHarness`. Запрос `languages.provideX` несёт handle
  — субпроцесс зовёт ровно этого провайдера. Агрегация — у потребителя, по upstream:
  hover/definition/references — параллельно и склейка в порядке `ordered`
  (`contrib/hover/browser/getHover.ts`, `contrib/gotoDefinition/browser/goToSymbol.ts`,
  `contrib/references/browser/getReferences.ts`), signatureHelp — по очереди до первого ответа
  (`contrib/parameterHints/browser/provideSignatureHelp.ts`), formatting — документный форматтер по
  score, за ним range-провайдер на полный диапазон (`editor/contrib/format/format.ts`; `null` = «нет
  форматтера» решается по реестру, без RPC), code actions — с отсевом по `providedCodeActionKinds`
  (`editor/contrib/codeAction/codeAction.ts`). Документ без подошедших провайдеров RPC не будит
  вовсе. **Пачка:** пока запросы несут полный текст документа (до document sync дельтами — G3), фичи
  «на каждый символ» (completion, folding, inline) зовут прокси одним объектом запроса, и хост
  склеивает их в один RPC `{handles, …}` (`services/extensions/common/providerRequestBatcher.ts`),
  ответ — массив, выровненный по handles. Новая языковая фича = вид в `WIRE_LANGUAGE_FEATURE_KINDS` +
  реестр в `ILanguageFeaturesService` + фабрика прокси в адаптере + `provideX(handle, …)` хоста +
  обработчик по handle в субпроцессе; полей-швов на `EditorService` и флагов подписки больше нет.
  **События провайдера** (`onDidChange*` расширения) едут нотификацией с handle — первой такой стала
  `languages.didChangeSemanticTokens`: регистрация несёт `hasOnDidChange`, подписка живёт, пока
  провайдер зарегистрирован (параметр `subscribe` у `registerByHandle`), адаптер отдаёт прокси
  `onDidChange` — срез общего события моста по handle (upstream `eventHandle`).
- **Save-participant / completion seams:** `TextFileModel.save()` асинхронный — участники сохранения
  `await`-ятся до записи (правки клампятся к границам, уходят одним undoable-батчем). Пайплайн —
  `TextFileSaveParticipant` (`services/textfile/common/textFileSaveParticipant.ts`, аналог
  upstream): один экземпляр на все модели держит `TextFileModelService`, модель зовёт его перед
  записью и в `save`, и в `saveAs`; состав берётся у провайдеров в момент save (живые настройки) —
  `EditorService` регистрирует их через `TextFileModelService.addSaveParticipant` в порядке VS Code:
  участник `editor.codeActionsOnSave` → участник `editor.formatOnSave` (оба —
  `services/editor/browser/onSaveParticipants.ts` поверх реестров `ILanguageFeaturesService`;
  участник входит в пайплайн, только если для ЭТОГО документа есть подходящий провайдер) → will-save
  расширений (`EditorService.saveParticipant` ← host `onWillSaveTextDocument`). Каждый участник
  получает свежий снапшот (предыдущий мог править буфер), ограничен таймаутом 5000 мс (зависший —
  пропуск, сохраняем как есть), сбойный пропускается. С дефолтами (настройки выключены) пайплайн =
  один will-save участник — поведение прежнее; без host'а список пуст. Сама запись — через
  `IFileService.writeFile` (атомарно, с гардом по etag), поэтому `save()` асинхронный и без
  участников. Инъекция seam'ов — в `src/vs/diode/modules/extensionHostModule.ts`; **ядро
  (`TextFileModel`/`EditorService`) про extension-слой не знает.**
- **Folding-провайдер seam (#194):** `languages.registerFoldingRangeProvider` — путь host↔subprocess
  по образцу completion (`languages.provideFoldingRanges` RPC). Реестр —
  `ILanguageFeaturesService.foldingRangeProvider` (тип `editor/common/languages/iFoldingSource.ts`),
  `EditorService` отдаёт его каждому `EditorComponent`; тот при пересчёте фолдов запрашивает области
  подошедших провайдеров (пачкой) и **мержит их поверх indentation-фолдов** (union: provider ∪
  indentation, provider выигрывает по общей `startLine`), перенося `isCollapsed` по `startLine`.
  Пересчёт идёт и на `onDidChange` реестра — на каждую регистрацию/снятие, так что провайдер,
  появившийся после открытия файла (в том числе второй), подхватывается — после задержки
  пересчёта ([Editor.md](Editor.md#folding)), тестам — `waitUntil` из `TestUtils/timing.ts`. Стоковый
  `maptz.regionfolder` заводится этим путём (тест `extensionHost.maptzRegionfolder.test.ts`).
- **Editor-write seam (#194):** `TextEditor.edit(cb)` (с `TextEditorEdit` insert/replace/delete),
  `editor.selection(s)` геттер/сеттер, `window.visibleTextEditors`, value-тип `Selection`.
  Правки/выделения субпроцесса едут хосту (`editor.applyEdit` / `editor.setSelection`) и применяются
  к активному редактору порта `IEditorOptionsService` (правки — одним undoable-батчем через
  `applyExternalEdits`, с клампом к границам; guard по совпадению uri).
- **Workspace-edit seam (#196):** `workspace.applyEdit(WorkspaceEdit)` — обобщение editor-write на
  несколько ресурсов: субпроцесс сериализует текстовые правки per-uri
  (`IWireApplyWorkspaceEditParams`) и шлёт RPC `workspace.applyEdit`; хост применяет через
  `IEditorOptionsService.applyWorkspaceEdit` (документ ищется в ЛЮБОЙ вкладке, каждый — своим
  undoable-батчем; all-or-nothing по валидации: закрытый или read-only ресурс — честный `false` без
  применения чего-либо). Файловые операции `WorkspaceEdit` не поддержаны — субпроцесс отвечает
  `false` сам, без RPC; сниппет-правки (`SnippetTextEdit` — класс-ловушка конвертера клиента)
  применяются текстом со стрипом плейсхолдеров. Люфты — [API-COVERAGE](../public/API-COVERAGE.md).
- **Document sync (LSP) — зеркало документа в субпроцессе (G3, как `$acceptModelChanged` эталона):**
  `editor.didOpen` — полный снапшот (`IWireDocumentSyncSnapshot`: uri, languageId, `version` =
  `versionId` модели, text — одной строкой, а не `lines` эталона: на 200 К строк массив строк
  стоит главному потоку больше, см. комментарий `snapshotOf`), дальше `editor.didChange` — правки батча модели
  (`IWireDocumentChangedEvent`: `{range, text}[]` в порядке применения, `version` после батча,
  isDirty) из `ITextDocument.onDidChangeModelContent`; замена содержимого целиком (flush, перечитка
  с диска) едет снапшотом в том же `didChange`. Продюсер — `bindDocumentSync`
  (`api/browser/documentSyncAdapter.ts`, проводка в module/харнессе) через порт
  `IDocumentSyncTarget`. Через порт едет не снапшот, а **источник** (`IDocumentSyncSource`: uri,
  languageId, version, isDirty, `length` — длина LF-текста из PieceTree без его сборки, `getText()`):
  текст строится только в `DocumentsCustomer`, прямо перед отправкой, для живого субпроцесса и
  документа в пределах порога; без субпроцесса (файл открыт раньше, чем он поднялся) и для документа
  сверх порога текст не строится вовсе, а семя на handshake строит тексты по одному, не все разом.
  Документ для расширений — пара «uri + languageId», а не модель: продюсер
  помнит, под какими uri и языком открыл модель субпроцессу, и Save As (новый uri у той же модели)
  или смена языка шлют `didClose` прежнего uri и `didOpen` нового снапшота, как эталон
  (`$acceptModelLanguageChanged`, Save As в новый ресурс); закрытие последней вкладки закрывает
  запомненный uri. Каждый батч уходит **синхронно, без коалесинга и без гейта подпиской**: запрос
  провайдера, ушедший следом, едет по тому же каналу после правки, а пропуск любой правки испортил
  бы зеркало. Хост (`DocumentsCustomer`) шлёт правки только документам, которые субпроцессу открыл
  (`synced` спавна; семя открытых документов на handshake тоже открывает); порог синхронизации — 50
  Mi символов (опция `maxSyncedDocumentChars`, как `_MODEL_SYNC_LIMIT` эталона) решается на
  открытии по `length` источника, как `isTooLargeForSyncing` эталона по длине буфера: документ сверх
  него для расширений не существует, а flush, переросший порог, его закрывает. Так же не существует
  документ в [режиме большого файла](Editor.md#режим-большого-файла) (`isTooLargeForTokenization`
  источника, 20 МБ / 300 К строк): «Enable Editing» шлёт flush, и он открывается. `applyEdit` в такую модель отвечает `false`: она только для чтения, а расширение правку всё равно бы не увидело. Состояние без движения текста (сохранение, перезагрузка с диска, смена EOL) едет `editor.didChangeDocumentState` и зажигает `onDidChangeTextDocument` с пустым `contentChanges`, как `$acceptDirtyStateChanged` эталона; смена EOL — новая версия документа, строки зеркала без `\r`, разделитель — по `eol`. Синхронизируются документы вкладок и сторон дифф-вкладок
  (`IEditorService.getTextSurfaces`), но не панели Output: строка лога канала RPC, уехав правкой,
  порождала бы новую. Субпроцесс (`DocumentSyncTracker`): `open` — снапшот (новый ресурс →
  `onDidOpenTextDocument`, изменившийся текст → одна full-range правка), `change` — правки
  применяются к строкам зеркала по одной (`ExtHostTextDocument.acceptChanges`,
  `rangeOffset`/`rangeLength` по строкам до каждой правки), `onDidChangeTextDocument` несёт
  настоящие `contentChanges` и `document.version` = версия модели; правки неоткрытого документа
  отбрасываются с предупреждением. **Запросы текста не везут:** `languages.provide*` и will-save
  несут `version` (`versionId` модели на момент запроса, в ядре — поле `versionId` seam-запросов
  `editor/common/languages/i*Source.ts`); хост по несинхронизированному документу отвечает пусто без
  RPC (`isSynced`), субпроцесс берёт документ из зеркала (`DocumentSyncTracker.resolve`) и отвечает
  пусто, если он не открыт или запрос устарел (версия запроса позади зеркала); версия впереди
  зеркала — нарушенный порядок, предупреждение. Как у эталона, корректность держит порядок сообщений
  в одном канале, а не текст в запросе. Активный документ пушится на `host.ready` ДО активации
  (стоковый `vscode-languageclient` читает `workspace.textDocuments` на `start()`). Не делаем:
  отложенную эмиссию событий модели (`beginDeferredEmit` эталона), префикс-суммы для offset,
  debounce `didChange`, синхронизацию по жизненному циклу моделей вместо вкладок, `reason` Undo/Redo
  в событии изменения.
- **Definition-провайдер seam (LSP):** `languages.registerDefinitionProvider` — калька с completion
  (`languages.provideDefinition` RPC, таймаут 5000 мс — холодный language server). Реестр —
  `ILanguageFeaturesService.definitionProvider` (тип
  `editor/common/languages/iDefinitionSource.ts`); UI — contrib `gotoDefinition`
  (`DefinitionService` + F12 `editor.action.revealDefinition`), кросс-файловая навигация паттерном
  Problems reveal (`openUri` + `goToPosition`). Результат провайдера
  `Location | Location[] | LocationLink[]` нормализуется субпроцессом (у LocationLink прицел —
  `targetSelectionRange ?? targetRange`). Ответы всех провайдеров сводит `createLocationModel`
  (`goToSymbol.ts`, калька с `ReferencesModel`): сортировка по uri и диапазону, без точных дубликатов,
  отдельно первая цель в порядке провайдера. Ноль целей — info-тост «No definition found for 'x'»
  (инлайн-сообщения у курсора, `MessageController`, нет — отступление). Одна цель — переход, а если
  она уже под курсором — `editor.gotoLocation.alternativeDefinitionCommand` с защитой от рекурсии.
  Несколько — по `editor.gotoLocation.multipleDefinitions`, и роль Peek-виджета (его нет — отступление)
  играет панель References: `ReferencesService.showLocations(title, locations, active, {reveal})`,
  заголовок секции задаёт вызывающий. `goto` кладёт цели в панель без показа, по ним ходят F4/Shift+F4.
  Цели в панели могут быть недисковыми: группа хранит `uri`, текст строк — от провайдера схемы.
  Команды с аргументами от расширений (`editor.action.goToLocations`, `peekLocations`, алиас
  `showReferences`, без пункта в палитре) терпят JSON-форму uri — разбор в `goToLocationsArguments.ts`.
  **Implementation** (`languages.registerImplementationProvider`, RPC `languages.provideImplementation`,
  реестр `implementationProvider`, Ctrl+F12 `editor.action.goToImplementation`) — тот же шов: обработчик
  в субпроцессе общий (`provideLocations`), а `DefinitionService` параметризован видом запроса
  (`ISymbolNavigation`: заголовок панели, сообщения, ключи настроек, реестр). Peek-вариант
  (`editor.action.peekImplementation`) не заводим — роль Peek играет панель.
  **Type Definition и Declaration** (`registerTypeDefinitionProvider`, `registerDeclarationProvider`,
  RPC `languages.provideTypeDefinition`/`provideDeclaration`, команды `editor.action.goToTypeDefinition`
  и `editor.action.revealDeclaration`, без клавиш — как в эталоне) — ещё два `ISymbolNavigation` на том же
  шве. `editor.action.goToDeclaration` в эталоне — устаревший алиас `revealDefinition`, его не заводим.
- **Провайдер содержимого недисковых ресурсов:** `workspace.registerTextDocumentContentProvider` —
  дверь, которой в редактор попадают исходники, которых нет на диске (`jdt:`/`class:` у стокового
  `redhat.java`: класс из jar, исходник JDK, декомпиляция). Проводка — калька с провайдеров ФС:
  реестр субпроцесса (`SubprocessTextDocumentContentProviders`, чистая логика без RPC) объявляет
  хосту свои схемы нотификацией `workspace.textDocumentContentProvidersChanged`, содержимое едет
  обратным запросом `workspace.provideTextDocumentContent` (текстом, а не base64 — провайдер отдаёт
  строку, не байты), `onDidChange` провайдера — нотификацией `workspace.textDocumentContentChanged`.
  Core-seam — `EditorService.virtualDocumentSource` (тип
  `workbench/services/editor/common/iVirtualDocumentSource.ts`), инъекция в
  `ExtensionHostModule`/`ExtensionTestHarness`; вкладка получается синтетической моделью
  (`TextFileModel.openSynthetic`) с `readOnly` — контракт `TextDocumentContentProvider` про
  read-only документы прямо и говорит. **Реестр отдельный от `IFileSystemProviderRegistry`**, как в
  эталоне: одна схема может иметь и провайдера ФС, и провайдера содержимого. На одну схему можно
  несколько провайдеров (новый спрашивается первым, отвечает первый со строкой, упавший не мешает
  остальным); запрещены ключи `Schemas` эталона (`file`, `untitled`…). Открытый так документ живой:
  он в `textDocuments`, а пока вкладки нет, субпроцесс сам перечитывает его по `onDidChange`.
  Отступление: без вкладки он не закрывается по таймеру, как модель в эталоне.
- **Язык документа без модели:** `setTextDocumentLanguage` идёт на хост (`languages.changeLanguage`).
  Есть модель — смена в ней даёт `editor.didClose`/`editor.didOpen`. Нет — ответ `applied: false`,
  пару событий выдаёт сам субпроцесс, а хост держит выбор до появления вкладки
  (`EditorLayoutServiceAdapter.pendingLanguages`). Язык документа без модели субпроцесс тоже
  спрашивает у хоста (`languages.getLanguageOfDocument`), иначе там был бы `plaintext`.
- **API-команды `vscode.execute*`** (`apiCommands.ts`): как `vscode.open`, живут в субпроцессе и в
  `getCommands` не входят. Completion и code action спрашивают провайдеров этого же субпроцесса и
  отдают их объекты; `vscode.executeLinkProvider` всегда отдаёт `[]`: провайдеры ссылок — no-op.
  `workspace.openTextDocument` по такой схеме спрашивает провайдера локально, без RPC, — он живёт в
  том же субпроцессе. Неудача открытия (схемы никто не обслуживает, провайдер отказался или
  сломался) — **не исключение**: `EditorService.openUri` не отклоняется никогда, причина уезжает в
  лог и хук `onOpenFailed`, а человек видит её тостом (`OpenFailureNotificationContribution`). Это
  не гигиена: раньше не-`file:` ресурс доезжал до `TextFileModel.openFile`, тот бросал, промис
  команды никто не ждал — и Node закрывал редактор со всеми буферами.
- **Безымянный документ расширения:** `workspace.openTextDocument({ content, language, encoding })`
  — калька с `$tryCreateDocument` эталона: запрос `workspace.createUntitledDocument` →
  `EditorService.createUntitled` заводит обычную untitled-модель ядра (та же, что у File → New
  Untitled File: общий счётчик `Untitled-N`, Save As, confirm на закрытии), но **без вкладки** — до
  показа ею владеет сервис (`getUntitledModelsWithoutEditor`). Документ сразу открыт расширениям:
  `bindDocumentSync` считает такие модели документами наравне с текстовыми поверхностями,
  `editor.didOpen` уходит синхронно внутри создания — раньше ответа на запрос, так что после `await`
  документ уже в `workspace.textDocuments`. Непустой `content` — несохранённая правка (буфер
  грязный, как `initialValue` эталона). `window.showTextDocument` по его ресурсу — `openUri`
  забирает модель во вкладку (владение переходит к ней), повторного didOpen нет: модель та же.
  `openTextDocument(untitled:…)` — калька с `_handleUntitledScheme`: тот же запрос с `uri`, модель
  живёт под этим ресурсом побайтно (`setUntitledResource`), с путём она грязная с самого начала
  (`associatedResource`), язык — из пути, существующий файл — отказ. Расширению пустой безымянный
  документ сразу читается грязным («mark as dirty» эталона), а модель и вкладка чистые до первой
  правки. `save` пишет по абсолютному пути (`saveAs` модели: `didClose` untitled, `didOpen` файла,
  тот же таб); относительный ресурс и ресурс с хостом пути не имеют — Save As (отступление: эталон
  пишет в `/new.txt`). Текстовая правка оживляет неизвестный untitled-ресурс, `createFile` на него
  пропускается, как в `CreateFileEdit`.
- **Hover-провайдер seam (LSP):** `languages.registerHoverProvider` — калька с definition
  (`languages.provideHover` RPC, таймаут 5000 мс). Ядро спрашивает все подошедшие провайдеры и
  склеивает непустые ответы в порядке реестра (`ICoreHover {contents, range?}`, contents — блоки
  сырого markdown; `MarkedString {language, value}` сериализуется fenced-блоком). Реестр —
  `ILanguageFeaturesService.hoverProvider` (тип `editor/common/languages/iHoverSource.ts`); UI —
  contrib `hover` (пара `HoverService`/`HoverComponent` по образцу suggest: overlay-сессия у каретки
  без захвата фокуса, `stripMarkdown` в плоский текст, закрытие по Escape/правке/каретке/фокусу;
  ключ `editorHoverVisible`).
- **References-провайдер seam (LSP):** `languages.registerReferenceProvider` — та же калька
  (`languages.provideReferences` RPC, таймаут 5000 мс; в параметрах LSP-контекст
  `includeDeclaration`). Ядро спрашивает все подошедшие провайдеры и склеивает ответы в порядке
  реестра (`ICoreReference {uri, range}`, сериализатор общий с definition). Реестр —
  `ILanguageFeaturesService.referenceProvider` (тип `editor/common/languages/iReferenceSource.ts`);
  UI — contrib `references` (вьюлет сайдбара REFERENCES: `ReferencesService` спрашивает провайдеров
  и добирает текст строк, `ReferencesComponent` рисует список; ключи `referencesViewletVisible` /
  `hasReferenceResult`). Особенность против definition/hover: ответ несёт только координаты, поэтому
  строку кода панель читает сама — из открытой модели, иначе через `IFileSystemProviderRegistry`.
- **Rename seam (LSP):** `languages.registerRenameProvider` — первый провайдер, который сразу
  написан под **реестр ядра по handle** (серия G2): субпроцесс объявляет регистрацию нотификацией
  `languages.register` (`kind: "rename"`), `LanguageFeaturesAdapter` держит её прокси в
  `ILanguageFeaturesService.renameProvider`, а ядро зовёт хост уже с выбранным handle. Два RPC:
  `languages.prepareRename` (таймаут 5000 мс) и `languages.provideRenameEdits` (10000 мс — внутри
  ещё два круга RPC). Скоринг селекторов и порядок опроса — на стороне ядра
  (`contrib/rename/browser/renameSymbol.ts`): ответы НЕ склеиваются, результат даёт первый
  провайдер, которому есть что сказать, а его отказ перебор останавливает. **Правки остаются в
  субпроцессе** и ложатся существующим `workspace.applyEdit` — как у code actions: ядру не нужен
  `WorkspaceEdit`, а rename бесплатно получает bulk edit целиком (закрытые файлы, ОДИН шаг отмены).
  Потребитель — contrib `rename` (`RenameService` + `editor.action.rename`/F2, новое имя через
  `QuickInputService.input`).
- **Selection range seam (LSP):** `languages.registerSelectionRangeProvider` — по рецепту реестра
  (`kind: "selectionRange"`, `ILanguageFeaturesService.selectionRangeProvider`, RPC
  `languages.provideSelectionRanges` с позициями всех кареток, 5000 мс). Цепочку `parent` субпроцесс
  разворачивает в `IRange[]` на позицию (`serializeSelectionRanges`), класс `vscode.SelectionRange`
  нужен в рантайме: его конструирует конвертер vscode-languageclient. Слияние ответов со встроенными
  ступенями — `editor/contrib/smartSelect/smartSelect.ts` (порт `provideSelectionRanges` эталона),
  стек Expand/Shrink — `SmartSelectController`, команды — contrib `smartSelect`.
- **Linked editing seam (LSP):** `languages.registerLinkedEditingRangeProvider` — по рецепту реестра
  (`kind: "linkedEditingRange"`, `ILanguageFeaturesService.linkedEditingRangeProvider`, RPC
  `languages.provideLinkedEditingRanges`, 5000 мс). Субпроцесс отдаёт `{ranges, wordPattern?, wordPatternFlags?}`
  или `null`, если нет массива `ranges`; `RegExp` пересекает провод источником и флагами, в ядре собирается
  заново. Ответ берётся у первого провайдера с непустыми `ranges`. Класс `vscode.LinkedEditingRanges` нужен в
  рантайме: его конструирует конвертер vscode-languageclient. Потребитель — `LinkedEditingController`
  ([Editor.md](Editor.md#editorcontriblinkedediting-связанная-правка-тегов)).
- **On type formatting seam (LSP):** `languages.registerOnTypeFormattingEditProvider` — по рецепту реестра
  (`kind: "onTypeFormatting"`, `ILanguageFeaturesService.onTypeFormattingEditProvider`, RPC
  `languages.provideOnTypeFormattingEdits`, 5000 мс). `firstTriggerCharacter` и `moreTriggerCharacter` едут
  метаданными `triggerCharacters`; ответ — `ITextEdit[]`, отказ — пустой список. Потребитель — `FormatOnTypeController`
  ([Editor.md](Editor.md#editorcontribformat-format-on-type)).
- **Color seam:** `languages.registerColorProvider` — по рецепту реестра (`kind: "color"`,
  `ILanguageFeaturesService.colorProvider`, RPC `languages.provideDocumentColors`, 5000 мс; отмена по
  новой правке уходит провайдеру токеном). Субпроцесс отдаёт `IColorInformation[]`
  (`serializeDocumentColors`: канал вне 0..1 клампится, NaN/битый диапазон отбрасывают один цвет) или
  `null`, если цветов нет — пустой ответ, не массив, сбой (`reportProviderFailure` с id расширения) или
  таймаут. `null` в `getColors` не считается ответом, и в `auto` работает встроенный детектор —
  **отступление** по спеке #884: эталон глушит детектор самой регистрацией провайдера на документ.
  Классы `vscode.Color`/`ColorInformation`/`ColorPresentation` — в рантайме (их конструирует
  конвертер vscode-languageclient); пикера нет, `provideColorPresentations` не вызывается.
- **Inlay hints seam:** `languages.registerInlayHintsProvider` — по рецепту реестра (`kind: "inlayHints"`,
  `ILanguageFeaturesService.inlayHintsProvider`, RPC `languages.provideInlayHints`, 5000 мс; отмена по новой
  правке уходит провайдеру токеном). Субпроцесс отдаёт `IWireInlayHint[]` (`serializeInlayHints`: пустая метка
  и позиция вне запрошенного диапазона отбрасывают одну подсказку, как `_isValidInlayHint` эталона) или `null`,
  если подсказок нет — пустой ответ, не массив, сбой (`reportProviderFailure` с id расширения) или таймаут.
  Хост разбирает ответ `wireToCoreInlayHints`: битая позиция и неизвестный `kind` стоят одной подсказки.
  `onDidChangeInlayHints` объявляется в регистрации (`hasOnDidChange`) и идёт нотификацией
  `languages.didChangeInlayHints` до события прокси; контроллер перезапрашивает. **Отступления:**
  `resolveInlayHint` и кэш сессий не делаем, поэтому `$releaseInlayHints` нет и `dispose` списка — пустой; по
  проводу не едут `tooltip`, `textEdits`, `location` и `command` частей (у подсказки нет ни наведения, ни
  клика, [InlayHintsCodeLens.md](../TODO/InlayHintsCodeLens.md)); `displayName` не возим.
- **Code lens seam:** `languages.registerCodeLensProvider` — по рецепту реестра (`kind: "codeLens"`,
  `ILanguageFeaturesService.codeLensProvider`, RPC `languages.provideCodeLenses` и `languages.resolveCodeLens`,
  по 5000 мс; отмена уходит провайдеру токеном). Как `CodeLensAdapter` эталона, субпроцесс держит оригинальные
  линзы ответа в сессии (`ICodeLensRegistration.sessions`), по проводу идёт `IWireCodeLensList {cacheId, lenses}`,
  у линзы — адрес `[session, index]`, диапазон и команда `{id, title, tooltip?}` **без аргументов**. Линза без
  диапазона отбрасывается с предупреждением и id расширения, индексы остальных не сдвигаются; пустой ответ, сбой
  (`reportProviderFailure`), отмена и таймаут — `null`, сессии не остаётся. `resolveCodeLens` зовётся на оригинале,
  только если у линзы ещё нет команды; ответ заменяет оригинал в сессии (провайдер вправе вернуть новый объект), без
  команды — `INVALID code lens resolved, lacks command` в лог и `null`. `dispose` списка в ядре —
  нотификация `languages.releaseCodeLenses`; снятие провайдера освобождает сессии вместе с регистрацией.
  `onDidChangeCodeLenses` объявляется в регистрации (`hasOnDidChange`) и идёт нотификацией
  `languages.didChangeCodeLenses` до `onDidChange` прокси.
  **Путь команды — отступление от `_generated_`-механизма эталона** (`CommandsConverter.toInternal`), решение
  человека в #937: прокси `LanguageFeaturesAdapter` кладёт в `CodeLensCommand` поле `run`, и `runCodeLensCommand`
  вызывает его вместо реестра → `languages.executeCodeLensCommand {handle, cacheId}` (без таймаута) → субпроцесс
  берёт команду линзы и зовёт `commands.executeCommand(id, ...arguments)` с настоящими объектами: своя команда
  расширения и API-команда исполняются на месте, команда хоста (`editor.action.showReferences`) уходит
  обычным `commands.executeCommand`, и её аргументы сериализуются только тут. Отказ команды отвергает запрос, и хост
  показывает тост. Хост отвечает на неизвестный id `undefined`, поэтому субпроцесс сперва сверяется
  (`ICodeActionDeps.hasCommand`) и отвергает с `command 'x' not found`, как эталон. Линза, снятая под кликом, просто
  ничего не исполняет. У линз провайдеров ядра `run` нет — у них реестр, как раньше. **Известный остаток:** ответ,
  дошедший до хоста уже после отмены запроса, отбрасывается, и его сессия живёт до снятия провайдера (так и в эталоне).
- **Signature-help seam (LSP):** `languages.registerSignatureHelpProvider` — та же калька
  (`languages.provideSignatureHelp` RPC, таймаут 5000 мс), но с двумя отличиями. Первое: провайдеров
  обходим по очереди и возвращаем ПЕРВЫЙ непустой ответ (vscode API предписывает именно это —
  склеивать две разные `activeParameter` нечем). Второе: в параметрах едет LSP-контекст
  (`triggerKind`, `triggerCharacter`, `isRetrigger`, эхо показанной подсказки `activeSignatureHelp`
  — по нему сервер удерживает выбранную пользователем перегрузку). Триггер- и ретриггер-символы
  объявляет сервер: они едут метаданными регистрации провайдера, и ядро берёт их только у подошедших
  документу. Реестр — `ILanguageFeaturesService.signatureHelpProvider` (тип
  `editor/common/languages/iSignatureHelpSource.ts`); UI — contrib `parameterHints`
  (`ParameterHintsService` ловит набор триггер-символа и перезапрашивает подсказку на каждую правку,
  `ParameterHintsComponent` держит overlay-сессию НАД строкой каретки; ключи `parameterHintsVisible`
  / `parameterHintsMultipleSignatures`). Стаб `vscodeTypes` пришлось дополнить value-классами
  `SignatureHelp`/`SignatureInformation`/`ParameterInformation` и enum'ом `SignatureHelpTriggerKind`
  — их конструирует и читает конвертер стокового клиента.
- **Formatting seam (#196):** `languages.registerDocumentFormattingEditProvider` /
  `registerDocumentRangeFormattingEditProvider` — ОДИН RPC `languages.provideFormattingEdits` на оба
  вида (наличие `range` в параметрах переключает на range-провайдеры). Запрос — к провайдеру по
  handle; `[]` — менять нечего/сбой/таймаут, иначе — wire-правки текста (`IWireEditorEdit`, общие с
  `editor.applyEdit`). Выбор форматтера — в ядре (`editor/contrib/format`): документный по score,
  без него — range-провайдер полным диапазоном; нет ни того ни другого — «нет форматтера» без RPC.
  Реестры — `ILanguageFeaturesService.documentFormattingEditProvider` /
  `documentRangeFormattingEditProvider` (типы `editor/common/languages/iFormattingSource.ts`);
  потребитель — команды `editor.action.formatDocument` (Shift+Alt+F, на legacy — Ctrl+K Ctrl+E) /
  `formatSelection` (Ctrl+K Ctrl+F) в `contrib/format/browser/formatActions.ts`: без форматтера —
  transient-notice в статус-баре (своего beautifier нет намеренно), правки — одним undoable-батчем,
  устаревший ответ (текст/вкладка сменились за время RPC) отбрасывается.
- **Code-actions seam (#196):** `languages.registerCodeActionsProvider` — два RPC:
  `languages.provideCodeActions` (метаданные действий `{id, title, kind, isPreferred, disabled}`,
  `disabled` — строка-причина из `CodeAction.disabled.reason`; контекст-диагностики субпроцесс
  собирает САМ из своих DiagnosticCollection по пересечению с range — те же объекты, что публиковал
  клиент) и `languages.applyCodeAction` (ленивый `resolveCodeAction` тем же объектом + правки
  существующим `workspace.applyEdit` + команда действия через локальный `executeCommand`; отказ
  правок глушит команду). Правки и команды НЕ пересекают границу ядра — ядро оперирует только id из
  кэша-вёдер (образец completion-resolve); глубина кэша (2 ведра) — **на провайдера**, как кэш
  адаптера в эталоне: меню опрашивает каждого провайдера отдельным запросом, и общая глубина
  вытесняла ответ самого быстрого до выбора пункта («Fix with Supermaven» → «Code action failed»
  рядом с tsserver и ещё одним провайдером); снятый провайдер уносит свои вёдра. Неактивные действия
  (`disabled`) — как эталон: Quick Fix и on-save их пропускают, организация импортов/fix all без
  активных показывает причину неактивного, меню с `only` (Refactor…/Source Action…) показывает их
  только когда активных нет — с причиной рядом с заголовком, выбор повторяет причину и не применяет
  (переключателя «Show Disabled» и серой отрисовки пункта нет). Реестр —
  `ILanguageFeaturesService.codeActionProvider` (`editor/common/languages/iCodeActionSource.ts`:
  `providedCodeActionKinds` из метаданных регистрации, `provideCodeActions`/`applyCodeAction`; выбор
  и склейка — `editor/contrib/codeAction`); потребители — source-команды
  `editor.action.organizeImports` / `fixAll` (полный диапазон + `only`, выбор `isPreferred` ??
  первого) и `editor.action.quickFix` (Ctrl+., чорд Ctrl+K Ctrl+Q; строка каретки/выделение без
  `only`, меню на `QuickInputService.quickPick`) в
  `contrib/codeAction/browser/codeActionActions.ts`; notices в статус-баре. Сборка зависимостей —
  ассемблер `buildVscodeNamespace` передаёт `workspace.applyEdit` / `commands.executeCommand` в
  `createLanguagesNamespace` (commands строится ДО languages).
- **Completion-провайдер seam (LSP):** `languages.registerCompletionItemProvider` — RPC
  `languages.provideCompletionItems` (пачкой `{handles, …}`, ответ —
  `ICoreCompletionResult {items, isIncomplete}` на каждый handle) и
  `languages.resolveCompletionItem` (`{id}` → detail/documentation/additionalEdits). Реестр —
  `ILanguageFeaturesService.completionProvider` (тип `CompletionItemProvider` в
  `editor/common/languages/iCompletionSource.ts`: триггер-символы из метаданных регистрации,
  `provideCompletionItems`, `resolveCompletionItem`); `CompletionService` склеивает пункты
  подошедших провайдеров (`contrib/suggest/browser/provideCompletions.ts`) и резолвит пункт у
  провайдера, который его отдал. Резолв идёт по id `"<cacheId>.<index>"` в кэш **последних 2 ответов
  субпроцесса**: клиенту нужно вернуть тот же самый объект пункта (`ProtocolCompletionItem` с
  приватным `data`), а не его копию. Триггер-символы сервера едут метаданными регистрации и видны
  только документам, которым провайдер подошёл. Грабли стека (падающий конвертер без
  `CompletionList`/`SnippetString`, dot-accessor-пункты) — [«LSP и стоковые клиенты»](#lsp-и-стоковые-клиенты).
- **Inline-completion seam (ghost text):** `languages.registerInlineCompletionItemProvider` — калька
  с completion, но проще: ОДИН RPC `languages.provideInlineCompletions` пачкой `{handles, …}` (без
  resolve и кэша идентичности — v1 не исполняет `item.command` и не шлёт lifecycle-хуки). Ядро
  склеивает ответы подошедших провайдеров
  (`ICoreInlineCompletionItem {insertText, filterText?, range?}`; `SnippetString` — текстом со
  стрипом плейсхолдеров; `selectedCompletionInfo` всегда `undefined` — при открытом suggest-попапе
  ядро ghost не запрашивает, а его закрытие (`CompletionService.onDidClose`: Esc/accept/уход из
  слова) перезапрашивает подсказку без правки). Реестр —
  `ILanguageFeaturesService.inlineCompletionsProvider` (тип
  `editor/common/languages/iInlineCompletionSource.ts`); UI — contrib `inlineCompletions`
  (`InlineCompletionsService`: авто-запрос на правку с дебаунсом 50 мс, latest-wins
  (`LatestRequest`), локальное сжатие/рост ghost при совпадающем наборе; рендер —
  `EditorElement.setGhostText`: хвост строки каретки + собственные view zones; Tab
  `editor.action.inlineSuggest.commit` / Esc `.hide`, ключи `inlineSuggestionVisible` и
  `inlineSuggestionHasIndentationLessThanTabSize` — имена дословно vscode). **Отмена**: запрос несёт
  настоящий `CancellationToken` — `InlineCompletionsService` заводит билет `LatestRequest` на запрос
  и гасит его, как только ответ перестал быть нужен (новый запрос, правка, уход каретки, Escape,
  смена активного редактора, `dispose`), а истёкший таймаут отменяет запрос уже на стороне хоста
  (`LanguageFeaturesCustomer.request`). Отменённый ответ не показывается, даже если провайдер отмену
  проигнорировал. Субпроцесс переводит транспортный токен в `vscode.CancellationToken` и прерывает
  обход пачки провайдеров — до следующего провайдера отменённый запрос не доезжает. Ключ
  `inlineSuggestionRequestPending` (нашего изобретения — у upstream отмена едет из observable-графа)
  продлевает биндинг Escape на окно ожидания ответа, когда призрака на экране ещё нет. Настройки
  `editor.inlineSuggest.{enabled,delay,requestTimeout}` читаются на каждом обращении (правка
  settings.json применяется без перезапуска); `enabled` гейтит ТОЛЬКО автозапрос — команда-триггер
  (**Alt+\\**) работает и при `false`. `requestTimeout` едет полем `timeoutMs` в САМОМ запросе, а не
  фиксируется при создании хоста, как остальные таймауты
  (`req.timeoutMs ?? options.inlineCompletionTimeoutMs`) — осознанная асимметрия ради
  live-применения. Люфты v1 — docs/TODO/InlineCompletions.md.
- **Транспорт отмены RPC:** `RpcEndpoint.request(method, params, { token?, timeoutMs? })` —
  сработавший токен вызывающего уходит второй стороне зарезервированной нотификацией
  `$/cancelRequest {id}` (аналог LSP), а принимающая сторона гасит токен, который выдаёт обработчику
  вторым аргументом (`IRequestHandler = (params, token) => unknown`). Транспорт общий для всех
  методов; подключение провайдера к отмене — это проводка токена, а не новый протокол. Ядро проводит
  свой токен у всех pull-запросов языковых фич: `*Provider.provide*(request, token)` → прокси
  `LanguageFeaturesAdapter` → `ExtensionHost.provide*` →
  `LanguageFeaturesCustomer.request(…, { token })`; источник токена — билет `LatestRequest`
  потребителя (у Format — `EditorStateCancellationTokenSource`), без токена намеренно — resolve
  пункта автодополнения (его ответ кэшируется и общий у панели описания и accept с правками
  авто-импорта, отменять его новым запросом нельзя; держит срок ответа), `applyCodeAction`
  (применение не отменяют посреди правок), разовые команды code actions и save-участники (конвейер
  сохранения токена не знает; устаревший ответ format on save отбрасывает сверка версии). Тихие
  края: отмена, пришедшая ПОСЛЕ ответа, не шлётся вовсе (подписка на токен снимается вместе с
  ответом), а отмена, обогнавшая свой запрос на переупорядоченном транспорте, запоминается
  (последние 64 id) и выдаётся обработчику уже отменённым токеном; `dispose` endpoint'а отменяет
  всё, что ещё считается. В субпроцессе каждый провайдер языковых фич и провайдер содержимого
  (`TextDocumentContentProvider`) получает настоящий `vscode.CancellationToken` поверх транспортного
  (`api/common/vscodeCancellation.ts`, подписка снимается по завершении вызова), а обход цепочки
  провайдеров (completion, folding, inline) на отмене прерывается. Сбой провайдера, кроме
  `CancellationError`, — строка в stderr с методом и стеком (`reportProviderFailure`):
  `[ext-host] [<id>] <method> failed: …`, где `<id>` — расширение, зарегистрировавшее провайдера
  (регистрация запоминает окружающего владельца G7 в момент `register*`; регистрация мимо оверлея —
  строка без `[<id>]`). Исключение — семантические токены: отказ провайдера (и устаревший запрос —
  `CancellationError`) уходит ядру исключением, а не пустым ответом, потому что `null` для
  `ModelSemanticColoring` — «токенов нет» и стёр бы подсветку (jdt.ls отвечает `ContentModified` на
  каждую правку во время запроса). Упавшая команда code action
  (`applyCodeAction command "<команда>"`) — туда же, а не молчаливым `false`; предупреждение
  `registerTextEditorCommand` без активного редактора тоже несёт id владельца; `RpcEndpoint`
  субпроцесса пишет свои warn туда же (`createStderrLogger`), host зеркалит stderr в канал
  `extensions.host.stderr`.
- **Срок ответа = отмена (G4):** `timeoutMs` в `request` — истёкший срок отменяет запрос тем же
  `$/cancelRequest` (провайдер видит токен, language server — свою отмену) и отклоняет промис
  `TimeoutError`, не дожидаясь опоздавшего ответа. Сроки pull-запросов хоста — одна таблица по
  методу провода `DEFAULT_REQUEST_TIMEOUTS` (`services/extensions/node/requestPolicy.ts`; тесты
  укорачивают опцией `requestTimeouts`), вместо опций `*TimeoutMs` на каждый провайдер; исключения —
  inline completions, срок которых едет в самом запросе, и `languages.provideCompletionItems`, у
  которого срока нет вовсе (как в upstream: по «пустому» ответу ядро открыло бы попап словами из
  буфера вместо пунктов медленного language server'а; ожидание ограничивает токен
  `CompletionService` — перезапрос, уход каретки из слова, закрытие). Срока нет и у
  `languages.provideInlayHints`, `languages.provideCodeLenses`, `languages.resolveCodeLens` (как в
  upstream: пустой ответ никто не перезапрашивает, и занятый импортом jdt.ls навсегда оставлял на кадре
  `no commands`; ожидание ограничивает токен контроллера — правка, закрытие). Хост шлёт через
  `loggingRequest`: истёкший срок — debug, отказ — warn с методом и ошибкой (стек доезжает целиком);
  результат в обоих случаях пустой, UI не ждёт.
- **Ошибки через RPC (G4):** отказ обработчика едет `SerializedError`
  (`base/common/errorSerialization.ts`, извлечение из upstream `errors.ts` без `noTelemetry`):
  `name`, `message`, `stack`, `code` и цепочка `cause` восстанавливаются у вызывающего
  (`transformErrorFromSerialization`) — `FileSystemError` расширения, `CancellationError` (узнаётся
  `isCancellationError` и после границы процесса) и стек провайдера не теряются. Бросили не `Error`
  — значение едет текстом сообщения.
- **Карта протокола (G4):** `api/common/extHostProtocol.ts` (калька upstream `extHost.protocol.ts`,
  только типы) — `IHostToSubprocess`/`ISubprocessToHost`: запросы `метод → [параметры, результат]` и
  нотификации `метод → параметры` каждого направления. `RpcEndpoint<TOut, TIn>` типизирует по ним
  `request`/`notify` (что шлёт сторона) и `handleRequest`/`handleNotification` (что принимает и
  обязана вернуть); алиасы `HostRpc` (хост, `IExtensionHostContext.rpc`) и `SubprocessRpc`
  (`IVscodeHostContext.rpc`) задают направление — хост не пошлёт метод, обработчик которого живёт на
  хосте. `RequestFn` (`services/extensions/node/hostRequests.ts`) берёт из той же карты и параметры
  запроса хоста, и тип ответа. Параметры в карте — то, что шлёт отправитель; принимающая сторона
  сужает доверие локально аннотацией (`const p: ЛокальныйВид = params`, поля необязательны). Ответ
  языковых запросов (`languages.*`, will-save) хост не перепроверяет (G5): форму провода гарантирует
  сериализатор субпроцесса (`api/common/extHostTypeConverters.ts`, калька upstream; G5 D1) —
  единственное место утиной проверки объекта расширения: конечность координат диапазонов, кламп
  `activeSignature`, конечный `kind`, непустые строки. Диапазон на проводе — везде core `IRange`
  (`{start, end}`, 0-based; G5 C1/C2): языковые запросы и ответы, правки (`IWireEditorEdit` = core
  `ITextEdit` — `TextEditor.edit`, workspace edit, formatting, правки-спутники resolve; will-save
  `WireTextEdit` = `ITextEdit` | смена EOL), дельты document sync, маркеры диагностик
  (`WireMarker.range`), декорации; плоской формы `startLine/…` в проводе нет (выделения
  `IWireSelection` — anchor/active, это не диапазон). Субпроцесс собирает любой диапазон «API →
  провод» одним `rangeFrom` (`extHostTypeConverters.ts`; утиный — подходит и `Range` чужого бандла,
  `Number.isFinite`, перевёрнутый разворачивает в `start <= end`): языковые ответы, правки
  (`TextEditor.edit`, workspace edit, will-save), маркеры, декорации. Битый диапазон выпадает вместе
  со своим элементом, а не роняет вызов расширения; если выпали все правки `TextEditor.edit` или
  текстовой операции workspace edit — ответ `false`, как дал бы разбор хоста. Там же сериализаторы
  ответов провайдеров (`serialize*`), опций декораций, `WorkspaceEdit` и обратные переводы провод →
  API (`toVscodeRange`, `toVscodeSelection`, `toVscodeSignatureHelp` — эхо `activeSignatureHelp`
  провайдер получает экземплярами API-классов), и ответы completion (с resolve), inline, definition,
  hover, references, formatting в карте — `ICore*`/`ITextEdit`: хост отдаёт их ядру как есть. Где
  хост — единственный валидатор (нотификации и запросы субпроцесса: `editor.applyEdit`,
  `workspace.applyEdit`, `diagnostics.publish`, декорации; у субпроцесса — `editor.didChange`),
  диапазон разбирает один `parseRange` в `wireTypes.ts`. В форму ядра хост переводит только то, что
  с ней ещё расходится: folding (`wireToCoreFoldingRegions`: floor/кламп/вырожденные — инвариант
  модели) и prepare rename. Все `provide*` хоста идут одним хелпером
  `LanguageFeaturesCustomer.request(method, params, empty)`: гарды «спавна нет» и «документ не
  синхронизирован» и исход сбоя (истёк срок, отказ RPC — `empty`; у rename — отказ с сообщением о
  причине) живут в одном месте. Прочие ответы субпроцесса (`workspace.fs.readFile`,
  `workspace.provideTextDocumentContent`, `window.inputBox.validate`) и нотификации субпроцесса
  по-прежнему проходят `parseWire*`. Код провода разделён по сторонам (G5 D2): в
  `api/common/wireTypes.ts` — общие типы провода (их держит карта `extHostProtocol.ts`) и разбор
  того, что читает субпроцесс (`parseWireDocumentChangedEvent`, `parseWireEditorLayout`, ответы
  хоста), плюс общие помощники `parseRange`/`isFiniteNumber`/`parseWireSelections`; host-only код —
  в `services/extensions/node/`: `hostWireParsers.ts` (разбор хостом нотификаций и запросов
  субпроцесса `parseWire*`, перевод в ядро `wireToCore*`, `themeColorIdOf`, `parseDecorationRanges`)
  и `hostRequests.ts` (`RequestFn`, `requestWillSaveEdits` с переводом в `ISaveEdit` save-участников
  `services/textfile`). `api/common` значений из `services/*` не берёт. Исключения по месту
  потребителя: `selectionChangeKindOf` зовёт `api/browser/editorOptionsServiceAdapter.ts` (browser
  не импортирует node), `reviveWireUri` — `contrib/diff`; они остались в `wireTypes.ts`. У языковых
  запросов (`languages.provide*`, rename) параметры объявлены один раз (G5): база
  `IWireDocumentParams {uri, languageId, version}` / `IWirePositionParams` (+ `line`, `character`),
  адресация провайдера `{handle}` или пачкой `{handles}`; субпроцесс читает тот же тип через
  `Received<T>` (`Pick<T, "uri"> & Partial<T>`) — своих копий у него нет, и разъехаться сторонам
  негде. Каналы спавна у customer'ов хоста — тоже `HostRpc` (а не голый `RpcEndpoint`), иначе их
  `notify`/`request` идут мимо карты. Карта полна: в ней все методы провода обоих направлений —
  `languages.*`, `workspace.*`, `editor.*`, `diagnostics.*`, `window.*`, `commands.*`
  (`commands.executeCommand` — запрос в обе стороны), `secrets.*`, `env.*`, `output.*`,
  `extensions.*`, `host.*`, `memento.*`, `terminal.*`, `tasks.*`; вне карты только служебный
  `$/cancelRequest`, его ведёт сам `RpcEndpoint`. Метод вне карты не компилируется (нетипизированный
  `IUntypedProtocol` — только дефолт голого `RpcEndpoint` для тестов транспорта). В рантайме те же
  расхождения сторон видны: нотификация без обработчика — warn раз на метод, повторный
  `handleRequest` того же метода бросает `BugIndicatingError` (у запроса один ответчик). Не делаем:
  `Proxy`/`$`-акторы и `ProxyIdentifier` эталона (карта методов даёт ту же статическую гарантию),
  бинарный формат сообщений, детектор неотзывчивости хоста, бан медленных will-save участников по
  образцу эталона, `$mid`/`Dto<T>`-маршалинг `Uri`.
- **Файловые watcher'ы (`workspace.createFileSystemWatcher`):** `RelativePattern` +
  `FileSystemWatcher` — настоящие. Субпроцесс держит только id и эмиттеры
  (`fileWatcherNamespace.ts`), а следит за деревом ядро: notify
  `workspace.watcher.create {id, base, pattern, ignore*Events}` → порт `IExtensionFileWatcher` (в DI
  — `FileWatcherAdapter` поверх `ITreeFileWatcher` + excludes из `files.watcherExclude` +
  каталоги-симлинки из `files.watcherInclude`: сам обход по ссылкам не ходит, как у эталона) →
  обратный notify `workspace.watcher.events`. **Матчинг шаблона — на хосте**: субпроцессу уезжают
  только подошедшие события, а не весь поток по воркспейсу. Рекурсивность выводится из шаблона (`*`
  — только прямые дети, `**`/`/` — поддерево) — на этом держится дешёвый watcher `.git` у
  встроенного git.
- **Локальный диск без RPC (`workspace.fs`, `workspace.findFiles`):** обе поверхности (и
  `openTextDocument` по промаху реестра) работают **в субпроцессе через `node:fs`**: привязка к
  диску — `api/node/extHostDisk.ts` (`IExtHostDisk`, как `extHostDiskFileSystemProvider` у эталона),
  её отдаёт `buildVscodeNamespace` точка входа субпроцесса, а в `api/common` остаются роутер, обход
  и сборка документов — целевой файл живёт на той же машине и не является открытым буфером ядра,
  поэтому запроса к хосту не нужно (в отличие от will-save, который ходит за текстом активного
  документа). Это ещё и правильное место по нагрузке: рекурсивный обход дерева однажды уже голодал
  главный цикл (см. `files.watcherExclude` и вынос watcher'а в отдельный процесс), а стоковый
  `redhat.java` зовёт `findFiles` около десяти раз на одной активации. `workspace.fs`
  (`fileSystemNamespace.ts`) — роутер по схеме: `file` идёт на диск, прочие схемы — провайдеру
  расширения (`registerFileSystemProvider`), схема без провайдера получает
  `FileSystemError.Unavailable`; гейт схемы не декоративный — `fsPath` у `untitled:` отдаёт
  относительный путь, и `writeFile` без него создавал бы файл в `$CWD`. `findFiles` (`findFiles.ts`)
  — обход в ШИРИНУ с отделённым интерфейсом `IFindFilesScanner` (бюджет каталогов, исключения и
  матчинг тестируются на карте в памяти); глубина обхода выводится из шаблона (без `**` число
  сегментов фиксировано), бюджет — 5000 каталогов на запрос, отмена — настоящий `CancellationToken`.
  Три значения `exclude` из контракта различаются: `undefined` — настройка `files.exclude` (и только
  она, как в контракте: `search.exclude` сюда не входит), `null` — ничего, шаблон — ВМЕСТО
  настройки.
- **Провайдеры ФС расширений (`workspace.registerFileSystemProvider`):** реестр —
  `SubprocessFileSystemProviders` (`fileSystemNamespace.ts`), объявление хосту — нотификация
  `workspace.fileSystemProvidersChanged {schemes, readonly}`; read-only — схема с `isReadonly`
  (`!!isReadonly`, как `Readonly` в capabilities эталона) и, сверх эталона, провайдер без
  `writeFile`. Хост (`FileSystemCustomer`) ходит к провайдеру запросами
  `workspace.fs.readFile`/`stat`/`writeFile` (байты — base64; отсутствие ресурса у `stat` — `null`,
  а не отказ: по проводу едет только текст ошибки, а ядру нужен код `FileNotFound`).
  `FileSystemProviderAdapter` (`api/browser`) регистрирует схему в `IFileService`: read-only —
  только чтение (без `stat`, чтобы не платить кругом RPC перед каждым чтением `git:`), пишущая — со
  `stat`/`writeFile`; смена записываемости перерегистрирует схему. Ресурс пишущей схемы — как файл у
  эталона (`TextFileEditorModel` поверх `IFileService` любой схемы):
  `TextFileModelService.acquireProvided` читает его сервисом и рожает общую `TextFileModel`
  (`openProvided`), сохранение идёт через save-участников (`onWillSaveTextDocument`) в
  `IFileService.writeFile` → провайдера, чистый буфер перечитывается по `onDidChangeFile`, а своя же
  запись (провайдер о ней тоже сообщает) отличается по тексту и историю отмены не стирает.
  Потребитель — сторона диффа (`openDiffPair.resolveSide`: пишущая схема — сторона `shared` под
  настоящим uri, read-only — снимок, как прежде); на этом стоит предложенный дифф Claude Code
  ([StockExtensions.md](StockExtensions.md#claude-code-anthropicclaude-code-в-терминальном-режиме), «Протокол предложенного диффа»). Стороны-модели видимой
  дифф-вкладки едут в снимке полосы (`IWireTabSnapshot.sideEditors`) и становятся
  `visibleTextEditors` — по ним расширение ставит свой when-ключ. `TextDocument.save()` — тот же
  `workspace.save`, что у `workspace.save(uri)`.
- **Webview как честный no-op (`webviewNoop.ts`):** четыре члена `window` (`createWebviewPanel`,
  `registerWebviewViewProvider`, `registerWebviewPanelSerializer`, `registerCustomEditorProvider`)
  существуют и ничего не делают. Webview в TUI не будет **by design**, но ОТСУТСТВИЕ члена убивало
  расширение целиком: панель поднимают первой строкой `activate()`, и `is not a function` уносил
  заодно команды и провайдеры. Вызов возвращает инертный объект и пишет в Output одну строку про
  неподдерживаемый webview; декларации в `vscode.d.ts` остаются закомментированными — статус ⛔
  рантайм-заглушка не меняет.
- **Деревья расширений (TreeView):**
  `window.createTreeView`/`registerTreeDataProvider` — как `extHostTreeViews`/`mainThreadTreeViews`
  эталона. **Объекты расширения живут только в субпроцессе** (`api/common/extHostTreeViews.ts`),
  хост знает строки по **handle**: `1/<TreeItem.id>` либо `<handle родителя>/<n>:<label>` (первый
  `/` в метке удваивается, `n` — первый свободный среди уже зарегистрированных соседей, поэтому
  узлы регистрируются по одному). Протокол (`treeViewWireTypes.ts`): субпроцесс шлёт
  `treeView.register {viewId, showCollapseAll, canSelectMany, extensionId}` / `dispose` /
  `setMessage` / `setTitle` и запросы `treeView.refresh {items?}` (без `items` — корень) и
  `treeView.reveal`; хост просит `treeView.getChildren {parentHandle?}` и
  `treeView.executeCommand {handle}`, шлёт `setVisible`/`setExpanded`/`setSelection`. Команда строки
  **выполняется в субпроцессе** (`vscode.commands.executeCommand` с её `arguments`): аргументы —
  объекты расширения, через провод они дошли бы копиями без прототипа (эталон делает то же через
  `_internal_command_delegation`); ошибка команды — reject запроса и тост на хосте. Кэш детей —
  до refresh. Команда пункта `view/item/context` идёт обычным `commands.executeCommand` с аргументом
  `{ $treeViewId, $treeItemHandle }` (массив таких — выделение): обработчик в субпроцессе пропускает
  каждый аргумент через `processArgument` деревьев (argument processor эталона, `_convertArgument`) и
  отдаёт команде объект провайдера; неизвестная строка или вид — `undefined`. `onDidChangeTreeData` чистит поддерево и идёт через debounce эталона (первое изменение
  сразу, следующие в окне 200 мс — одним запросом). Устаревший ответ провайдера (refresh пришёл, пока
  расширение отвечало) не регистрирует узлов. Хост: `TreeViewsCustomer` → порт
  `IExtensionTreeViewsSink` → `ExtensionTreeViewsAdapter` (`api/browser`), который ставит телом
  законтрибьюченной секции `ExtensionTreeView` (через `ExtensionViewWelcomes`: пока корень пуст и
  `message` пуст, там `viewsWelcome` вида — [Views.md](workbench/Views.md)) и считает `visible` = «контейнер показан и секция
  развёрнута» на `onDidShowView`/`onDidChangeViewExpanded`/`onDidChangeLocations`. Корень читается,
  когда секция видна (terraform ставит контекст-ключи прямо из `getChildren`), дети — на раскрытии;
  `Expanded` раскрывает узел при первом появлении; ответ с ошибкой — строка в Output (канал
  Extensions), дерево показывает прежние строки. Повторная регистрация того же `viewId` подменяет
  провайдер, `dispose` старого вида новый не трогает; смерть субпроцесса — все секции пустые (или
  их welcome).
  Отступления: дерево для незаконтрибьюченного вида — warn в Output, а не ошибка эталона; иконки — по
  решению 2026-10-24 (`ThemeIcon` — глиф codicon, цвет — токен темы, если тема его знает, иначе без
  цвета: неизвестный токен ронял бы кадр; `resourceUri` — значок файла как в Explorer; SVG/PNG — без
  иконки); tooltip не показывается (ховеров нет), `badge` хранится, но не рисуется; чекбоксы, drag and
  drop, `resolveTreeItem`, `TreeItemLabel.highlights`, `activeItem` не поддержаны.
- **Сток диагностик (LSP):** `languages.createDiagnosticCollection` (наивная: хранит оригинальные
  `Diagnostic`, честные get/has/forEach/итератор; `dispose` снимает её и из контекста code actions)
  → notify `diagnostics.publish` с owner — ключом `MarkerService`, уникальным на коллекцию:
  `ext:<id>:<имя>` (без владельца — `ext:<имя>`, без имени — `diagnostics`), повтор базы получает
  `#N`, как уникализирует эталон, — одноимённые коллекции не затирают маркеры друг друга; → опция
  `ExtensionHost.diagnosticsSink` → мост в `MarkerService.changeOne` (module); потребители
  (squiggle, панель Problems) слушают `onDidChangeMarkers` и правок не требуют. Принимает публикацию
  `DiagnosticsCustomer` (`MainThreadDiagnostics` эталона); он же ведёт **обратный путь**: опция
  `ExtensionHost.markers` (чтение `MarkerService`) → маркеры чужих владельцев (не публиковавшихся
  субпроцессом этого хоста — аналог `origin` эталона; множество живёт с хостом, чтобы маркеры
  умершего спавна не стали «чужими») уходят `diagnostics.markersChanged` полным набором ресурса,
  семенем на handshake и потоком на `onDidChangeMarkers`. Субпроцесс кладёт их в зеркальное
  хранилище рядом с коллекциями — из всех хранилищ отвечают `languages.getDiagnostics` и контекст
  code actions, а `onDidChangeDiagnostics` (окно 50 мс, как `DebounceEmitter` эталона) стреляет на
  `set`/`delete`/`clear` коллекций и на зеркало. Стоковый потребитель — Claude Code: без
  `onDidChangeDiagnostics` его ide-MCP-сервер рвёт каждое подключение CLI.
- **Прогресс (LSP):** настоящий `window.withProgress` — notify `window.progress.{start,report,end}`
  → опция `ExtensionHost.progressSink` → `ProgressStatusBarAdapter` (запись статус-бара с
  анимированным спиннером; report обновляет message/проценты, end снимает; на смерть subprocess'а
  host гасит живые handle'ы). Отмена не поддержана — токен не стреляет.
- **Пункты статус-бара:** настоящий `window.createStatusBarItem` — notify
  `window.statusBarItem.update`/`.dispose` → опция `ExtensionHost.statusBarItemSink` →
  `ExtensionStatusBarAdapter` (запись `StatusBarService` на каждый ПОКАЗАННЫЙ пункт; клик исполняет
  команду расширения через `ICommandService`). Состояние живёт в субпроцессе, `update` несёт ПОЛНОЕ
  состояние (у хоста своей копии пункта нет), а непоказанный пункт в проводе не появляется вовсе. Id
  записи — `extensions.<id пункта>`, где id пункта — `<id расширения>.<свой id>` (как
  `asStatusBarItemIdentifier` эталона; владелец фиксируется при создании пункта, имя может прийти
  позже): пространства имён разделены, расширение не может ни перебить, ни скрыть встроенный сегмент
  (`status.editor.encoding`). Id пункта без явного — slug его `name` (чтобы «скрыл через меню
  видимости» пережило перезапуск: скрытые id хранит `StatusBarService`), иначе `item-<счётчик>`.
  Вызов мимо оверлея (общий namespace, владельца нет) даёт id без префикса расширения. Значки
  `$(name)` в тексте подменяются глифами codicon-шрифта (см. «Значки `$(name)` в тексте расширений»
  ниже) ДО обрезки по 24 символам — иначе разметка съела бы смысл подписи. Стабы —
  `tooltip`/`color`/`backgroundColor`/`accessibilityInformation` (принимаются, ни на что не влияют).
- **Language Status:** настоящий `languages.createLanguageStatusItem` (`extHostLanguageStatus.ts`) —
  notify `languages.statusItem.update` (полное состояние сразу при создании и на каждое поле, как
  `$setLanguageStatus` эталона, но без отложки на тик) / `.dispose` → `LanguageStatusCustomer` →
  опция `ExtensionHost.languageStatusSink` → `ExtensionLanguageStatusAdapter` → `LanguageStatusService`
  (`services/languageStatus/`, сопоставляет селектор с документом через `languageSelector.score`,
  сортирует severity ↓, `source` (id расширения), `id`). Id пункта — `<id расширения>/<свой id>`, второй
  живой с тем же id бросает, как в эталоне. Смерть субпроцесса — `clear()`. Сегмент рисует
  `contrib/languageStatus` (`status.languageStatus`, priority 75 — между EOL и языком); отступление
  от эталона: клик открывает quick pick пунктов вместо hover, нет закрепления (dedicated) и
  `accessibilityInformation`.
- **Вход как null-объект (`authenticationNoop.ts`) и телеметрия (`telemetryLogger.ts`):**
  `vscode.authentication` и `env.createTelemetryLogger` нужны расширению ещё до его настоящей работы
  — `@vscode/extension-telemetry` строит логгер в конструкторе репортера, а `hashicorp.terraform`
  регистрирует провайдер входа и спрашивает сессию в `activate()`, до старта языкового сервера. Без
  них расширение умирало целиком. Логгер — полная реализация, а не заглушка: телеметрии в Diode нет
  навсегда, и эталонный `ExtHostTelemetryLogger` с выключенными флагами тоже не зовёт отправителя
  (остаётся `flush` на первом `dispose`). `authentication` — временная ступень, как деревья:
  декларации подняты целиком, `getSession` без `createIfNone`/`forceNewSession` — `undefined`, с
  ними — отказ с причиной (перегрузка обещает сессию, `undefined` уронил бы расширение невнятным
  `TypeError`), провайдер принимается и не зовётся, человеку — одна warn-строка в Output на id
  провайдера. Настоящие провайдеры — [docs/TODO/LanguageServers.md](../TODO/LanguageServers.md#terraform).
- **Отладка и Test API как null-объекты (`debugNoop.ts`, `testsNoop.ts`):** дебаггера (DAP) в Diode
  нет и не планируется (решение человека, [StockExtensions.md](StockExtensions.md#go-golanggo-gopls)), view Testing пока
  нет, но ОТСУТСТВИЕ namespace'ов убивало расширение целиком: `golang.go` регистрирует провайдер
  конфигураций отладки посреди `activate()` и заводит контроллер тестов с тремя профилями
  `TestRunProfileKind` — без них не появлялись ~60 команд `go.*`, хотя gopls уже жил. Декларации
  `vscode.debug`/`vscode.tests` и их типы подняты в `vscode.d.ts` целиком, значения-типы — эталонные
  (`debugTypes.ts`, `testingTypes.ts`). Поведение — «сессий нет»: `register*` — `Disposable`,
  события не стреляют, `startDebugging` — `false`, `asDebugSourceUri` честный; у контроллера тестов
  коллекции `items`/`children` рабочие (расширение ищет в них свои элементы), обработчики никто не
  зовёт. Человеку — одна warn-строка в Output на тип отладчика / id контроллера (как у comments).
  События активации `onDebug*` не стреляют.
- **`languages.setLanguageConfiguration` (`extHostLanguageConfiguration.ts` →
  `LanguageConfigurationCustomer`):** по эталону `wordPattern` остаётся в субпроцессе — определение
  слова языка в `DocumentRegistry` для `getWordRangeAtPosition` (и эфемерных документов
  `openTextDocument`), а секции, которые ядро умеет из `language-configuration.json` (`comments`,
  `brackets`, `autoClosingPairs`, `onEnterRules`, `wordPattern` — его читает linked editing), уезжают notify `languages.setLanguageConfiguration` слоем в
  `ILanguageConfigurationService.register` — как `register(…, priority)` эталона: секция слоя
  заменяет секцию файла, поздний слой побеждает ранний, результат слияния разворачивается тем же
  `resolveLanguageConfiguration`. Снятие — `languages.unsetLanguageConfiguration` по handle; смерть
  субпроцесса снимает все его слои (кастомер живёт один спавн). `indentationRules` не
  применяются: ядро не умеет их и из файла. `onEnterRules` регулярки идут как `{ pattern, flags }`, действие — в формате файла.
- **Значки `$(name)` в тексте расширений:** подменщик — `renderCodicons` (`base/common/codicons.ts`
  над генерируемой таблицей `codicons.generated.ts`: `scripts/import-codicons.mjs`, пин в лок-степе
  с `vscode.d.ts`). Политика: известное имя → глиф, **неизвестное выбрасывается** (литерал `$(foo)`
  хуже, чем ничего), модификатор `~spin` игнорируется, `\$(имя)` — литерал со снятым слэшем. Подмена
  стоит **в раковине** — в адаптере, который превращает просьбу расширения в нашу модель интерфейса,
  — а НЕ на границе RPC: подменять можно далеко не всё, что пишет расширение (содержимое канала
  Output, тела диагностик/ховеров/дополнений, `InputBox.value`, который человек правит и который
  уезжает обратно, обязаны остаться дословными — `$(…)` там бывает настоящей шелл-подстановкой).
  Перечень раковин с политикой и обоснованием по каждому полю —
  `workbench/api/browser/extensionTextSinks.test.ts`; у перечня два гейта: типовой (новое текстовое
  поле wire-типа без записи краснит `typecheck`) и поведенческий (поле без кейса, гоняющего текст
  через настоящую раковину, краснит тест).
- **Output-каналы (LSP):** настоящий `window.createOutputChannel` — notify
  `output.append`/`output.show` → опция `ExtensionHost.outputSink` → `ExtensionOutputAdapter`
  (ленивая регистрация канала `extensions.<id расширения>.<slug(name)>` в `OutputChannelRegistry` —
  канал принадлежит расширению, как в эталоне, и не сталкивается с логгерами хоста вроде
  `extensions.host`; без владельца — `extensions.<slug(name)>`, строки — логгером `ILogService`,
  `show` — команда `workbench.action.output.show.<id>`). `append` буферизуется в subprocess до `\n`
  (панель строчная).
- **Сообщения человеку:** `window.show{Information,Warning,Error}Message` — **запрос**
  `window.showMessage` (не notify: перегрузка с кнопками обязана вернуть выбранное) → опция
  `ExtensionHost.notificationSink` → `NotificationExtensionAdapter` → `NotificationService`
  (поверхность — стек тостов над статус-баром, у модального сообщения окно по центру; см.
  [workbench/Notifications.md](workbench/Notifications.md)). Разбор четырёх перегрузок
  (`MessageOptions` первым аргументом, кнопки строками или `MessageItem`-ами) живёт в
  `api/common/messageNamespace.ts`, ответ приходит ИНДЕКСОМ в присланном массиве — расширение
  обязано получить обратно свой объект. Адреса показа на проводе нет: отменять показ расширение не
  умеет (у `show*Message` нет токена), а «погасить при смерти субпроцесса» решается handle'ом,
  который минтит сам хост. Сообщение вдобавок дублируется в лог расширений — тост гаснет, а
  прочитать сказанное надо и потом. Исключение стока НЕ отклоняет запрос (`index: null` + строка в
  лог): отказ доехал бы до `await show*Message(...)` расширения, а необработанный reject валит весь
  субпроцесс.
- **`env.clipboard` / `env.openExternal`:** запросы `env.clipboard.{readText,writeText}` → опция
  `ExtensionHost.clipboard` (тот же `IClipboard`, которым пользуются copy/paste ядра: OSC 52 +
  внутренний регистр) и `env.openExternal` → опция `ExtensionHost.externalOpener`. Uri уезжает по
  проводу как `toString(true)` (skipEncoding) — как в эталоне, где ссылка отдаётся системному
  обработчику именно в этой форме; обычный `toString()` percent-кодирует `=`/`&` в query, и системе
  досталось бы `?token%3D42`.
- **Builtin LSP-клиент:** `extensions/diode-lsp-typescript` — стоковый `vscode-languageclient@10` в
  esbuild-бандле, декларативная таблица серверов `{ languageIds, resolveCandidates }`
  (`lib/resolveServer.ts`), ленивая активация `onLanguage:*`. **Сервер вшит в поставку**
  (`ts-server.bundle` → XDG-кэш, `loadTsServer.ts`) и является дефолтным кандидатом резолва:
  настройка → workspace `node_modules/.bin` → bundled → PATH; пути и режим рантайма инжектирует host
  переопределениями дефолтов в общем реестре настроек (`builtinConfigInjection` в `main.ts`).
  Рантайм «как VS Code»: JS-энтрипоинты запускаются `process.execPath` субпроцесса (dev/self-extract
  — настоящий node; SEA — diode-бинарь в node-режиме `DIODE_RUN_AS_NODE=1` — ранний branch
  `runAsNode.ts`, калька `ELECTRON_RUN_AS_NODE`; env сервера всегда снимает `DIODE_EXTENSION_HOST`).
  У bundled-сервера **ATA выключен** (`disableAutomaticTypingAcquisition`, typingsInstaller не
  упакован, `scripts/pack-ts-server.mjs`): автоимпорт и члены встроенных модулей Node (`path`, `fs`, …)
  есть только при `@types/node` в проекте — в TS так и в эталоне, а в JS VS Code после первого
  `require('path')` сам ставит `@types/node` в `~/.cache/typescript`. Решение человека 2026-10-25:
  оставить как есть (проверено вживую: с `@types/node` completion с импортом и quick fix
  «Add import» работают в TS и JS).
  Middleware `provideCodeActions` — **холостая «Organize Imports»** (`lib/organizeImports.ts`):
  стоковый сервер при пустом ответе tsserver'а (менять нечего — импорты упорядочены, CommonJS
  `require()`) действия не отдаёт, а эталонное `typescript-language-features` отдаёт его на любой
  запрос с `only` ⊇ `source.organizeImports.ts` и считает правки лениво; клиент дописывает действие
  с пустым `WorkspaceEdit`, и команда молчит, как в VS Code, вместо «No organize imports action for
  'javascript'».
  **Inlay hints и code lens** включаются ключами эталона `typescript-language-features`
  (`typescript.inlayHints.*`, `javascript.inlayHints.*`, `*.referencesCodeLens.*`,
  `typescript.implementationsCodeLens.*`), по умолчанию выключены. Сервер берёт эти предпочтения только из
  `workspace/didChangeConfiguration` (`workspace/configuration` он спрашивает лишь про `formattingOptions`) и заменяет
  ими свою копию целиком, поэтому `synchronize.configurationSection` плюс middleware
  `workspace.didChangeConfiguration` шлют полный перевод (`lib/serverSettings.ts`) на старте и при каждой смене;
  сервер сам просит клиента обновить подсказки и линзы (`inlayHint/refresh`, `codeLens/refresh`). Перевод как в
  `getInlayHintsPreferences` эталона: `suppressWhen*` → `includeWhen*` с отрицанием. Настройки читаются без `scope`:
  уведомление одно на сервер, поэтому `scope: "resource"` у подсказок на деле — на всё окно. Сервер игнорирует
  `implementationsCodeLens.showOnInterfaceMethods`. Не объявлены `js/ts.*` (единые ключи эталона 1.127) и
  `implementationsCodeLens.showOnAllClassMethods`, у старых ключей поэтому нет `markdownDeprecationMessage`.
  **Статус проекта JS/TS** (`lib/projectStatus.ts`, `lib/projectConfig.ts`) — порт эталонного
  `IntellisenseStatus` и команд `tsconfig.ts`: элемент Language Status `typescript.projectStatus`
  («No jsconfig» → «Configure JSConfig», путь конфига → «Open Config File», «Loading IntelliSense
  status» пока сервер не готов) и `javascript.goToProjectConfig`/`typescript.goToProjectConfig`.
  `projectInfo` идёт через `typescript.tsserverRequest` стокового сервера (`ExecuteCommandRequest`
  мимо middleware), логика написана против хоста-интерфейса и тестируется без `vscode`, `main.ts`
  только связывает. Отступления: «Configure» не открывает untitled-буфер со сниппетом, а создаёт
  `<папка>/jsconfig.json` одной `workspace.applyEdit` (createFile + текст шаблона, Ctrl+Z удаляет
  файл) и открывает его (нет сниппет-сессий; решение человека
  2026-10-25); шаблон — с дефолтами `js/ts.implicitProjectConfig.*` (настроек нет); `projectInfo` без
  ответа убирает элемент вместо вечного Loading; активный редактор — `activeTextEditor`, а не
  активная вкладка. **Пересчёт без смены редактора:** tsserver сам замечает новый/удалённый конфиг
  опросом (`fs.watchFile`, 2 с) и грузит проект в фоне — сервер показывает это прогрессом
  «Initializing JS/TS language features…»; middleware `handleWorkDoneProgress` по его `end`
  переспрашивает `projectInfo` (`ProjectStatus.refresh`, без мигания Loading). Клиентский watcher
  (`useClientFileWatcher`, как `tsserver.watchOptions: "vscode"` эталона) пробовали: tsls просит
  рекурсивный `**/*` на весь `node_modules` с tsserver'ом — для этой задачи слишком дорого.
  **Грабли:** tsserver не ставит watcher на конфиг в каталоге двух уровней от корня
  (`canWatchDirectoryOrFilePath` считает `/home/<user>`, `/tmp/<x>` домашним каталогом), поэтому
  в `~/proj` или `/tmp/x/proj` новый конфиг без перезапуска сервера не подхватится — так и в VS Code;
  тесты и живой прогон кладут проект глубже. Наивные стабы поверхности languageclient (no-op провайдеры, naive-события, env,
  `version` в лок-степе с `extensions/VSCODE_VERSION`) — статусы в [API-COVERAGE](../public/API-COVERAGE.md).
- **Проекция выделения host → subprocess (#194):** первичное выделение едет в `IActiveEditorMeta` на
  смене активного редактора, а **каждое движение каретки** — отдельной нотификацией
  `editor.selectionChanged` (`IActiveEditorSelections`: uri + все выделения). Продюсер —
  `EditorService.onDidChangeActiveEditorSelection` (подписка живёт на группе и сама переезжает на
  новый активный редактор) → `IEditorOptionsService.onActiveEditorSelectionChanged` (коалесинг в
  пределах тика + эхо-гард: выделение, поставленное самим субпроцессом через `editor.setSelection`,
  назад не уезжает). Отдельное сообщение, а не повторный `activeEditorChanged`, потому что последний
  дёргает `onDidChangeActiveTextEditor` — встроенный git пересчитывал бы статус на каждое нажатие
  стрелки. **Без этой проекции любая команда расширения, читающая `activeTextEditor.selection`,
  видит состояние момента открытия файла** (обычно `(0,0)`) и молча ничего не делает — так ломались
  все команды `maptz.regionfolder`.
- **Событие выделения (`window.onDidChangeTextEditorSelection`):** производит его САМ субпроцесс из
  нотификации `editor.selectionChanged` (нового сообщения в проводе нет — добавилось поле `kind`),
  уже после обновления своих кэшей: слушатель читает `event.textEditor.selection` и обязан увидеть
  новое. Эхо-гард остаётся на хосте, поэтому выделение, которое расширение поставило само
  (`TextEditor.selection =`), события не даёт — осознанное отличие от upstream в пользу «расширение
  не будит само себя». **`kind` (`TextEditorSelectionChangeKind`) едет от ЖЕСТА**, а не угадывается:
  источник объявляется областью `withCursorChangeSource`
  (`editor/common/core/cursorChangeSource.ts`) вокруг обработчика — ввод и мышь в `EditorElement`,
  диспетчер кейбиндов (`keyboard`: стрелки у нас исполняются командами, но для расширения это
  Keyboard, как в VS Code), обработчик `commands.executeCommand` от расширения (`command`).
  Снимается источник СИНХРОННО в `EditorOptionsServiceAdapter` (в отложенном флаше коалесинга
  область жеста уже закрыта), вложенная область не перебивает внешнюю. Неразмеченный жест
  (undo/redo, find, фолдинг, программная правка) едет без поля — `kind: undefined` upstream
  объявляет явно. Плоского «протащить причину через пять сигнатур» не делаем: у потребителя один, и
  ambient-область дешевле. Второй источник — **вкладка, ставшая видимой**
  (`announceRestoredSelections` в диффе снимка): эталон на смене модели виджета заводит новый
  `MainThreadTextEditor` с 1:1, и восстановление курсора (`restoreState`) даёт событие с
  `kind: undefined`; у нас каждая вкладка держит своё состояние, поэтому событие производится из
  выделения снимка, если оно не 1:1. В активной группе оно отложено до `editor.activeEditorChanged`
  (снимок приходит раньше меты): слушатели сверяют `e.textEditor === activeTextEditor`, так
  отбрасывает чужие события Claude Code.
- **Активная тема (`window.activeColorTheme` + `onDidChangeActiveColorTheme`):** notify
  `window.themeChanged {kind}` (host → subprocess) через тот же порт `IThemeColorResolver`, что
  резолвит `ThemeColor` — второго порта к теме не заводим, событие смены у обоих потребителей одно.
  `ThemeColorResolverAdapter.kind()` переводит `WorkbenchTheme.type` в `vscode.ColorThemeKind`.
  Сообщение уходит **семенем на handshake, ДО первой активации** (расширение читает тему уже в
  `activate()`, чтобы выбрать иконки/цвета) и на каждую настоящую смену темы; субпроцесс стреляет
  событием на каждое пришедшее сообщение, включая переход между двумя тёмными темами — upstream
  формулирует событие как «changed **or has changes**». До первого сообщения тема — `Dark` (дефолт
  VS Code), а не `undefined`: `activeColorTheme.kind` читают без проверок.
- **Уборка расширения в субпроцессе** (`services/extensions/node/extensionDeactivation.ts`):
  `deactivate()`, затем `context.subscriptions` в обратном порядке; сбой любого шага — warn
  `[ext-host] [<id>] deactivate failed` / `subscription dispose failed` в stderr, уборка доходит до
  конца и наружу не бросает (и в `host.deactivateExtension`, и при выключении).
- **Изоляция сбоев субпроцесса:** `runExtensionHostSubprocess` ставит
  `process.on("unhandledRejection")` — расширение, не поймавшее свой промис (исторический пример:
  стоковый maptz после `wrapWithRegion` fire-and-forget звал `editor.action.formatDocument`, до #196
  отсутствовавшую), логируется в stderr и **не уносит с собой host** со всеми остальными
  расширениями. Причина печатается со **стеком** (`describeRejection`): `String(err)` даёт только
  «Error: message», по которой не найти ни виноватое расширение, ни строку.
- **`localhost` в субпроцессе — IPv4 первым:** `runExtensionHostSubprocess` ставит
  `dns.setDefaultResultOrder("ipv4first")` — то же, что `--dns-result-order=ipv4first` в execArgv
  extension host'а VS Code (`localProcessExtensionHost.ts`, issue #189805). С дефолтным `verbatim`
  Node вешает `net.listen(port, "localhost")` на `::1` там, где `/etc/hosts` ставит его выше, а
  клиент на Java (`Socket("localhost", port)`, JVM предпочитает IPv4) стучится в 127.0.0.1 и
  получает «Connection refused» — так bazel-java терял лог синхронизации. Функцией, а не флагом: под
  SEA execArgv бинаря не наш (прецедент эталона — `cliProcessMain.ts`). Отступление: дети
  субпроцесса (`cp.fork` из расширения) порядок не наследуют — в VS Code он уезжает вместе с
  execArgv. Тест — `extensionHost.localhost.test.ts` на синтетическом расширении.
- **Каталоги хранения (`ExtensionContext.globalStorageUri` / `storageUri` / `logUri` +
  депрекейтнутые строковые близнецы):** корни даёт ХОСТ — раскладку user-data знает приложение, и
  субпроцессу её не выдумывать. Опция `ExtensionHost.storageHomes` — **ленивый** провайдер
  (`() => IExtensionStorageHomes`): папка воркспейса выставляется позже создания хоста, а
  `storageUri` зависит именно от неё, поэтому корни читаются на каждой активации. Сами корни
  собирает `extensionStorageHomes` (чистая, из путей user-data и текущей папки), пути одного
  расширения — `resolveExtensionStoragePaths`; и то и другое уезжает в `host.activateExtension`, а
  субпроцесс только оборачивает их в `Uri.file`. Регистр id повторяет эталон дословно, включая
  асимметрию: `globalStorage` — по **lowercase** id, `workspaceStorage`/`logs` — по id как есть.
  Разделение ответственности за каталоги — из контракта `vscode.d.ts`: **родителя** создаёт хост
  (`ensureExtensionStorageParents`, best effort — недоступный на запись user-data не рубит
  активацию), **свой** каталог создаёт расширение. Папка не открыта ⇒ `storageUri` = `undefined`,
  как в VS Code. Без опции — `fallbackExtensionStorageHomes()` (каталог во временных файлах ОС):
  `globalStorageUri` по API необязательным не бывает, а расширение падает на нём в первой же строке
  `activate()`.
- **`ExtensionContext.extension`** — запись самого расширения из каталога `vscode.extensions`
  (телеметрии читают по ней `packageJSON.name`/`version` первой строкой `activate()`). Эталон строит
  в `_loadExtensionContext` отдельный `Extension` из описания расширения; у нас объект уже лежит в
  каталоге, который хост шлёт семенем до первой активации и на каждой регистрации, поэтому
  субпроцесс берёт `getExtension(id)` общего namespace (оверлей владельца `extensions` не
  перекрывает). Записи нет — нарушен контракт хоста, активация падает с именем расширения, а не
  TypeError'ом внутри него. Идентичность с `getExtension(id)` не обещается (эталон тоже отдаёт
  отдельные экземпляры): новый каталог пересобирает объекты, но `isActive`/`exports` у старой записи
  остаются живыми.
- **Memento (`ExtensionContext.globalState` / `workspaceState`):** хранилище держит ХОСТ
  (`IExtensionStateStore`, опция `ExtensionHost.extensionState`; в проводке —
  `createExtensionStateStore` поверх общего `IStateService`, ключ `extensionState/<id>`,
  `globalState` — scope `global`, `workspaceState` — `workspace`, то есть стор открытого проекта или
  пустого окна), поэтому memento переживает перезапуск, как и состояние workbench'а. Субпроцесс
  держит словарь у себя (`get`/`keys` синхронные), начальный приезжает в параметрах
  `host.activateExtension` (без отдельного round-trip), а `update` отдаёт хосту словарь целиком
  запросом `memento.update` и резолвится по ответу; опустевший словарь удаляет запись
  (`IStateService.remove`). Запись `workspaceState` из воркспейса, отличного от того, где расширение
  активировано, хост отбрасывает с предупреждением: словарь A не протечёт в стор B (лечение —
  перезапуск хоста при смене воркспейса, см. «Смена воркспейса окна» ниже; проверка остаётся
  страховкой от записи, ушедшей в полёт до перезапуска). `setKeysForSync` — осознанный no-op
  (Settings Sync нет). Без проводки (тесты, харнессы) — `createTransientExtensionStateStore`:
  memento живёт в памяти субпроцесса.
- **Секреты (`ExtensionContext.secrets`):** хранилище держит ХОСТ (`IExtensionSecretStore`, опция
  `ExtensionHost.secrets`), субпроцесс только ходит в него запросами
  `secrets.get`/`store`/`delete`/`keys` — причина та же, что у каталогов хранения: раскладку
  user-data знает приложение. Секреты переживают перезапуск (в них лежит токен сервиса, который
  расширение спрашивает у человека один раз) — отдельный файл `<profileDir>/secrets.json` (0600,
  синхронная запись), `createFileExtensionSecretStore`. Лоток у каждого расширения свой: ключ
  хранения составной (id расширения + ключ секрета), причём id подставляет субпроцесс, а не сам
  вызов — чужой лоток расширению не адресовать. `onDidChange` приходит уведомлением
  `secrets.changed` от хоста и на СВОИ записи тоже (в эталоне событие описывает факт изменения, а не
  его источника); один диспетчер на субпроцесс разводит его по id. **Шифрования нет** — связки
  ключей ОС у нас нет, значения лежат открытым текстом под правами `0600`; замалчивать это нельзя,
  поэтому оно написано и здесь, и в [матрице](../public/API-COVERAGE.md). Отсюда же правило:
  значения секретов не логируются нигде, и сообщения об отказе хендлеров `secrets.*` не содержат
  параметров запроса (в соседнем поле того же объекта едет значение).
- **Каталог расширений (`vscode.extensions`):** состав знает только хост (он держит регистрации),
  поэтому каталог едет уведомлением `extensions.catalog` — **семенем на handshake, ДО первой
  активации** (`getExtension` зовут прямо в `activate()`, детектя соседей: в бандле Supermaven таких
  вызовов четыре) и на каждую смену состава. Активность доводится отдельным точечным
  `extensions.activated {id}`: манифесты тяжёлые (у языковых серверов `package.json` со схемой
  настроек — сотни килобайт), а меняется один флаг. Источник состава — `ExtensionPhases.all()` (все
  регистрации в порядке появления, отдельно от фаз «ждёт активации» и «активно»), `packageJSON` —
  манифест регистрации целиком. `exports` (публичный API расширения) по проводу не ездят вовсе: все
  расширения живут в ОДНОМ субпроцессе, и значение берётся из карты `IVscodeHost.extensionExports`,
  куда точка входа кладёт результат `activate()`. **Расхождение с эталоном:** декларативные
  расширения (языковые паки без `main`) в extension host не регистрируются и в `all` не попадают.
  `Extension.activate()` у активного расширения отдаёт его `exports`, у неактивного — честно
  отклоняется: активацией распоряжается хост, и «субпроцесс просит хост поднять соседа» — отдельная
  задача со своим RPC. `extensionKind` — константа стороны субпроцесса (`ExtensionKind.UI`):
  upstream предписывает именно её, когда удалённого extension host'а нет.
- **Команда `setContext`:** встроенная команда VS Code, которой расширения публикуют собственные
  when-ключи (`commands.executeCommand("setContext", "supermaven.isProUser", true)`). Регистрирует
  `SetContextCommandContribution` (`workbench/browser/`) — без title, в палитре её быть не должно.
  Имя ключа регистрировать не нужно: when-вычислитель (парсер грамматики VS Code) читает любое имя
  целиком, в том числе **точечное** (`publisher.thing`); массив и объект хранятся как есть под
  оператор `in` — см. [workbench/Commands.md](workbench/Commands.md#конвенции-системы-команд).
- **`contributes.menus` / `contributes.submenus`:** декларативный contributor
  `extensionMenuContributor.ts` (не через host, как keybindings) переводит строковые id точек VS
  Code в наши `MenuId` и кладёт пункты в `MenuRegistry.appendMenuItem`. Правила разбора и список
  поддержанных точек — в [workbench/Menus.md](workbench/Menus.md); неизвестная точка, пункт без
  команды и ссылка на необъявленное подменю — строка в лог и пропуск пункта, а не падение
  расширения. Пункты смотрят на upstream-имена контекст-ключей (`editorLangId`, `editorTextFocus`),
  поэтому они выставляются рядом с нашими.
- **`contributes.keybindings` (#194):** декларативный contributor
  `extensionKeybindingContributor.ts` (не через host) собирает манифестные биндинги всех расширений
  в слой extension `KeybindingRegistry` (`setExtensionKeybindings`): бинд расширения сильнее
  встроенного на той же комбинации, пользовательский из `keybindings.json` — сильнее бинда
  расширения, независимо от порядка шагов старта; `key`/`mac`/`linux`/`win`, `-command` — снятие из
  слоёв default и extension (user-бинды не трогает).
- **`contributes.viewsContainers` / `contributes.views`:** декларативный contributor
  `api/browser/viewsExtensionPoint.ts` (аналог `ViewsExtensionHandler` эталона) — контейнеры
  расширений в сайдбаре (их показывает переключатель контейнеров, наша замена activity bar), панели
  и вторичном сайдбаре, древовидные виды секциями-заглушками, `when` вживую, `<view>.focus`, неявный
  `onView:<id>`. Устройство и отступления — в
  [workbench/Views.md](workbench/Views.md#виды-расширений-contributesviewscontainers--views).
- **`IExtensionRegistration`** несёт `commandTitles`, `commandCategories` и `activationEvents`.
  `commandTitles` нужны, чтобы рантайм-`registerCommand` расширения **показался в палитре** (host
  заводит прокси в `CommandRegistry` с этим title; иначе команда исполнима, но невидима).
  `commandCategories` — `category` из того же вклада (`"Java"`): палитра рисует её **префиксом
  подписи** («Java: Switch to Standard Mode», `commandPaletteLabel`), но в сам `title` она не входит
  — иначе протекла бы в меню и в статус-бар, где эталон её не показывает. `activationEvents` — см.
  «Активация» ниже.
- **Lifecycle:** `ExtensionHost.dispose()` — graceful `host.shutdown` → `SIGTERM` → `SIGKILL`;
  `shutdown()` — то же, но отдаёт промис прощания; `disposeNow()` — синхронно добивает сигналом
  субпроцесс, который ещё не вышел (перезагрузка окна: дальше идёт `spawnSync` нового процесса, и он
  остался бы сиротой). Оба подключены к прощанию `LifecycleService` в `extensionHostModule`:
  `shutdown()` — в асинхронной фазе `onWillShutdown`, `disposeNow()` — в синхронной
  `onShutdownSync`, так что выход, перезагрузка и выход по инспектору снимают host одинаково. В DI —
  `ExtensionHostDIToken`. `main.ts` содержит ранний branch на env-флаг: subprocess грузит ленивый
  кусок `roles/extension-host` (вход `vs/diode/roles/extensionHostRole.ts` →
  `runExtensionHostSubprocess()`; реализации vscode API в `main.js` нет, см. «Роли процессов» в
  ARCHITECTURE.md), обычный запуск — в `runEditor()`.
- **Смерть субпроцесса:** расширение может уронить свой процесс (краш нативного модуля, OOM,
  `process.exit`). `exit` ребёнка → `handleSubprocessDeath` → общий с вежливым выключением
  `endSpawn()`: `spawnStore` снимается целиком, и каждый customer отдаёт то, что держал мертвец
  (спиннеры прогресса, пункты статус-бара, декорации, прокси-команды, watcher'ы, схемы провайдеров
  ФС и содержимого, языковые провайдеры, флаги подписок, подписки на события ядра — `editorLayout`,
  `editorOptions`, `configuration`); хост забывает `rpc` и процесс. Ручного списка сброса нет: новое
  состояние спавна заводится в `attach` и уходит само, респавн не копит слушателей. Канал мертвеца
  закрывается (`rpc.dispose()`): запросы в полёте получают отказ, и активация, оборванная смертью,
  возвращается в `pending` вместе с остальными, а не теряется (если расширение за это время не
  сняли). Активные расширения при этом возвращаются в `pending`, а **любое** следующее событие
  активации сперва проигрывает **журнал запрошенных событий** (`requestedEvents`, как
  `_allRequestedActivateEvents` эталона; `ensureSubprocess` спавнит новый субпроцесс) и проход
  `workspaceContains:` (его повод в журнал не пишется — заново по ФС): их собственное событие (`*`,
  `onStartupFinished`, `onLanguage:<уже открытый язык>`) давно отгорело и второй раз не наступит.
  Оживление ленивое, на следующем событии, а не сразу при смерти — краш-петлю не устраиваем. Тот же
  журнал поднимает расширение, зарегистрированное **после** своего события
  (`_activateAddedExtensionIfNeeded` эталона): оно встаёт на самой регистрации. `activateByEvent`
  дожидается и расширений, которые уже поднимает другой вызов (активации «в полёте»), — его промис
  значит «расширения события активны». Заглушки-активаторы команд при этом возвращаются на место
  снятых прокси — см. «Активация» ниже.

### Активация (activationEvents)
Расширения активируются **лениво** по `manifest.activationEvents` — до триггера код расширения не грузится и subprocess под него не поднимается. Механика целиком на родительской стороне `ExtensionHost`; ядро про activation-events не знает.
- **Смена воркспейса окна** (Open Folder, File: Open Workspace from File…): у эталона это
  перезагрузка окна, и процесс расширений поднимается заново. Расширения читают `workspaceFolders`,
  `workspaceFile`, `storageUri` в `activate()` и больше не перечитывают — языковой клиент отдаёт
  папки серверу один раз, в `initialize`. Без перезапуска redhat.java в открытом командой
  `.code-workspace` отдавал jdt.ls пустой набор папок, и Java не работала. Поэтому
  `IWorkspaceContextService.onDidChangeWorkspaceFolders` →
  `ExtensionService.restartForWorkspaceChange()` → `ExtensionHost.restartForWorkspaceChange()`:
  живой субпроцесс вежливо выключается (`deactivate()` расширений, как при выходе), активные
  возвращаются в `pending` тем же путём, что после смерти (`armRevival`: журнал, заглушки-активаторы
  команд), и журнал проигрывается в новом спавне — его семя `workspace.initialize` несёт уже новый
  воркспейс, а `storageUri` считается от новой идентичности. Повод активации в логе —
  `workspaceChanged`. Оживление взводится до ожидания выхода: событие, пришедшее за время прощания,
  сразу поднимает новый спавн. Субпроцесса нет (или до барьера старта) — перезапускать нечего,
  остаётся проход `workspaceContains:` по новым папкам. Окно при этом не перезагружается: вкладки,
  раскладка и терминалы живут дальше.
- **Владелец цикла — `ExtensionService`** (`services/extensions/node/extensionService.ts`, интерфейс
  `IExtensionService` и токен — `services/extensions/common/extensions.ts`; аналог vscode
  `IExtensionService`, узкий срез). Политика «что и когда активировать» — у сервиса, механика (RPC,
  субпроцесс) — у `ExtensionHost` (сервис видит его через узкий `IExtensionActivationHost`).
  `start()` (зовёт старт окна за кадром с подсветкой, перед `eventually`, — хук `startExtensions` у
  `workbenchStartup.ts`; как у эталона, `NativeExtensionService` поднимает host после
  `LifecyclePhase.Ready` через `runWhenWindowIdle`, а не на пути к первому кадру): регистрирует
  набор (`ctx.extensions` модуля — пользовательские, затем встроенные) через
  `toExtensionRegistration` (веха `main:extensions-registered`), затем, как `_handleEagerExtensions`
  эталона, **параллельно** `*` (за ним — события, запрошенные до регистрации, и **барьер**
  `whenInstalledExtensionsRegistered`) и проход `workspaceContains:`; `onStartupFinished` — после
  них, но не позже `STARTUP_FINISHED_TIMEOUT_MS` (10 с, `timeout(10000)` эталона), и веха
  `exthost:activated`. Старт окна `start()` не ждёт: фаза `eventually` (фоновый прогрев,
  `main:startup-complete`) от активации не зависит, трасса выгружается, когда есть обе вехи. Сбой
  host'а на одном стартовом событии — лог `extension host activation failed (<событие>)`, остальные
  события всё равно идут. **Память событий** (как `_allRequestedActivateEvents` эталона):
  `activateByEvent` до барьера запоминает событие (без повторов, в порядке прихода) и резолвится на
  барьере, после — идёт в host сразу. Поэтому файл, открытый на старте раньше регистрации, свой
  `onLanguage:` не теряет, и ручной `onLanguage:` активного редактора из `main.ts` больше не нужен.
  Сбой регистрации одного расширения — лог с id, сбой host'а — лог
  `extension host activation failed`; барьер открывается в любом случае. Набор статичен на жизнь
  окна (установка — через перезагрузку), событий состава нет.
- **Сборка регистрации — одна функция:** `toExtensionRegistration(ext, env)`
  (`services/extensions/node/extensionRegistration.ts`) из записи скана: манифест целиком,
  заголовки/категории команд (`collectCommandMeta`), события активации; пользовательское —
  `mainPath`/`extensionPath` с диска, встроенное — `source`/`filename` из ассетов; без `main` —
  `null`. Ей же собирают регистрацию стоковые фикстуры тестов
  (`TestUtils/installedExtensionRegistration.ts`), так что в сьютах регистрация ровно прод-овая.
- **Настройки расширений — в общем реестре.** `contributes.configuration` всех расширений (включая
  декларативные и ещё не активированные) регистрирует в `ConfigurationRegistry` главного процесса
  `ExtensionConfigurationContributor` (`services/extensions/common/`, аналог `configurationExtPoint`
  vscode) — на bootstrap, до загрузки настроек, поэтому скан расширений в `main.ts` идёт раньше
  `loadConfiguration`. Дубль ключа — warn в лог `extensions` и пропуск; `scope` без значения —
  `window`. Инъекции хоста (курируемые дефолты сторонних — `curatedConfigInjection`, пути вшитого
  tsserver — `builtinConfigInjection`) ложатся переопределениями дефолтов
  (`registerDefaultConfigurations`). Следствия: ядро видит дефолты `git.*`, валидатор settings.json
  не помечает ключи расширений «unknown», а субпроцесс своего defaults-слоя не держит — хост шлёт
  ему слои `{ defaults, user, workspace }` (`IConfigurationService.getConfigurationData()`;
  `workspace` — `.diode/settings.json` открытой папки, уже отфильтрованный по `scope`),
  `WorkspaceConfigStore` сливает их той же `ConfigurationModel` (как `ExtHostConfigProvider`
  vscode). `configDefaults` в регистрации и в `host.activateExtension` больше нет. Значения ключей
  расширений по схеме не валидируются (схема расширения — полный JSON-schema). Тестовый харнесс
  собирает дефолты тем же контрибьютором из манифестов своих регистраций (`manifestWithDefaults` —
  описать настройки фикстуры в её манифесте).
- **Регистрация ≠ активация.** `registerExtension(reg)` — синхронный bookkeeping: кладёт reg в `pending`, регистрирует `commandTitles` и заглушки-активаторы команд (палитра видит команды до активации), возвращает disposable. Subprocess **не** поднимается.
- **Разбор событий — один на всех:** `services/extensions/common/activationEvents.ts`. Точное
  сравнение строк закрывает только виды без аргумента (`*`, `onStartupFinished`) и те, где аргумент
  приносит вызывающий (`onLanguage:<id>`, `onCommand:<id>`); `workspaceContains:<паттерн>` так не
  закрывается — его аргумент надо сверять с ФС.
- **`activateByEvent(event)`** — идемпотентно активирует `pending`-расширения, чьи события активации
  содержат событие: `ensureSubprocess()` → `host.activateExtension` RPC → перенос в реестр активных.
  Набор одного события активируется **параллельно** (`Promise.all`, как `_activateExtensions`
  эталона) с изоляцией сбоя каждого: стоковый LSP-клиент, поднимающий сервер секундами прямо в
  `activate()`, соседей не держит. Ошибки spawn/`parseActivateParams` (в т.ч. конфликт
  `source`/`mainPath`) всплывают здесь, а не на регистрации.
- **Дефолт `*` — осознанное отклонение от эталона:** манифест без событий (пусто или нет поля)
  считается eager — у vscode пусто значит пусто, но в нашем магазине опубликованы расширения,
  которые на этот дефолт полагаются (`test.tab-setter`), и эталонный дефолт молча выключил бы их у
  пользователей. Считает дефолт сборка регистрации (`computeActivationEvents`), хост его не
  додумывает: регистрация с пустым набором не поднимается. Тестовым регистрациям в обход сборки
  eager-дефолт даёт харнесс (`testRegistration`, `extensionFixture`).
- **Неявные события — явный список генераторов** `IMPLICIT_ACTIVATION_EVENT_GENERATORS`
  (`activationEvents.ts`, как `activationEventsGenerator` у дескрипторов точек эталона):
  `contributes.commands` ⇒ `onCommand:<id>` (иначе видимая в палитре команда не-eager расширения
  была бы вечным no-op'ом), `contributes.languages` ⇒ `onLanguage:<id>`,
  `contributes.taskDefinitions` ⇒ `onTaskType:<type>`. Полный набор (`computeActivationEvents`:
  объявленные + неявные) считается **один раз при сборке регистрации** (`toExtensionRegistration`) и
  лежит в `IExtensionRegistration.activationEvents`; хост только сравнивает строки и про
  `contributes` не знает. Голое `onUri` манифеста там же становится `onUri:<id в нижнем регистре>`
  (`_readActivationEvents` эталона). Генераторы для поверхностей, которых у нас нет (`onView`, …),
  появятся вместе с поверхностью.
- **Поддержанные события:** `onTaskType:<type>` (фаерит сервис задач перед тем, как спросить
  провайдеров, — см. «Задачи расширений»), `*` и `onStartupFinished` (фаерит
  `ExtensionService.start()` после регистрации, когда файлы открыты), `onLanguage:<id>`,
  `onCommand:<id>`, `workspaceContains:<паттерн>`, `onUri:<id>` (фаерит обработчик URL — см.
  «Обработчики URI расширений»). `onLanguage:<id>` — владелец сигнала сервис языков (как
  `requestRichLanguageFeatures` эталона): `TextFileModel` зовёт
  `ILanguageService.requestLanguageFeatures(id)`, когда у документа появляется язык (новая модель,
  открытый файл, синтетический документ) или меняется (Change Language Mode, Save As);
  `LanguageRegistry` фаерит `onDidRequestLanguageFeatures` один раз на язык, и
  `extensionHostModule.ts` переводит его в `ExtensionService.activateByEvent("onLanguage:"+id)` плюс
  голое `onLanguage`. Так расширение встаёт для любой модели — фоновой вкладки, диффа,
  `jdt:`-документа, — а не только для активного редактора; стартовые (модели открылись до
  регистрации) сервис запоминает и проигрывает за `*`.
- **`onCommand:<id>` — заглушка-активатор, а не только событие.** Пофаерить событие мало: настоящий
  прокси команды заводит сам субпроцесс в `commands.registerCommand`, то есть уже ПОСЛЕ
  `activate()`, и команда до активации попросту не нашлась бы. Поэтому `registerExtension` кладёт в
  `CommandRegistry` заглушку под каждый `onCommand:<id>` (с `commandTitles`-заголовком — значит
  команда видна в палитре): её исполнение сперва `await activateByEvent`, потом вызов уже живого
  прокси. Заглушка не затирает живой прокси, снимается на `commands.registerCommand`, и
  **возвращается на место после смерти субпроцесса** — иначе команда исчезла бы из палитры вместе с
  единственным ручным способом оживить расширение. Провал хоста и «расширение поднялось, но команду
  не завело» гасятся логом: вызывающие (палитра, бинд) результат не ждут, и reject ушёл бы в
  `unhandledRejection` главного процесса.
- **`workspaceContains:<паттерн>` — повод считается по ФС**, поэтому у него свой вход
  `activateByWorkspaceContains()` и своя единица: не «событие на всех», а **расширение** (паттерн —
  аргумент события, и подошёл он конкретному манифесту; так же устроен
  `checkActivateWorkspaceContainsExtension` эталона). Причина подъёма — подошедший паттерн — уходит
  в лог хоста. У префикса **две семантики**, и сводить их к одной нельзя: паттерн **без**
  glob-символов — простая проверка существования пути относительно каждой папки воркспейса (истинна
  и для каталога, `workspaceContains:.vscode`), паттерн **с** ними — поиск ФАЙЛА по дереву. Оба —
  `node/workspaceContainsActivation.ts` за сеамом `IWorkspaceScanner`: проверка путей — `fs.stat`,
  поиск по глобам — **подпроцесс ripgrep**, как `checkGlobFileExists` эталона (поиск файлов с
  `exists`). Все глобы расширения — один запуск `rg` на каждую `file:`-папку (несколько `--glob`),
  флаги и исключения — те же, что у Quick Open (`buildRgFilesArgs`: `files.exclude` +
  `search.exclude`, ignore-файлы по `search.useIgnoreFiles`), чтобы наборы файлов не расходились.
  Первая строка вывода — «найдено»: rg сразу убивается, повод — глоб, которому подошёл путь
  (`matchGlob`; не подошёл ни один по нашему диалекту — первый из манифеста). Коды выхода 1 и 2 —
  «не найдено», несостоявшийся запуск (нет rg, нет папки) — `error` в лог хоста.
  - **Почему подпроцесс, а не `readdir`** (#825): `readdir` по остывшему FUSE/сетевому маунту
    (rclone, sshfs, NFS) висит секунды–десятки секунд в пуле libuv главного процесса, а
    `process.exit` перед выходом дожидается всей очереди пула — выход висел до минуты после
    погашенного экрана. Подпроцесс убивается сигналом, и главный процесс в ФС ради
    `workspaceContains` больше не ходит.
  - **Тайм-аут 7000 мс на расширение**, как `WORKSPACE_CONTAINS_TIMEOUT` эталона; расширения ищут
    параллельно и независимо, как в эталоне: каждое со своим тайм-аутом и поднимается сразу по своему
    ответу — поиск, повисший на медленном маунте, не держит остальных. По тайм-ауту токен отменяется, rg убивается, в лог — `warn` `Not activating extension
    '<id>': Timed out while searching for 'workspaceContains' pattern <паттерны>`: молча усечённый
    поиск читался бы как «ничего не подошло». Тайм-аут — гонка, а не только флаг: `stat` на мёртвом
    маунте флагом не сдвинуть. Выход окна (`ExtensionHost.dispose`, в т.ч. `disposeNow` в
    синхронной фазе) и перезапуск хоста на смену папок отменяют все живые поиски — подпроцесс,
    переживший окно, — баг. Бюджета каталогов нет, как и в эталоне: его роль играет тайм-аут.
  - **Семантика глобов — rg через `anchorRgGlob`, как в эталоне:** паттерн с `**` в начале ищется на
    любой глубине, остальные заякорены от корня папки — `*.py` только в корне, `*/pom.xml` — на
    первом уровне. Файлы под `.gitignore` и под `search.exclude` (`**/node_modules`,
    `**/bower_components`) расширение не поднимают. Симлинки не обходятся (нет
    `search.followSymlinks`).
  - **Шов для тестов:** `DIODE_RIPGREP_PATH` (`loadRipgrep.ts`) подменяет rg всем потребителям —
    фейковый rg изображает зависший обход (e2e `workspaceContainsExit.test.ts`, `drive`).
  - **Лениво.** Папка воркспейса может открыться позже регистрации расширений, поэтому стартовый
    проход делает `ExtensionService.start()` (последним из стартовых событий — поиск
    единственный из них ходит на диск), а смену набора папок ловит
    `IWorkspaceContextService.onDidChangeWorkspaceFolders` →
    `ExtensionService.restartForWorkspaceChange()` в `extensionHostModule.ts`: перезапуск живого
    субпроцесса (см. «Смена воркспейса окна») и проход по новым папкам (до барьера проход ждёт
    стартовый). Повторный проход дешёвый: активное расширение ушло из `pending`, кандидатов нет — ФС
    не трогается вовсе.
- **`extensionDependencies` — зависимости активируются раньше зависимого**
  (`activateAfterDependencies` в `ExtensionHost`, как `_handleActivationRequest` эталона):
  расширение в `activate()` вправе читать `exports` соседа через `extensions.getExtension(dep)`,
  поэтому зависимость поднимается, даже если её собственные события не наступали (стоковый форк
  bazel-java зовёт команды `redhat.java`, а у того в Bazel-воркспейсе своих событий нет). Причина в
  логе — `dependency of <id>, <событие>`. Ожидающая зависимость активируется, поднимающаяся —
  дожидается, активная — годится сразу; id сравниваются без учёта регистра, разбор манифеста и поиск
  цикла — `platform/extensions/common/extensionDependencies.ts` (общий с установкой из магазина). Не
  вышло — зависимое **не активируется** (эталонный `FailedExtension`), оживляет его только
  перезагрузка окна:
  - зависимости нет среди установленных — ошибка в лог и **тост** «Cannot activate the '<имя>'
    extension because it depends on unknown extension '<id>'» (текст `unknownDep` эталона; кнопок
    «Install/Enable and Reload» эталона нет — минимальный вариант). Тост хост шлёт тем же стоком
    `notificationSink`, что и `window.show*Message`, под отрицательными адресами: свои показы
    субпроцесса растут от 1 и гасятся на его смерти, тост хоста к ней отношения не имеет;
  - зависимость упала в `activate()` (сейчас или раньше) — только лог, как у эталона в собранной версии;
  - цикл (`a → b → a`) — только лог с цепочкой; каждый участник узнаёт о цикле на своей активации (у эталона они выпадают из реестра целиком — наблюдаемо то же);
  - **встроенного расширения VS Code** (`vscode.*`) у Diode нет — **отступление**: зависимое
    поднимается без него, с предупреждением в лог (`isBuiltinVSCodeExtension`). У эталона они часть
    продукта и есть всегда, а у нас многих нет (`git` — это `diode.git`), и поставить их неоткуда:
    строгий вариант молча выключил стоковый Supermaven (`extensionDependencies: ["vscode.git"]`).
    Встроенные `vscode.*`, которые у нас есть (`vscode.git-base`), — декларативные языковые паки
    (следующий пункт): скрипт импорта вырезает из манифеста `main` вместе с кодом, иначе хост читал бы
    отсутствующую точку входа и писал `failed to register (builtin)` на каждом старте;
  - расширение **без кода** (декларативный языковой пак, тема) регистрации в хосте не имеет, но зависимость на него удовлетворена: `ExtensionService.start()` сообщает хосту такие id (`registerDeclarativeExtension`), как `_isResolvedExtension` эталона;
  - субпроцесс умер, пока поднималась зависимость, — зависимое не считается упавшим и возвращается к оживлению вместе с ней.
- **Тест-хелпер:** `registerAndActivate(host, reg)` (`TestUtils/ExtensionTestHarness.ts`) = `registerExtension` + `activateByEvent("*")`; харнесс фаерит `activateEvents` (дефолт `["*"]`) после регистрации.

### Пример: builtin `diode-settings` (автодополнение настроек)
`extensions/diode-settings/` — code-расширение, активируется **только** по
`onLanguage:json`/`onLanguage:jsonc` (доказательство лениости: пока не открыт JSON — не грузится). В
`activate()` регистрирует `registerCompletionItemProvider` с селектором `pattern:"**/settings.json"`
→ в `settings.json` подсказывает известные ключи настроек. Каталог ключей **вшит на этапе сборки**:
`scripts/generate-settings-schema.mjs` (запускается из `build-extensions.mjs` перед esbuild)
собирает ключи из configuration-узлов приложения (`CONFIGURATION_CONTRIBUTIONS`,
`workbench/common/configuration/configurationContributions.ts`) + `contributes.configuration` всех
builtin и пишет `settings-schema.generated.ts`, который бандлится в `out/extension.cjs`. Никакого
рантайм-API за схемой расширение не ходит.

## LSP и стоковые клиенты

LSP-протокол diode не пишет. Языковой сервер поднимает **расширение** стоковым
`vscode-languageclient` (сам спавнит сервер, гоняет JSON-RPC и отдаёт результаты через `vscode` API) —
builtin `diode-lsp-typescript` (см. «Builtin LSP-клиент» выше) или сторонний vsix из магазина. Наша
работа — шим `vscode` и швы ядра; готовность поверхности — [API-COVERAGE](../public/API-COVERAGE.md),
заметки по конкретным расширениям — [StockExtensions.md](StockExtensions.md), открытое —
[TODO/LanguageServers.md](../TODO/LanguageServers.md).

### Грабли клиента и серверов

- **Классы-ловушки.** Конвертеры клиента (`protocolConverter`) строят значения-классы шима:
  `new code.CompletionList(items, isIncomplete)` на каждый ответ-список, `SnippetString`,
  `SnippetTextEdit`, `SignatureHelp`, `Location`… Нет класса в namespace — конвертация падает
  целиком, фича молча пустая, а единственный след уходит в `client.outputChannel` (без экспорта
  `CompletionList` тест автодополнения висел таймаутом 60 с вместо ответа). Новый провайдер — сначала
  проверить, какие классы зовёт его конвертер.
- **`client.outputChannel` обязан быть настоящим.** Ошибки конвертации (`p2c.asDiagnostics` и т.п.)
  логируются ТОЛЬКО туда — no-op канал теряет их молча.
- `vscode-languageclient` шлёт `didOpen` серверу только для документов из
  `window.visibleTextEditors` — пустой стаб даёт «сервер молча не получил документ, 0 диагностик».
  Текст, набранный в редакторе и не сохранённый, сервер видит только через didChange — тесты на это
  правят буфер, а не диск.
- `vscode.version` — валидный VS Code semver (лок-степ с `extensions/VSCODE_VERSION`): languageclient
  проверяет `^1.91.0`.
- **Форк `process.execPath` из расширения под SEA.** Там `execPath` — diode-бинарь. Наши
  builtin-клиенты спавнят сервер `{ command }`-формой, а сторонние форкают сами (`TransportKind.ipc`
  у basedpyright), поэтому субпроцесс extension host'а чистит наследуемое окружение:
  `DIODE_EXTENSION_HOST` снят, `DIODE_RUN_AS_NODE=1` — любой форк бинаря из расширения работает как
  node (`main.ts` проверяет RUN_AS_NODE первым, env-фикс — `runExtensionHostSubprocess`). Продолжение:
  `Files.resolve()` vscode-languageserver'а (так eslint ищет линтер в проекте) форкает с
  `execArgv: ["-e", <скрипт>]` — runAsNode обязан понимать eval-режим, иначе расширение молча не
  линтит. Гейты — `extensionHost.fork.test.ts`, `runAsNode.eval.test.ts`, e2e `pythonLsp`/`eslintLsp`
  на настоящем SEA.
- **Rename у tsserver проверять с каретки на ОБЪЯВЛЕНИИ.** С вызова импортированного символа сервер
  переименовывает только локальный алиас (`useAliasesForRenames`, как в VS Code). На холодном старте
  tsserver отвечает только по открытым файлам: перед кросс-файловым rename дождаться готовности проекта
  (в e2e — через Find All References, в юнитах — опросом `provideReferences`).

### Автодополнение поверх LSP

Стек: попап у каретки ← `CompletionService` ← `EditorService.completionSource` ← хост ← RPC ←
провайдеры субпроцесса ← `vscode-languageclient` ← сервер.

- **Dot-accessor.** После `.` tsserver отдаёт `label: "getTime"`, `insertText`/`filterText`:
  `.getTime`, а `range` накрывает саму точку. Поэтому границу префикса ядро берёт из провайдерского
  `range` (свой `wordStart` включает `.` и `-` — префиксом стало бы `d.`), фильтрует по `filterText` и
  не пересчитывает провайдерскую границу при доборе символов (иначе попап закрывался на первом же).
- **Описание и авто-импорт — через resolve.** Клиент объявляет `resolveSupport: [documentation,
  detail, additionalTextEdits]`, в первом ответе их нет; резолвить надо ТОТ ЖЕ объект пункта (см.
  «Completion-провайдер seam» выше). Accept ждёт resolve до 300 мс, потом вставляет без импорта —
  молчащий сервер не морозит правку. Сервер без `resolveProvider` (gopls) шлёт `additionalTextEdits`
  сразу в списке: они едут в пункте (`ICoreCompletionItem.additionalEdits`), и accept применяет их без
  resolve — как «sync additional edits» в `suggestController` эталона.
- **Сниппет-сессий нет** (осознанно): `SnippetString` — только транспорт, плейсхолдеры
  вырезаются (`stripSnippetPlaceholders`), чтобы `${1:name}` не попал в буфер. `TextEditor.insertSnippet`
  (`extHostSnippetInsert.ts`) вставляет текст с отступами эталона и ставит каретку на первую позицию,
  но Tab по позициям не ходит.
- **Клавиши ждут текстовую команду расширения** (отступление от эталона). `registerTextEditorCommand`
  помечает регистрацию `textEditor: true`; пока прокси не получил ответ, `attachKeyboardInputHold`
  (`keyboardInputHold.ts`) держит клавиши в capture на корне и затем прогоняет их в порядке нажатия. Иначе
  клавиша меняет версию документа, правка команды отклоняется, и у Python Indent пропадает перевод строки
  (#967). Ответ приходит после правки: subprocess шлёт `editor.applyEdit` раньше. Потолок — 1 с, зависшее
  расширение клавиатуру не отнимет. Обычные `registerCommand` не держат: они могут ждать человека. Вставка
  (`paste`) не удерживается; переигранный Tab, который никто не обработал, не двигает фокус: это делает только
  движок для своего ввода.
- Markdown в документации и hover показывается текстом — рендерера markdown нет.

### Участники сохранения

`editor.codeActionsOnSave` (объект VS Code `{ "<kind>": true | "explicit" | "always" | false |
"never" }` или массив kinds; все сохранения diode ручные, так что `"explicit"` ≡ `true`) и
`editor.formatOnSave`; дефолты выключены.

- **Композиция.** `TextFileSaveParticipant` (один на все модели) берёт список участников в момент
  save (живые настройки); `EditorService.collectSaveParticipants` собирает порядок VS Code: code
  actions → формат → will-save расширений (editorconfig). Каждый участник видит свежий снапшот —
  предыдущий уже правил буфер (`workspace.applyEdit` из субпроцесса прилетает прямо во время await).
- **Участники** (`services/editor/browser/onSaveParticipants.ts`): для каждого включённого kind —
  `provide({ only: kind })` по всему документу (иерархический матч: `source.fixAll` берёт
  `source.fixAll.ruff`) и `apply` вернувшихся действий по порядку; формат — по свежему тексту, с
  отбросом устаревшего ответа и схлопыванием каретки (общий хвост `applyFormattingEdits` с Format
  Document).
- **Пробелы и переводы строк** (`services/editor/browser/whitespaceSaveParticipants.ts`, upstream
  `saveParticipants.ts`): `files.trimTrailingWhitespace` — первым, до code actions;
  `files.insertFinalNewline` и `files.trimFinalNewlines` — после формата, перед will-save. Полный
  порядок: trim → code actions → формат → final newline → trim final newlines → will-save (последний —
  наше отступление, он и был последним). Настройки читаются в момент save с `overrideIdentifier`
  языка; выключена — провайдер отдаёт `null`, участника нет. Алгоритм удаления хвоста — общий с
  командой `editor.action.trimTrailingWhitespace`: `editor/common/commands/trimTrailingWhitespace.ts`
  (только `' '`/`'\t'`; при `files.trimTrailingWhitespaceInRegexAndStrings: false` строка без точных
  токенов или с хвостом в String/RegEx пропускается; токены — `viewState.tokenStore` панели, без
  панели их нет). Строку с курсором не защищаем: автосохранения нет, а эталон защищает только при нём.
  Финальный перевод строки — `"\n"`, на диск уходит EOL файла. Модель без edit target (ни одной
  вкладки и стороны диффа) правок участников не принимает вовсе — `applyExternalEdits` без
  представления no-op; это общее для всех участников.
- **Таймаут** — 5000 мс на участника (`SAVE_PARTICIPANT_TIMEOUT_MS`): зависший или сбойный
  пропускается, сохраняем как есть (как VS Code).
- **Люфты:** порядок kinds — порядок ключей настройки (VS Code сортирует fixAll-семейство); действия
  одного kind применяются списком без пере-запроса между apply (как в VS Code); сохранение по таймауту
  участника может получить его правки уже ПОСЛЕ записи (буфер останется «грязным»).
- Гейты: `editorService.onSave.test.ts`, `onSaveParticipants.test.ts`,
  `textFileSaveParticipant.test.ts`, `editorService.whitespaceOnSave.test.ts`; стоковый стек — `extensionHost.ruffLsp.onSave.test.ts` (fixAll
  чинит F401 и формат на диске за один Ctrl+S).

### Участники файловых операций

`workspace.onWill/onDid{Create,Delete,Rename}Files` — эталонная цепочка `WorkingCopyFileService` → `mainThreadFileSystemEventService` → `extHostFileSystemEventService`, у нас `WorkspaceEditService` → `FileOperationParticipantAdapter` → `FileOperationsCustomer` → `ExtHostFileOperations`.

- **Группа.** Подряд идущие операции одного вида — одна операция с одним событием на все файлы, как `BulkFileEdits`; текстовая правка или другой вид группу заканчивают. Переименование и перенос из проводника — `move`, копия для расширения — создание.
- **Порядок.** Проверка всей правки → `will` → правка участника → операция → `did`. Отказанная или пропущенная (`ignoreIfExists`) операция событий не даёт.
- **Правка из `waitUntil`** применяется до операции и входит в тот же шаг отмены. Отказ или сбой правки участника операцию не останавливает. Файловые операции внутри неё сами зовут участников, как в эталоне. Автосохранение рефакторинга её буферы не трогает: они остаются грязными.
- **Undo и redo.** Участников не зовут, но `did` посылают с обратной операцией: отмена создания — `delete`, отмена переименования — `move` наоборот.
- **Таймаут** — `files.participants.timeout` (60 с, `0` выключает). Истёк — запрос отменён, операция идёт без правок. Слушатели вызываются по одному, следующий ждёт `waitUntil` предыдущего.
- **Без слушателей `will`** RPC нет (`workspace.updateFileOperationSubscriptions`): зависший хост не держит переименование.
- **Отступления от эталона:** нет вопроса «Extension wants to make refactoring changes» и нет `needsConfirmation` — предпросмотра у нас нет, правка применяется как после «OK» и отменяется одним шагом; прогресс в статус-баре, без кнопки отмены; виртуальные файлы отказываются целиком, событий не дают.
- Гейты: `workspaceEditService.fileOperations.test.ts`, `extHostFileOperations.test.ts`, `fileOperationsCustomer.test.ts`, `extensionHost.fileOperations.test.ts`, сценарий `renameFileUpdatesImports`.

## Правило роста `vscode.d.ts` (важно)
`src/vscode-dts/vscode.d.ts` — стадийная копия upstream `microsoft/vscode:src/vscode-dts/vscode.d.ts`, всё line-commented кроме активной поверхности. Это дословная копия реального API, а не стаб под реализацию. Инвариант: **файл меняется ТОЛЬКО снятием `// `**.

Структура файла:
1. **Шапка** — провенанс (upstream tag + commit SHA + permalink) и ссылка сюда.
2. **Активный `declare module "vscode"`** — дословно раскомментированные строки upstream. Единственный human-owned блок. Framing-строки (сам `declare module "vscode" {`, его `}`, глобальный `Thenable`) — единственное не-upstream в этой части.
3. **Строка-сентинел** `//@diode:begin-upstream-verbatim …`.
4. **Дормант** — вся upstream-копия, каждая строка с `// `. Генерируется, вручную не редактируется.

**Пиннинг.** Тег зафиксирован в шапке и согласован с `extensions/VSCODE_VERSION` (сейчас `1.127.0`)
— держи их в лок-степе. Пин нужен, чтобы обновление upstream шло **ручным трёхсторонним merge**:
base = `vscode.d.ts` запинненной версии, theirs = новый upstream, ours = наш файл с
раскомментированными блоками.

**Как добавить API.** Найди нужный блок в дормантной части и подними **дословно** (сняв `// `) в
активный модуль — не сужать / не переписывать / не переоформлять (комментарии тоже upstream). Если
блок тянет ещё не раскомментированный тип (dependency closure) — раскомментируй и его.
Runtime-значение может опережать типовую декларацию: неймспейсы и корень проверяются против
активного модуля присваиваемостью (`implementsApi<typeof vscode.X>()(ns)` из
`api/common/apiSurface.ts`) — недостающий член или сигнатура не той формы ловится компилятором, а
лишние члены рантайма разрешены. Поднял поверхность или поменял статус стаба — **в том же PR обнови
публичную матрицу** [docs/public/API-COVERAGE.md](../public/API-COVERAGE.md): она ведётся руками и
держится актуальной именно этой дисциплиной; генератор для неё не заводим (решение человека:
дисциплина, а не автоматика).

**Bounded member-level uncommenting.** Для «тяжёлого по closure» блока (namespace/интерфейс/класс,
чьё полное upstream-тело тянет непрактичное дерево зависимостей) можно раскомментировать
**подмножество членов**, оставив прочие в дормантной части. Каждая раскомментированная строка
обязана быть **байт-в-байт** равна upstream. Так сделаны, например, `window`/`workspace`/`languages`
(только реализованные функции), `TextEditor` (`document`/`selection`/`selections`/`options`/`edit`),
`ExtensionContext` (`subscriptions`, каталоги хранения, `secrets`), `FileStat`/`CompletionItem`
(подмножество полей). `TextDocument` поднят целиком, и класс документа субпроцесса
`implements vscode.TextDocument` — недостающий член ловит компилятор.

**Инструмент.** `scripts/import-vscode-dts.mjs`:
- (без флагов) — регенерировать дормант из запинненного тега + обновить провенанс в шапке (активный модуль не трогает);
- `--check` — сверить, что дормант байт-в-байт равен upstream тега (drift guard, нужна сеть);
- `--verify-active` — offline-проверка инварианта: каждая кодовая строка активного модуля дословно присутствует в дормантной копии. Прогоняй после ручного раскомментирования.

**Раскомментирование скриптом.** Если блоков много и правишь файл одноразовым скриптом: все вырезки
из дормантной копии делай из **исходного** текста до первой подстановки — офсеты плывут после каждой
вставки в активную часть, и поиск «следующего маркера» попадает в соседний блок (так вместо
`FileSystem` дважды вырезался `FileSystemProvider`). Якорь в активной части ищи с ведущим `\n`:
строка `\texport enum X {` — подстрока закомментированной `// \texport enum X {`, и проверка
«нашлось ровно одно» проходит, вставляя блок в середину дормантной копии. Итог сверяй
`--verify-active`, а скрипт с несколькими заменами — по каждой замене.

**Какие API нужны стоковому расширению** — дешевле снять с его бандла, чем гонять UI:
`grep -oE "\b(window|workspace|languages|commands|env)\.[A-Za-z]+" out/main.js | sort | uniq -c` (из
магазина — `meta/<id>.json` → `artifact.url` → `unzip`). Быстрый спайк без редактора —
`createExtensionTestHarness({ extensions: [registration], activateEvents: [], logger })`, где
`registration` — настоящий vsix (`fetchStockVsix` → `installVsix` → `registrationFromInstalled`, по
образцу `src/TestUtils/ruffFixture.ts`), со своими стоками (`outputSink`, `statusBarItemSink`,
`quickInputSink`, …) и ручным `host.activateByEvent(...)`: ошибку активации без `logger` не видно.

**Семантические отклонения Diode** (тип совпадает с upstream, отличается только смысл/JSDoc-намерение):
| Символ | Отклонение |
| --- | --- |
| `version` | Возвращает версию **Diode**, а не VS Code (upstream JSDoc говорит «editor»). |
| `Event<T>` | Слушатель `(e) => any` (upstream); хост оборачивает подписки через `EventEmitterImpl` в `api/common/vscodeTypes.ts`. |
| `TextEditorOptions.indentSize` | Хост алиасит его к `tabSize` (Diode пока не различает); editorconfig шлёт `indent_size` так. |
| `TextEditorOptions.cursorStyle` | Getter — `undefined`, пока стиль не задали ни расширение, ни `editor.cursorStyle` (форма терминала, решение человека по #887). Сеттер шлёт только изменение и только 1..6, в редактор по `uri` + `groupId` (не в активный); на хосте это `TextEditorPane.cursorStyleOverride` — переопределение сессии поверх настройки, живёт с вкладкой, в settings.json не пишется (#888). |
| Namespaces / value-типы | Рантайм может опережать типы (лишние члены разрешены); отставание ловит компилятор — поверхность собирается в `api/common/*Namespace.ts` и проверяется `implementsApi<typeof vscode.*>()`. Где отставание осознанное (новый функционал не сделан), стоит точечный каст с комментарием-причиной. |

**Кодировки (#106).** `workspace.openTextDocument(…, { encoding })` реально декодирует не-utf8 файлы
осью encoding ядра (`src/vs/editor/common/model/encoding.ts`): explicit-кодировка побеждает
BOM-сниф, неизвестный id молча откатывается к дефолту (контракт vscode.d.ts); эфемерный документ
детектит и `encoding`, и `eol`. `ExtHostTextDocument.encoding`/`.eol` — живые: обновляются метой
`editor.activeEditorChanged` и снапшотом will-save (`IWireWillSaveParams.encoding`). Дормантные
`workspace.decode`/`encode` не раскомментированы (не понадобились).

**Зависимости:** Extensions → Editor (через `ILanguageService`, `TextMateGrammarLoader`,
`TokenizationRegistry`), Common. Host-адаптеры (`workbench/api/browser/`) **дополнительно →
Workbench** (адаптеры над `EditorService`; мост файловых декораций типизирован портом
`IFileDecorationsTarget`, в DI его реализует `ExplorerService`) и **→ Theme**
(`ThemeColorResolverAdapter` над `ThemeService`) — единственное место, где Extensions поднимается
выше Editor.

**Терминалы расширений (`window.createTerminal`, `terminals`, `activeTerminal`, события).** Устроено
как `ExtHostTerminalService` ↔ `MainThreadTerminalService` эталона. Состояние `vscode.Terminal`
живёт в субпроцессе (`api/common/terminalNamespace.ts`), инстансом владеет хост: `TerminalCustomer`
(`services/extensions/node/customers/`) переводит нотификации
`terminal.create/show/hide/sendText/dispose` в сток `IExtensionTerminalSink`, а его реализация
`ExtensionTerminalAdapter` (`contrib/terminal/browser/` — в фиче, потому что ядро workbench фич не
знает) водит `TerminalService`. Обратно хост пересказывает жизнь ВСЕХ инстансов встроенного
терминала, включая шеллы человека: `terminal.opened` (с pid и `launch` — из него `creationOptions`
чужого терминала), `terminal.closed` (код и причина: выход шелла — `process`, Kill — `user`,
`dispose()` — `extension`), `terminal.activeChanged`. Адресация двойная: хостовый `id` минтит хост,
свой терминал субпроцесс до прихода `opened` адресует собственной меткой `extHostId`
(`extHostTerminalId` эталона) — поэтому `createTerminal` + `sendText` в одном тике доходят до шелла.
Снимок всех инстансов уходит после `host.ready` и до первой активации (`pushInitialState`); на
смерти субпроцесса метки забываются, а шеллы расширения живут дальше — новый субпроцесс видит их как
чужие (у эталона так же). `hideFromUser` — фоновый инстанс `TerminalService`
(`_backgroundedTerminalInstances` эталона): процесс жив, во вкладках он появляется по `show()`.
`location` (`_serializeParentTerminal` эталона) едет в `terminal.create` полем `location`: `1`/`2` —
`TerminalLocation`, `{ viewColumn, preserveFocus }` — колонка, `{ parentTerminal }` — адрес родителя
(субпроцесс находит его запись по объекту `Terminal`; отпущенный — поле пропадает). Хост решает
место как `resolveLocation` эталона: колонка и `Editor` — вкладка в области редакторов через
`TerminalEditorService` (`contrib/terminal/browser/`), родитель — туда же, где он (редакторный —
справа от его группы, `splitInstance`), без `location` — по `terminal.integrated.defaultLocation`;
`show()` редакторного терминала показывает его вкладку (`revealActiveEditor`), `hide()` его не
трогает. `activeTerminal` — как `_evaluateActiveInstance` эталона: у каждого хоста (вид TERMINAL,
область редакторов) свой активный инстанс, глобальный — последний активированный из них
(`TerminalService.getActiveInstanceAcrossHosts`). Вкладка-терминал становится активной, когда она —
активный редактор или её показал `show()`; файл, ставший активным, её не сбрасывает. Иначе
`activeTerminal.show()` стокового Claude Code раскрывал бы панель со старым шеллом. Pty расширения (`ExtensionTerminalOptions`, `ExtHostPseudoterminal`
эталона): на хосте — инстанс с сессией-эмулятором без процесса (`ExtensionPtySession` поверх общего
с шеллом `XtermSurface`, фабрика `ExtensionPtySessionFactoryDIToken`, в сервис — готовой сессией в
опции `session`, как `customPtyImplementation` эталона). Хост сразу после создания шлёт
`terminal.pty.start` — субпроцесс подключает `onDidWrite`/`onDidClose` и зовёт `pty.open`; вывод
склеивается окном 5 мс и едет `terminal.pty.data`, выход pty — `terminal.pty.exit`. Набор человека и
`sendText` расширения идут через хост в эмулятор и обратно `terminal.pty.input` → `handleInput` —
поэтому `sendText` сразу после `createTerminal` приходит уже после `open` (как в эталоне); размер
виджета — `terminal.pty.resize` → `setDimensions`. Закрытие инстанса по любой причине зовёт
`pty.close()`; на смерти субпроцесса его pty-терминалы закрываются.

**Обработчики URI расширений (`window.registerUriHandler`).** Устроено как `ExtHostUrls` ↔
`MainThreadUrls` + `ExtensionUrlHandler` эталона. Субпроцесс (`api/common/uriHandlers.ts`) держит по
обработчику на расширение (владелец — из overlay, `registerUriHandler` в `OWNED_MEMBERS.window`;
повтор — эталонная ошибка) и сообщает хосту `window.registerUriHandler`/`unregisterUriHandler` (id
расширения); хост отдаёт URI запросом `window.handleUri` (id + URI строкой), сбой обработчика
остаётся в stderr субпроцесса. На хосте `UriHandlersCustomer` — реестр спавна
(`ExtensionHost.uriHandlers`), а решение «кому и когда» — `ExtensionUrlHandler`
(`services/extensions/common/`): authority URI должен быть id установленного расширения; без
`trusted` и без записи в `extensions.confirmedUriHandlerExtensionIds` — `DialogService.confirm`;
обработчик есть — доставка сразу, нет — буфер (сборка каждые 30 с, TTL 5 мин) и
`activateByEvent("onUri:<id>")`, а `onDidRegister` спускает буфер. Обработчик подписан на
`IURLService` (`platform/url/common/url.ts`, цепочка до первого `true`); источник URL —
`Developer: Open URL` (`contrib/url/browser/urlActions.ts`, последний ввод — `workspace`-состояние
`workbench.action.url.openUrl.lastInput`). Проводка — `extensionHostModule.ts` при сборке
`ExtensionService`. **Отступления:** нет галочки «больше не спрашивать» (диалог называет настройку),
неустановленное расширение не ставится — тост; протокола ОС и `--open-url` нет.

**Коллекции окружения расширений (`ExtensionContext.environmentVariableCollection`).** Устроено как
`ExtHostTerminalService` (коллекции) ↔ `MainThreadTerminalService` + `EnvironmentVariableService`
эталона. Субпроцесс (`api/common/environmentVariableCollection.ts`) держит по коллекции на
расширение — она переживает повторную активацию — и после каждого изменения шлёт её целиком:
`terminal.setEnvironmentVariableCollection` (id, `persistent`, записи `[ключ, мутатор]` — ключ
`<переменная>` или `<переменная>:::<uri папки>`, описания). На хосте
`EnvironmentVariableCollectionsCustomer` кладёт её в хранилище `IEnvironmentVariableCollectionStore`
(опустевшая — снимается), а на подъёме субпроцесса отдаёт всё хранилище семенем
`terminal.initEnvironmentVariableCollections` (до первой активации, только когда оно не пусто).
Хранилище — `EnvironmentVariableService` (`contrib/terminal/common/`): `persistent` коллекции в
workspace-состоянии `terminal.integrated.environmentVariableCollectionsV2`, перечитываются при смене
воркспейса; коллекции удалённых расширений забываются, когда модуль extension host сообщает состав
установленных (`setInstalledExtensions`). Слияние и применение —
`MergedEnvironmentVariableCollection` (`platform/terminal/common/environmentVariable.ts`): Replace
отсекает остальных, порядок — обратный заведению, область папки — по `index`, Windows — без учёта
регистра. Применяет его сама сессия терминала: `EmbeddedTerminalSession` получает довесок
`ITerminalEnvironmentContributor` (`contrib/terminal/common/extensionEnvironment.ts`, проводка —
фабрика сессий в `workbenchModule.ts`) и зовёт его на каждый запуск процесса — и при перезапуске
терминала задачи — поверх унаследованного окружения и `env` терминала, под нашими `TERM`/`TMUX`
(`buildEnv`); при `strictEnv` — нет (`shouldUseEnvironmentVariableCollection` эталона).
**Отступления:** `applyAtShellIntegration` не применяется (shell integration нет); нет индикатора
устаревшего окружения и `environmentChangesRelaunch`; `${…}` в значениях не разворачиваются.

**Задачи расширений (`vscode.tasks`).** Устроено как `ExtHostTask` ↔ `MainThreadTask` эталона;
задачами владеет сервис ядра (`contrib/tasks`, см. [workbench/Tasks.md](workbench/Tasks.md)).
Субпроцесс (`api/common/tasksNamespace.ts`) держит провайдеры, свои исполнения и колбэки
`CustomExecution`; хост — `TasksCustomer` (`services/extensions/node/customers/`) над стоком
`IExtensionTaskSink`, реализация — мост `ExtensionTaskAdapter` (`contrib/tasks/browser/`, перевод
описаний — `contrib/tasks/common/taskDto.ts`). Провод `tasks.*` (типы —
`api/common/taskWireTypes.ts`, разбор хостом — `hostWireParsers.ts`): субпроцесс → хост
`tasks.registerProvider`/`unregisterProvider` (нотификации с handle, типом и id
расширения-владельца), `tasks.fetch` и `tasks.execute` (запросы), `tasks.terminate`; хост →
субпроцесс `tasks.provideTasks` (запрос по handle) и жизнь ВСЕХ задач ядра — `tasks.didStart`
(исполнение, id терминала, определение с подставленными переменными), `tasks.didStartProcess`,
`tasks.didEndProcess`, `tasks.didEnd`, поэтому задача, запущенная из палитры, приходит расширению
событиями с `name`/`source` задачи провайдера (так bazel-java ищет свою бегущую задачу в
`taskExecutions`). Идентичность — эталонная: своё исполнение `executeTask` заводит по id задачи ДО
запроса, и событие, обогнавшее ответ, находит его — расширение получает свой объект `Task`; задача
из ядра (`fetchTasks`) исполняется по id (`handleId`, `_id` эталона), сеттер `Task` его сбрасывает —
тогда уходит описание целиком. **Отступления:** RPC в стиле Diode (customer, методы `tasks.*`) — по
смыслу 1:1 с `$`-методами; нет `$createTaskId` — id задачи провайдера `${расширение}.${_key}`
субпроцесс считает сам той же формулой (`api/common/taskIdentity.ts`, общая для обеих сторон; схемы
`contributes.taskDefinitions` — из каталога расширений); нет
`$registerSupportedExecutions`/`$registerTaskSystem`/`$jsonTasksSupported`/`$findExecutable`
(исполнение одно — терминал, платформа — своя); `$customExecutionComplete` и отдельного сообщения
старта `CustomExecution` нет — его колбэк зовётся на `tasks.didStart`, как у эталона в
`$onDidStartTask`. **CustomExecution:** ядро заводит терминал задачи на pty расширения через тот же
мост, что `window.createTerminal({ pty })` (`IExtensionPtyTerminals`, реализует
`ExtensionTerminalAdapter`), субпроцесс на старте зовёт колбэк и подключает pty к терминалу по id
инстанса (`ITerminalNamespace.attachPty`, `attachPtyToTerminal` эталона): размер — последний из
`terminal.pty.start`/`resize`, которые хост прислал раньше подключения; при повторном запуске
прежний pty отцепляется без `close()`. Нотификации задач субпроцесс обрабатывает строго по очереди —
старт с колбэком не обгоняется событиями процесса. Overlay владельца оборачивает
`tasks.registerTaskProvider`/`executeTask` и устаревший `workspace.registerTaskProvider`.
`contributes.taskDefinitions` дают неявное `onTaskType:<type>`; перед Run Task сервис поднимает
`onCommand:workbench.action.tasks.runTask` и `onTaskType:` (таймаут 5 с, как у эталона).
`contributes.problemPatterns`/`contributes.problemMatchers` — статический вклад манифеста (без
активации): `bindExtensionTasks` кладёт их в реестр матчеров сервиса задач, паттерны раньше матчеров;
устройство, сообщения о битых вкладах и порядок имён — в
[workbench/Tasks.md](workbench/Tasks.md) («Матчеры из расширений»).

**Мост декораций (`vscode.window.createTextEditorDecorationType` /
`registerFileDecorationProvider`).** Value-типы
(`ThemeColor`/`FileDecoration`/`OverviewRulerLane`/`DecorationRangeBehavior`) живут в
`api/common/vscodeTypes.ts`; `WindowNamespace` держит тип декорации локально (монотонный числовой
key) и шлёт хосту RPC-нотификации, сериализуя `ThemeColor` как `{ $themeColor: id }` (см.
`api/common/wireTypes.ts`). Хост держит реестр `key → { overviewRulerColorId?, isWholeLine }`
(gutter-тип = есть `overviewRulerColor`), резолвит `ThemeColor` через `IThemeColorResolver` и
проталкивает: gutter change-bar'ы — в `EditorComponent.setGutterChangeDecorations` (по совпадению
пути, образец — `DiagnosticsService`), файловые декорации — в `ExplorerService.setFileDecorations`.
На `theme.onDidChange` все держимые декорации пере-резолвятся и пере-push'атся. **Ядро про источник
декораций (git/SCM) не знает** — адаптеры отдают уже резолвнутые packed-RGB цвета.
