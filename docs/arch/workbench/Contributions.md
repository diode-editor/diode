# Workbench-contributions и Configuration-узлы

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).

## Workbench-contributions (`src/vs/workbench/common/workbenchContributionsRegistry.ts`)

Фич-проводка (подписки на события сервисов, публикация UI, регистрация
программных команд) НЕ живёт в конструкторе корневого `WorkbenchComponent` —
она вынесена в самодостаточные **contribution'ы** (аналог `IWorkbenchContribution`
в VS Code). Так корень остаётся тонким: сборка view + слоты + lifecycle, а не
перечисление фич.

**Контракт `IWorkbenchContribution`** — маркер (`extends IDisposable`, пустой):
вся работа делается в конструкторе (подписка/публикация/регистрация), `dispose()`
её сматывает. Отдельного метода активации нет — инстанцирование класса И ЕСТЬ
активация. Прообраз — `EditorStatusContribution`.

**Реестр + фазы.** `WorkbenchContributionsRegistry.instantiateByPhase(phase)`
инстанцирует по фазе через DI (`accessor.get(token)` — авто-инжект
`static dependencies` + кэш-синглтон) и забирает владение (`register`), поэтому
dispose реестра сматывает все contribution'ы. Четыре фазы с contribution'ами:
- **`blockStartup`** (≈ vscode `WorkbenchPhase.BlockStartup`) — корень прогоняет
  её сам, в конструкторе, сразу после `LayoutService.attachRoot` (хост оверлеев)
  и до `setWorkspaceFolder` бутстрапа и старта extension host'а. Здесь живут
  фич-компоненты и их сервисы: Explorer, Search, магазин, References, Quick Open,
  пары suggest/hover/parameterHints, inline completions, find, диагностики,
  Problems, Output, Source Control (команды, на которые публикует git-расширение,
  обязаны существовать до его активации), терминал, рекордер и Keyboard Doctor.
  Порядок вкладок и вьюлетов от порядка записей не зависит (`order` контейнеров),
  порядок overlay-сессий suggest/hover/parameterHints — зависит.
- `ready` и `eventually` — фазы жизненного цикла (`LifecyclePhase` из
  `services/lifecycle/common/lifecyclePhase.ts`): корень подписан на
  `LifecycleService.onDidChangePhase` и зовёт `instantiateByPhase` синхронно на
  каждый переход:
- **`ready`** — в `WorkbenchComponent.mount()`, который сам двигает фазу (view
  построена, лёгкие сервисы готовы; ≈ vscode `WorkbenchPhase.BlockRestore`; между
  конструктором и mount ни один редактор не открывается → перенос проводки из
  конструктора эквивалентен);
- **`eventually`** — после второго кадра (`workbenchStartup.ts`,
  `afterNextFrame` → `setImmediate`; из mount фаза сработала бы до кадра, т.к.
  `app.run()` красит отложенно): первый кадр — текст, второй — подсветка
  (токенизаторы придержаны до первого кадра), и фоновая работа фазы не должна
  вставать перед цветом. Фаза — для тяжёлой/отложенной работы. Здесь же
  стартует фоновый прогрев грамматик (`main.ts`, по `onDidChangePhase`).
- **`afterRestored`** (≈ vscode `WorkbenchPhase.AfterRestored`: фаза `Restored`,
  инстанцирование через `runWhenGlobalIdle`) — своего перехода нет: пачка идёт
  первой в переходе в `eventually`, раньше его contribution'ов. Фаза жизненного
  цикла `restored` наступает до кадра с текстом, и всё, что висит на ней,
  откладывало бы кадр. Здесь — то, что эталон держит на `Restored`: каналы Output,
  change-bars, статус-бары SCM и задач (OpenPerformance, рычаг 8b).

**Регистрация — явный массив** `WORKBENCH_CONTRIBUTIONS` в агрегаторе
`src/vs/workbench/workbench.common.main.ts` (зеркало `WORKBENCH_ACTIONS`, без
import-side-effect саморегистрации): пара `{ token, phase }`. Новую фичу или
проводку добавляем сюда + биндим класс в `src/vs/diode/modules/workbenchModule.ts`,
а не строкой в конструктор корня.

**Правило под наш DI** (ленив по токену, без Delayed-прокси): тяжёлые сервисы НЕ
класть в `static dependencies` — иначе они сконструируются в момент прогона фазы.
Тяжёлое резолвить лениво через `ServiceAccessor` внутри колбэков.

**Contribution vs Action.** Порция кейбиндов и команды с ленивым `run(accessor)` —
это декларативные `CommandAction` в `browser/actions/` и `contrib/<f>/browser/` (данные в реестры, сервис
резолвится при вызове), а не contribution'ы. Contribution нужен для eager-проводки
на событиях. Пограничный случай — программная команда без title (`workbench.openFile`):
не Action (тот форсит title → палитра), а contribution, регистрирующая команду.

Текущие: `EditorStatusContribution`, `TerminalEnvStatusContribution` (сегменты
статус-бара), `AutoRevealContribution` (`explorer.autoReveal`),
`ThemeConfigContribution` (live-reload `workbench.colorTheme`),
`OpenFileCommandContribution` (команда `workbench.openFile`),
`PanelFocusContribution` (возврат фокуса в редактор, когда содержимое нижней панели
уходит со сцены), `HistoryService` (история навигации — сервис, он же contribution:
владение подписками отдаёт реестр). Все — `ready`.

## Configuration-узлы (`src/vs/workbench/common/configuration/`)

Схемы настроек фич — узлы `IConfigurationNode` для `ConfigurationRegistry`
(механизм — слой Configuration, см. [Configuration.md](../Configuration.md)):
по файлу на секцию (`workbenchConfiguration.ts`, `editorConfiguration.ts`,
`filesConfiguration.ts`, узлы фич — `explorer`, `terminal`, `search`, `scm`, `tasks`,
`extensions`; их переезд в `contrib/<f>/common/` — в
[таблице долга](../../TODO/VscodeStructureFollowUps.md#где-канон-состав-фичи-ещё-не-выполнен))
плюс явный массив `CONFIGURATION_CONTRIBUTIONS` (`configurationContributions.ts`).
Узлы — чистые данные (их бандлит генератор схемы автодополнения); новая
настройка = свойство в узле своей секции. Реестр собирает `main.ts` (defaults-слой
`ConfigurationService`) и биндит `configurationModule`
(`ConfigurationRegistryDIToken` — известные ключи валидации settings.json в
`DiagnosticsService`).
