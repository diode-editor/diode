# State — машинное состояние UI/сессии

Часть архитектуры Vexx — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).

Персистентное машинное состояние рабочего места (аналог `IStorageService` /
`Memento` из VS Code): открытые файлы + активная вкладка, ширина/видимость
сайдбара, видимость/высота нижней панели.

## Назначение и non-goals

- **Это НЕ настройки.** `settings.json` (`IConfigurationService`,
  [Configuration.md](Configuration.md)) — человекочитаемый JSONC, который правят
  руками (комментарии, форматирование). **State** — машинный: его пишет само
  приложение, никто не редактирует руками. Поэтому это **отдельная система** от
  ConfigurationService, как `IStorageService` vs `IConfigurationService` в VS Code.
- Формат — **plain JSON** (`JSON.parse`/`JSON.stringify`), а не jsonc `modify`:
  комментарии сохранять не нужно.
- Хранилище — **JSON-файлы**, не SQLite: GOAL запрещает тяжёлые зависимости.
  Плата — cross-process last-writer-wins (см. «Ограничения»).

## Scopes и раскладка

Область видимости (`StateScope`):

- **`global`** — per active profile: `<profileDir>/globalState.json`. Fallback,
  когда воркспейс не открыт (запуск без папки).
- **`workspace`** — per-project: `<profileDir>/workspaceStorage/<sha256(folder)>/state.json`,
  ключ каталога — sha256 от абсолютного пути папки (как в VS Code). Хэш резолвит
  `resolveWorkspaceStatePath` (`Common/UserDataPaths.ts`, pure).

```
~/.vexx/user-data/User/            # profileDir (именованный профиль → profiles/<name>/)
  settings.json                    # человекочитаемые настройки (отдельно)
  globalState.json                 # global-scope
  workspaceStorage/<hash>/state.json
```

По решению проекта состояние UI/сессии — `workspace` scope. Если проект не
открыт, `workspace`-дескрипторы прозрачно обслуживает `global`-стор (fallback).

Исключение — настройки, которые описывают вкус пользователя, а не проект: у них
`global`. Сегодня такая одна — `STATUS_BAR_HIDDEN_STATE` (какие сегменты
статус-бара скрыты); в VS Code она тоже application-scope.

## Дескрипторы (свойства состояния)

Каждое сохраняемое значение объявляется дескриптором `IStateDescriptor<T>`
(`Configuration/IStateService.ts`) — это «инструкция», какие у него свойства:

| Поле | Смысл |
| --- | --- |
| `key` | Ключ в сторе, namespaced в стиле VS Code (`"workbench.sideBar.width"`). |
| `scope` | `global` \| `workspace`. |
| `default` | Значение при первом запуске / битом файле. |
| `version?` | Версия формы значения (вместе с `migrate`). |
| `migrate?` | `(raw, from) => T` — миграция старой формы к текущей. |

Типобезопасный доступ: `state.get(descriptor): T`, `state.store(descriptor, value)`.
Значения копируются на входе и выходе (`structuredClone`) — стор изолирован от
мутаций вызывающего.

**Правило co-location.** Дескриптор объявляется рядом с **сервисом**-владельцем,
а НЕ с TUIDom-элементом: элементы (напр. `WorkbenchLayoutElement`) в слое TUIDom и
не могут импортировать Configuration. Реестр дескрипторов — `Workbench/Services/StateKeys.ts`
(параллель `ContextKeys.ts`).

## Движок (`Configuration/StateService.ts`)

- **Слои:** движок key/value поверх plain-JSON файлов, зависит только от Common +
  fs. Живёт в `Configuration/` (сосед `ConfigurationService`);
  `StateServiceDIToken` объявлен в `Workbench/Services/CoreTokens.ts` (потребители-
  сервисы — в Workbench), биндинг — модуль `Workbench/Modules/StateModule.ts`.
- **Write-through + debounce + flushSync:** `store` обновляет in-memory стор
  синхронно, запись на диск — debounced (async). Durability гарантирует
  `flushSync()` на выходе процесса. Так `get` всегда видит последнее значение.
- **Unknown-key preservation:** весь распарсенный объект держится в памяти целиком;
  правятся только известные ключи, сериализуется объект целиком → ключи от
  других/будущих версий не затираются (old/new билды и частичный рефакторинг
  сосуществуют).
- **Tolerant-load:** отсутствующий файл → пустой стор; битый JSON / нечитаемый
  файл → пустой стор + лог. Bootstrap не падает.
- **Версионирование:** записанная версия ключа хранится в служебном `$versions`;
  при чтении устаревшей формы прогоняется `migrate`.

## Жизненный цикл (проводка)

```
main.ts: build container ─► process.on("exit", stateService.flushSync)
   │
   ├─ первый CLI-arg — папка? ─► WorkbenchComponent.setWorkspaceFolder(dir)
   │                              └─► WorkbenchStateService.openWorkspace(dir)  (load per-project стор)
   ├─ mount()  ─► LayoutService.restoreLayout()   (перед первым кадром; + sync истины в PanelService)
   ├─ run()
   ├─ await activate()
   ├─ есть явные файлы в CLI?
   │      ├─ да ─► открыть ТОЛЬКО их            (CLI перебивает сессию)
   │      └─ нет ─► restoreOpenEditors()        (реплей сохранённых путей + активная вкладка)
   └─ focusEditor()
```

- Проводку «состояние ↔ UI» изолируют два Workbench-сервиса (этап 11, headless):
  **`WorkbenchStateService`** (открытые файлы через `EditorService`) и
  **`LayoutService`** (layout: читает/пишет `WorkbenchLayoutElement` через
  публичные геттеры/сеттеры; сам элемент приходит от владельца view через шов
  `attachLayout`).
- **Write-through:** `WorkbenchLayoutElement.onDidChangeLayout` (плейн-колбэк, без
  DI — TUIDom чист) фаерит на drag сэша и на команды (toggle/resize);
  `LayoutService.attachLayout` подписывает его на `captureLayout()`. Открытые
  файлы — собственная подписка `WorkbenchStateService` на
  `EditorService.onActiveEditorChanged` → `captureOpenEditors()`.
- **Активная вкладка нижней панели** живёт не в layout-элементе, а в
  `PanelService`, поэтому у неё свой write-through: подписка `LayoutService` на
  `onDidChangeActiveView` → `PANEL_ACTIVE_VIEW_STATE`. На restore вкладка
  активируется программно (`setActiveView`, не `activateView`) — ленивые фичи не
  будятся, TERMINAL восстанавливается с placeholder'ом без спавна шелла.
- **restoreLayout** во время restore глушит авто-capture (re-entrancy guard).
- **restoreOpenEditors** пропускает отсутствующие на диске файлы (как VS Code) и
  переотображает индекс активной вкладки на выживших.
- **Смена папки в рантайме** (`setWorkspaceFolder`): `openWorkspace(newDir)` сначала
  синхронно флашит текущий workspace-стор, затем синхронно грузит новый.
- **Flush:** единственный якорь — `process.on("exit")` в `main.ts` (только
  синхронный I/O → `flushSync`). Любой путь выхода (`doQuit`, SIGINT в
  `NodeTerminalBackend`) идёт через `process.exit(0)` и фаерит "exit".

## Известные ограничения

- **Cross-process last-writer-wins:** два инстанса Vexx на одном воркспейсе
  затирают состояние друг друга (у каждого своя in-memory копия; сохранение
  unknown-ключей — внутрипроцессное). VS Code решает это SQLite-локом (запрещён
  GOAL).
- **SIGKILL / жёсткий креш** минует `"exit"` → несохранённое теряется; debounce
  ограничивает потерю.
- **Битый файл → сброс:** unparseable-содержимое (и его unknown-ключи) теряется
  при следующей записи.

## Тестирование

- `NULL_STATE_SERVICE` (`Configuration/NullStateService.ts`) + `stateModuleDefault`
  — no-op для тестов/demo, которым персистентность не нужна (`get` отдаёт дефолт).
- Юниты: `StateService.test.ts` (round-trip, tolerant-load, unknown-key
  preservation, workspace↔global fallback, версии),
  `Workbench/Services/WorkbenchStateService.test.ts` (открытые редакторы),
  `Workbench/Services/LayoutService.test.ts` (restore/capture layout, сайдбар/панель).
- Integration: `Workbench.StatePersistence.test.ts` — реальный `StateService`
  через `createAppTestHarness({ stateService })`, round-trip restore на двух
  «запусках».
- Демо: `e2e/scenarios/sessionLayout.scenario.ts` (видимая раскладка, которая
  персистится; сам рестарт скриншотом не покрыть — он за юнит/integration тестами).
