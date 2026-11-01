# Configuration

Часть архитектуры Diode — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).

Сервис пользовательских настроек (урезанный аналог `IConfigurationService` из VS Code). Источники слоями: дефолты из `ConfigurationRegistry` → `User/settings.json` (Default-профиль; в именованном профиле из него действуют только ключи `scope: "application"`) → `profiles/<id>/settings.json` активного именованного профиля (он **замещает** пользовательский слой, а не уточняет его — семантика эталона, см. [Профили](#профили-user-data-profiles)) → `<папка>/.diode/settings.json` (слой воркспейса, см. [ниже](#слой-воркспейса-diodesettingsjson)); у окна из файла `.code-workspace` слой воркспейса — блок `settings` файла, а `.diode/settings.json` папки ложится поверх него слоем папки ([ниже](#файл-воркспейса-code-workspace)). Формат — JSONC; битый файл логируется и заменяется пустой моделью — bootstrap не падает.

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
      globalStorage/storage.json # реестр профилей и привязки к воркспейсам (application scope, State.md)
      profiles/<id>/{settings,keybindings}.json   # именованные профили; id — slug имени (реестр в storage.json)
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

## Профили (user data profiles)

Аналог профилей VS Code (`platform/userDataProfile/` эталона); отступления и решения — ниже, открытые задачи — [TODO/Profiles.md](../TODO/Profiles.md).

- **Модель и реестр** — `platform/userDataProfile/common/userDataProfile.ts`: `IUserDataProfile { id, name, isDefault, location, settingsResource, keybindingsResource, globalStorageHome, extensionsResource }`, `IUserDataProfilesService` (токен `IUserDataProfilesServiceDIToken`) — `profiles`, `createNamedProfile`, `updateProfile`, `removeProfile`, `setProfileForWorkspace`/`getProfileForWorkspace`, событие `onDidChangeProfiles`. Node-реализация (`node/userDataProfilesService.ts`) хранит реестр в application-состоянии `User/globalStorage/storage.json` ключами эталона: `userDataProfiles: [{ name, location }]` (`location` — относительно `User/profiles/`) и `profileAssociations: { workspaces: { "<путь>": "<id>" } }`. Каталог профиля создаётся при создании и сносится при удалении; каталоги `User/profiles/<name>/` без записи (старые `--profile`) регистрируются на каждом старте как профили с именем каталога (`migrateProfileDirectories`).
- **Id профиля** — slug имени (`profileIdFromName`: `[A-Za-z0-9._-]`, прочее → `-`, коллизия → `-2`), он же — имя каталога; переименование каталог не двигает. Отступление от эталона (там случайный hex) — в таблице ниже.
- **Активный профиль** фиксирован на процесс: `main.ts` читает реестр раньше остальных путей (`loadApplicationState` → `UserDataProfilesService` → `resolveActiveProfile`: `--profile <name>` → привязка воркспейса → Default; `--profile` с неизвестным именем создаёт пустой профиль и привязывает открытый воркспейс) и только потом резолвит `IUserDataPaths` с `profile: id`. Workbench получает его через `IUserDataProfileService.currentProfile` (`workbench/services/userDataProfile/common`), пути ресурсов — по-прежнему через `IEnvironmentService`.
- **Привязка — к воркспейсу**: ключ `profileWorkspaceKey` — абсолютный путь файла `.code-workspace`, если окно открыто им, иначе путь папки (зеркало `workspace.configuration ?? folders[0]` эталона), в форме `fsPath`; пустое окно привязки не имеет. Привязка к Default = снятие записи.
- **Слои настроек** именованного профиля — как у эталона (`ApplicationConfiguration` + `UserConfiguration` с `PROFILE_SCOPES`): слой `user` = `User/settings.json`, урезанный до зарегистрированных ключей `APPLICATION_SCOPES` (`pickRegisteredSettings`); слой `profile` = файл профиля без `application`-ключей (`PROFILE_SCOPES`, отброшенные — warn в лог). `updateValue` `application`-ключа из именованного профиля пишет в `User/settings.json`, остальное — в файл профиля. `inspect().user`/`.profile` отражают именно эти слои. Keybindings — standalone: грузится только `keybindings.json` активного профиля.
- **Команды** (`contrib/userDataProfile/`, ID и названия эталона): `Profiles: Switch Profile...` (пикер, текущий — `$(check)`; выбор пишет привязку воркспейса и перезагружает окно), `Profiles: New Profile...` (имя → «Empty» / «Copy from current»: settings.json без `application`-ключей + keybindings.json → привязка → перезагрузка), `Profiles: Delete Profile...` (мультивыбор; удалён текущий — окно перезагружается в профиль воркспейса, то есть Default). Смена воркспейса на живом окне (Open Folder, Open Workspace from File) пересчитывает привязку **до** смены папки — обёртка опенера воркспейса `UserDataProfileWorkspaceOpener` над `WorkbenchComponent` (`WorkspaceFolderOpenerDIToken`): другой профиль — папка не трогается, окно перезагружается уже с новым воркспейсом; Cancel в «Save changes?» оставляет окно в прежней папке и профиле. `application`-ключ в settings.json именованного профиля не действует и назван warn'ом в канале `configuration` один раз на набор ключей. Перезагрузка несёт аргументы следующего окна явно (`relaunchArgs`: `--profile <name>`, при смене воркспейса — его путь вместо позиционных; супервизор читает их из файла `DIODE_RELAUNCH_FILE`, `base/node/restartProcess.ts`).
- **Заголовок окна** терминала (OSC 0, `WindowTitleContribution`, `workbench/browser/parts/titlebar/`): `${rootName} - ${profileName} - Diode` — подмножество дефолта `window.title` эталона; у Default `${profileName}` пуст. Самого ключа `window.title` нет.
- **Не поддержано** (итерации 3–4 в [TODO/Profiles.md](../TODO/Profiles.md)): `useDefaultFlags`, `workbench.settings.applyToAllProfiles`, `window.newWindowProfile`, `emptyWindows`, Export/Import, `--profile-temp`, Profiles editor, горячее переключение.

**Решения человека** (итерация 1, #601): семантика настроек именованного профиля — эталонная (свой `settings.json` плюс `application`-ключи Default), а не наследование всего; id — slug из имени; переключение — перезагрузкой окна; реестр — в `User/globalStorage/storage.json`, как у эталона; привязка — к воркспейсу (`.code-workspace` приоритетнее папки), `--profile` тоже привязывает. Хвосты, меняющие устройство (`StateFileStore`, магазин), ведутся задачами, а не чинятся в фиче (13.10.2026).

**Отступления от эталона:**

| Что | Эталон | У нас | Мотив |
|---|---|---|---|
| id профиля | случайный hex, каталог `profiles/<id>` | slug имени (`[A-Za-z0-9._-]`, прочее → `-`, ≤ 64; пусто или одни точки → `profile`; имена устройств Windows (`con`, `nul.txt`…) → префикс `profile-`; коллизия без учёта регистра и с зарезервированным `default` → `-2`) | каталог читается глазами и совпадает с прежним `--profile <name>`; переименование каталог не двигает — id расходится с именем |
| переключение | перезапуск extension host без перезагрузки окна | перезагрузка окна (профиль фиксирован на процесс, `IEnvironmentService`) | как у remote-окна эталона |
| привязка Default | пишется `"__default__profile__"` | запись снимается (нет записи ⇔ Default) | файл короче, резолв тот же |
| каталоги без записи в реестре | `cleanUp()` на старте сносит | регистрируются как профили | миграция старых `--profile`; `removeProfile` сносит каталог сразу |
| пустое окно | привязка `emptyWindows` | нет: `--profile` либо Default; после reload — профиль из аргументов перезапуска | итерация 3 |
| `window.title` | настройка с переменными | заголовок терминала (OSC) из `rootName`, `profileName`, `Diode`; ключа нет | — |
| `Delete Profile...` | precondition `HAS_PROFILES_CONTEXT` | всегда в палитре; без именованных профилей пикер не открывается | контекст-ключ — с Profiles editor |
| `New Profile...` | Profiles editor (имя, иконка, Copy from, ресурсы) | два шага quick input: имя → «Empty» / «Copy from current» | editor — итерация 4 |
| `application`-ключ в settings.json профиля | редактор гасит ключ с подсказкой | не действует, warn в канале `configuration` | подсказки — вместе с валидацией settings.json |
| уборка общего каталога расширений | `.obsolete` + `deleteExtensionsNotInProfiles` на старте shared process | пометка в `.obsolete` при уходе версии из последнего профиля, удаление на старте окна; каталоги, загруженные живыми окнами (`extensions/.inuse/<pid>.json`), не трогаются | окно — свой процесс, общего shared process нет ([Extensions.md](Extensions.md)); каталоги без ссылок из профилей (положенные руками, сироты) помечаются на старте и удаляются на следующем, как у эталона |
| профиль без `extensions.json` | пустой состав | при старте получает все установленные, файл пишется | обновление с 0.8.x (расширения были общими) ничего не прячет; новый профиль получает `[]` явно |
| запись `extensions.json` | `location` + `relativeLocation` + `metadata` | `identifier`, `version`, `relativeLocation`; чужие поля сохраняются | `metadata` (pre-release, источник, pinned) нет |

`--profile default` (как у эталона, поиск по имени с учётом регистра) создаёт именованный профиль `default` с каталогом `profiles/default-2`, а не открывает Default.

- **`resolveUserDataPaths(...)`** (`platform/environment/node/userDataPaths.ts`) — чистая функция, возвращает все пути; `profile` — **id** (каталог) активного профиля из реестра, валидируется `/^[A-Za-z0-9._-]+$/`; `extensionsDir` замещается независимо от `root` (флаг `--extensions-dir`).
- **`parseCliArgs(argv)`** (`platform/environment/node/cliArgs.ts`) — флаги `--user-data-dir`, `--extensions-dir`, `--profile`, `--disable-extensions`, `--log [<channel>:]<level>` (повторяемый) / `--verbose`, `-g`/`--goto`, `-d`/`--diff`, `--inspect-tui`, `--headless[=CxR]` (требует `--inspect-tui`), `-h`/`-v`, разделитель `--`, неизвестные → `CliArgsError`. Позиционные **необязательны**: без них поднимается пустое окно.
- **`resolveStartupTargets(cli, isDirectory)`** (`platform/environment/node/startupTargets.ts`) — что именно открыть: папка воркспейса (первый позиционный-директория), файлы (с `line`/`column` в режиме `--goto`) либо пара сторон `--diff`. Порт к FS передаётся аргументом, поэтому решение тестируется юнитом, а не через `main.ts`. Решение про пустое окно — [docs/TODO/Startup.md](../TODO/Startup.md).
- **`ConfigurationModel`** — иммутабельная: нормализует dotted-keys (`"editor.tabSize"` → вложенный объект), deep-merge слоёв, `get`/`getValue`.
- **`ConfigurationRegistry`** (`platform/configuration/common/configurationRegistry.ts`) — contribution point схем настроек (аналог `IConfigurationRegistry` vscode, `vs/platform/configuration/common/configurationRegistry.ts`): фичи описывают настройки узлами `IConfigurationNode` (`{ id, title, properties }`, ключи в `properties` — полные dotted; схема ключа — `{ scope, type, default?, description?, enum?, minimum?, maximum? }`), реестр агрегирует их по ключу, дубль ключа — ошибка. Узлы приложения — явный массив `CONFIGURATION_CONTRIBUTIONS` (`workbench/common/configuration/configurationContributions.ts`, по файлу-узлу на секцию: workbench/editor/explorer/files/scm/search/terminal/tasks/extensions; чистые данные — их бандлит и генератор схемы автодополнения `scripts/generate-settings-schema.mjs`). Из реестра деривируются: defaults-слой `ConfigurationService` (`getDefaultConfiguration()` — вложенное дерево), известные ключи валидации settings.json (`DiagnosticsService` → `collectKnownSettingKeys`) и каталог автодополнения diode-settings. Собирается на bootstrap в `main.ts`, в DI — `ConfigurationRegistryDIToken` (`configurationModule`). **`scope`** у ключа (`application`/`machine`/`window`/`resource`/`language-overridable`, как `ConfigurationScope` эталона) объявляет, где ключ **разрешено** переопределять. Поле **обязательное** — в отличие от эталона, где оно опционально с дефолтом `WINDOW`: ключей у нас десятки, и молча получить `window` у ключа, который на самом деле про папку, дороже, чем ответить на вопрос при заведении ключа. Читает поле слой воркспейса: ключ `application`/`machine` из `.diode/settings.json` не действует (см. [ниже](#слой-воркспейса-diodesettingsjson)); ревизия всех наших ключей записана таблицей в `configurationContributions.test.ts` (см. [TODO/MultiRoot.md](../TODO/MultiRoot.md), M6). У ключей расширений есть ещё `machine-overridable` (свойство машины, которое проекту можно переопределить: путь к JDK у redhat.java); `application-machine` эталона у нас равен `application`.
- **`editor.codeLens`** (boolean, `true`, `language-overridable`, дословно как в эталоне) доходит до редактора через `TextEditorConfiguration.apply`: `false` снимает зоны линз сразу, `true` запрашивает заново без переоткрытия. `editor.codeLensFontFamily` и `editor.codeLensFontSize` не заводим: шрифт терминала один.
- **Настройки по языку (`"[lang]"`).** `ConfigurationModel` держит секции языков (`"[go]"`, сдвоенные `"[javascript][typescript]"`) отдельно от основного дерева и сливает их послойно, как `overrides` vscode; `override(lang)` кладёт секцию поверх итогового значения, поэтому `[lang]` из любого слоя — и из `contributes.configurationDefaults` расширения — бьёт плоское значение любого слоя (Makefile на табах при глобальном `insertSpaces: true`). Чтение — `get(key, { overrideIdentifier })` / `inspect(key, overrides)`; второй аргумент `get` у нас — только `overrides`, как у `getValue(section, overrides)` vscode (`defaultValue` убран). В секции действуют ключи ядра со `scope: "language-overridable"` (остальные ключи ядра там игнорируются, значения проходят схему); ключи расширений — как есть. Общая логика двух реализаций сервиса — `ConfigurationSnapshot` (`common/`): слитая модель, ленивые модели по языку, событие изменения с `overrideIdentifiers`. Потребители по языку документа: `EditorService.applyConfigurationToEditor` (переприменяется и при смене языка модели), участники on-save, inline completions, `workspace.getConfiguration(section, scope)` в API расширений (`TextDocument` или `{ languageId }` → секция языка; слои с секциями хост шлёт в сырой форме, `ConfigurationModel.toRaw`). Не делаем: запись в секцию языка, язык по позиции (embedded), `resource`-ось.
- **Ключи расширений в том же реестре.** `registerExtensionConfiguration(extId, properties)` — `contributes.configuration` расширения (дубль — предупреждение и пропуск, не исключение; владелец и `scope` хранятся, схема значений не валидируется), `registerDefaultConfigurations(overrides)` — переопределения дефолтов (курируемые инъекции хоста). Заводит их `ExtensionConfigurationContributor` на bootstrap, до `loadConfiguration`, — так defaults-слой сервиса, валидатор settings.json и extension host (`getConfigurationData()` → `{ defaults, user }`) видят одни и те же дефолты. Детали — [Extensions.md](Extensions.md).
- **Типизированные ключи и валидация по схеме.** Узлы объявлены `as const satisfies IConfigurationNode`, из них выводится `DiodeSettings` (`configurationContributions.ts`: `type: "number"` → `number`, `enum` → union литералов) и через module augmentation наполняет платформенный `IConfigurationKeys` — platform о workbench не знает. Отсюда перегрузка `get(key)` для ключа схемы: точный тип без `undefined` (дефолт гарантирует реестр); ключ схемы без `default` (`editor.cursorStyle`: незаданный — «не трогать форму курсора терминала») читается как `тип | undefined`, в defaults-слой не попадает, а невалидное значение у него становится `undefined`; прежняя `get<T>(key, default?)` остаётся для чужих ключей (`git.*`, настройки расширений) и объектов с явным типом. Runtime-половина — `sanitizeConfiguration` (`platform/configuration/common/configurationValidation.ts`, аналог `validate()` опций редактора vscode): значение, не прошедшее `type`/`enum`/`minimum`/`maximum` своей схемы, обе реализации сервиса заменяют дефолтом схемы (`inspect().user` остаётся как записано). Исключение — `type: "integer"` (`EditorIntOption` эталона, `editor.colorDecoratorsLimit`): число (и числовая строка) вне `minimum`/`maximum` или дробное зажимается в диапазон и усекается, как `clampedInt`; дефолт — только не-числу. Ещё исключение — `booleanEquivalents` (`editor.inlayHints.enabled`, `validate` эталона): булево в ключе, который перерос его, читается как свой эквивалент (`true` → `on`, `false` → `off`), а не как дефолт. Поэтому дублей дефолтов (`?? true`, `?? 80`, константы `DEFAULT_*`) и ручных санитайзеров на месте вызова нет; юниты, которым нужны дефолты, берут `createTestConfigurationService(settings?)` из `TestUtils`.
- **`ConfigurationService`** — async `loadConfiguration(paths, logger?, fileWatcher?, registry?)`; `registry` — источник defaults-слоя (production передаёт реестр из `CONFIGURATION_CONTRIBUTIONS`; без него слой пуст — юнит-тесты). **Live-reload:** если передан `IFileWatcher` (из Common), сервис следит за `User/settings.json` (и файлом именованного профиля), на изменение перечитывает слой через `reload()`, пересобирает merged и эмитит `onDidChangeConfiguration` с диффом затронутых ключей (`diffConfigurationKeys` через `ConfigurationModel.collectKeys()`). `affectsConfiguration(q)` матчит точное совпадение, предка и потомка ключа. **`updateValue(key, value)`** (обязательный метод интерфейса, как у VS Code) — запись в settings.json активного профиля через `jsonc-parser` (сохраняет комментарии/форматирование) + синхронный апдейт in-memory слоя и то же событие изменения; первый потребитель — theme picker. Пустой дифф события не порождает (повторный reload после собственной записи молчит). `InMemoryConfigurationService` (`platform/configuration/common/`, аналог `TestConfigurationService`) — та же модель без диска: дефолты из того же реестра, `updateValue` пишет в user-слой в памяти и эмитит то же событие; его биндит тестовый профиль (`configurationModuleDefault`) вместе с реестром, так что тесты видят дефолты приложения. `NULL_CONFIGURATION_SERVICE` — пустая read-only заглушка для юнитов, которым настройки безразличны: дефолтов нет, запись — отказ (rejected promise). Потребители live-apply: `EditorService` (перепримeняет `editor.*` к открытым редакторам), `WorkbenchComponent` (перекрашивает по `workbench.colorTheme`), `ExplorerService` и `FileSearchService` (`files.exclude`/`search.exclude` — см. ниже); `explorer.*` читаются on-demand.

**Читай настройку на каждом обращении, а не кэшируй в поле.** Конфиг и так живой (watcher → `reload` → `onDidChangeConfiguration`), поэтому потребитель, который зовёт `get(key)` в момент использования, применяет правку `settings.json` без перезапуска бесплатно (образец — `editor.inlineSuggest.*` в `InlineCompletionsService`). Значение, скопированное в поле при создании, — единственный способ эту живость потерять; если кэш нужен ради цены, он обязан подписаться на `onDidChangeConfiguration`.

**Настройки — как в эталоне.** Если у фичи в vscode есть настройки (`registerConfiguration` в `*.contribution.ts` эталона: путь к исходникам — `node scripts/vscode-ref.mjs`, дальше grep по ключу), фича приезжает с ними в том же PR: ключи, дефолты, `scope`, `enum` и описания дословно из эталона. Ключ, который сознательно не поддерживаем, называется в теле PR. Настройку читаем на каждом обращении, а не кешируем на старте, — тогда смена в `settings.json` применяется вживую без отдельной подписки (так устроены `editor.inlineSuggest.*`). Матрицу покрытия настроек не ведём — держится этим правилом и напоминанием Stop-хука.

**Новый ключ настройки — три шага:** узел в `workbench/common/configuration/*Configuration.ts` с обязательным `scope`; запись в `EXPECTED_SCOPES` (`configurationContributions.test.ts` — ревизия скоупов таблицей, без неё тест красный); перегенерация каталога автодополнения `settings-schema.generated.ts` (`npm run build:extensions`, генератор сам форматирует prettier'ом). Снапшот настроек, который едет в субпроцесс расширений, — вложенное дерево, а не dotted-ключи.

Пути обоих файлов доступны через окружение процесса — `IEnvironmentService` (`platform/environment/common/environment.ts`, токен `IEnvironmentServiceDIToken`): `settingsResource` (валидатор settings.json) и `keybindingsResource`. Оба используют Preferences-экшены (`contrib/preferences/browser/`). `workbench.action.openSettings` (Ctrl+,) открывает settings.json в редакторе — UI-редактора настроек нет. `workbench.action.openGlobalKeybindings` (Ctrl+K Ctrl+S) с недавних пор открывает **UI-вкладку** Keyboard Shortcuts (`KeybindingsEditorPane`, редактирует и пишет keybindings.json через `KeybindingsEditorService` — детали в [workbench/KeybindingsEditor.md](workbench/KeybindingsEditor.md)); сам JSON — отдельной командой `…openGlobalKeybindingsFile` (VS Code parity). На свежем профиле JSON создаётся заготовкой. Окружение собирает `createEnvironmentService` (`platform/environment/node/`) из резолва user data в `main.ts`, биндит `environmentModule`; в тестах — `createTestEnvironment()` тестового профиля (пути в своём временном каталоге на контейнер, `null`-путей нет).

Применение к редактору: `EditorService` при создании каждого редактора (`EditorComponent`) дёргает `setIndentOptions({ tabSize, insertSpaces })` и `setCursorSurroundingLines(...)` из ключей `editor.*`. `setIndentOptions` принудительно выключает auto-detect indent.

Фикстура `test-fixtures/diode-home/` повторяет реальную раскладку (`--user-data-dir ./test-fixtures/diode-home`); профиль `compact` демонстрирует переопределение `editor.tabSize`.

## Слой воркспейса (`.diode/settings.json`)

> Каталог проекта `.diode/` общий для всех его файлов: `settings.json` и `tasks.json` ([workbench/Tasks.md](workbench/Tasks.md)) берут путь из `platform/workspace/common/workspaceConfigFolder.ts`; `.vscode/` не читается вовсе (импорт настроек VS Code — отдельной задачей).

Эталон в однопапочном окне держит в слое `workspace` файл `<папка>/.vscode/settings.json`. У нас каталог свой — **`.diode/`**: настройки Diode не читают и не перетирают файл VS Code в том же проекте (`.vscode/settings.json` игнорируется). Константы и пути — `platform/configuration/common/workspaceSettings.ts`.

- **Место в стеке** — выше профиля: defaults → user → profile → workspace, как у эталона (проект уточняет настройки человека).
- **Фильтр по `scope`** (`filterWorkspaceSettings`, `configurationValidation.ts`; аналог `scopes` у `ConfigurationModelParser` эталона): ключи `application`/`machine` — ядра и расширений, по `ConfigurationRegistry.getConfigurationScopes()` — из слоя выкидываются, в основном дереве и в секциях языков; отброшенные называются warn'ом в логе `configuration`. Ключ вне реестра идёт как есть. В редакторе на таком ключе стоит подсказка (`Hint`) с текстом эталона — `DiagnosticsService` валидирует и `.diode/settings.json` открытой папки (`workspaceUnsupportedSettingMessage`).
- **Папка** — сервис о папках окна не знает: `loadConfiguration(…, { folder, configuration? })` читает слои ДО первого кадра (тема и `editor.*` проекта видны сразу), а `main.ts` переводит `onDidChangeWorkspaceFolders` в `ConfigurationService.setWorkspace(folders, configuration?)` (Open Folder, Open Workspace from File). Форма папок — список: при мульти-руте у каждой папки будет свой слой ([TODO/MultiRoot.md](../TODO/MultiRoot.md), этап D), сейчас берётся первая. Смена посреди загрузки — побеждает последняя (поколение).
- **Live-reload** — watch на файл переезжает вместе с папкой. `ChokidarFileWatcher` отдаёт chokidar'у не сам файл, а ближайший существующий каталог на пути к нему, без рекурсии (`depth: 0`, из соседей пропускается только ожидаемый сегмент). Обычно это каталог файла. Если `.diode` ещё нет — предок, и watch перевешивается ближе к файлу, когда сегмент появится; снос каталога целиком (`rm -rf .diode`) возвращает его в ожидание. Голый chokidar на файл без каталога молча не видит ничего. На файл-корень chokidar слепнет после атомарного сохранения (временный сосед + `rename`), если за тем же путём в процессе следит второй экземпляр: `fs.watch` на путь у chokidar общий, и переподписка попадает на мёртвый inode. Открытый в редакторе `settings.json` смотрят двое — модель документа и сервис настроек, — поэтому вторая правка из UI не применялась, а сохранение после записи снаружи упиралось в Overwrite. Оба случая проверены пробой; регрессия — `chokidarFileWatcher.atomicSave.test.ts`.
- **Запись** — `updateValue(key, value, target?)`, цель `"user"` (по умолчанию), `"workspace"` или `"workspaceFolder"` (подмножество `ConfigurationTarget` эталона; у окна из папки цель-папка — тот же `.diode/settings.json`, что у воркспейса, как `getConfigurationFileResource` эталона). `value: undefined` снимает ключ. Отказы — rejected promise с текстами эталона: запись в воркспейс или папку без открытой папки (`ERROR_NO_WORKSPACE_OPENED`), ключ `application`/`machine` в воркспейс (`ERROR_INVALID_WORKSPACE_CONFIGURATION_*`) и ключ вне `FOLDER_SCOPES` в папку (`ERROR_INVALID_FOLDER_CONFIGURATION`). Записи сервиса идут очередью: read-modify-write одного файла не перекрываются, отказ одной записи очередь не рвёт.
- **Запись из расширений** — `WorkspaceConfiguration.update(key, value, target?, overrideInLanguage?)` (эталон: `extHostConfiguration` → `mainThreadConfiguration` → `ConfigurationEditing.validate`). Субпроцесс переводит цель (`parseConfigurationTarget`: `true`/Global → `user`, `false`/Workspace → `workspace`, WorkspaceFolder → `workspaceFolder`, прочее — не задана) и шлёт запрос `configuration.update` `{ key, value?, target?, resource? }` (нет `value` — снять ключ). На хосте `ConfigurationCustomer` выводит цель без явного выбора как `deriveConfigurationTarget` эталона — у окна из `.code-workspace` ключ `resource`/`language-overridable` с ресурсом уходит в папку, прочее в `workspace` — и делает проверки эталона, которых нет у сервиса: незарегистрированный ключ при записи значения (`ERROR_UNKNOWN_KEY`; снятие и `"[lang]"`-ключи — можно; реестр — ядро + расширения, `ConfigurationRegistry.getConfigurationScopes()`), цель-папка без открытой папки, без ресурса или с ресурсом вне папки (`ERROR_INVALID_FOLDER_TARGET`) и ключ вне `FOLDER_SCOPES` (`resource`/`language-overridable`/`machine-overridable`). Дальше — `IConfigurationService.updateValue` с той же целью: папка единственная, файл её настроек сервис знает сам (пустое окно и чужой скоуп отклоняет он). Отказ — rejected promise расширению без тоста (эталон пишет с `donotNotifyError`). Порядок как у эталона: сервис эмитит изменение до резолва записи, `workspace.configurationChanged` уходит по каналу раньше ответа — после `await update()` `get()` уже видит значение. **Отступление:** запись в секцию языка (`overrideInLanguage: true`, либо не задан, а у языка из scope в целевом слое своё значение — эталон тогда пишет в `"[lang]"`) отклоняется в субпроцессе. Демо — `e2e/scenarios/configurationUpdate.scenario.ts`.
- **Расширениям** слой едет третьим деревом `IConfigurationData.workspace` (`workspace.initialize`/`configurationChanged`), слой папки — четвёртым `workspaceFolder`; `WorkspaceConfigStore` кладёт их поверх user, `inspect().workspaceValue`/`workspaceFolderValue` честные.
- **Команды** — `workbench.action.openWorkspaceSettings` и `…openWorkspaceSettingsFile` (оба открывают JSON: UI настроек у нас нет), в палитре только при `workbenchState != 'empty'` (upstream-ключ, выставляет `WorkbenchContextKeys`). Файла нет — создаётся заготовкой `{}`. Автодополнение ключей — то же встроенное `diode-settings` (селектор `**/settings.json`).
- **Не делаем:** слои нескольких папок (мульти-рут), доверие к воркспейсу (`restricted`-ключи эталона), запись в секцию языка (ни из ядра, ни из расширений).

Демо — сценарий `e2e/scenarios/workspaceSettings.scenario.ts`.

### Файл воркспейса (`.code-workspace`)

Зачем при однопапочном мире: у одного каталога бывает несколько способов работы — в монорепе `web.code-workspace` и `backend.code-workspace` лежат в корне, оба смотрят на `"."` и держат разные закоммиченные настройки (exclude, форматтер, LSP). Формат эталона, разбор — `platform/workspace/common/workspaceFile.ts` (`parseWorkspaceFile`/`loadWorkspaceFile`):

```jsonc
{ "folders": [{ "path": "." }], "settings": { "files.exclude": { "backend": true } } }
```

- **Папка ровно одна.** `path` — относительно каталога файла (или абсолютный), либо file-`uri`; `name` — отображаемое имя папки. Папок больше одной — отказ «multi-root workspaces are not supported yet» (а не молча первая); папки нет на диске — отказ. Секции `extensions`/`launch`/`tasks` не читаются — задачи живут в `.diode/tasks.json` папки.
- **Как открыть.** `diode web.code-workspace` (первый позиционный с этим расширением — `resolveStartupTargets` → `workspaceFile`; файл не открыть — сообщение в stderr и код 1) и команда `workbench.action.openWorkspace` «File: Open Workspace from File...» (меню File; причина, по которой файл не открыть, — сообщением прямо в поле ввода). Обе ветки идут в `WorkbenchComponent.openWorkspaceFile` → `WorkspaceContextService.setWorkspaceFile`: `WorkbenchState` `"workspace"`, `IWorkspace.configuration` — путь файла.
- **Идентичность — от пути файла** (`computeWorkspaceId`): два файла над одной папкой и сама папка — три проекта со своими вкладками, раскладкой и `storageUri` расширений ([State.md](State.md)).
- **Слои, как у эталона** (`WorkspaceConfiguration` + `FolderConfiguration` при `WorkbenchState.WORKSPACE`): воркспейс — блок `settings` файла (`WORKSPACE_SCOPES`), поверх него папка — `.diode/settings.json` с `FOLDER_SCOPES` (`resource`/`language-overridable`/`machine-overridable`). Следствие для монорепы (решение человека, вариант эталона): общее для всех режимов кладут в `.diode/settings.json`, а различия режимов — только в файлы воркспейса, потому что по ключам папки (`files.exclude`, `search.exclude`, большинство `editor.*`) файл папки перебивает файл воркспейса. `window`-ключ из `.diode/settings.json` в таком окне не действует — warn в лог и подсказка эталона в редакторе (`folderUnsupportedSettingMessage`, «This setting cannot be applied in this workspace…»). Live-reload — оба файла; Open Folder на ту же папку возвращает `.diode/settings.json` в слой воркспейса.
- **Запись** `"workspace"` идёт в блок `settings` файла (JSONC-правка с сохранением комментариев; блока нет — заводится), `"workspaceFolder"` — в `.diode/settings.json`.
- **Команды.** `openWorkspaceSettings(File)` в таком окне открывает сам файл воркспейса; `workbench.action.openFolderSettings(File)` — `.diode/settings.json` папки, в палитре только при `workbenchState == 'workspace'`.
- **Редактор.** `.code-workspace` — язык `jsonc` (`contributes.languages` встроенного `diode-settings`, как у `configuration-editing` эталона); `DiagnosticsService` проверяет блок `settings` файла ТЕКУЩЕГО окна, `diode-settings` дополняет ключи внутри него.
- **Расширениям** — `workspace.workspaceFile` (поле `workspaceFile` семени `workspace.initialize`) и `workspace.name` вида `web (Workspace)` (`getWorkspaceLabel` эталона).
- **Не делаем:** смену набора папок из файла на ходу (правка `folders` подхватится при следующем открытии), untitled-воркспейсы, Save Workspace As, Add/Remove Folder — это мульти-рут ([TODO/MultiRoot.md](../TODO/MultiRoot.md)).

Демо — сценарий `e2e/scenarios/workspaceFile.scenario.ts`.

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

К ним примыкает `files.watcherInclude` — массив путей (как у эталона), а не карта шаблонов: каталоги-симлинки, за которыми всё-таки следить (обход по ссылкам не ходит, см. «Слежение за файлами» в `docs/ARCHITECTURE.md`). Относительный путь — от папки воркспейса, абсолютный — только внутри неё. Потребитель — `FileWatcherAdapter`: рекурсивный watcher расширения дополнительно следит за путями настройки, лежащими за ссылкой внутри его базы (`watcherIncludesUnder`).

Формат значения — карта `{ "<glob>": true }`, как у эталона: слои конфигурации
сливаются ПО КЛЮЧАМ, поэтому свой шаблон добавляется рядом с дефолтными, а
ненужный дефолт гасится значением `false`. Объектные значения настроек по точкам
не сплющиваются (`normalizeNode` в `configurationModel.ts`) — иначе ключ-glob
развалился бы в дерево.

Дефолты — набор эталона плюс наши кеши, и критерий, куда класть, один: в
`files.exclude` — только то, что не читают никогда (`__pycache__`, `.mypy_cache`,
`.pytest_cache`, `.ruff_cache`), всё прочее машинное — в `search.exclude`.
Поэтому `node_modules` в дереве Explorer'а **виден**, как у эталона: исходник
зависимости читают, а шумит он только в результатах поиска. Спрятать его
совсем — одна строка в settings.json (`"files.exclude": { "**/node_modules": true }`).

Все дефолты — в форме `**/<имя>`, то есть матчат САМ вход, а не только его
содержимое: `**/<имя>/**` каталог не матчит, и обход всё равно спускался бы
внутрь. Шаблон матчится против пути ОТНОСИТЕЛЬНО корня — так же, как его матчат
watcher (`isExcluded`) и ripgrep (`--glob !<pattern>`).

### Ignore-файлы поиска

`search.useIgnoreFiles` (дефолт `true`), `search.useParentIgnoreFiles` и
`search.useGlobalIgnoreFiles` (оба `false`) — как у эталона: поиск уважает
`.gitignore`/`.ignore` папки, по желанию — родительских каталогов и глобальный
gitignore. Действуют на оба поиска: индекс Quick Open строится `rg --files`
(`FileSearchService`), содержимое ищет `rg --json` (сервис текстового поиска), и
флаги обоим собирает один код — `rgIgnoreFilesArgs` в
`services/search/common/ripgrepArgs.ts` (`--no-ignore` / `--no-ignore-parent` /
`--no-ignore-global`, плюс всегда `--no-require-git` и `--no-config`, как у
эталона). Чтение — `readUseIgnoreFiles` в `excludeSettings.ts`.

Для Quick Open шаблоны exclude-настроек якорятся к корню (`anchorRgGlob`, как
`anchorGlob` эталона): у rg шаблон без `/` действует на любой глубине, а у нас
`out` — только `<корень>/out`. Поиск по содержимому пока передаёт шаблоны как
есть: туда же идёт поле «files to exclude», где `foo` значит «на любой глубине».

`explorer.excludeGitIgnore` эталона не заведён: дерево Explorer'а читает ФС само,
и для него нужен свой разбор `.gitignore` (у эталона —
`services/search/common/ignoreFile.ts`), а не флаг rg. Трекер —
[docs/TODO/FileTreePerformance.md](../TODO/FileTreePerformance.md).

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

Поиск по глобам `workspaceContains:` (`workspaceContainsActivation.ts`) своего
набора не держит: это тот же `rg --files`, что у индекса Quick Open, с тем же
`searchExcludeGlobs` и ignore-файлами, как `checkGlobFileExists` эталона.
Зависимости (`node_modules`) расширение не поднимают через `search.exclude`, `.git` —
через `files.exclude`; настройки читаются на каждый поиск.


## StateService — машинное состояние (отдельно от настроек)

Машинное состояние UI/сессии (`IStateService`, аналог `IStorageService`/`Memento`) — не
`settings.json` и живёт отдельно от `ConfigurationService`; устройство — [State.md](State.md).
