# Configuration/

Часть архитектуры Diode — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).

Сервис пользовательских настроек (урезанный аналог `IConfigurationService` из VS Code). Источники слоями: дефолты из `ConfigurationRegistry` → `User/settings.json` (default-профиль) → `profiles/<name>/settings.json`. Формат — JSONC; битый файл логируется и заменяется пустой моделью — bootstrap не падает.

Раскладка user data (VS Code-совместимая):
```
<root>/                          # default ~/.diode ; CLI --user-data-dir <path>
  extensions/                    # внешние расширения
  user-data/User/
    settings.json                # default-профиль
    keybindings.json
    profiles/<name>/{settings,keybindings}.json
```

- **`resolveUserDataPaths(...)`** (`Common/UserDataPaths.ts`) — чистая функция, возвращает все пути; имя профиля валидируется `/^[A-Za-z0-9._-]+$/`.
- **`parseCliArgs(argv)`** (`Common/CliArgs.ts`) — флаги `--user-data-dir`, `--profile`, `--inspect-tui`, `--headless[=CxR]` (требует `--inspect-tui`), `-h`/`-v`, разделитель `--`, неизвестные → `CliArgsError`.
- **`ConfigurationModel`** — иммутабельная: нормализует dotted-keys (`"editor.tabSize"` → вложенный объект), deep-merge слоёв, `get`/`getValue`.
- **`ConfigurationRegistry`** (`Configuration/ConfigurationRegistry.ts`) — contribution point схем настроек (аналог `IConfigurationRegistry` vscode, `vs/platform/configuration/common/configurationRegistry.ts`): фичи описывают настройки узлами `IConfigurationNode` (`{ id, title, properties }`, ключи в `properties` — полные dotted; схема ключа — `{ type, default, description?, enum? }`), реестр агрегирует их по ключу, дубль ключа — ошибка. Узлы приложения — явный массив `CONFIGURATION_CONTRIBUTIONS` (`Workbench/Configuration/configurationContributions.ts`, по файлу-узлу на секцию: workbench/editor/explorer/files/terminal; чистые данные — их бандлит и генератор схемы автодополнения `scripts/generate-settings-schema.mjs`). Из реестра деривируются: defaults-слой `ConfigurationService` (`getDefaultConfiguration()` — вложенное дерево), известные ключи валидации settings.json (`DiagnosticsService` → `collectKnownSettingKeys`) и каталог автодополнения diode-settings. Собирается на bootstrap в `main.ts`, в DI — `ConfigurationRegistryDIToken` (`configurationModule`).
- **`ConfigurationService`** — async `loadConfiguration(paths, logger?, fileWatcher?, registry?)`; `registry` — источник defaults-слоя (production передаёт реестр из `CONFIGURATION_CONTRIBUTIONS`; без него слой пуст — юнит-тесты). **Live-reload:** если передан `IFileWatcher` (из Common), сервис следит за `User/settings.json` (и файлом именованного профиля), на изменение перечитывает слой через `reload()`, пересобирает merged и эмитит `onDidChangeConfiguration` с диффом затронутых ключей (`diffConfigurationKeys` через `ConfigurationModel.collectKeys()`). `affectsConfiguration(q)` матчит точное совпадение, предка и потомка ключа. **`updateUserValue(key, value)`** — запись в settings.json активного профиля через `jsonc-parser` (сохраняет комментарии/форматирование) + синхронный апдейт in-memory слоя и то же событие изменения; первый потребитель — theme picker. Пустой дифф события не порождает (повторный reload после собственной записи молчит). Заглушка `NULL_CONFIGURATION_SERVICE` метод не реализует (вызов через optional chaining), `onDidChangeConfiguration` у неё остаётся no-op. Потребители live-apply: `EditorService` (перепримeняет `editor.*` к открытым редакторам), `WorkbenchComponent` (перекрашивает по `workbench.colorTheme`); `explorer.*` читаются on-demand.

Пути обоих файлов прокинуты в DI (слой Workbench): `settingsFile` → `SettingsResourceDIToken` (валидатор settings.json), `keybindingsFile` → `KeybindingsResourceDIToken`. Оба используют Preferences-экшены (`Workbench/Actions/`) для команд `workbench.action.openSettings` (Ctrl+,) и `workbench.action.openGlobalKeybindings` (Ctrl+K Ctrl+S), которые просто открывают соответствующий JSON-файл в редакторе (UI-редактора настроек нет); на свежем профиле файл создаётся заготовкой. Бинд обоих токенов — в `markersModule`, значения — из `main.ts`.

Применение к редактору: `EditorService` при создании каждого редактора (`EditorComponent`) дёргает `setIndentOptions({ tabSize, insertSpaces })` и `setCursorSurroundingLines(...)` из ключей `editor.*`. `setIndentOptions` принудительно выключает auto-detect indent.

Фикстура `test-fixtures/diode-home/` повторяет реальную раскладку (`--user-data-dir ./test-fixtures/diode-home`); профиль `compact` демонстрирует переопределение `editor.tabSize`.

## StateService — машинное состояние (отдельно от настроек)
Рядом с `ConfigurationService` живёт **`StateService`** (`Configuration/StateService.ts`) — аналог `IStorageService`/`Memento`: персистентное **машинное** состояние UI/сессии (открытые файлы + активная вкладка, ширина/видимость сайдбара, видимость/высота нижней панели). Это **не** `settings.json`: формат — plain JSON (никто не редактирует руками), scope `global` (`<profileDir>/globalState.json`) / `workspace` (`<profileDir>/workspaceStorage/<sha256(folder)>/state.json`). Движок: write-through + debounced-запись + `flushSync` на `process.on("exit")`, tolerant-load, сохранение unknown-ключей. DI-токен — `Workbench/Services/CoreTokens.ts`, биндинг-модуль — `Workbench/Modules/StateModule.ts`; дескрипторы — `Workbench/Services/StateKeys.ts`; потребители — `WorkbenchStateService` (открытые редакторы) и `LayoutService` (layout). Полное описание → [State.md](State.md).
