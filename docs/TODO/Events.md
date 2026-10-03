# Единый примитив событий (`Emitter` / `Event`) — исследование

Статус: **сделано** (план — раздел 7). Ядро `base/common/event.ts`, провод
`onUnexpectedError` и vitest `setupFiles`, пилот — #420; `platform` — #430;
`editor/common` — #431; `TextFileModel` — #434; остальные `workbench/services`
и слот `FileSearchService.onIndexChanged` — #435; `ExtensionHost` — #436;
`browser/parts` + `EditorElement` — #439; `contrib` — #440; `api` — #441;
`EditorService`/`EditorGroupModel` и слоты `onOpenFailed`/`onEditorCreate`/
`TextFileModel.onDidSave` — #442; lint-предохранитель — завершающий PR.

Отклонения от плана:
- **`Event.debounce` и его потребители не сделаны.** Все кандидаты из §3.6
  (`diffSnapshotRefreshContribution`, `quickDiffService`, `diffEditorPane2`,
  `fileSearchService.notify`, `chokidarTreeWatcher`) — это отложенный вызов
  метода, а не преобразование события, и ровно они — пилоты задачи
  async-примитивов (C10; `RunOnceScheduler` уже в `base/common/async.ts`).
  Мигрировать одни таймеры двумя способами не стали — остаются ей.
- **`LifecycleService` не переведён:** синхронный шаг выхода рассылается в
  обратном порядке подписки (LIFO), `Emitter` порядок не переворачивает —
  исключение lint-правила.
- `vscode.EventEmitter` для расширений (`vscodeTypes.ts`) и события
  `windowNamespace.ts` — отдельный контракт (`thisArgs`/`disposables`),
  не трогали (план помечал их «опционально»).
- Открытые вопросы раздела 10 человек не решал: ошибка слушателя в проде
  уходит только в лог (без тоста); lint-предохранитель — в конце, сразу `error`.

Документ отвечает на вопрос «чем заменить рукописные списки слушателей в
`src/vs`, сколько это стоит и в каком порядке делать».

База исследования — `19df1033` (main на 03.10.2026). Эталон — `/workspaces/vscode`
(`src/vs/base/common/event.ts`, 1991 строка).

Соседние исследования той же группы: [Lifecycle](Lifecycle.md) (`Disposable` и
владение ресурсами), [FileService](FileService.md) (файловый сервис). Стыки с
ними помечены по тексту; их темы здесь не раскрываются.

---

## 1. Короткий ответ

- **Свой узкий `Emitter<T>` по парному пути `vs/base/common/event.ts`, а не
  дословный перенос.** Дословный `event.ts` тянет 68 файлов / ~21,5 тыс. строк
  (32 файла без `observableInternal`), приносит второй `Disposable` и
  `console.warn` из монитора утечек прямо в терминал TUI. Нам из него нужно
  ~150 строк. Имена и форма API — upstream-овские, механизм — наш (это уже
  узаконенное правило: «пути повторяем, механизм — нет»).
- **Заменяем 76 коллекций слушателей в 42 файлах**; потребители почти не
  меняются: `service.onDidX(listener)` остаётся тем же вызовом, потому что
  `Event<T>` — это функция с ровно такой сигнатурой.
- **Главная ценность — не строки, а три гарантии, которых сегодня нет:**
  изоляция ошибок слушателя (сейчас есть в 1 месте из 76), единая семантика
  отписки во время обхода (сейчас 10 мест ходят по живой коллекции), снятие
  слушателей при `dispose` (сейчас 6 из 76). Первая закрывает архитектурную
  дыру #275 из [TESTING.md](../TESTING.md) — источник `RuntimeError` в
  мутационном гейте.
- **Одиночные слоты (`public onX?:`) в основном остаются:** из 55 событием
  становятся 3, один сливается с уже существующим событием, остальное —
  законная связь «элемент → владелец» либо колбэк в опциях.
- **Комбинаторы — по требованию.** В первом заходе только `Event.None` и
  `Event.once`. `Event.debounce` закрывает 4–5 из 25 таймеров и идёт отдельным
  малым PR; остальные таймеры — это `Delayer`/`RunOnceScheduler`/`timeout`, то
  есть **отдельная задача про async-примитивы**, в эту тему не входит.
- **От `Lifecycle` не зависим.** `Emitter` нужен только тип `IDisposable`
  (type-only импорт). Движок `@tuidom/*` трогать не требуется.
- **Порядок величины: 5 PR** — ядро с пилотом, потом три слоя, потом хвост
  (debounce, lint-предохранитель). Кодмод не окупается.

Рекомендация: **брать.** Ядро (PR 1) полезно само по себе, даже если массовая
миграция растянется.

---

## 2. Как сделано в vscode

`vs/base/common/event.ts` — три вещи в одном файле:

| Часть | Строки | Что это |
|---|---|---|
| `Event<T>` + `namespace Event` | 46–900 | тип-функция `(listener, thisArgs?, disposables?) => IDisposable` и ~25 комбинаторов: `None`, `once`, `map`, `filter`, `signal`, `any`, `reduce`, `debounce`, `accumulate`, `throttle`, `latch`, `split`, `buffer`, `chain`, `fromNodeEventEmitter`, `toPromise`, `forward`, `runAndSubscribe`, `fromObservable`… |
| `Emitter<T>` | 901–1435 | сам эмиттер + `EmitterOptions`, `LeakageMonitor`, `EventProfiling`, `ListenerLeakError`/`ListenerRefusalError`, очередь доставки |
| Производные | 1437–1991 | `AsyncEmitter` (`waitUntil`), `PauseableEmitter`, `DebounceEmitter`, `MicrotaskEmitter`, `EventMultiplexer`, `EventBufferer`, `Relay`, `ValueWithChangeEvent` |

Конвенция объявления: приватный `_onDidX = new Emitter<T>()`, публичное
`readonly onDidX: Event<T> = this._onDidX.event`. Событие — **поле-функция**, а
не метод.

Семантика `Emitter`, на которую стоит равняться:

| # | Гарантия эталона | Где в коде |
|---|---|---|
| G1 | Слушатель, добавленный во время `fire`, в этом `fire` не зовётся (граница — длина списка на момент входа) | `dq.enqueue(this, event, this._listeners.length)` :1425 |
| G2 | Слушатель, снятый во время `fire` и ещё не достигнутый, **не зовётся** — слот зануляется сразу, обход пропускает пустые | `_removeListener` :1360, `_deliver` :1380 |
| G3 | Ошибка слушателя ловится и уходит в `onListenerError ?? onUnexpectedError`; остальные слушатели событие получают | `_deliver` :1384–1394 |
| G4 | Вложенный `fire` того же эмиттера сначала доводит до конца текущую доставку, потом начинает новую (порядок событий у всех слушателей одинаковый) | `fire` :1412, `EventDeliveryQueue` |
| G5 | `dispose()` сбрасывает слушателей; подписка на мёртвый эмиттер возвращает `Disposable.None` | :1226, :1281 |
| G6 | Хуки первого/последнего слушателя (`onWillAddFirstListener`, `onDidRemoveLastListener`) — на них построены ленивые комбинаторы | `EmitterOptions` :901 |
| G7 | Монитор утечек: порог числа слушателей, сбор стеков подписки, `console.warn`, за квадратом порога — отказ принимать подписку. Выключен по умолчанию (`_globalLeakWarningThreshold = -1`), включается приложением | :985–1123, :1265 |
| G8 | Оптимизация «один слушатель без массива», разрежённый массив с компакцией | :1198, :1363 |

Зависимости файла (прямые импорты): `async` (и обратно — `async.ts`
импортирует `Emitter`, цикл), `cancellation`, `collections`, `errors`,
`functional`, `lifecycle`, `linkedList`, `observable`, `process`, `stopwatch`,
`symbols`. Транзитивное замыкание по value-импортам, посчитанное скриптом по
дереву на диске: **68 файлов, 21 521 строка** (из них 36 — `observable` и
`observableInternal/*`; без них 32 файла). `async.ts` даёт то же самое
замыкание — они взаимно рекурсивны. Оценка «~30 файлов» из
[ARCHITECTURE.md](../ARCHITECTURE.md#дословный-перенос-upstream-editorcommondiff)
верна для варианта без observable.

---

## 3. Инвентаризация: что у нас сейчас

Счётчики сняты скриптом по `src/vs` (590 не-тестовых `.ts`, без `*.test.ts`,
`test/`, `*.d.ts`) и перепроверены чтением спорных мест. Цифры поверхностного
аудита, с которого началось исследование, разошлись — расхождения сведены в
разделе 3.6.

### 3.1. Примитива нет

Класса `Emitter` в `src/vs` нет. Единственный эмиттер —
`EventEmitter<T>` в `workbench/api/common/vscodeTypes.ts:645`: это реализация
`vscode.EventEmitter` для расширений (снапшот + `try/catch` с молчаливым
проглатыванием). Плюс `CancellationTokenSource`
(`base/common/cancellation.ts:37`) — одноразовое событие с повтором для
опоздавшего подписчика.

### 3.2. Коллекции слушателей

Полей вида `…Listeners: (…)[]` / `Set<…>` — **84 в 47 файлах**. Из них
событиями в нашем смысле являются **76 в 42 файлах**:

| Слой | Коллекций | Файлов | Крупнейшие |
|---|---|---|---|
| `workbench/services` | 31 | 11 | `textFileModel.ts` — 7, `editorService.ts` — 7, `extensionHost.ts` — 6, `editorGroupModel.ts` — 3, `outputService.ts` — 2 |
| `workbench/contrib` | 13 | 9 | `terminalService.ts` — 4, `embeddedTerminalSession.ts` — 2, scm (`changesService`, `graphService`, `repoStateService`) — по 1 |
| `platform` | 11 | 10 | `fileSystemProviderRegistry.ts` — 2, остальные по 1 (config, contextkey, log, markers, progress, workspace, menu×2, clipboard) |
| `workbench/browser/parts` | 8 | 4 | `panelService.ts` — 4, `editorComponent.ts` — 2, `textEditorPane.ts`, `viewsService.ts` |
| `workbench/api` | 7 | 5 | `fileSystemNamespace.ts` — 2, `subprocessTextDocumentContentProviders.ts` — 2, каналы (`ipcMessageChannel`, `inProcessChannelPair`), `editorLayoutServiceAdapter` |
| `editor/common` | 6 | 3 | `textDocument.ts` — 3, `editorViewState.ts` — 2, `tokenizationRegistry.ts` |
| **Итого** | **76** | **42** | |

Не события (остальные 8 из 84):

- `rpcEndpoint.ts:87–88` — `requestHandlers`/`notificationHandlers`: реестр
  обработчиков по имени метода, а не список слушателей;
- `sharedTreeWatcher.ts:17` — `subscribers`: записи подписчиков с путями и
  счётчиком ссылок;
- `cancellation.ts:37` и `vscodeTypes.ts:646` — см. 3.1 (свои контракты);
- `statusBarComponent.testUtils.ts` — 3 набора в тестовом дублёре (переедут
  заодно со своим интерфейсом).

По форме: 39 массивов, 37 `Set`. Точек отписки
(`indexOf(listener)`+`splice` / `.delete(listener)`) — **77 в 46 файлах**,
на каждое событие ~8 строк одинаковой обвязки (подписка + замыкание
отписки + цикл рассылки).

### 3.3. Семантика — разная, и это главная находка

| Свойство | Сколько из 76 | Примеры |
|---|---|---|
| Обход по копии (`[...x]` / `.slice()`) | 66 | `ContextKeyService`, `PanelService`, `TextFileModel`, `ExtensionHost` |
| Обход **живой** коллекции | 10 | `MarkerService:90`, `InMemoryFileClipboard:35`, `ThemeService:19`, `LogService:83`, `TextDocument.fireChange:285` и `setLanguage:56`, `EditorService.fireEditorsChanged:1668` и `fireActiveEditorChanged:1682`, `EmbeddedTerminalSession:148,288` |
| Изоляция ошибок слушателя (`try/catch`) | 1 | только `LogService:83–89` (молча глотает) |
| Слушатели сбрасываются в `dispose` | 6 | `ContextKeyService`, `ProgressService`, оба канала сообщений, `ExtensionsWorkbenchService`, `TerminalEnvironmentService` |

Внутри одного класса бывает и то и другое: `TextDocument.setEol` (:96)
копирует, а `fireChange` (:285) и `setLanguage` (:56) — нет;
в `EditorService` пять событий копируют, два — нет.

Обход по копии и обход живого массива расходятся с эталоном в разные стороны:

- по копии — снятый во время рассылки слушатель **всё равно будет вызван**
  (нарушение G2: вызов после `dispose`);
- по живому массиву — `splice` из-под итератора сдвигает индексы, и следующий
  за снятым слушатель **пропускается**; у `Set` добавленный во время обхода
  слушатель будет вызван в том же обходе (нарушение G1).

Особые механики, которые миграция обязана сохранить:

| Место | Механика | Как ложится на `Emitter` |
|---|---|---|
| `ContextKeyService:168–185` | коалесинг в микротаске со слиянием наборов ключей | остаётся в сервисе (`pending` + `queueMicrotask`), эмиттер только рассылает. Аналог эталона — `MicrotaskEmitter` со `merge`, не берём |
| `ThemeService.onThemeChange:29` | слушатель сразу зовётся с текущей темой | метод-обёртка над эмиттером (аналог `Event.runAndSubscribe`) |
| `EditorService.onDidChangeActiveEditorSelection:356` | проводка к активному редактору подцепляется при первом подписчике | опция `onWillAddFirstListener` (G6) |
| `ViewsService.onDidChangeViewExpanded:328` | единственное событие с **двумя** аргументами | полезная нагрузка-объект `{ viewId, expanded }` — единственное место, где правятся и подписчики |
| `LogService:83` | ошибки слушателя глотаются молча | `onListenerError: noop` — иначе рекурсия «ошибка → лог → слушатель лога» |
| `PanelService:152–158` | свои приватные `subscribe`/`fire` поверх `Set` | хелперы удаляются |
| Адаптеры `api/browser` | повторный коалесинг в микротаске поверх чужого события | не трогаем, это потребители |

### 3.4. Одиночные слоты

Полей/параметров вида `onX?: (…) => void` / `onX: (…) | null` — **55 в 27
файлах**. Классификация:

| Класс | Сколько | Где | Решение |
|---|---|---|---|
| Элемент/виджет → владелец (1:1, владелец создал ребёнка и тут же подцепился) | 39 | `findComponent` — 8, `quickPickElement` — 6, `paneHeaderElement` — 4, `paneViewElement` — 3, `confirmSaveDialog` — 3, диалоги, тосты, `filteredListControl`, `scmInputComponent`… | **остаются слотами.** Это та же идиома, что у виджетов `@tuidom/elements` (`InputElement.onChange`); второго подписчика не бывает по построению |
| Колбэк в опциях/параметрах функции | 7 | `onProblem` (реестр расширений, 3), `onError` (хранилища расширений, 2), `onDidChangeActive` (опции quick pick, 2) | остаются: это аргументы, а не состояние объекта |
| Контракт data-provider'а движка | 3 | `FileTreeDataProvider.onChange`/`onWatchError`, `ProblemsTreeDataProvider.onChange` | остаются: `onChange?` — поле `ITreeDataProvider` из `@tuidom/elements`; менять контракт движка ради единообразия не будем |
| Слот на сервисе/модели | 6 | см. ниже | разбор поштучно |

Шесть слотов на сервисах — единственные, где одиночность опасна (сервис
доступен всем через DI, второй подписчик молча затирает первого):

| Слот | Что это на самом деле | Решение |
|---|---|---|
| `EditorService.onOpenFailed` (:243) | событие; подписчик — `openFailureNotificationContribution.ts:32–43` (ставит и в `dispose` обнуляет) | → событие `onDidFailOpen` |
| `FileSearchService.onIndexChanged` (:66) | событие; `filesQuickAccessProvider.ts:53,61` ставит и обнуляет на открытии/закрытии пикера | → событие |
| `EditorService.onEditorCreate` (:189) | событие без подписчиков | → событие либо удалить (см. раздел 9) |
| ~~`TextFileModel.onDidSave`~~ | снят в E3: `EditorService.wireModel` подписан на `onDidSaveDocument` (первым — порядок прежний) | — |
| ~~`EditorService.onRequestConfirmClose`~~ | снят в E8: закрытие с подтверждением — метод `EditorService.closeEditor` | — |
| `UndoManager.onDidPush` (:63) | ребёнок → владелец (`TextFileModel` создаёт `UndoManager`) | остаётся слотом |

### 3.5. Что не событие вовсе: вето, участники, провайдеры

Отдельный класс — «слушатель», результат которого нужен вызывающему. Это не
`Event`, и на `Emitter` их переводить не надо:

- **save-участники** — `SaveParticipant = (snapshot) => Promise<ISaveEdit[]>`
  (`services/textfile/common/iSaveParticipant.ts`), с таймаутом и
  последовательным применением правок. В эталоне это `AsyncEmitter` +
  `waitUntil`; у нас уже явный контракт участника — он честнее;
- **shutdown-участники** — `IShutdownParticipant`
  (`services/lifecycle/browser/lifecycleService.ts:32`), вето на выход;
- **источники языковых фич** — `EditorService.hoverSource`,
  `signatureHelpSource` и соседи: это провайдеры (см.
  [VscodeStructureFollowUps](VscodeStructureFollowUps.md), пункт про реестр
  провайдеров);
- **порты** — `subprocessTreeWatcher.ts:33–41` (`onMessage`/`onExit`/`onError`
  без возврата `IDisposable`): абстракция над `ChildProcess`, подписка живёт
  столько же, сколько процесс.

Вывод: `AsyncEmitter`/`IWaitUntil` нам не нужны.

### 3.6. Таймеры и микротаски

Хранимых таймеров (`ReturnType<typeof setTimeout|setInterval>`) — **25 в 19
файлах**; вызовов `setTimeout` — 33; `queueMicrotask` — 13.

| Вид | Сколько | Где | Примитив эталона |
|---|---|---|---|
| Хвостовой debounce (перевзвод на каждый вызов) | 9 | `searchComponent.debounceTimer`, `quickDiffService`, `diffSnapshotRefreshContribution`, `diffEditorPane2.recomputeTimer`, `chokidarFileWatcher`, `fileTreeDataProvider` (карта по каталогу), `parameterHintsService`, `completionService.autoSuggestTimer`, `inlineCompletionsService` | `Delayer` / `Event.debounce` |
| «Взвести один раз» (throttle: если взведён — выйти) | 6 | `searchComponent.resultKeysTimer`/`treeRebuildTimer`, `stateService.writeTimer`, `fileSearchService.notifyTimer`, `chokidarTreeWatcher` (с накоплением), `quickOpenService.searchTimer` | `RunOnceScheduler` / `Event.accumulate` |
| Таймаут-гонка | 2 хранимых + 5 локальных | `wireTypes.ts:136`, `httpRegistrySource`; локальные — save-участник, `workspaceNamespace`, `extensionHost` ×2, `completionService:649` | `timeout()` / `raceTimeout` |
| UI-таймер одного выстрела / интервал | 8 | `progressService` (delay, minVisible, ticker), `progressStatusBarAdapter`, `notificationService` ×2, `keybindingDispatcher` ×2 | `disposableTimeout` / `IntervalTimer` |

`Event.debounce` применим только там, где и вход, и выход — события:
`diffSnapshotRefreshContribution` (накопление URI — ровно `merge`),
`quickDiffService` (контент → пересчёт), `diffEditorPane2` (контент →
раскладка), `fileSearchService.notify` (на стороне продюсера),
`chokidarTreeWatcher` (накопление). То есть **4–5 из 25**. Остальные 20 —
отложенный вызов метода, а не преобразование события; им нужен `async.ts`.

Из 13 `queueMicrotask` коалесингом уведомлений являются 6
(`contextKeyService:171`, `editorLayoutServiceAdapter:182`,
`editorOptionsServiceAdapter:111`, `editorComponent:646`, `diffEditorPane2:163`,
`extensionHost:1172`) — тот же класс задач («взвести один раз, на микротаск»).

**Решение: таймеры — отдельной задачей** («async-примитивы:
`RunOnceScheduler`, `Delayer`, `timeout`»), со своим исследованием. Причины:
примитив другой, файлы другие, а `async.ts` эталона взаимно рекурсивен с
`event.ts` — после появления `Emitter` его узкий шим писать проще.

### 3.7. `addEventListener` — не наша тема

`addEventListener` — 44 вызова в 16 файлах (`workbench` — 35, `editor` — 9),
`removeEventListener` — 0. Это DOM-подобные события элементов `@tuidom/core`
(`TUIElement.addEventListener`, всплытие/capture), а не наш `Emitter`:
подписка живёт столько же, сколько элемент, и снимается вместе с ним.
Смешивать их с `Emitter` не надо; вопрос «кто снимает слушателя с
долгоживущего элемента» — к [Lifecycle](Lifecycle.md).

### 3.8. Расхождения с цифрами поверхностного аудита

| Что | Было в аудите | По факту |
|---|---|---|
| Поля-коллекции слушателей | ~81 | 84 по шаблону, из них 76 событий |
| Методы `on*(listener…)` | ~62 | 137 объявлений в 68 файлах (с интерфейсами и делегирующими обёртками); собственных точек отписки — 77 |
| Одиночные слоты | ~35 в `parts/*` + сервисы | 55 всего (32 в `parts`, 12 в `contrib`, 7 в `services`, 4 прочих) |
| `TokenizationRegistry.onDidChange` | одиночный слот | обычное многоподписочное событие (:30, :95) |
| Изоляция ошибок | «нигде» | есть в `LogService` и в API-`EventEmitter` |
| Самодельные таймеры | 23 | 25 хранимых, 33 вызова `setTimeout` |
| `addEventListener` | 26 в workbench | 35 в workbench, 44 в `src/vs` |
| Замыкание upstream `event.ts` | «~30 файлов» | 32 без observable, 68 с ним |

---

## 4. Варианты

| | A. Дословный перенос `event.ts` | **B. Узкий свой `Emitter`** | C. Общий хелпер без класса |
|---|---|---|---|
| Что это | `event.ts` копией под `import-vscode-*.mjs` + шимы 11 прямых зависимостей | `base/common/event.ts` ~150 строк, наш код, имена эталона | функции `subscribe(set, l)` / `fireAll(set, e)` |
| Объём нового кода | 1991 строка копии + шимы `lifecycle` (`DisposableStore`, `DisposableMap`, `combinedDisposable`, `toDisposable`, `Disposable.None`), `linkedList`, `functional`, `stopwatch`, `symbols`, `collections`, типы `async`/`observable` | ~150 строк + ~300 строк тестов | ~40 строк |
| Гарантии G1–G5 | все, дословно | G1, G2, G3, G5, G6; G4 — нет (см. раздел 5) | G3, частично G1 |
| Комбинаторы | все 25 бесплатно | пишем по требованию | нет |
| Покрытие/мутации | копия исключена из храповика (как diff-движок) — ядро событий оказывается **вне гейтов** | под обоими гейтами, 100% | под гейтами |
| Побочные эффекты | `console.warn`/`console.log` из монитора утечек и `_removeListener` пишут в stdout TUI; `EventProfiling` и `LeakageMonitor` едут в бандл (парс бандла — отслеживаемая метрика, см. [OpenPerformance](OpenPerformance.md)) | нет | нет |
| Стык с `Disposable` | второй мир `Disposable`/`DisposableStore` рядом с `@tuidom/core/common/disposable` — решение за [Lifecycle](Lifecycle.md) принимается де-факто | только тип `IDisposable` | только тип |
| Стиль | табы, `_private`, `any` — зона, закрытая для линта | наш | наш |
| Используем из принесённого | ~10% | 100% | — |
| Убирает идиому «поле + метод + цикл» | да | да | нет — три места на событие остаются |

**A отклонён.** Аргумент «дословный перенос упрощён парностью путей» работает
для чистых алгоритмов (дифф); `event.ts` — узел графа `base/common`, и вместе с
ним приезжает либо весь граф, либо шимов больше, чем полезного кода. От этого
же отказались при переносе diff-движка.

**C отклонён.** Чинит изоляцию ошибок, но не убирает ни дублирование, ни
разнобой: сигнатуры и владение коллекцией остаются рукописными.

**Рекомендация — B**, со статусом шима: шапка
`//@diode:shim microsoft/vscode@<пин> src/vs/base/common/event.ts`, как у
`errors.ts`/`arrays.ts`. Имена совпадают с эталоном, чтобы будущий перенос
upstream-кода, импортирующего `Emitter`/`Event`, не требовал правки импортов.

---

## 5. Выбранный дизайн

### Поверхность

```ts
// src/vs/base/common/event.ts
export type Event<T> = (listener: (e: T) => unknown) => IDisposable;

export interface IEmitterOptions {
    onWillAddFirstListener?: () => void;
    onDidRemoveLastListener?: () => void;
    onListenerError?: (e: unknown) => void; // по умолчанию onUnexpectedError
}

export class Emitter<T> {
    constructor(options?: IEmitterOptions);
    readonly event: Event<T>;
    fire(event: T): void;
    hasListeners(): boolean;
    dispose(): void;
}

export const Event: { None: Event<never>; once<T>(event: Event<T>): Event<T> };
```

Объявление события в классе (подчёркивания у нас запрещены — суффикс
`Emitter`):

```ts
private readonly onDidChangeMarkersEmitter = new Emitter<readonly string[]>();
public readonly onDidChangeMarkers = this.onDidChangeMarkersEmitter.event;
```

Интерфейсы сервисов можно не трогать: поле-функция удовлетворяет объявлению
метода `onDidX(listener: …): IDisposable`, а тестовые дублёры с методом
удовлетворяют интерфейсу с полем `Event<T>`. Вызовы у потребителей не меняются
(исключение — двухаргументное событие `ViewsService`, см. 3.3).

### Обязательные гарантии

| Гарантия | Решение | Почему |
|---|---|---|
| **Снапшот при обходе (G1)** | copy-on-write: массив слушателей неизменяем, подписка/отписка создаёт новый; `fire` идёт по захваченной ссылке без копирования | `TextDocument.fireChange` — горячий путь (каждая правка); копировать массив на каждый `fire`, как сейчас делают 66 мест, там нельзя, а подписки редки |
| **Отписка внутри обработчика (G2)** | у контейнера слушателя флаг «снят»; `fire` снятых пропускает | вызов после `dispose` — худший из двух вариантов расхождения; сегодня так ведут себя все 66 «копирующих» мест |
| **Изоляция ошибок (G3)** | `try/catch` на каждого слушателя → `onListenerError ?? onUnexpectedError` | закрывает #275: один кинувший слушатель не лишает события остальных и не уносит исключение мимо стека |
| **`dispose` (G5)** | сбрасывает слушателей, дальнейшие `fire` — no-op, подписка возвращает пустой `IDisposable` | сейчас так делают 6 из 76 |
| **Хуки первого/последнего (G6)** | две опции | нужны `EditorService.onDidChangeActiveEditorSelection` уже сейчас и любому ленивому комбинатору потом |

### Осознанные отклонения от эталона

- **G4 (очередь доставки) не берём.** Вложенный `fire` у нас доставляется
  вглубь, как и сегодня во всех 76 местах; глобальный порядок событий между
  слушателями эталона не гарантируем. Берём, только если появится реальный
  баг порядка.
- **G7 (монитор утечек) не берём в v1.** Сбор стека на каждую подписку —
  цена на горячем пути, `console.warn` в TUI недопустим. Дешёвая замена, если
  понадобится: порог числа слушателей → разовый `onUnexpectedError` без
  стеков (~10 строк). Системно утечки подписок — тема
  [Lifecycle](Lifecycle.md) (трекер неосвобождённых `IDisposable` в тестах).
- **G8 (оптимизация одного слушателя) не берём** — copy-on-write проще и на
  наших масштабах (единицы слушателей) не медленнее.
- **`thisArgs` и `disposables[]` в сигнатуре `Event` не берём.** Внутри проекта
  ими никто не пользуется; они нужны только `vscode.EventEmitter`, а он —
  отдельный класс в `vscodeTypes.ts` и остаётся таким (может быть переписан
  обёрткой над `Emitter`, см. PR 5).

### Куда уходят ошибки слушателей

`onUnexpectedError` уже есть в шиме `base/common/errors.ts`, по умолчанию
пишет в `console.error`. Вместе с `Emitter` нужно два провода:

1. **Прод:** `main.ts` и `extensionHostSubprocess.ts` ставят
   `setUnexpectedErrorHandler` на свой логгер — рядом с уже существующим
   `process.on("unhandledRejection")` (`main.ts:198`). `LogService` при этом
   создаёт свой эмиттер с `onListenerError: noop`.
2. **Тесты:** общий `setupFiles` vitest'а (сейчас его нет) ставит обработчик,
   который копит ошибки и **роняет текущий тест в `afterEach`**. Без этого
   изоляция ошибок превращает «слушатель кинул → тест упал» в «слушатель кинул
   → тишина», и мутанты, которых раньше убивало всплывшее исключение, начнут
   выживать. С этим проводом, наоборот, мутант, ломающий слушателя из
   микротаска, получает честный статус Killed вместо `RuntimeError`.

Граница применимости: `Emitter` ловит **синхронное** исключение слушателя.
Отказ fire-and-forget промиса внутри слушателя по-прежнему уходит в
`unhandledRejection`. Из четырёх гашений Stryker со ссылкой на #275 эмиттер
снимает одно (`rpcEndpoint.ts:197` — бросок из доставки канала); три других
(`quickInputExtensionAdapter.ts:31`, `problemsComponent.ts:162`,
`keybindingsEditorPane.ts:144`) — про отклонённый промис и остаются.

### Комбинаторы

В v1 — `Event.None` (заглушки и дублёры) и `Event.once`. Остальное — по
правилу «появился второй потребитель»:

| Комбинатор | Кандидаты в коде | Когда |
|---|---|---|
| `Event.debounce(event, merge, delay)` | 4–5 мест из раздела 3.6 | PR 5 |
| `Event.map` / `Event.signal` | обёртки-делегаты в `textEditorPane.ts:246–262` (`onDidChangeContent` и соседи пробрасывают событие модели) | по месту, если обёртка окажется чистой проекцией |
| `Event.any` | подписчики, слушающие 3–5 событий ради одного `refresh()` (`editorStatusContribution`) | не раньше, чем понадобится |
| `runAndSubscribe` | `ThemeService.onThemeChange` | один потребитель — оставляем методом |
| `AsyncEmitter`, `PauseableEmitter`, `EventBufferer`, `Relay`, `EventMultiplexer`, `fromObservable` | нет | не делаем |

---

## 6. Зависимость от `Disposable` и порядок с соседями

- `Emitter` использует только **тип** `IDisposable` — сегодня это type-only
  импорт из `@tuidom/core/common/disposable` (оттуда же его берут 129 файлов
  `src/vs`). Подписка возвращает объект-литерал `{ dispose }`. Значимой
  зависимости от класса `Disposable` нет.
- **В tuidom ничего не требуется.** Движку `Emitter` не нужен (у него
  DOM-модель событий), контракты виджетов (`onChange?` и т.п.) не меняем.
- Если [Lifecycle](Lifecycle.md) заведёт собственный
  `vs/base/common/lifecycle.ts`, в `event.ts` меняется одна строка импорта.
  Перегрузку подписки с `DisposableStore` (третий аргумент эталона) добавим
  тогда же, если она понадобится.
- **Порядок:** PR 1 (ядро) от Lifecycle не зависит и может идти первым.
  Массовую миграцию (PR 2–4) дешевле делать, когда Lifecycle уже решил, откуда
  импортируется `IDisposable` и как объект владеет эмиттером
  (`this.register(new Emitter())` против явного `dispose`): оба исследования
  правят одни и те же файлы сервисов, и двойной проход по ним — это двойной
  прогон мутаций. Жёсткой блокировки нет — только экономия.
- **Кто диспозит эмиттер.** Сервисам-синглтонам, живущим весь процесс, строку
  `emitter.dispose()` не добавляем (ненаблюдаемая уборка — готовый выживший
  мутант). Объектам с коротким циклом (`TextFileModel`, панели,
  `EmbeddedTerminalSession`, каналы) — добавляем, и там она наблюдаема: после
  `dispose` слушатель не зовётся.

---

## 7. План миграции

### Механическая ли она

Наполовину. Шаблон на событие устойчив (поле + метод подписки + цикл →
эмиттер + поле + `fire`), и 66 из 76 мест — буквально он. Но каждое место
меняет поведение в трёх точках (отписка в обходе, ошибки, порядок при живом
обходе), а 7 мест несут особую механику (таблица в 3.3).

**Кодмод не делаем.** 42 файла — это меньше работы, чем написать и отладить
кодмод на `ts-morph` под две идиомы коллекций и пять вариантов обвязки;
проверять результат всё равно пришлось бы по файлу, потому что гейт — мутации.

### Разбивка

| PR | Содержание | Событий | Размер | Зависит от |
|---|---|---|---|---|
| **1. Ядро + пилот** | `base/common/event.ts` с тестами (100% покрытие и мутации); провод `setUnexpectedErrorHandler` в `main.ts` и `extensionHostSubprocess.ts`; vitest `setupFiles`, роняющий тест на непредвиденной ошибке; пилот на двух разных идиомах — `MarkerService` (массив, живой обход) и `PanelService` (4 `Set` + свои хелперы); правка [TESTING.md](../TESTING.md) (раздел про `RuntimeError`/#275) и `docs/arch/Common.md` | 5 | средний | — |
| **2. `platform` + `editor/common`** | оставшиеся 10 событий `platform` и 6 `editor/common`; `ContextKeyService` (коалесинг остаётся), `LogService` (`onListenerError`), `TextDocument` (горячий путь — замер до/после на бенче правок) | 16 | средний | 1 |
| **3. `workbench/services`** | 31 событие; при объёме диффа — двумя PR: 3а `textFileModel` + `editorService` + `editorGroupModel` (17, вместе со слотами `onOpenFailed`, `onDidSave`, `onEditorCreate`), 3б остальное (14, вместе с `FileSearchService.onIndexChanged`) | 31 | крупный | 1; желательно после решения Lifecycle |
| **4. `browser/parts` + `contrib` + `api`** | 4 + 13 + 7 событий; `ViewsService` (нагрузка-объект), тестовый дублёр статус-бара | 24 | средний | 1 |
| **5. Хвост** | `Event.debounce` и его 4–5 потребителей; lint-предохранитель (`no-restricted-syntax` на поля `*Listeners` с типом массива/`Set` функций в `src/vs`, с явным списком исключений из 3.2); опционально — `vscode.EventEmitter` обёрткой над `Emitter`; закрыть строку в [VscodeStructureFollowUps](VscodeStructureFollowUps.md) | — | малый | 2–4 |

PR 2, 3, 4 между собой независимы и могут идти в любом порядке. Ожидаемый
итог по строкам: минус ~600 строк обвязки (76 × ~8), плюс ~450 (ядро с
тестами).

### Мутационный гейт

Скоуп гейта — изменённые строки, поэтому миграция для него скорее выгодна:

- **Мутантов становится меньше.** Обвязка подписки/отписки (`indexOf`,
  `if (i >= 0)`, `splice`, копия массива) исчезает из 42 файлов и проверяется
  один раз в `event.ts`. Гашений Stryker на этих строках нет (проверено: ни
  одного `Stryker disable` в трёх строках над точками отписки), переносить
  нечего.
- **Гашения «уборка ненаблюдаема» не задеваются.** Их 88 в 31 файле, но они
  стоят на стороне **подписчика** (`subscription.dispose()` и т.п.), а строки
  подписчиков миграция не трогает — форма вызова `onDidX(listener)` та же.
- **Новые мутанты** — удаление вызова `fire(...)`. Их убивают существующие
  тесты «слушатель получил событие»; где такого теста нет, это честная
  находка, а не шум.
- **Риск 1: тесты, закрепившие старую семантику.** Тест, ожидающий, что
  исключение слушателя всплывёт из метода сервиса (`expect(() =>
  svc.set(…)).toThrow()`), или что снятый в обходе слушатель будет вызван,
  покраснеет — править осознанно, это и есть смена контракта.
- **Риск 2: изоляция ошибок прячет падения.** Снимается vitest-проводом из
  раздела 5; он обязан приехать в PR 1 **раньше** первой миграции.
- **Риск 3: цена прогонов на слабой машине.** Один PR на слой держит дифф и
  прогон мутаций обозримыми; базу диффа брать от `origin/main`
  (см. [MutationGateFlake](MutationGateFlake.md), [TestRunTime](TestRunTime.md)).
  Крупный PR 3 делить по файлам-тяжеловесам, если прогон не укладывается.
- **Риск 4: горячий путь.** `TextDocument.onDidChangeContent` и
  `EditorViewState.onDidChangeCursorPosition` зовутся на каждую правку/движение
  каретки. Copy-on-write не добавляет аллокаций на `fire`, но `try/catch` и
  контейнер слушателя — добавляют косвенность; замерить существующими бенчами
  в PR 2.

---

## 8. Что НЕ делаем

- Не переносим upstream `event.ts` дословно и не заводим `observable`.
- Не делаем `AsyncEmitter`/`waitUntil`: save- и shutdown-участники остаются
  явными контрактами.
- Не трогаем 39 слотов «элемент → владелец», колбэки в опциях и контракт
  `ITreeDataProvider.onChange` движка.
- Не трогаем `addEventListener` элементов tuidom и сам движок.
- Не переводим `CancellationTokenSource` (одноразовое событие с повтором —
  свой контракт) и реестры обработчиков RPC.
- Не делаем async-примитивы (`Delayer`, `RunOnceScheduler`, `timeout`) — 20 из
  25 таймеров ждут отдельной задачи.
- Не делаем очередь доставки (G4), монитор утечек со стеками (G7),
  `thisArgs`/`disposables[]` в `Event`.
- Не переименовываем события под upstream-имена (`onActiveEditorChanged` →
  `onDidChangeActiveEditor` и т.п.) — это отдельная косметика, она раздула бы
  дифф у потребителей.
- Не пишем кодмод.

---

## 9. Найденное по пути (не чиним здесь)

- `EditorService.onEditorCreate` (`editorService.ts:189`) — слот зовётся
  (:1397), но в не-тестовом коде его никто не ставит.
- `EditorService.onOpenFailed` и `FileSearchService.onIndexChanged` —
  одиночные слоты на DI-сервисах: второй подписчик затрёт первого, а
  `dispose` первого обнулит чужую подписку.
- Живой обход с `splice` из-под итератора в 10 местах (список в 3.3): отписка
  из обработчика пропускает следующего слушателя.
- В проде нет обработчика `uncaughtException`: синхронный бросок слушателя из
  микротаска (`ContextKeyService.flush`) роняет процесс — это #275, описано в
  [TESTING.md](../TESTING.md).
- `onUnexpectedError` по умолчанию пишет в `console.error`, то есть в экран
  TUI: `main.ts` обработчик не переставляет.

---

## 10. Открытые вопросы (решать человеку)

1. **Что делает прод с ошибкой слушателя, кроме записи в лог?** Только Output,
   или ещё тост «внутренняя ошибка»?
2. **Массовую миграцию (PR 3) ждать решения Lifecycle или идти сразу?** Ждать —
   экономит один проход по ~15 файлам сервисов; идти — раньше закрывает #275
   для самых нагруженных событий.
3. **Lint-предохранитель — в PR 1 (как `warn`) или в PR 5 (как `error`)?**
   Ранний `warn` останавливает прирост новых рукописных списков на время
   миграции.
4. **Async-примитивы — заводить отдельное исследование сейчас?** 20 таймеров и
   6 микротаск-коалесингов ждут `RunOnceScheduler`; тема самостоятельная.

---

## Связанные документы

- [VscodeStructureFollowUps](VscodeStructureFollowUps.md) — исходная строка
  задачи («Опциональные углубления») и правило «пути повторяем, механизм — нет»
- [Lifecycle](Lifecycle.md) — `Disposable`, владение, утечки подписок
- [FileService](FileService.md) — файловый сервис (его события `onDidChangeFile`
  переедут на `Emitter` в общем порядке)
- [docs/TESTING.md](../TESTING.md) — «Раннер упал на мутанте», #275
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md#дословный-перенос-upstream-editorcommondiff)
  — шимы `base/common` против дословного переноса
- [MutationGateFlake](MutationGateFlake.md), [TestRunTime](TestRunTime.md) —
  цена и капризы мутационного гейта
