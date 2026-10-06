# Configuration/

Часть архитектуры Diode — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).

Сервис пользовательских настроек (урезанный аналог `IConfigurationService` из VS Code). Источники слоями: дефолты из `ConfigurationRegistry` → `User/settings.json` (default-профиль) → `profiles/<name>/settings.json`. Формат — JSONC; битый файл логируется и заменяется пустой моделью — bootstrap не падает.

Раскладка user data (VS Code-совместимая):
```
<root>/                          # default ~/.diode ; CLI --user-data-dir <path>
  extensions/                    # внешние расширения ; CLI --extensions-dir <path> переносит их
  user-data/
    logs/<extId>/                # ExtensionContext.logUri
    User/
      settings.json              # default-профиль
      keybindings.json
      secrets.json               # ExtensionContext.secrets (0600, без шифрования)
      globalStorage/<extId>/     # ExtensionContext.globalStorageUri
      workspaceStorage/<hash>/<extId>/   # ExtensionContext.storageUri
      profiles/<name>/{settings,keybindings}.json
```

Приватные каталоги расширений живут в этой же раскладке и повторяют VS Code:
`globalStorage` и `workspaceStorage` — внутри профиля (переезжают вместе с ним,
как `globalState.json`), `logs` — рядом с `User/`, вне профиля. Отличие от
эталона одно: у нас нет подкаталога сессии (`logs/<timestamp>/`) — ротации логов
по запускам нет. Раздаёт их хост (`ExtensionHost`, см.
[Extensions.md](Extensions.md)), резолвит — `resolveExtensionStoragePaths`.

Там же, внутри профиля, лежит `secrets.json` — `ExtensionContext.secrets`
(`createFileExtensionSecretStore`). В VS Code секреты уходят в связку ключей ОС;
у нас её нет, поэтому они хранятся **открытым текстом под правами `0600`** —
защита ровно уровня прав ФС. Per-profile, как `globalState.json`: токены
рабочего профиля не должны быть видны из личного.

- **`resolveUserDataPaths(...)`** (`Common/UserDataPaths.ts`) — чистая функция, возвращает все пути; имя профиля валидируется `/^[A-Za-z0-9._-]+$/`; `extensionsDir` замещается независимо от `root` (флаг `--extensions-dir`).
- **`parseCliArgs(argv)`** (`platform/environment/node/cliArgs.ts`) — флаги `--user-data-dir`, `--extensions-dir`, `--profile`, `--disable-extensions`, `--log [<channel>:]<level>` (повторяемый) / `--verbose`, `-g`/`--goto`, `-d`/`--diff`, `--inspect-tui`, `--headless[=CxR]` (требует `--inspect-tui`), `-h`/`-v`, разделитель `--`, неизвестные → `CliArgsError`. Позиционные **необязательны**: без них поднимается пустое окно.
- **`resolveStartupTargets(cli, isDirectory)`** (`platform/environment/node/startupTargets.ts`) — что именно открыть: папка воркспейса (первый позиционный-директория), файлы (с `line`/`column` в режиме `--goto`) либо пара сторон `--diff`. Порт к FS передаётся аргументом, поэтому решение тестируется юнитом, а не через `main.ts`. Решение про пустое окно — [docs/TODO/Startup.md](../TODO/Startup.md).
- **`ConfigurationModel`** — иммутабельная: нормализует dotted-keys (`"editor.tabSize"` → вложенный объект), deep-merge слоёв, `get`/`getValue`.
- **`ConfigurationRegistry`** (`Configuration/ConfigurationRegistry.ts`) — contribution point схем настроек (аналог `IConfigurationRegistry` vscode, `vs/platform/configuration/common/configurationRegistry.ts`): фичи описывают настройки узлами `IConfigurationNode` (`{ id, title, properties }`, ключи в `properties` — полные dotted; схема ключа — `{ scope, type, default, description?, enum?, minimum?, maximum? }`), реестр агрегирует их по ключу, дубль ключа — ошибка. Узлы приложения — явный массив `CONFIGURATION_CONTRIBUTIONS` (`Workbench/Configuration/configurationContributions.ts`, по файлу-узлу на секцию: workbench/editor/explorer/files/scm/search/terminal; чистые данные — их бандлит и генератор схемы автодополнения `scripts/generate-settings-schema.mjs`). Из реестра деривируются: defaults-слой `ConfigurationService` (`getDefaultConfiguration()` — вложенное дерево), известные ключи валидации settings.json (`DiagnosticsService` → `collectKnownSettingKeys`) и каталог автодополнения diode-settings. Собирается на bootstrap в `main.ts`, в DI — `ConfigurationRegistryDIToken` (`configurationModule`). **`scope`** у ключа (`application`/`machine`/`window`/`resource`/`language-overridable`, как `ConfigurationScope` эталона) объявляет, где ключ **разрешено** переопределять. Поле **обязательное** — в отличие от эталона, где оно опционально с дефолтом `WINDOW`: ключей у нас десятки, и молча получить `window` у ключа, который на самом деле про папку, дороже, чем ответить на вопрос при заведении ключа. Читателя у поля пока нет — слоёв ниже user'а (`.code-workspace`, `<folder>/.vscode/settings.json`) не существует; это декларация на будущее, и ревизия всех наших ключей записана таблицей в `configurationContributions.test.ts` (см. [TODO/MultiRoot.md](../TODO/MultiRoot.md), M6).
- **Настройки по языку (`"[lang]"`).** `ConfigurationModel` держит секции языков (`"[go]"`, сдвоенные `"[javascript][typescript]"`) отдельно от основного дерева и сливает их послойно, как `overrides` vscode; `override(lang)` кладёт секцию поверх итогового значения, поэтому `[lang]` из любого слоя — и из `contributes.configurationDefaults` расширения — бьёт плоское значение любого слоя (Makefile на табах при глобальном `insertSpaces: true`). Чтение — `get(key, { overrideIdentifier })` / `inspect(key, overrides)`; второй аргумент `get` у нас — только `overrides`, как у `getValue(section, overrides)` vscode (`defaultValue` убран). В секции действуют ключи ядра со `scope: "language-overridable"` (остальные ключи ядра там игнорируются, значения проходят схему); ключи расширений — как есть. Общая логика двух реализаций сервиса — `ConfigurationSnapshot` (`common/`): слитая модель, ленивые модели по языку, событие изменения с `overrideIdentifiers`. Потребители по языку документа: `EditorService.applyConfigurationToEditor` (переприменяется и при смене языка модели), участники on-save, inline completions, `workspace.getConfiguration(section, scope)` в API расширений (`TextDocument` или `{ languageId }` → секция языка; слои с секциями хост шлёт в сырой форме, `ConfigurationModel.toRaw`). Не делаем: запись в секцию языка, язык по позиции (embedded), `resource`-ось.
- **Ключи расширений в том же реестре.** `registerExtensionConfiguration(extId, properties)` — `contributes.configuration` расширения (дубль — предупреждение и пропуск, не исключение; владелец и `scope` хранятся, схема значений не валидируется), `registerDefaultConfigurations(overrides)` — переопределения дефолтов (курируемые инъекции хоста). Заводит их `ExtensionConfigurationContributor` на bootstrap, до `loadConfiguration`, — так defaults-слой сервиса, валидатор settings.json и extension host (`getConfigurationData()` → `{ defaults, user }`) видят одни и те же дефолты. Детали — [Extensions.md](Extensions.md).
- **Типизированные ключи и валидация по схеме.** Узлы объявлены `as const satisfies IConfigurationNode`, из них выводится `DiodeSettings` (`configurationContributions.ts`: `type: "number"` → `number`, `enum` → union литералов) и через module augmentation наполняет платформенный `IConfigurationKeys` — platform о workbench не знает. Отсюда перегрузка `get(key)` для ключа схемы: точный тип без `undefined` (дефолт гарантирует реестр); прежняя `get<T>(key, default?)` остаётся для чужих ключей (`git.*`, настройки расширений) и объектов с явным типом. Runtime-половина — `sanitizeConfiguration` (`platform/configuration/common/configurationValidation.ts`, аналог `validate()` опций редактора vscode): значение, не прошедшее `type`/`enum`/`minimum`/`maximum` своей схемы, обе реализации сервиса заменяют дефолтом схемы (`inspect().user` остаётся как записано). Поэтому дублей дефолтов (`?? true`, `?? 80`, константы `DEFAULT_*`) и ручных санитайзеров на месте вызова нет; юниты, которым нужны дефолты, берут `createTestConfigurationService(settings?)` из `TestUtils`.
- **`ConfigurationService`** — async `loadConfiguration(paths, logger?, fileWatcher?, registry?)`; `registry` — источник defaults-слоя (production передаёт реестр из `CONFIGURATION_CONTRIBUTIONS`; без него слой пуст — юнит-тесты). **Live-reload:** если передан `IFileWatcher` (из Common), сервис следит за `User/settings.json` (и файлом именованного профиля), на изменение перечитывает слой через `reload()`, пересобирает merged и эмитит `onDidChangeConfiguration` с диффом затронутых ключей (`diffConfigurationKeys` через `ConfigurationModel.collectKeys()`). `affectsConfiguration(q)` матчит точное совпадение, предка и потомка ключа. **`updateValue(key, value)`** (обязательный метод интерфейса, как у VS Code) — запись в settings.json активного профиля через `jsonc-parser` (сохраняет комментарии/форматирование) + синхронный апдейт in-memory слоя и то же событие изменения; первый потребитель — theme picker. Пустой дифф события не порождает (повторный reload после собственной записи молчит). `InMemoryConfigurationService` (`platform/configuration/common/`, аналог `TestConfigurationService`) — та же модель без диска: дефолты из того же реестра, `updateValue` пишет в user-слой в памяти и эмитит то же событие; его биндит тестовый профиль (`configurationModuleDefault`) вместе с реестром, так что тесты видят дефолты приложения. `NULL_CONFIGURATION_SERVICE` — пустая read-only заглушка для юнитов, которым настройки безразличны: дефолтов нет, запись — отказ (rejected promise). Потребители live-apply: `EditorService` (перепримeняет `editor.*` к открытым редакторам), `WorkbenchComponent` (перекрашивает по `workbench.colorTheme`), `ExplorerService` и `FileSearchService` (`files.exclude`/`search.exclude` — см. ниже); `explorer.*` читаются on-demand.

**Читай настройку на каждом обращении, а не кэшируй в поле.** Конфиг и так живой (watcher → `reload` → `onDidChangeConfiguration`), поэтому потребитель, который зовёт `get(key)` в момент использования, применяет правку `settings.json` без перезапуска бесплатно (образец — `editor.inlineSuggest.*` в `InlineCompletionsService`). Значение, скопированное в поле при создании, — единственный способ эту живость потерять; если кэш нужен ради цены, он обязан подписаться на `onDidChangeConfiguration`.

**Новый ключ настройки — три шага:** узел в `workbench/common/configuration/*Configuration.ts` с обязательным `scope`; запись в `EXPECTED_SCOPES` (`configurationContributions.test.ts` — ревизия скоупов таблицей, без неё тест красный); перегенерация каталога автодополнения `settings-schema.generated.ts` (`npm run build:extensions`, генератор сам форматирует prettier'ом). Снапшот настроек, который едет в субпроцесс расширений, — вложенное дерево, а не dotted-ключи.

Пути обоих файлов доступны через окружение процесса — `IEnvironmentService` (`platform/environment/common/environment.ts`, токен `IEnvironmentServiceDIToken`): `settingsResource` (валидатор settings.json) и `keybindingsResource`. Оба используют Preferences-экшены (`contrib/preferences/browser/`). `workbench.action.openSettings` (Ctrl+,) открывает settings.json в редакторе — UI-редактора настроек нет. `workbench.action.openGlobalKeybindings` (Ctrl+K Ctrl+S) с недавних пор открывает **UI-вкладку** Keyboard Shortcuts (`KeybindingsEditorPane`, редактирует и пишет keybindings.json через `KeybindingsEditorService` — детали в [Workbench.md](Workbench.md#текущие-обитатели), Preferences-кластер); сам JSON — отдельной командой `…openGlobalKeybindingsFile` (VS Code parity). На свежем профиле JSON создаётся заготовкой. Окружение собирает `createEnvironmentService` (`platform/environment/node/`) из резолва user data в `main.ts`, биндит `environmentModule`; в тестах — `createTestEnvironment()` тестового профиля (пути в своём временном каталоге на контейнер, `null`-путей нет).

Применение к редактору: `EditorService` при создании каждого редактора (`EditorComponent`) дёргает `setIndentOptions({ tabSize, insertSpaces })` и `setCursorSurroundingLines(...)` из ключей `editor.*`. `setIndentOptions` принудительно выключает auto-detect indent.

Фикстура `test-fixtures/diode-home/` повторяет реальную раскладку (`--user-data-dir ./test-fixtures/diode-home`); профиль `compact` демонстрирует переопределение `editor.tabSize`.

## Слой exclude-настроек

Три настройки отвечают на три разных вопроса, и общего у них только формат
значения. Ключи, разбор и сборка набора под каждого потребителя — в
`workbench/common/configuration/excludeSettings.ts`; сами узлы со дефолтами — в
`filesConfiguration.ts` и `searchConfiguration.ts`.

| Настройка | Смысл | Потребители |
| --- | --- | --- |
| `files.exclude` | «этого нет» | дерево Explorer'а (`FileTreeDataProvider`), индекс файлов Quick Open (`FileSearchService`), поиск по содержимому (ripgrep), `workspace.findFiles` расширения |
| `search.exclude` | «этого не надо в поиске» — ДОБАВЛЯЕТСЯ к `files.exclude` | индекс файлов, поиск по содержимому |
| `files.watcherExclude` | «за этим не следим» (свой бюджет inotify) | `ITreeFileWatcher` ядра, `FileWatcherAdapter` расширений |

Формат значения — карта `{ "<glob>": true }`, как у эталона: слои конфигурации
сливаются ПО КЛЮЧАМ, поэтому свой шаблон добавляется рядом с дефолтными, а
ненужный дефолт гасится значением `false`. Объектные значения настроек по точкам
не сплющиваются (`normalizeNode` в `configurationModel.ts`) — иначе ключ-glob
развалился бы в дерево.

Все дефолты — в форме `**/<имя>`, то есть матчат САМ вход, а не только его
содержимое: `**/<имя>/**` каталог не матчит, и обход всё равно спускался бы
внутрь. Шаблон матчится против пути ОТНОСИТЕЛЬНО корня — так же, как его матчат
watcher (`isExcluded`) и ripgrep (`--glob !<pattern>`).

`search.exclude` не входит в дефолты `workspace.findFiles` сознательно — так в
контракте эталона: расширение ищет файл, чтобы с ним работать, а не чтобы
показать человеку результат поиска. Набор шаблонов едет в субпроцесс в общем
снапшоте настроек (`WorkspaceConfigStore`) и читается тем же кодом, что на
хосте.

Живая применяемость: набор читается на каждое обращение (дешевле, чем кешировать
и подписываться), а правка настройки дополнительно перечитывает дерево
(`ExplorerService` → `refresh()`) и пересобирает индекс файлов
(`FileSearchService`) — иначе исключённое висело бы на экране до перезапуска.
Поиск по содержимому и `findFiles` отдельного сигнала не требуют: они собирают
набор на каждый запрос.

Четвёртый набор, `DEFAULT_WORKSPACE_CONTAINS_EXCLUDES`
(`workspaceContainsActivation.ts`), пользовательской настройке НЕ подчиняется:
`workspaceContains:`-паттерн подразумевает сам проект, а не его зависимости, и
семантика взята у эталона.

## StateService — машинное состояние (отдельно от настроек)
Рядом с `ConfigurationService` живёт **`StateService`** (`Configuration/StateService.ts`) — аналог `IStorageService`/`Memento`: персистентное **машинное** состояние UI/сессии (открытые файлы + активная вкладка, ширина/видимость сайдбара, видимость/высота нижней панели). Это **не** `settings.json`: формат — plain JSON (никто не редактирует руками), scope `global` (`<profileDir>/globalState.json`) / `workspace` (`<profileDir>/workspaceStorage/<sha256(folder)>/state.json`; у пустого окна — `workspaceStorage/empty-window/state.json`). Движок: write-through + debounced-запись + `flushSync` на `process.on("exit")`, tolerant-load, сохранение unknown-ключей. DI-токен — `platform/state/common/iStateService.ts`, биндинг-модуль — `Workbench/Modules/StateModule.ts`; дескрипторы — `Workbench/Services/StateKeys.ts`; потребители — `WorkbenchStateService` (открытые редакторы) и `LayoutService` (layout). Полное описание → [State.md](State.md).
