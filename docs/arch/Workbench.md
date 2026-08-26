# Workbench/

Часть архитектуры Diode — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).
История миграции Controllers → Workbench (задача завершена, слой Controllers растворён) —
[../TODO/WorkbenchRefactoring.md](../TODO/WorkbenchRefactoring.md).

Прикладной слой приложения. Здесь живут **сервисы** (логика приложения) и **компоненты**
(UI-сборка поверх контролов TUIDom) — как в VS Code (services + Part/ViewPane), а также
встроенные экшены (`Actions/`) и DI-модули с профилями (`Modules/`).

## Модель Service ↔ Component

- **Service** — где живёт логика приложения: состояние, I/O, индексы, подписки на нижние
  слои. Сервис ничего не знает про конкретные компоненты.
- **Component** — принимает сервисы в конструктор и общается с ними (вызовы, подписки);
  владеет корневым контролом и раздаёт данные/стили вниз.

**Правило-инвариант:** есть `view` → Component; нет `view` → Service.

Async-инициализация живёт в сервисах: интерфейс `IActivatable` (`src/vs/workbench/browser/iActivatable.ts`):

```ts
export interface IActivatable {
    activate(): Promise<void>;
}
```

У компонентов отдельных `mount()`/`activate()` **нет** — вся сборка происходит в конструкторе.
Единственное исключение — корневой `WorkbenchComponent`: у корня есть реальная
bootstrap-последовательность приложения (mount → activate → open/restore файлов),
которую ведёт `main.ts`.

## Контракты Component / ThemedComponent (`src/vs/workbench/Component.ts`)

```ts
export abstract class Component extends Disposable {
    public abstract readonly view: TUIElement;
}

export abstract class ThemedComponent extends Component {
    protected constructor(protected readonly themeService: ThemeService);
    protected get theme(): WorkbenchTheme;      // активная тема из themeService
    protected initStyles(): void;               // подписка на onThemeChange → updateStyles()
    protected abstract updateStyles(): void;    // пуш стилей во владеемые контролы
}
```

- Компонент **владеет** корневым контролом (`view`), но в жизненный цикл контролов не
  встраивается — только размещает их (как DOM-узлы) и не наследует `TUIElement`.
- Наследник `ThemedComponent` вызывает `initStyles()` **последней строкой конструктора**
  (из базового конструктора нельзя — поля наследника ещё не инициализированы).
  `ThemeService.onThemeChange` файрит листенер немедленно с текущей темой, поэтому
  начальная покраска происходит ровно один раз — внутри `initStyles()`; явный вызов
  `updateStyles()` не нужен. Подписка снимается при `dispose()`.

### Идентичность в дереве

Компонент вешает `view.id` на свой корневой контрол — это DOM-идентичность для тестов и
Inspector'а (поиск по дереву, скриншот-демо). Контролы своих id не придумывают.

## Стандарт стилей контролов + мост defaultStyles

Контролы TUIDom про темы не знают. У контрола — плоский интерфейс packed-цветов и
дефолты рядом с ним:

```ts
export interface IButtonStyles { readonly fg: number; readonly bg: number; /* … */ }
export const unthemedButtonStyles: IButtonStyles = { /* историческая палитра */ };
class ButtonElement {
    constructor(label: string, options?: { styles?: IButtonStyles });
    setStyles(styles: IButtonStyles): void; // единственный канал обновления, вызывает markDirty()
}
```

Мост тема → стили — `src/vs/platform/theme/browser/defaultStyles.ts`: по функции
`getXxxStyles(theme)` на контрол; **единственная точка знания «ключ темы → поле стиля»**.
Раздача — **пуш-моделью**: компонент подписан на смену темы (`ThemedComponent.updateStyles()`)
и заново вызывает `control.setStyles(getXxxStyles(this.theme))`. Никаких `applyTheme(theme)`
у контролов и никаких литералов цвета вне темы (см. [Theme.md](Theme.md)).

## Правила коммуникации

- **component → control**: вызовы методов контрола + `setStyles(...)`.
- **control → component**: колбэки `onX` (контрол не знает получателя).
- **component ↔ service**: конструкторная инъекция + подписки на события сервиса.
- **component ↔ component**: напрямую **запрещено** — только через общий сервис.

## Чек-лист новой пары Service ↔ Component

Исторически — чек-лист миграции view-контроллера (миграция завершена, слой
Controllers растворён); остаётся конвенцией для нового кода:

1. Логика — в `Workbench/Services/<Area>/`, UI-сборка — в `Workbench/Components/<Area>/`
   (компонент наследует `Component`/`ThemedComponent`).
2. Стили — `updateStyles()` + `getXxxStyles(theme)` из `Workbench/Styles/defaultStyles.ts`
   (никаких `applyTheme(...)` у контролов и ручных подписок на тему).
3. Wiring — в конструктор компонента, async-часть — в сервис (`IActivatable`).
4. DI-токен компонента — `*ComponentDIToken`, рядом с компонентом; биндинг — в
   `Workbench/Modules/`.
5. `view.id` — на корневой контрол компонента; тесты живут рядом с кодом.

## Workbench-contributions (`src/vs/workbench/Contributions/`)

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
dispose реестра сматывает все contribution'ы. Две фазы:
- **`restored`** — синхронно в `WorkbenchComponent.mount()` (view построена,
  лёгкие сервисы готовы; между конструктором и mount ни один редактор не
  открывается → перенос проводки из конструктора эквивалентен);
- **`eventually`** — idle после первого кадра (из `main.ts`,
  `setImmediate(() => workbench.runEventuallyPhase())`; из mount фаза сработала бы
  до кадра, т.к. `app.run()` красит отложенно) — для тяжёлой/отложенной работы.

**Регистрация — явный массив** `WORKBENCH_CONTRIBUTIONS` (`workbenchContributions.ts`,
зеркало `builtinActions`, без import-side-effect самрегистрации): пара
`{ token, phase }`. Новую фич-проводку добавляем сюда + биндим класс в
`Modules/WorkbenchModule.ts`, а не строкой в конструктор корня.

**Правило под наш DI** (ленив по токену, без Delayed-прокси): тяжёлые сервисы НЕ
класть в `static dependencies` — иначе они сконструируются в момент прогона фазы.
Тяжёлое резолвить лениво через `ServiceAccessor` внутри колбэков.

**Contribution vs Action.** Порция кейбиндов и команды с ленивым `run(accessor)` —
это декларативные `CommandAction` в `Actions/` (данные в реестры, сервис
резолвится при вызове), а не contribution'ы. Contribution нужен для eager-проводки
на событиях. Пограничный случай — программная команда без title (`workbench.openFile`):
не Action (тот форсит title → палитра), а contribution, регистрирующая команду.

Текущие: `EditorStatusContribution`, `TerminalEnvStatusContribution` (сегменты
статус-бара), `AutoRevealContribution` (`explorer.autoReveal`),
`ThemeConfigContribution` (live-reload `workbench.colorTheme`),
`OpenFileCommandContribution` (команда `workbench.openFile`),
`PanelFocusContribution` (возврат фокуса в редактор, когда содержимое нижней панели
уходит со сцены), `HistoryService` (история навигации — сервис, он же contribution:
владение подписками отдаёт реестр). Все — `restored`.

## Configuration-узлы (`src/vs/workbench/common/configuration/`)

Схемы настроек фич — узлы `IConfigurationNode` для `ConfigurationRegistry`
(механизм — слой Configuration, см. [Configuration.md](Configuration.md)):
по файлу на секцию (`workbenchConfiguration.ts`, `editorConfiguration.ts`,
`explorerConfiguration.ts`, `filesConfiguration.ts`, `terminalConfiguration.ts`)
плюс явный массив `CONFIGURATION_CONTRIBUTIONS` (`configurationContributions.ts`).
Узлы — чистые данные (их бандлит генератор схемы автодополнения); новая
настройка = свойство в узле своей секции. Реестр собирает `main.ts` (defaults-слой
`ConfigurationService`) и биндит `configurationModule`
(`ConfigurationRegistryDIToken` — известные ключи валидации settings.json в
`DiagnosticsService`).

## MenuRegistry (`src/vs/platform/actions/common/`)

Пункты меню собираются декларативно из реестра (аналог `MenuRegistry`+`MenuId` в
VS Code), а не хардкодятся списками в местах открытия. Так `when`-видимость и
группировку пунктов задаёт данные, а сборщик (контекст-меню редактора/Explorer,
меню-бар) лишь запрашивает готовый список.

**Точки.** `MenuId` — расширяемый класс с id-уникальностью (как в vscode):
встроенные точки — статические инстансы (`EditorContext`, `ExplorerContext`,
`EditorTitleContext`, `MenubarMainMenu` + `MenubarFileMenu`/`MenubarEditMenu`/…),
новая точка —
`new MenuId("my.menu")`; сравнение — по идентичности инстанса.

**Записи.** Два вида contributions (`MenuContribution`):
- `IMenuContribution { menuId; command; title?; when?; visible?; group?; order?;
  icon?; args?; shortcut? }` — пункт-команда;
- `ISubmenuContribution { menuId; submenu; title; mnemonic?; when?; group?;
  order? }` — пункт, открывающий вложенную точку (аналог `ISubmenuItem`);
  меню-бар = submenu-записи в `MenubarMainMenu`.

**Co-location placement (аналог `registerAction2`).** Placement живёт на самой
команде: `CommandAction.menus: CommandMenuPlacement[]` (+ `shortTitle` — короткий
label для меню: «File: Copy» → «Copy»; label-цепочка «title размещения →
shortTitle → title» фиксируется при деривации). Явный полный массив
`MENU_CONTRIBUTIONS` = структура меню-бара (`MENUBAR_SUBMENUS`) + деривация
`menuItemsOfAction(action)` по `builtinActions` — конвенция явных массивов
сохраняется, но источник каждого placement'а — файл его экшена.

**Реестр (данные).** `MenuRegistry.getMenuItems(menuId, context?)`: фильтр по
`when` (`ContextKeyService.evaluate`) и по `visible(context)`, сортировка групп —
**`navigation` первой** (спец-группа vscode), дальше по строке; внутри — order;
авто-разделители **между непустыми группами** (скрытый пункт схлопывает группу
без лишнего сепаратора), маппинг в `MenuEntry`:
- **label** — `title` пункта, иначе `CommandRegistry.getTitle(command)`, иначе id;
- **shortcut** — `false` → нет; строка → литерал; иначе резолв из
  `KeybindingRegistry.getKeybindingForCommand`+`formatKeybinding`;
- **onSelect** — `CommandRegistry.execute(command, ...args(context))` (args
  резолвятся при открытии).

`getSubmenus(menuId)` — submenu-записи (тот же when-фильтр и сортировка, без
разделителей). `appendMenuItem` (динамика) + `onDidChangeMenu` (событие смены
состава). Реестр — чистая функция реестров команд/кейбиндов/контекст-ключей;
состояние открытия (буфер обмена файлов, путь узла) приходит параметром
`context`, не через DI. Конвенция контекста: `EditorContext`, меню-бар →
`undefined`; `ExplorerContext → { path, canPaste }`; `ScmGraphContext →
{ sha, shortSha, subject }` — коммит под меню в графе;
`EditorTitleContext → { groupId, index, path, tabCount, hasTabsToTheRight,
hasSavedTabs }` — вкладка под правым кликом (хелперы — `Menus/menuContexts.ts`).

**`EditorTitleContext` — меню вкладки** (VS Code `editor/title/context`).
Открывает `EditorGroupComponent` по `EditorTabStripElement.onTabContextMenu`;
цель — вкладка **под курсором**, а не активная (правый клик активную не меняет,
как в VS Code). Поэтому команды пунктов адресуются парой `(groupId, index)` из
`editorTabTargetArg` (резолв — `Actions/editorTabTarget.ts`, фолбэк на активную
вкладку, если аргументов нет: палитра и клавиатура), а видимость решается
императивно через `visible(context)`: глобальные when-ключи вкладку под курсором
не различают, а `enablement` тут не поможет — он гасит пункт, а не адресует его.
Пункт закрытия ходит через
`closeTabsWithConfirm` (`Actions/editorCloseHelpers.ts`) — общая серия закрытий с
confirm-диалогом по несохранённым и прерыванием на Cancel.

**MenuService (потребление).** `MenuService.createMenu(menuId) → IMenu` (аналог
`IMenuService`/`IMenu`): живое меню одной точки — `getEntries(context?)`/
`getSubmenus()` резолвят на момент вызова, `onDidChange` переэмитит смену
состава реестра. Консюмеры не ходят в реестр напрямую: контекстные меню — через
`ContextMenuService` (`platform/contextview`, делегаты с `menuId`; редактор —
`editor/contrib/contextmenu`), меню-бар (`MenuBarComponent`:
top-уровень — `getSubmenus(MenubarMainMenu)`, entries каждого меню — ленивый
геттер, резолв при открытии попапа — шорткаты и динамические пункты всегда
актуальны, порядок резолва относительно user keybindings не важен). Попапы
по-прежнему резолвятся при открытии, а постоянный UI (inline-кнопки заголовков
view) пере-резолвится по `ContextKeyService.onDidChange` — событие коалесцировано
в тик и не стреляет на запись того же значения (иначе оно бы срабатывало перед
каждым кейбиндом, см. `WorkbenchContextKeys.update`).

**`enablement` — доступность против видимости.** У `CommandAction`,
`CommandMenuPlacement` и `IMenuContribution` рядом с `when` есть `enablement`
(аналог `precondition`/`enablement` VS Code): `when` пункт прячет, `enablement`
гасит — пункт остаётся на месте, но приглушён и не исполняется. Placement
наследует значение экшена, своё — сужает (AND). Принуждение живёт на самой
команде (обёртка в `registerAction`), поэтому накрывает все пути запуска: пункт
меню, inline-кнопку, кейбинд, палитру и программный `execute`; `enablement`
дополнительно складывается в `when` биндинга, иначе диспетчер проглотил бы
клавишу впустую. Резолвнутый пункт несёт `enabled` (`IResolvedMenuItemEntry`) —
его читает заголовок view и рисует кнопку токеном `disabledForeground`. Серые
пункты попапа «⋯» пока невозможны: у `MenuItemEntry` в `@tuidom/elements` нет
поля `disabled` — это задача в репозиторий tuidom, см.
[TODO](../TODO/WorkbenchContributions.md).

**Границы vs contribution/Action.** Menu-placement — *где показывать команду*
(данные, co-located на экшене). Command+keybinding — `Actions/` (поведение).
Event-проводка — `Contributions/`.

Осознанно не перенесено из vscode: `alt`-пункты (альтернатива по Alt) и user
hide-toggle (`isHiddenByDefault`). См.
[TODO](../TODO/WorkbenchContributions.md).

**Группы и вложенность.** `MenuRegistry.getMenuItemGroups` отдаёт пункты
разложенными по группам (склейка сепараторами — `joinMenuGroups`): это нужно
потребителям, которые рисуют группы по-разному — заголовок view показывает
`navigation` inline-кнопками, а остальное уводит в «⋯». Вложенные submenu в
попапах поддержаны: `MenuService.getEntries/getEntryGroups` резолвят их
рекурсивно (`seen` рвёт циклы `MenuId`), `PopupMenuElement` рисует
`type: "submenu"` дочерним попапом.

## Текущие обитатели

- `Component.ts` — база `Component`/`ThemedComponent`.
- `IActivatable.ts` — контракт async-инициализации сервисов.
- `Styles/` — мост тема → стили контролов (`defaultStyles.ts`).
- `Modules/` — DI-модули и профили (`ProductionProfile`/`TestProfile`,
  `WorkbenchModule` со всеми парами Service ↔ Component и интерфейсными швами,
  `ExtensionHostModule` и др.) — см. [../DI.md](../DI.md).
- `Services/` — переехавшие из Controllers сервисы: система команд (`CommandRegistry`,
  `KeybindingRegistry`, `ContextKeyService`, `ContextKeys`), `KeybindingDispatcher`
  (клавиатурный диспатч: резолв keydown против `KeybindingRegistry` + `ContextKeyService`,
  chord-режим с таймаутами и swallow продолжения, chord-хинт/«is not a command» через
  `StatusBarService`, hold-сессии через `ModifierReleaseArmory`, runtime-детект CSI-u,
  применение user keybindings.json; view не знает — владелец корневого дерева
  (`WorkbenchComponent`) вешает его capture/bubble-листенеры и подключает хук-шов
  `hasKeyboardCapturingOverlay`; второй хук — `updateContextKeys` — замыкает на
  себя `WorkbenchContextKeys`), `StateKeys`,
  `ModifierReleaseArmory`, `ChokidarFileWatcher` + `IFileWatcherDIToken`,
  `FileSearchService`, `QuickOpenParsing`, `collectWordCompletions`, `CoreTokens`,
  каталоги `Workspace/` (undo/redo + `TrashService`/`WorkspaceEditService`/
  `fileClipboardFs.ts` — чистые ФС-операции copy/cut/paste), `TerminalEnvironment/`,
  `Terminal/` (EmbeddedTerminalSession, фабрика, загрузчик node-pty,
  `TerminalService`), `Diagnostics/` (валидатор settings.json,
  `ProblemsTreeDataProvider`, `DiagnosticsService`), `history/`
  (`HistoryService` — стек Go Back / Go Forward, см. ниже).
- **История навигации** (`services/history/browser/historyService.ts`, аналог
  `IHistoryService` + `EditorNavigationStack` у VS Code). Стек хранит
  **место** (ресурс + позиция каретки + группа), а не вкладку: MRU вкладок
  (`Ctrl+Tab`) помнит, ЧТО было открыто, история — ГДЕ ты был. Ведётся двумя
  путями: неявно — подпиской на смену активного редактора и на каретку
  (`entries[index]` всегда зеркалит живую позицию, движение ближе 10 строк
  перезаписывает запись, а не растит стек), и явно — обёрткой
  `IJumpRecorder.jump()` вокруг перехода. Обёртку обязан звать каждый сайт
  прыжка (Go to Definition, Problems, результаты поиска, Go to Line/File):
  между `openUri` и `goToPosition` история иначе увидит промежуточную позицию
  «начало целевого файла», и первый Back приведёт туда. Собственные Back/Forward
  гасятся флагом `suspended` — без него восстановление тут же записалось бы
  новой записью и отсекло forward-хвост. Чистка стека (удалённый с диска файл,
  закрытый `untitled:`) — ленивая, только на шаг пользователя: `onDidChangeEditors`
  прилетает на КАЖДОЕ нажатие клавиши (группа слушает `onDidChangeContent` вкладки),
  и вешать туда `existsSync` по полусотне записей нельзя.
- **Explorer-кластер (этап 7)** — дерево файлов сайдбара и файловые операции:
  - `Services/FileTreeDataProvider.ts` — данные дерева (ленивая загрузка по
    уровням, chokidar-watch раскрытых каталогов, статус-декорации/иконки).
  - `Services/ExplorerService.ts` — логика Explorer'а (аналог `IExplorerService`):
    корень воркспейса + владение провайдером (`setRootPath` пересоздаёт провайдер и
    файрит `onDidChangeRoot`), `revealPath` (построение цепочки предков),
    `autoRevealActiveFile` (настройка `explorer.autoReveal`; активный файл передаёт
    `WorkbenchComponent`), выбор (`getSelectedPaths`/`getPasteTargetDir`),
    `setFileDecorations` (мост декораций extension-host'а: адаптер
    `FileDecorationsServiceAdapter` типизирован минимальным интерфейсом
    `IFileDecorationsTarget`, сервис соответствует структурно), подсветка
    «вырезанных» по `IFileClipboard.onDidChange` и лог ошибок file-watcher'а
    (`filetree.watcher`, подсказка про inotify-лимит). Дерево приходит через шов
    `IExplorerView` (refresh/reveal/focus/selection/cut-keys):
    `TreeViewElement<FileTreeNode>` соответствует структурно, регистрирует его
    компонент через `attachView`.
  - `Components/Explorer/ExplorerComponent.ts` — `ThemedComponent`; по
    `onDidChangeRoot` строит `TreeViewElement` поверх провайдера сервиса
    (обёрнут `ScrollBarDecorator` + `TitledPanelElement` «EXPLORER»,
    `view.id = "explorer"`; стили — `getFileTreeStyles`/`getScrollBarStyles`),
    вяжет события дерева (expand → watch каталога, активация файла → команда
    `workbench.openFile`) и открывает контекст-меню дерева через
    `ContextMenuService` — делегат с `MenuId.ExplorerContext`, пункты исполняют
    команды `explorer.*`/`fileOperations.*`; правый клик и Shift+F10 — одно
    событие `contextmenu` движка, один путь.
  - `Services/FileOperationsService.ts` — файловые операции поверх
    `WorkspaceEditService`/`DialogService`/`UndoRedoService`/`IFileClipboard`:
    `runCreate`/`runRename` (промпт имени через узкий шов
    `IExplorerInputPrompt` — срез `QuickInputService.input`, в DI замкнут на
    `QuickInputServiceDIToken`; интерфейс оставлен ради фейков в тестах),
    `requestDeleteFile` (корзина/
    безвозвратно + подтверждения), `copySelected`/`cutSelected`/`paste`
    (+ `buildPasteEdits`), workspace-undo/redo, `resolveInputPath` (`~`, корень
    воркспейса).
  - `Services/InputWidgetService.ts` — целевой сервис input-команд: держит
    активный `InputElement` (ставит `WorkbenchContextKeys.update()`) и
    исполняет курсор/правки/выделение/клипборд для него (читают экшены
    `Workbench/Actions/InputActions.ts` под `when: inputWidgetFocus`).
- **QuickInput-кластер (этап 8)** — квик-инпут/квик-опен поверх ОДНОГО общего
  виджета:
  - `Components/QuickInput/QuickInputComponent.ts` — `ThemedComponent`; владеет
    единственным переиспользуемым `QuickPickElement` (`view.id = "quickInput"`;
    внутри — `InputElement` строки запроса) и его overlay-сессией
    (`restoreFocus`, `closeOnEscape`, `pointerPolicy: "close-on-outside"`).
    Overlay-хост — late-init шов `attachHost(BodyElement)` (как у
    DialogService). API для сервисов-клиентов: `show()` (позиция: центр, ~10%
    от верха + open + focus), `hide()`, `isOpen()`, канал закрытия `onDidClose`
    (Escape / клик мимо / программное — один путь). Стили: пуш
    `unthemedQuickPickStyles` — пикер пока на исторической unthemed-палитре,
    маппинг на ключи темы — отдельная задача.
  - `Services/QuickInputService.ts` — VS Code-style QuickInput: `input(opts)`
    (InputBox: title/prompt/placeholder/value/`validateInput`; Enter блокируется
    hard-ошибкой) и `quickPick(opts)` (фильтруемый список, `activeIndex`,
    `onDidChangeActive` — шов live-preview). Промисы резолвятся значением/
    выбранным айтемом или `undefined` при отмене; новый вызов отменяет
    предыдущий. На каждый показ полностью ре-инициализирует состояние и колбэки
    общего виджета.
  - `Services/QuickAccess/` — contribution point провайдеров Quick Open
    (аналог `IQuickAccessRegistry` vscode,
    `vs/platform/quickinput/common/quickAccess.ts`): `QuickAccessRegistry`
    выбирает провайдера по самому длинному префиксу запроса; список — явный
    массив `QUICK_ACCESS_PROVIDERS` (`quickAccessProviders.ts`, DI-токены,
    резолв ленивый). Провайдер (`IQuickAccessProvider`) отдаёт
    пункты (`getItems`, запрос целиком — префикс срезает сам; свой префикс
    объявляет статикой `PREFIX`, как vscode-провайдеры) и плейсхолдер, живёт
    по хукам `onShow(refresh)`/`onHide`; пункт — `QuickAccessItem` с колбэком
    `accept` (пункт без `accept` — информационный хинт, пикер не закрывает).
    Встроенные провайдеры: `FilesQuickAccessProvider` (`""` — дефолтный:
    фоновый индекс `FileSearchService`, `debounceQuery`, live-refresh по
    `onIndexChanged` с сохранением курсора, `file:line[:col]`-суффикс через
    `QuickOpenParsing`), `CommandsQuickAccessProvider` (`>`:
    `CommandRegistry.listCommands` + шорткаты из
    `KeybindingRegistry`/`ContextKeyService`), `GotoLineQuickAccessProvider`
    (`:`; активный редактор — шов `IGotoLineEditorSource` → `EditorService`
    структурно, биндинг в `Modules/WorkbenchModule.ts`).
  - `Services/QuickOpenService.ts` — контроллер показа Quick Open (аналог
    `QuickAccessController`): `show(prefix)` занимает общий виджет, дальше
    ведёт запрос через реестр (смена префикса на лету переключает провайдера),
    к дорогим провайдерам применяет leading+trailing debounce 16мс. О
    конкретных префиксах не знает. UI — тот же `QuickInputComponent`;
    сервис-клиент, занявший виджет позже, закрывает предыдущий показ (его
    промис отменяется через `onDidClose`).
- **`Actions/`** — экшены Workbench (`CommandAction`/`registerAction` — описание
  команды + кейбинды; переехали из Controllers): `FileTreeActions.ts`
  (delete/rename/refresh/undo/redo + Shift+F10-меню Explorer'а),
  `FileTreeClipboardActions.ts` (copy/cut/paste, copyPath/copyRelativePath),
  `FileTreeCreateActions.ts` (`explorer.newFile`/`explorer.newFolder`);
  с этапа 8 — тонкие экшены-пикеры с реальными `run(accessor)`:
  `QuickOpenActions.ts` (Ctrl+P / Show Commands / goto-line →
  `QuickOpenService.show(prefix)` с префиксами из статик `PREFIX` провайдеров), `ThemeActions.ts` (`selectColorTheme` поверх
  `QuickInputService.quickPick` + `ThemeRegistry`/`ThemeService`, live-preview
  через `onDidChangeActive`, персист в `workbench.colorTheme`; здесь же
  `themeTypeLabel`), `FileActions.ts` (Open File / Open Folder: InputBox-промпт
  пути + `FileOperationsService.resolveInputPath`; открытие — команда
  `workbench.openFile`, смена воркспейса — шов `IWorkspaceFolderOpener` →
  `WorkbenchComponent` структурно, биндинг в `Modules/WorkbenchModule.ts`).
  Регистрирует их `WorkbenchComponent` в общем цикле `builtinActions`.
  С этапа 9b здесь же экшены активного редактора поверх `EditorService`:
  `EncodingActions.ts` (двухуровневый пикер Reopen/Save with Encoding),
  `EolActions.ts` (convert/toggle/пикер EOL), `ContextMenuActions.ts`
  (Shift+F10-меню редактора). С этапа 10 — `FindActions.ts` (Ctrl+F/Enter/F3/
  Escape → `FindService`) и `SuggestActions.ts` (Ctrl+Space triggerSuggest +
  навигация/accept/hide попапа → `CompletionService`); экшены под
  `findWidgetVisible`/`suggestWidgetVisible` идут ХВОСТОМ `builtinActions`,
  чтобы победить editor-команды (резолвер берёт последний зарегистрированный
  с проходящим `when`). С этапа 11 `Controllers/Actions/` растворён целиком:
  сюда переехали Editor*/Input*/Clipboard*/Folding*/List*/Tab*/Whitespace*/App*/
  Preferences*-экшены (Preferences и save/saveAs/newUntitled — с реальными
  `run(accessor)`, About — экшен поверх DialogService; у quit `run` перекрывает
  `WorkbenchComponent` confirm-save-флоу), добавились `LayoutActions.ts`/
  `TerminalActions.ts`, а сам упорядоченный список — `builtinActions.ts`
  (регистрирует владелец приложения одним циклом).
- **Диалоги (этап 5b)** — `browser/parts/dialogs/`: база `DialogComponent`
  (владеет `FitContentElement`-view; наследник собирает в нём дерево примитивов
  конструкторами один раз — компонент **компонует** контролы, не наследуя
  `TUIElement`; общий каркас окна — `buildFrame` (рамка + отступы + стек, цвета
  контента раздаёт каскад); общее поведение: ряд кнопок, стрелки, Escape →
  `onDismiss`; цвета — токены `DIALOG_STYLES`: `editorWidget.*`,
  `descriptionForeground`, `textLink.foreground`, `editorWarning.foreground` —
  резолвит каскад, пере-пуш при смене темы не нужен) и наследники
  `ConfirmDialog`, `ConfirmSaveDialog`, `AboutDialog`. Оркестрация — `Services/DialogService.ts`
  (аналог `IDialogService`): владеет компонентами и их overlay-сессиями
  (`pointerPolicy: "modal"`, центрирование по экрану), API —
  `showConfirmDialog`/`showConfirmSaveDialog` (+ promise-обёртка `confirmSave`)/
  `showAboutDialog`, `getOpen*` для тестов/оркестрации. OverlayLayer приходит
  через late-init шов `attachHost(BodyElement)` — его зовёт владелец корневой
  view (`WorkbenchComponent`) после её постройки.
- **Жизненный цикл (этап 5c)** — `Services/LifecycleService.ts`:
  `requestQuit(onQuit)` последовательно спрашивает про «грязные» элементы
  участников через `DialogService.confirmSave` (Cancel прерывает выход; чистый
  выход — синхронно, до первого await). Шов — интерфейс `IShutdownParticipant`
  (`collectDirty(): IShutdownDirtyItem[]` — имя + `isStillDirty()` + `save()`
  с overwrite): Workbench объявляет, `EditorService` реализует
  структурно, регистрирует его `WorkbenchComponent`; сам выход (teardown TUI +
  `process.exit`) остаётся колбэком `onQuit` от владельца приложения.
- **Статус-бар — эталонная пара Service ↔ Component** (пилот, этап 4):
  - `Services/StatusBarService.ts` — реестр записей статус-бара (аналог
    `IStatusbarService` VS Code): `addEntry(IStatusBarEntry) → IStatusBarEntryHandle`
    (`update`/`dispose`), `onDidChangeEntries`, `entries()` (left, затем right; внутри
    стороны — по убыванию `priority`, выше — левее, как в VS Code). Про поставщиков
    и контролы не знает. Он же владеет **видимостью** записей: `allEntries()` отдаёт
    полный список (источник пунктов меню), `entries()` — только видимые (то, что
    рисует компонент), `isHidden`/`setHidden` переключают с write-through персиста
    в `STATUS_BAR_HIDDEN_STATE` (`scope: "global"` — состав полосы это вкус
    пользователя, а не свойство проекта, так же в VS Code). Скрыть можно только
    запись с `name`: транзиентные сегменты (chord-хинт, прогресс расширения) имени
    не несут, в меню не показываются и всегда видимы.
  - `Components/StatusBar/StatusBarComponent.ts` — `ThemedComponent`; **композиционный
    корень** из примитивов tuidom (`view` = `HFlexElement`, `view.id = "statusBar"`:
    краевые `FillerElement`-паддинги, лейблы сегментов `TextLabelElement`,
    fill-филлер в середине). Отдельных разделителей нет: каждый сегмент несёт по
    пробелу с краёв, поэтому соседей разделяют ровно две клетки, а блок подсветки
    накрывает сегмент с воздухом — как элемент статус-бара в VS Code. Дерево
    строится один раз и мутируется по `onDidChangeEntries`: при неизменном числе
    сегментов — только `setText` (путь курсора `Ln X, Col Y`), пересборка
    `replaceChildren` — лишь при смене состава; лейблы живут в пулах, клик резолвит
    запись по (стороне, индексу) в момент клика. Красит бар из темы в
    `updateStyles()` — дети наследуют цвета каскадом.
  - **Наведение и меню видимости.** Кликабельный сегмент (запись с `onClick`) несёт
    `when`-стиль `statusBarItem.hoverBackground`/`hoverForeground` — hover движок
    ставит сам, лейблы настоящие цели хит-теста. Инертные сегменты подсветки не
    получают: она обещала бы клик, которого нет (в VS Code ровно так — hover-стиль
    у `<a>`-элементов с командой). Команду запускает только ЛЕВАЯ кнопка. Правый
    клик по полосе открывает через `ContextMenuService` переключатель видимости:
    галочки (`CHECKED_ICON`) по всем именованным записям **включая скрытые** —
    иначе их нечем вернуть — и `Hide '<name>'` для сегмента под курсором (цель
    резолвится из `event.target`). Клик мимо сегментов даёт меню без `Hide` — это
    путь назад, когда скрыто всё. Id лейбла едет за записью
    (`#statusBarItem-status-scm-branch`), не за индексом в пуле — селекторы
    инспектора/e2e стабильны.
  - Сегменты публикуют workbench-contribution'ы (инстанцируются реестром в фазе
    `restored`, см. «Workbench-contributions»): `Services/EditorStatusContribution.ts`
    (правые, порядок VS Code: `Ln X, Col Y` · Encoding · EOL · Language; Encoding/EOL
    кликабельны — команды `changeEncoding`/`changeEOL` через `CommandRegistry`) и
    `Services/TerminalEnvironment/TerminalEnvStatusContribution.ts` (tier + моды).
    Активный редактор приходит через **интерфейсный шов**: Workbench объявляет
    `IActiveEditorStatusSource`/`IActiveEditorStatus` (минимальный срез:
    `onActiveEditorChanged`, курсор/encoding/EOL/язык), `EditorService`
    соответствует ему структурно; связывание — биндинг
    `ActiveEditorStatusSourceDIToken` в `Modules/WorkbenchModule.ts`.
    Chord-хинт публикует `KeybindingDispatcher` как обычную запись сервиса.
- **Panel-кластер (этап 6)** — нижняя панель и её вкладки:
  - `Services/PanelService.ts` — таб-строка нижней Panel: набор вкладок, активная
    вкладка и **видимость** панели. Вкладки заводит только `ViewsService`
    (контейнер с `location: "panel"` = вкладка), фичи в этот реестр не ходят.
    События:
    `onDidChangeViews`, `onDidChangeActiveView`, `onDidActivateView`
    (пользовательская активация — клик по табу; программный `setActiveView` его
    **не** порождает — на нём висят ленивые фичи), `onDidChangeVisibility`
    (с этапа 11 за ней следует `LayoutService`: двигает `WorkbenchLayoutElement`
    и контекст-ключ `panelVisible`).
  - `Components/Panel/PanelComponent.ts` — `ThemedComponent`; владеет
    `PanelContainerElement` (`view.id = "panel"`, стили —
    `getPanelContainerStyles`), отражает реестр сервиса (вкладки/контент/актив)
    и возвращает клик по табу в `PanelService.activateView`.
  - `Components/Panel/ProblemsComponent.ts` — `ThemedComponent`; дерево
    «файл → маркеры» (`TreeViewElement` поверх `ProblemsTreeDataProvider`,
    `view` = `ScrollBarDecorator`, `view.id = "problemsView"`; стили —
    `getProblemsTreeStyles` + `getScrollBarStyles`). Регистрирует контейнер и
    view PROBLEMS (`PROBLEMS_VIEW_ID`, `location: "panel"`); пока маркеров нет —
    тело view `null` и секция рисует placeholder. Reveal маркера — через **интерфейсный шов**
    `IMarkerRevealTarget` (`openUri` + `getActiveEditor` с
    `goToPosition`/`revealRange`); `EditorService` соответствует
    структурно, биндинг `MarkerRevealTargetDIToken` — в `Modules/WorkbenchModule.ts`.
  - `Services/Terminal/TerminalService.ts` — headless-оркестратор терминала:
    инстансы (id/title/session), lazy spawn через `TerminalSessionFactory`,
    регистрация контейнера/view TERMINAL (`TERMINAL_VIEW_ID`, `location: "panel"`)
    + подписка на её активацию, чистка PTY при выходе шелла/dispose. События:
    `onDidOpenInstance`/`onDidCloseInstance`/`onDidChangeActiveInstance`/
    `onDidRequestFocus`.
  - `Components/Panel/TerminalPanelComponent.ts` — view-владелец терминала:
    строит `TerminalViewElement` по каждому инстансу, вкидывает виджет
    активного в TERMINAL-вкладку (через `ViewsService.setViewBody`), красит
    виджеты (`getTerminalViewStyles`). **Не** наследник `Component`: корневого
    контрола нет — его UI это несколько виджетов. ВАЖНО: у `TUIElement` нет
    unmount-хуков, поэтому компонент **обязан** сам dispose'ить виджеты — при
    закрытии инстанса и при своём `dispose()`.
  - `Services/Diagnostics/DiagnosticsService.ts` — headless-проводник диагностик
    поверх `MarkerService`: поставщик — валидатор активного settings.json,
    потребитель — editor squiggles (Problems — второй потребитель того же
    реестра). Редакторы приходят через шов `IDiagnosticsEditorSource` /
    `IDiagnosticsEditor` (`EditorService`/`EditorPane`
    структурно; биндинг `DiagnosticsEditorSourceDIToken` — в WorkbenchModule).
- **Editor-кластер (этапы 9a/9b)** — редактор целиком в Workbench:
  - `Services/TextFile/TextFileModel.ts` — per-file модель без view (аналог
    `ITextFileEditorModel`): владеет `TextDocument`, dirty-статусом
    (`isModified` = versionId + EOL-ось), осями encoding/EOL/language, записью
    на диск (`save`/`saveAs`/`saveWithEncoding` + save-участник с клампом правок),
    перечиткой (`revertToDisk`/`reopenWithEncoding` → событие
    `onDidReloadDocument` с reason `disk`/`owned`) и слежением за файлом на диске
    через `IFileWatcher` (авто-перечитка чистого буфера / `hasDiskConflict` у
    «грязного»). **Владеет движком undo**: `UndoManager` (класс — в
    `src/vs/editor`) — один на документ, пересоздаётся с ним; модель сама
    роутит шаги в `UndoRedoService` (`undoContext`), а `undo/redo(view)`
    принимают «действующую вью», которой восстанавливается снимок выделений.
    **Не** singleton-сервис: экземпляр на файл, но один при любом числе вкладок —
    реестр `TextFileModelRegistry` (`acquire(uri)` → ref-count-ссылка, вкладка
    владеет ссылкой, модель умирает с последней; untitled/synthetic — мимо
    реестра). Правки, которые модель применяет сама (участник, `setEol`,
    `applyExternalEdits`), идут через шов `ITextFileEditTarget` — прикрепляет
    каждый парный компонент (целей может быть несколько — сплит-вью; действующую
    передаёт вызывающий, `markDirty` вещается всем).
  - `Components/Editor/EditorComponent.ts` — `ThemedComponent`; владеет
    `EditorElement` + view-state + токен-кешем (`view` = `ScrollBarDecorator`),
    принимает модель в конструктор (модель может делиться несколькими
    компонентами — по вью на группу): по `onDidReloadDocument` пересобирает
    view-state/`EditorElement` (перенося стили/контекст-меню; при
    `reason === "disk"` — ещё каретку и скролл), по
    `onDidChangeLanguage` и `TokenizationRegistry.onDidChange` пересаживает
    токенизатор, по контенту пересчитывает folding-регионы (микротаск-коалесинг).
    Чужие правки документа (другая вью, undo, владелец буфера) строчно ремапят
    выделения/фолды/скролл каждой вью — `EditorViewState.remapForDocumentChange`
    по `onDidChangeContent` (свои мутаторы гейтятся и пересчитывают себя точно).
    Здесь же view-API: курсор/reveal/goToPosition, декорации (search/markers/
    gutter change-bars), folding-команды, контекст-меню редактора,
    `updateStyles()` → `getEditorStyles` + `editor.style={fg,bg}` +
    `getScrollBarStyles`.
  - `Components/Editor/EditorPane.ts` — пара «модель + view-компонент» одного
    открытого редактора (аналог editor input + pane): владеет временем жизни
    `TextFileModel` + `EditorComponent` и делегирует единый API по
    принадлежности. Это поверхность «активного редактора» для потребителей
    (экшены, Find/Completion, host-адаптеры, швы `IActiveEditorStatus`/
    `IDiagnosticsEditor`/`IMarkerRevealEditor`/`IGotoLineEditor` — выполняются
    структурно делегатами в модель/компонент).
  - `Services/EditorService.ts` (этап 9b; со сплитов — фасад активной группы +
    менеджер полосы, аналог IEditorService+IEditorGroupsService) — логика без
    view. Пер-группная модель извлечена в `editorGroupModel.ts` (`EditorGroup`:
    вкладки, активная, MRU-серии Ctrl+Tab, `insertPane`/`detachPane` без
    dispose, пер-группный дедуп `findPaneIndex`; контракт порядка событий
    `onDidChangeEditors` → фокус → `onDidChangeActivePane`). Сервис владеет
    полосой (`groups`/`activeGroup`/`viewColumnOf`/`groupOf`), операциями
    сплитов (`splitActiveGroup`/`newGroup`/`focusGroup`/`moveActiveEditorToGroup`/
    `copyActiveEditorToGroup`/`joinTwoGroups`/`joinAllGroups`/`moveActiveGroup`;
    отказ по месту — `canAddGroupHook` + лог), схлопыванием опустевших групп,
    реестром моделей (`TextFileModelRegistry`: одна `TextFileModel` на ресурс,
    вкладка владеет ref-count-ссылкой), `openFile`/`openUri` (`{group:"beside"}` —
    Open to the Side), `newUntitled`, `displayName`/`suggestedSaveName`,
    применение `editor.*`-настроек, группа-уровневые швы host'а
    (`saveParticipant`, `completionSource`), `IShutdownParticipant`
    (`collectDirty` — дедуп по документу). События: `onActiveEditorChanged`
    (смена вкладки активной группы ЛИБО активной группы), `onEditorSaved`,
    `onDidChangeEditors` (агрегат групп), `onDidActiveGroupChange`,
    `onDidGroupsChange({kind: added|removed|moved})`.
  - `parts/editor/editorPartComponent.ts` — часть «область редактора» (аналог
    `EditorPart`): владеет `tuidom/ui/editorpart/EditorPartElement` (полоса N
    вью + N−1 сашей, нормированные веса, min-клампы 20×5, максимизация,
    `canFit`) и по `EditorGroupComponent` на группу; политика долей (сплит
    делит долю источника пополам); хуки сервису (`canAddGroupHook`,
    `focusGroupContentHook`) и персисту (`onDidChangeGroupLayout`,
    `IEditorGroupsLayoutView` для `WorkbenchStateService`).
  - `Components/Editor/EditorGroupComponent.ts` — контрол ОДНОЙ группы;
    **композиционный корень** из примитивов tuidom: `view` = `OverlayHostElement`
    (локальный OverlayLayer для find-виджета группы; `view.id =
    "editorGroup-<groupId>"`) поверх `VFlexElement` [`EditorTabStripElement`
    (1 ряд), контент-слот (остаток; пустой — фон-филлер `editor.background`,
    focusable у пустой группы)]: по `group.onDidChangeEditors` вставляет view
    активной вкладки и перерисовывает табы (метки с минимальной разводкой тёзок
    пер-стрип, иконки, маркер изменённости — `getTabStripStyles`); клики по
    табам возвращает в группу (`activateTab`/`closeTab`, закрытие «грязной»
    вкладки — `EditorService.onRequestConfirmClose(group, index)`); любой фокус
    в поддереве капчурится → `notifyGroupFocused` (клик мышью делает группу
    активной).
  - `Parts/Editor/DiffEditorPane2.ts` — живая дифф-вкладка (DiffEditable):
    **композиция двух настоящих редакторов** — стороны это `TextFileModel` +
    `EditorComponent` в `TextEditorPane` (file-сторона — общая модель из
    реестра, untitled — своя, git/clipboard/диск — снимок read-only); контейнер
    `DiffPaneElement` (строка подписей `HEAD │ a.ts` + колонки 50/50 +
    разделитель). Выравнивание — view zones, свёртка unchanged — обычный
    фолдинг с парным синком, подсветка — `IExternalDecorations`; раскладку
    считает `editor/common/diff/diffV2Layout`. Живой пересчёт — по
    `onDidChangeContent` моделей сторон (debounce 200) с переносом свёрнутости
    и якорем скролла; `getActiveEditor()`/`getActiveTabEditor()` отдают
    активную сторону (команды, статус-бар, find, Ctrl+S работают по ней);
    revert-чанка — `revertHunkAtCaret()` (команда «Diff: Revert Hunk»);
    dirty-контракт — `EditorService.needsCloseConfirm`/`collectDirty` считают
    стороны диффов. Снимочные стороны автоосвежает
    `contrib/diff/DiffSnapshotRefreshContribution` по `onDidChangeFile` (US-31).
    Узкая панель (порог 100 колонок элемента, гистерезис) или тумблер
    «Diff: Toggle Inline View» (персист `DIFF_VIEW_MODE_STATE`) переводят пару
    в **inline**: original скрыт, modified на всю ширину, удалённые строки —
    зоны-призраки (`computeInlineLayout`).
- **Find/Suggest-кластер (этап 10)** — поиск по файлу и автодополнение поверх
  активного редактора (`EditorService`):
  - `Components/Editor/FindComponent.ts` — `ThemedComponent`; **композиционный
    корень**, собранный из примитивов (`view` = `SizedBoxElement`(preferredWidth×3)
    → `BoxContainerElement` → `HFlexElement` со строкой запроса `InputElement`,
    счётчиком совпадений и кнопками ↑ ↓ ✕ `ButtonElement`; `view.id = "findWidget"`).
    Ручного рендера нет — рамку/фон/раскладку дают примитивы, цвета из темы через
    `getFindWidgetStyles` (`editorWidget.*` + счётчик `descriptionForeground` +
    «No results» `editorError.foreground`; кнопки из `getDialogButtonStyles`).
    Дерево строится ОДИН раз в конструкторе и мутируется на месте (`setCounter`/
    `setQuery` меняют только текст/цвет счётчика и его зазор) — строка запроса
    никогда не переподключается к дереву и не теряет фокус между нажатиями.
    Публичная поверхность для `FindService` — на самом компоненте
    (`getQuery`/`setQuery`/`setCounter`/`focus` + колбэки `onQueryChange`/`onNext`/
    `onPrev`/`onClose`), а не на `view`. Overlay-сессия — в ЛОКАЛЬНОМ слое группы
    редакторов (`pointerPolicy: "passthrough"` — док-виджет, клики мимо уходят в
    редактор); хост (`OverlayHostElement` группы) приходит через late-init шов `attachHost`
    (зовёт `WorkbenchComponent` после постройки дерева). `show()` позиционирует
    виджет (правый край группы с 1-колоночным отступом, под tab strip) и фокусирует input.
  - `Services/FindService.ts` — состояние поиска query → matches → current
    index: `open` (сеет запрос из однострочного выделения), `close` (курсор
    остаётся на текущем совпадении, подсветка снимается), `next`/`prev`
    (циклично), recompute по `onQueryChange` (стартовый индекс — первое
    совпадение от курсора); подсветка/reveal — `setSearchDecorations`/
    `revealRange` активного `EditorPane`. Смена активного редактора закрывает
    виджет (подписка на `onActiveEditorChanged` — find оперирует только
    активным редактором).
  - `Components/Editor/SuggestComponent.ts` — компонент suggest-попапа; владеет
    `CompletionListElement` (`view.id = "suggestWidget"`; НЕ `ThemedComponent` —
    контрол живёт на unthemed-палитре `unthemedCompletionListStyles`, маппинг
    на тему — отдельная задача) и overlay-сессией в глобальном body-слое
    (`attachHost(BodyElement)`; `capturesKeyboard: false` — редактор сохраняет
    фокус, команды идут по `suggestWidgetVisible`; `close-on-outside`).
    `openAt(anchor)`/`setAnchor` — позиционирование у каретки
    (`EditorPane.getCaretAnchor`).
  - `Services/CompletionService.ts` — логика автодополнения (WP8): `trigger()`
    (провайдеры расширений через `EditorService.completionSource` + word-based
    fallback `collectWordCompletions` из всех открытых редакторов), сессия
    попапа (живой `prefixRange`, re-filter по мере набора, авто-suggest по
    эвристике «вставлен 1 word-символ» с задержкой `autoSuggestDelayMs`),
    accept (замена префикса/провайдерского range с догоном каретки;
    `item.command` исполняется напрямую через `CommandRegistry.execute` в
    микротаске), делегаторы select*/accept/hide для команд, `onFocusChanged`
    (зовёт `WorkbenchContextKeys.handleFocusChange` при смене фокуса —
    клавиатурный уход с редактора закрывает попап).
- **Shell-кластер (этапы 11–12)** — корневой компонент, меню, layout, персист
  сессии и контекст-ключи:
  - `Components/Shell/WorkbenchComponent.ts` — **корневой компонент приложения**
    (финал этапа 12; бывший `AppController`): владеет корневой view
    (`BodyElement`, `view.id = "workbench"`, + `WorkbenchLayoutElement` с сэшами),
    вставляет в неё view компонентов (`EditorGroupComponent` в центр,
    `PanelComponent` вниз, `ExplorerComponent` в сайдбар при
    `setWorkspaceFolder`, `StatusBarComponent`, `MenuBarComponent` — ПОСЛЕ
    применения user keybindings), прикрепляет late-init швы
    (`DialogService`/`ExplorerComponent`/`QuickInputComponent`/`SuggestComponent`
    `attachHost(BodyElement)`, `FindComponent.attachHost(OverlayHostElement)`,
    `LayoutService.attachLayout`, `WorkbenchContextKeys.attachView`), вешает
    листенеры `KeybindingDispatcher` и фокус-хуки, регистрирует список
    `builtinActions` одним циклом. Фич-проводка (autoReveal, live-reload темы,
    контекст-меню редактора, команда `workbench.openFile`, статус-бар) вынесена в
    workbench-contribution'ы — корень лишь прогоняет их по фазам через реестр
    (`restored` — в `mount()`, `eventually` — из `main.ts` через
    `runEventuallyPhase()`; см. «Workbench-contributions»). Выход (`quitAction`)
    делегируется корню через шов `QuitHandlerDIToken` → `requestQuit`: confirm-save
    через `LifecycleService`, затем teardown TUI + `process.exit`. Наследник
    `ThemedComponent`: `updateStyles()` красит корень (fg/bg body) и hover-цвет
    сэшей. Единственный компонент с lifecycle за пределами конструктора — bootstrap
    ведёт `main.ts`: `setWorkspaceFolder` → `mount()` (contribution'ы фазы
    `restored` + листенеры + restore layout до первого кадра) → `run()` →
    `activate()` (контекст-ключи, probe терминала, активация редакторов/
    Explorer'а) → `openFile`/`restoreOpenEditors` → `focusEditor` →
    `runEventuallyPhase()`.
  - `Components/Shell/MenuBarComponent.ts` — `ThemedComponent`; владеет
    `MenuBarElement` (`view.id = "menuBar"`; стили — `getMenuStyles`), строит
    top-уровень из submenu-записей `MenuId.MenubarMainMenu`, а entries каждого
    меню резолвит лениво при открытии попапа через живые `IMenu`
    (см. раздел «MenuRegistry»); `view` вставляет владелец корневой view
    (`BodyElement.setMenuBar`).
  - `Services/LayoutService.ts` — логика workbench-layout'а: сайдбар
    (видимость/`toggleSidebar`/`nudgeSidebarWidth`/`resetSidebarWidth`) и
    нижняя панель (`isPanelVisible`/`setPanelVisible`; истина видимости — в
    `PanelService`, layout и контекст-ключ `panelVisible` следуют за
    `onDidChangeVisibility`). Персист layout'а поверх `IStateService`
    (`StateKeys.ts`): `restoreLayout()` до первого кадра (+ синхронизация истины
    в PanelService), write-through `captureLayout()` по
    `WorkbenchLayoutElement.onDidChangeLayout` (drag сэша и команды; во время
    restore глушится re-entrancy-guard'ом). Сам `WorkbenchLayoutElement` остаётся
    контролом у владельца корневой view (`WorkbenchComponent`) и приходит через
    late-init шов `attachLayout`.
  - `browser/parts/sidebar/sidebarService.ts` — реестр вьюлетов сайдбара и
    переключатель (activity bar'а нет, роль играют команды `workbench.view.*`;
    показ вьюлета — подмена контента сайдбара через `LayoutService`). Своих
    вьюлетов ему больше никто не приносит: единственный регистратор —
    `ViewsService` (см. ниже).
  - `browser/parts/views/` — **общая модель container↔view** (аналог
    ViewContainer/PaneView/ViewsService VS Code). Ей подчиняются ВСЕ панели с
    содержимым: Explorer, Search, Source Control в сайдбаре и Problems, Output,
    Terminal в нижней панели.

    **Дескрипторы (`viewsService.ts`).** Контейнер — «активити»:
    `{id, title, location: "sidebar" | "panel", order?}`. View — секция внутри
    него: `{id, containerId, title, order, body, placeholder?, focus,
    minBodyHeight?, canToggleVisibility?}`. `containerId` — реестровая связь, а
    не свойство контрола: перенос view между контейнерами ляжет сменой поля.
    `body === null` рисует `placeholder` (аналог `viewsWelcome`); тело и виджет
    заголовка меняются на месте (`setViewBody`/`setViewTitleWidget`), поэтому
    место держит одну и ту же ссылку на корень контейнера всю жизнь.

    **Merged выводится, а не объявляется.** Контейнер с ровно одной ВИДИМОЙ
    секцией сливает заголовки (как VS Code): в сайдбаре заголовка контейнера нет
    вовсе, а единственная секция несёт его название и не сворачивается; в панели
    у секции нет и своей строки заголовка — им служит таб
    (`IPaneOptions.headerVisible: false`). Скрыли предпоследнюю секцию —
    контейнер сам стал merged, вернули — заголовки разъехались.

    **Видимость секций** — `setViewVisible`/`isViewVisible`/`getContainerViews`;
    последнюю видимую скрыть нельзя. Персист (`workbench.views.state`,
    write-through по действию пользователя, restore строго после
    `openWorkspace`) хранит свёрнутость, веса и скрытость.

    **Раскрытость — опора ленивых view.** `isViewExpanded(viewId)` отвечает,
    видит ли пользователь тело секции (контейнер собран, секция не скрыта и не
    свёрнута; до `attachContainer` — `false`), `onDidChangeViewExpanded` шлёт
    переходы. Считает и диффит их сам `ViewsService`, а не `PaneViewElement`:
    тот пересоздаёт панели в `rebuildPanes` и молча игнорирует свёртку
    несворачиваемой (merged) секции, так что пер-панельное событие теряло бы
    переходы. Поэтому после каждого пути изменения (`rebuildPanes` — он же
    покрывает `attachContainer`, позднюю `registerView` и `setViewVisible`;
    `restoreViewsState`; пользовательский toggle через `onDidChangeState`)
    состояние пересчитывается целиком и сравнивается с прежним. Первый
    потребитель — GRAPH контейнера Source Control: пока секция не раскрыта, она
    не строит строк и через `ScmGraphService.setActive` просит git-расширение не
    запускать `git log` вовсе.

    **Прогресс — общий такт, а не таймер в элементе.** Занятость секции рисуется
    спиннером сразу после названия (`CHANGES ⠹`): полосы прогресса, как в
    VS Code, у нас быть не может — заголовок ровно одна строка, а лишняя дёргала
    бы layout секции. Кадры гонит `ProgressService` (`platform/progress`) —
    один тикер на приложение, живой только пока есть что крутить; элемент сам
    ничего не анимирует. Мост — `viewProgressContribution.ts` →
    `ViewsService.setViewSpinner`. Кадр живёт в записи view и переприменяется в
    `refreshContainerTitleActions`, иначе операция, начатая до пересборки секций,
    теряла бы индикацию; сам тик идёт коротким путём (`applySpinner`) и меню не
    резолвит — 10 Гц этого не стоят. Место выбрано так, чтобы ряд кнопок не
    дёргался: лишние колонки съедает филлер, а зоны `hitZone` считаются по
    разложенным ширинам.

    **Отрисовка заголовка — одна на всех:** `viewTitleRowElement.ts` (название +
    шеврон? + виджет + inline-кнопки + «⋯», плюс арифметика зон — хит-тест
    детей отключён, иначе не работает pointer capture у drag границы). На нём
    собраны `paneHeaderElement.ts` (заголовок секции: toggle, drag границы,
    Shift+F10) и `viewContainerHeaderElement.ts` (заголовок активити; в панели
    он же — полоса контролов в таб-строке, без названия).
    `paneViewElement.ts` — стопка секций: развёрнутые тела делят высоту по весам,
    граница таскается за заголовок нижней секции (паттерн `SashElement`).

    **Меню.** Одна точка на view — `MenuId.ViewTitle`: группа `navigation` с
    иконкой рисуется inline-кнопкой, остальное уходит в попап «⋯» и там не
    дублируется. У контейнера своя точка `MenuId.ViewContainerTitle`. Обе
    фильтруются императивно (`viewMenuVisible` / `containerMenuVisible` по
    `menuContext`) — глобальный when-ключ не годится: в сайдбаре видимы
    несколько секций сразу. Состав попапов собирает `ViewsService`:
    | Заголовок | «⋯» |
    | --- | --- |
    | секции (2+ видимых) | overflow этой view |
    | контейнера (2+ видимых) | его команды + подменю **Views** с чекбоксами видимости секций |
    | merged (одна видимая) | overflow view + подменю с названием контейнера (его команды + Views) |

    Пункты «Views» динамические, поэтому идут не контрибуцией, а собственным
    списком `MenuEntry` через `getEntries` делегата контекст-меню.

    Потребители: Explorer (одна секция), Search (одна), Source Control (две —
    CHANGES с контролами коммита `ScmInputComponent` в теле view и GRAPH),
    Problems / Output / Terminal (`location: "panel"`, по одной секции;
    переключатель каналов Output — `setViewTitleWidget`, он и уезжает в
    таб-строку). Редактор Output садится на фон панели через
    `TextEditorPane.backgroundToken` (`EditorComponent.backgroundToken` — имя
    токена темы, по умолчанию `editor.background`); свой фон заодно снимает
    тематический `editorGutter.background`, иначе гуттер остался бы полосой
    цвета редакторской группы.
  - `Services/WorkbenchStateService.ts` — персист открытых редакторов (headless):
    `openWorkspace` (per-project стор), `captureOpenEditors` (write-through —
    собственная подписка на `EditorService.onActiveEditorChanged`),
    `getOpenEditorsToRestore`/`restoreOpenEditors` (реплей выживших путей +
    активная вкладка). См. [State.md](State.md).
  - `Services/WorkbenchContextKeys.ts` — выставляет контекст-ключи
    (`ContextKeys.ts`) из фокуса и сервисов: `update()` читает активный элемент
    из FocusManager корневой view (шов `attachView`; ключи
    `textInputFocus`/`inputWidgetFocus`/`listFocus`/`terminalFocus` + передача
    активного `InputElement` в `InputWidgetService`), состояние сервисов
    (`editorGroupHasEditors`/`editorTabsMultiple`/`panelVisible`/
    `findWidgetVisible`/`suggestWidgetVisible`/`terminalIsOpen`) и терминальное
    окружение (tier/os/cap_*/mode_*; динамические `mode_<name>` регистрирует в
    конструкторе + подписка на `onDidChange`). Замыкает на себя хук
    `KeybindingDispatcher.updateContextKeys`; `handleFocusChange` (capture
    focus/blur листенеры вешает владелец дерева) сбрасывает незавершённый чорд и
    закрывает suggest-попап при уходе фокуса с редактора.
  - Экшены: `LayoutActions.ts` (toggle sidebar Ctrl+B, show explorer
    Ctrl+Shift+E, reveal active file, width-команды, toggle panel Ctrl+J,
    Problems Ctrl+Shift+M) и `TerminalActions.ts` (toggle Ctrl+` / new
    Ctrl+Shift+` на tier kitty/csi-u) — поверх LayoutService/PanelService/
    TerminalService/WorkbenchContextKeys.
- `Components/` — UI-компоненты: `StatusBar/` (пилот), `Dialogs/`, `Panel/`, `Explorer/`, `QuickInput/`, `Editor/` и `Shell/` (корневой `WorkbenchComponent` + меню-бар).

## Конвенции системы команд

- ID команд, отражающих VS Code Workbench/Editor, именуются в стиле VS Code
  (`workbench.action.closeActiveEditor`).
- Доступность кейбиндингов — через typed when-контексты из
  `Workbench/Services/ContextKeys.ts` (`ContextKeyService`); фокус/UI-состояния
  обновляет `WorkbenchContextKeys.update()`.
- Кейбинды адаптируются к терминалу по трём осям — **capability** / **tier**
  (`legacy < csi-u < kitty`) / **mode** (`local`/`ssh`/`tmux`) — доступны в
  when-клаузах (`tier == 'kitty'`, `cap_osc52`, `mode_ssh`, `os == 'mac'`).
  Default-бинды задают tier-зависимые fallback'и через per-binding `when`;
  пользовательские — через `keybindings.json` (VS Code-семантика `-command`
  для unbind).
- Tier определяется по env, но **под мультиплексором env-флаги хост-терминала
  (`KITTY_WINDOW_ID` и родня) не считаются доказательством**: расширенные клавиши
  доходят, только если их пропускает сам tmux (`extended-keys on`). Внутри tmux
  ждём подтверждения — probe `CSI ? u` или реально увиденный CSI-u ввод
  (`noteExtendedKeysObserved`). Иначе tier завышался, Ctrl+Shift+F приезжал
  неотличимым от Ctrl+F, а legacy-фоллбэки были выключены — то есть терялись
  и комбинация, и запасной путь.
- **Вторая часть аккорда — с модификатором, если команда переключает вкладку.**
  Парный `keypress` закреплён за целью своего `keydown`
  (`TuiApplication.pinnedKeypressTarget`), и когда команда меняет активную панель,
  эта цель уезжает из дерева: глобальный capture-обработчик `KeybindingDispatcher`
  до неё уже не достаёт и проглотить клавишу не может — голый символ печатается
  в документ, который команда только что покинула. Отсюда `Ctrl+K Ctrl+B` у
  `navigateBack`, а не `Ctrl+K -`. Баг движка — в трекере (docs/TODO/README.md).
- Экшены объявляются `CommandAction`/`registerAction` в `Workbench/Actions/`;
  упорядоченный список — `builtinActions.ts`, регистрирует `WorkbenchComponent`
  одним циклом. Порядок важен: резолвер берёт последний зарегистрированный
  биндинг с проходящим `when`.

## Разделение Service/Component / Element / State

Виджет со сколько-нибудь сложным поведением строится из трёх частей, а не из
«толстого» элемента:

- **Service/Component** (слой Workbench) — логика, I/O, подписки, оркестрация;
- **Element** (слой TUIDom) — тонкий: только render + локальные input-события;
- опц. **State-класс** — выделенное изменяемое состояние виджета.

Связь двунаправленная и без обратной зависимости TUIDom → Workbench:
`element.onX = …` (element → component) и `component.update(view)`
(component → element). Эталоны: `EditorGroupComponent` ↔ `EditorTabStripElement`,
`InputWidgetService` ↔ `InputElement` + `InputState`. «Контроллеры под видом
элемента» (напр. `MenuBarElement`, `ContextMenuLayer`) сводим к этому паттерну —
см. [../TODO/Inspector.md](../TODO/Inspector.md).

**Где живёт Element.** Элемент общего назначения (его публичный API не упоминает
понятий Diode) — в `@tuidom/elements`. Diode-специфичному элементу в tuidom не
место: либо он вовсе не существует — компонент является **композиционным корнем**
и собирает view из примитивов (`FindComponent`, `StatusBarComponent`,
`EditorGroupComponent`, диалоги), либо, если посимвольная раскладка оправдывает
ручной render (как у `EditorElement`), живёт рядом со своим компонентом в
`parts/*`.

Смешанный случай — `QuickPickElement` (`parts/quickinput/`): сам он собран из
примитивов (`InputElement`, `ListViewElement`, флексы, `PaddingContainerElement`)
и своего render'а не имеет, а ручной остался ровно на хроме, который композицией
не выражается, — рамка с врезанным в неё заголовком и сепаратором
(`QuickPickFrameElement`). Виджет приехал из движка, где по этому же критерию
лежать не должен был; остальные кандидаты на возврат —
[../TODO/EngineWidgetRepatriation.md](../TODO/EngineWidgetRepatriation.md).

Зависимости слоя: Workbench → { Editor, TUIDom, Theme, Configuration, Common,
интерфейс Backend }. Workbench — верхний слой ядра приложения; выше него только
Extensions (host-адаптеры) и App (`main.ts`).
