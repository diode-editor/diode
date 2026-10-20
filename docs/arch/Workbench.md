# Workbench

Часть архитектуры Diode — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).

Прикладной слой приложения (`src/vs/workbench/`). Здесь живут **сервисы** (логика приложения)
и **компоненты** (UI-сборка поверх контролов TUIDom) — как в VS Code (services + Part/ViewPane),
а также встроенные экшены (`browser/actions/`, экшены фич — в `contrib/<f>/browser/`).
DI-модули и профили — `src/vs/diode/modules/` (см. [../DI.md](../DI.md)).

Здесь — модель слоя и каноны (пара Service ↔ Component, состав фичи, Element/State).
Устройство отдельных частей — в подфайлах `workbench/`:

| Файл | О чём |
|---|---|
| [Contributions.md](workbench/Contributions.md) | workbench-contributions и их фазы, узлы конфигурации фич |
| [Commands.md](workbench/Commands.md) | конвенции системы команд, кейбинды и их досягаемость, when-вычислитель, контекст-ключи, клавиатурный диспатч, где живут экшены |
| [Menus.md](workbench/Menus.md) | `MenuRegistry`/`MenuService`, точки меню, пункты расширений, `enablement` |
| [Shell.md](workbench/Shell.md) | корневой компонент и последовательность старта, жизненный цикл, layout, строка меню, статус-бар, нижняя и вторичная боковая панели |
| [Views.md](workbench/Views.md) | модель container↔view (`ViewsService`), расположение видов, общие контролы списков |
| [EditorPart.md](workbench/EditorPart.md) | модели буферов, вкладки, группы редакторов, `EditorService`, дифф-вкладка, история навигации |
| [EditorWidgets.md](workbench/EditorWidgets.md) | попапы и виджеты над редактором: find, suggest |
| [QuickInput.md](workbench/QuickInput.md) | общий виджет квик-инпута, Quick Open и его провайдеры, разбор запроса |
| [Explorer.md](workbench/Explorer.md) | дерево файлов, файловые операции, bulk edit |
| [Notifications.md](workbench/Notifications.md) | тосты и вопросы, внешние ссылки, диалоги |
| [ExtensionsView.md](workbench/ExtensionsView.md) | магазин расширений в UI |
| [KeybindingsEditor.md](workbench/KeybindingsEditor.md) | редактор Keyboard Shortcuts и user-слой биндингов |
| [Tasks.md](workbench/Tasks.md) | задачи (`contrib/tasks`) |
| [Terminal.md](workbench/Terminal.md) | встроенный терминал: PTY + эмулятор, упаковка node-pty, вкладки, терминал в редакторе, цвета |
| [SourceControl.md](workbench/SourceControl.md) | Source Control: мосты к расширению git, группы ресурсов, граф коммитов |

## Модель Service ↔ Component

- **Service** — логика приложения: состояние, I/O, индексы, подписки на нижние слои.
- **Component** — UI-сборка: владеет корневым контролом (`view`) и собирает под ним
  дерево примитивов TUIDom.

**Правило-инвариант:** есть `view` → Component (`src/vs/workbench/browser/component.ts`);
нет `view` → Service.

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

Правила «сервис ничего не знает про view» **нет** — его нет и в VS Code: там сервис
часто сам и есть view-часть (`EditorParts implements IEditorGroupsService`,
`Layout implements IWorkbenchLayoutService`) или владелец виджета
(`QuickInputService` → `QuickInputController`, `HoverService` → `HoverWidget`).
Развязка идёт через **интерфейс сервиса** (контракт в `common/`, потребители знают
контракт, а не реализацию), а не через направление владения. Кто кого знает, задаёт
одна из трёх узаконенных форм пары.

### Три формы пары

| Форма | Кто кого инжектит | Наш эталон | Прообраз в VS Code |
|---|---|---|---|
| **Part/View над сервисом** | компонент ← сервис | `StatusBarComponent` ← `StatusBarService` | Part / ViewPane над сервисом |
| **Владелец виджета** (попапы, editor-контрибуции) | сервис/контроллер ← `*ComponentDIToken` | `HoverService` → `HoverComponent` | `FindController` → `FindWidget`, `QuickInputService` → `QuickInputController` |
| **Сервис-владелец layout-контрола** | сервис получает контрол late-init | `LayoutService.attachLayout(WorkbenchLayoutElement)` | `Layout implements IWorkbenchLayoutService` |

1. **Part/View над сервисом.** Компонент берёт сервисы в конструктор, подписан на их
   события и возвращает действия пользователя вызовами сервиса. Сервис про компонент
   не знает. Так устроены части и вьюлеты: статус-бар, панель, строка меню, область
   редактора, Explorer, Search, Problems, SCM, Extensions, нотификации
   (`NotificationsComponent` ← `NotificationService`: модель показов + view-подписчик,
   как `NotificationsCenter(notificationService.model)` у VS Code).
2. **Владелец виджета.** Сервис или контроллер инжектит `*ComponentDIToken` и
   командует виджетом: на каждом показе заполняет его, открывает и закрывает. Компонент-
   виджет держит контрол и overlay-сессию, объявляет `static dependencies = []` и
   сервисов не знает — его зависимость только хост. Так устроены все попапы:
   `QuickInputService`/`QuickOpenService` → `QuickInputComponent`, `HoverService` →
   `HoverComponent`, `ParameterHintsService` → `ParameterHintsComponent`, `FindService` →
   `FindComponent`, `CompletionService` → `SuggestComponent`, `ReferencesService` →
   `ReferencesComponent`. Отличие от VS Code: там владелец **сам создаёт** виджет (лениво,
   с хостом из `layoutService`/редактора), а у нас виджет — DI-синглтон. Хост contrib-
   оверлеи берут так же, как там: `LayoutService.mainContainer` (корневая view;
   корень прикрепляет её `attachRoot` первым делом в конструкторе, до резолва фич),
   сессию создают в своём конструкторе (suggest, hover, parameterHints) или лениво
   при первом показе (рекордер, Keyboard Doctor); find берёт слои групп у
   `EditorPartComponent` через DI. Оверлеи `browser/parts` и `DialogService` пока на
   `attachHost` от корня. Целевой каркас попапов («владелец создаёт виджет сам») —
   задача H1.
3. **Сервис-владелец layout-контрола.** `LayoutService` держит `WorkbenchLayoutElement`
   через `attachLayout` и пишет в него сеттерами (`restoreLayout`/`captureLayout`).
   Это ближе всего к VS Code, где layout-сервис и есть корневой view.

### Что сервису можно знать про view

- **Можно:** импортировать view-типы ради типов и `instanceof` (`EditorService` знает
  `DiffEditorPane2`; upstream `EditorService` так же импортирует из
  `browser/parts/editor`), инжектить компонент-виджет в форме «владелец виджета».
- **Известное отклонение:** сервис **конструирует** view. `TextEditorPaneBuilder`
  (`services/editor/browser/textEditorPaneBuilder.ts`, DI) собирает
  `EditorComponent`/`TextEditorPane` поверх модели, а `DialogService` — диалоги и их
  overlay-сессии. В VS Code панели создаёт группа по дескриптору из реестра
  (`EditorPanes.doInstantiateEditorPane`), а диалоги — пара `DialogsModel` в сервисе +
  подписчик `DialogHandlerContribution`. Перенос создания панелей — задачи E1/E2;
  новый код этот приём не повторяет.

### Обратная связь view → сервис

Новая обратная связь — **событием сервиса** или **интерфейсом-портом** в конструкторе,
а не публичным необязательным полем-хуком: `?:`-хук молча становится no-op там, где
его никто не поставил (headless-тесты, профиль без корня). Существующие хуки — долг с
адресом задачи:

| Хук | Кто ставит | Куда уходит |
|---|---|---|
| `EditorGroupsService.canAddGroupHook`, `focusGroupContentHook` | `EditorPartComponent` | E5 (порт view-части полосы вместо полей-хуков) |
| `EditorService.onOpenFailed` | `OpenFailureNotificationContribution` | C1 (перевод `?:`-хуков на `Emitter`) |

### Late-init `attach*`

`attach*` допустим только для того, что физически появляется позже конструктора:
хост корневой view (`LayoutService.attachRoot`; `attachHost(BodyElement)` у
оверлеев `browser/parts` и `DialogService`), `attachLayout`, `attachEditorLayout`, `WorkbenchContextKeys.attachView`) и деревья,
которые компонент строит по событию (`ExplorerService.attachView`). Сейчас эти вызовы
собраны в `WorkbenchComponent.mount`-проводке, и каждый новый попап добавляет туда
строку; уход от этого (владелец берёт хост из layout-сервиса) — задачи H1/E4.

### Контракт Component

```ts
export abstract class Component extends Disposable {
    public abstract readonly view: TUIElement;
}
```

- Компонент **владеет** корневым контролом (`view`), но в жизненный цикл контролов не
  встраивается — только размещает их (как DOM-узлы) и не наследует `TUIElement`.
- Темизационной базы у компонентов нет. Цвета компонент задаёт **именами токенов**
  темы в `style`/`setStyleVars` своих контролов один раз при создании; палитру активной
  темы кладёт в корневой var-scope `WorkbenchComponent` (`applyThemeVars`), hot-swap темы
  расходится каскадом — подписок на смену темы в компонентах нет. Детали —
  [Theme.md](Theme.md) и [STYLES.md (tuidom)](https://github.com/tuidom/tuidom/blob/main/docs/STYLES.md).

### Идентичность в дереве

Компонент вешает `view.id` на свой корневой контрол — это DOM-идентичность для тестов и
Inspector'а (поиск по дереву, скриншот-демо). Контролы своих id не придумывают.

## Правила коммуникации

- **component → control**: вызовы методов контрола, цвета — имена токенов в `style`.
- **control → component**: колбэки `onX` (контрол не знает получателя).
- **component ↔ service**: конструкторная инъекция + подписки на события сервиса;
  направление — по форме пары (см. выше).
- **component ↔ component**: напрямую **запрещено** — только через общий сервис.

## Чек-лист новой пары Service ↔ Component

1. Выбери форму пары (см. «Три формы пары»): часть/вьюлет — компонент над сервисом;
   попап — сервис-владелец виджета.
2. Раскладка: сервис области — `src/vs/workbench/services/<area>/` (контракт в
   `common/`, реализация в `browser/`/`node/`), фича — `src/vs/workbench/contrib/<feature>/browser/`,
   часть окна — `src/vs/workbench/browser/parts/<part>/`. Компонент наследует `Component`.
   Что ещё фича обязана держать в своей папке — [«Состав фичи»](#состав-фичи).
3. Цвета — имена токенов темы в `style`/`setStyleVars`; новый цвет — определение в
   `src/vs/platform/theme/common/colors/` (см. [Theme.md](Theme.md)).
4. Wiring — в конструктор компонента, async-часть — в сервис (`IActivatable`);
   обратная связь view → сервис — событием или портом, не `?:`-хуком.
5. DI-токен — `*DIToken` рядом с классом; биндинг — в DI-модуле слоя (см. [../DI.md](../DI.md)).
6. `view.id` — на корневой контрол компонента; тесты живут рядом с кодом.

## Состав фичи

**Фича** — папка `src/vs/workbench/contrib/<feature>/` с подпапками по оси окружения:
`common/` — данные и объявления без node и UI, `browser/` — UI и команды, `node/` —
процессы и FS. Набор файлов в фиче выбирается **по нужде, а не по шаблону**: у
gotoDefinition нет компонента, у search нет своего сервиса, у scm есть
contribution'ы. Так же устроено и в VS Code. Обязательно одно правило: **всё, что
фича регистрирует в приложении, объявлено в её папке**, а центр знает фичу одной
строкой в агрегаторе `src/vs/workbench/workbench.common.main.ts`.

Прообраз в VS Code — точка сборки `<feature>.contribution.ts` внутри папки фичи
(`search.contribution.ts`, `scm.contribution.ts`, `markers.contribution.ts`). Она
регистрирует сервисы, вью, команды, конфигурацию и contribution'ы, а
`workbench.common.main.ts` подключает фичу строкой импорта. Механизм мы не
повторяем: вместо import-side-effect и `Registry.as` фича делает **явный экспорт**, а
агрегатор собирает экспорты в **явные массивы** (см.
[VscodeStructureFollowUps.md](../TODO/VscodeStructureFollowUps.md), раздел «Механика»).

| Элемент | Где | Имя | Когда нужен |
|---|---|---|---|
| Сервис | `browser/<f>Service.ts`; если сервисом пользуются несколько фич — `services/<area>/` | `XxxService` и рядом `XxxServiceDIToken` | у фичи есть состояние или логика без view |
| Компонент | `browser/<f>Component.ts` | `XxxComponent` и `XxxComponentDIToken` | у фичи есть `view`; форма пары — одна из [трёх](#три-формы-пары) |
| Команды | `browser/<f>Actions.ts`, можно несколько файлов | фича экспортирует **один** массив `<FEATURE>_ACTIONS: readonly CommandAction[]` | статические команды. Динамические и сервисные команды — `commands.register` в сервисе или contribution |
| Контекст-ключи: объявление | `common/<f>ContextKeys.ts` | константы `RawContextKey<T>` | у фичи есть свои ключи |
| Контекст-ключи: значение | сервис или компонент — владелец состояния | `implements IContextKeyContributor` (pull) либо `set` в точке перехода (push) | там же |
| Ключи состояния | `common/<f>StateKeys.ts` или локальная константа у владельца | `XXX_STATE: IStateDescriptor<T>` | фича сохраняет UI-состояние между сессиями ([State.md](State.md)) |
| Contribution | `browser/<x>Contribution.ts` | `implements IWorkbenchContribution`, запись `{ ctor, phase }` | фоновый работник без view и API: подписки, сегмент статус-бара, мост между сервисами |
| Контейнер вью | регистрирует компонент-владелец | `IViewContainerDescriptor` с `order` (и `isDefault` у дефолтного вьюлета); строит `ViewsService.attachRegisteredContainers()` из `mount()` | у фичи есть вьюлет или вкладка панели |
| Конфигурация | `common/<f>Configuration.ts` | `xxxConfiguration: IConfigurationNode`, чистые данные | у фичи свои ключи настроек. Секции `editor.*` и `workbench.*` — центральные, как `editorOptions.ts` в VS Code |
| DI-биндинги | сейчас — блок фичи в `src/vs/diode/modules/workbenchModule.ts` | — | у фичи есть классы под DI |
| Цвета | центрально, `src/vs/platform/theme/common/colors/` | — | всегда центрально: из общего массива `COLOR_CONTRIBUTIONS` выводится тип `WorkbenchColorKey` ([Theme.md](Theme.md)) |

**Запреты:**
- центральные файлы (`workbench/{browser,common,services,api}`) не импортируют
  `contrib/`. Направление проверяет `scripts/check-layers.mjs`, а признанные
  исключения собраны в храповик, который только убывает;
- компонент не обращается к чужому компоненту напрямую;
- фича не импортирует внутренности соседней фичи — только её сервис, DI-токен и
  экспорты из `common/`. Циклов между фичами нет;
- фича не добавляет свои команды, ключи и состояние в центральные реестры
  (`contextKeys.ts`, `stateKeys.ts`); экшены фичи разворачивает агрегатор.

**Агрегатор** `workbench.common.main.ts` — единственный файл workbench, которому
разрешено импортировать `contrib/`. Он разворачивает массивы фич в
`WORKBENCH_ACTIONS`, `MENU_CONTRIBUTIONS`, `WORKBENCH_CONTRIBUTIONS`,
`CONFIGURATION_CONTRIBUTIONS` и подключает контрибьюторов контекст-ключей.

Отдельного линта «у фичи обязаны быть файлы X, Y, Z» нет и не будет: формы фич законно
разные. Канон держит правило направления. Когда исключение для центрального файла
снято, вернуть регистрацию фичи в центр уже нельзя.

Где канон ещё не выполнен (центральные файлы с регистрациями фич и задачи, которые их
разносят) — [VscodeStructureFollowUps.md](../TODO/VscodeStructureFollowUps.md#где-канон-состав-фичи-ещё-не-выполнен).

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

Ручной render оправдан и у `PanelContainerElement` (`parts/panel/`): его таб-строка
— посимвольная раскладка с подчёркиванием ровно под глифами названия и кнопкой
закрытия в хвосте той же строки. Виджет тоже приехал из движка, где по этому
критерию лежать не должен был (`PanelView` с welcome-состоянием и контролами
вкладки — понятия VS Code).

Смешанный случай — `QuickPickElement` (`parts/quickinput/`): сам он собран из
примитивов (`InputElement`, `ListViewElement`, флексы, `PaddingContainerElement`)
и своего render'а не имеет, а ручной остался ровно на хроме, который композицией
не выражается, — рамка с врезанным в неё заголовком и сепаратором
(`QuickPickFrameElement`). Виджет приехал из движка, где по этому же критерию
лежать не должен был; остальные кандидаты на возврат —
[../TODO/EngineWidgetRepatriation.md](../TODO/EngineWidgetRepatriation.md).

**Что уже есть в движке — до того как писать своё.** Перенос по словам —
`wrapText` из `@tuidom/elements/completionlist/completionDetailsElement`
(им пользуются тосты, диалоги, hover, parameter hints, welcome-вьюхи; режет
по пробелам, поэтому отступ перенесённого хвоста не сохраняется).
`HFlexElement` допускает **не больше одного** `fill`-ребёнка (второй —
исключение `HFlexElement supports at most one fill child`): центрировать ряд
двумя филлерами нельзя, ширину кнопок бери у `getMaxIntrinsicWidth`, а не по
длине подписи. `TreeViewElement` наполняется только `refresh()` (см.
[Shell.md](workbench/Shell.md#корневой-компонент-и-старт)).

Зависимости слоя: Workbench → { Editor, TUIDom, Theme, Configuration, Common,
интерфейс Backend }. Workbench — верхний слой ядра приложения; выше него только
Extensions (host-адаптеры) и App (`main.ts`).
