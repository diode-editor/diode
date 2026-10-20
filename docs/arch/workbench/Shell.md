# Корень, раскладка и части окна

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).

## Корневой компонент и старт

- `browser/workbenchComponent.ts` — **корневой компонент приложения**: владеет корневой view
  (`BodyElement`, `view.id = "workbench"`, + `WorkbenchLayoutElement` с сэшами),
  вставляет в неё view компонентов (`EditorGroupComponent` в центр,
  `PanelComponent` вниз, контейнеры view — в `mount()` через
  `ViewsService.attachRegisteredContainers()`, `StatusBarComponent`, `MenuBarComponent` — ПОСЛЕ
  применения user keybindings), первым делом прикрепляет корневую view
  (`LayoutService.attachRoot` — хост оверлеев фич), затем late-init швы
  (`DialogService`/`QuickInputComponent`/`TabSwitcherComponent`/`NotificationsComponent`
  `attachHost(BodyElement)`, `LayoutService.attachLayout`, `WorkbenchContextKeys.attachView`), вешает
  листенеры `KeybindingDispatcher` (клавишные — в конструкторе, ДО `MenuBarComponent`:
  мнемоники меню слушают тот же корень в bubble-фазе, а съеденную кейбиндом клавишу
  диспетчер гасит `stopImmediatePropagation` — кейбинд на Alt+буква сильнее мнемоники,
  как в VS Code; в не-латинской раскладке и мнемоника, и `alt+буква`/`ctrl+буква`
  матчатся по физической клавише `event.code` — `Alt+а` в русской = `Alt+F`, и в tmux
  тоже: движок выводит `code` из кириллицы ЙЦУКЕН) и фокус-хуки, регистрирует список
  `WORKBENCH_ACTIONS` одним циклом (получает его токеном `CommandActionsDIToken`). Фич-компоненты и их сервисы он не резолвит —
  их инстанцирует реестр contribution'ов в фазе `blockStartup` (в конструкторе
  корня); фич-проводка (autoReveal, live-reload темы, контекст-меню редактора,
  команда `workbench.openFile`, статус-бар) — те же contribution'ы по фазам
  `LifecycleService` (`ready` — в `mount()`, `eventually` — после кадра с подсветкой;
  см. [Contributions.md](Contributions.md)). Выхода в корне нет:
  `quitAction` и `reloadWindowAction` ведут прощание через `LifecycleService`
  (см. [«Жизненный цикл»](#жизненный-цикл)). Тему
  кладёт в корневой var-scope (`applyThemeVars` по `onThemeChange`) — единственная
  точка «тема → цвета», дальше каскад. Единственный компонент с lifecycle за пределами конструктора — стартовую
  последовательность ведёт `src/vs/diode/workbenchStartup.ts` (`startWorkbench`,
  юнит-тесты порядка и вех — рядом): keybindings расширений (после builtin) →
  `setWorkspaceFolder` (**только если папку назвали** — без неё поднимается пустое
  окно) → `mount()` (`attachRegisteredContainers()` + фаза `ready` с её
  contribution'ами + листенеры + restore layout до первого кадра) → `run()` →
  `activate()` (контекст-ключи, probe клавиатуры и XTVERSION, активация редакторов/Explorer'а) →
  прогрев грамматик стартовых файлов → `vscode.diff`/`openFile`(+`--goto`)/
  `restoreOpenEditors` → `focusEditor` → фаза `restored` → после первого кадра
  (текст) отпуск токенизаторов → после второго (подсветка) опрос tmux (`detectTmuxClient`: спаун `tmux`, ~20 мс синхронно), старт `ExtensionService`
  (регистрация и стартовая активация расширений — без ожидания) и фаза `eventually`. Что делается руками
  процесса (корень рендера, инспектор, прогрев, extension host), `main.ts` отдаёт
  хуками `IWorkbenchStartupHost`; вехи трассы старта — те же имена, что читает бенч.

  **Сайдбар не зависит от воркспейса.** `attachRegisteredContainers()` (из
  `mount()`) собирает ВСЕ зарегистрированные контейнеры — Explorer, Search,
  Source Control, Extensions, References в сайдбаре, Problems, Output, Terminal
  в панели — и показывает дефолтный (`isDefault`, Explorer). `setWorkspaceFolder` отвечает
  ровно за то, что зависит от папки: корень Explorer'а, cwd терминалов,
  per-project стор состояния, restore-вызовы view и индекс файлов. Поэтому окно
  без папки не слепое: Explorer рисует интерактивное пустое состояние
  (`IViewDescriptor.placeholder` блоками, аналог `viewsWelcome`) — текст «You
  have not yet opened a folder.» и кнопку `Open Folder`, которая зовёт обычную
  команду; Search и Source Control в этом состоянии погашены
  (`requiresWorkspaceFolder`) и тоже говорят, чего не хватает, а магазин
  расширений работает целиком — папка ему не нужна. Смена корня на живом
  приложении (после `mount()`) сама зовёт `explorerService.refresh()`: `setRootPath` лишь пересоздаёт провайдер, а
  `TreeViewElement` наполняется исключительно `refresh()` — на бутстрапе эту
  единственную загрузку делает `activate()`. Решение и его мотивы —
  [docs/TODO/Startup.md](../../TODO/Startup.md).

### Запуск без аргументов: пустое окно

`diode` без позиционных аргументов поднимает **пустое окно**: воркспейс не открывается (ни корня
Explorer, ни индекса файлов, ни вотчеров; расширения видят `workspace.workspaceFolders ===
undefined`), **текущий каталог не трогается вообще** — `cd ~ && diode` не должен уходить обходить
домашний каталог, вкладки прошлой сессии не восстанавливаются (сессия живёт у воркспейса). Сайдбар
собран, Explorer говорит «No folder opened.», магазин работает; выход — `workbench.action.files.openFolder`.
Регистрация вьюлетов поэтому расцеплена с `setWorkspaceFolder` (`registerViewContainers()` — из
`mount()`), а Open Folder на живом окне наполняет дерево через `refresh()`.

Почему не как у других:

| подход | кто так делает | почему не взяли |
| --- | --- | --- |
| восстановить последний воркспейс | vscode (`window.restoreWindows`), zed, jetbrains | в GUI-IDE это замена бессмысленной cwd; в терминале даёт «стою в одном проекте, открылся другой» |
| открыть cwd как папку (`code .`) | terminal-native | cwd бывает `~` или `/`, и запуск уходит в обход гигантского дерева |
| пустой scratch-буфер | vim, helix, emacs, micro, nano, kakoune | у них нет workspace folder, а у нас есть — буфер не решает, что делать с Explorer/Search/SCM |

Пустое окно ничего не угадывает; недавние папки, действия и справку принесёт welcome page
([TODO/Startup.md](../../TODO/Startup.md)).

## Жизненный цикл

Сервис — `services/lifecycle/browser/lifecycleService.ts`.
**Фазы старта** (`LifecyclePhase`: `starting` → `ready` → `restored` →
`eventually`, аналог vscode `LifecyclePhase`) растут монотонно: `setPhase`
проходит пропущенные промежуточные, откат — ошибка. `ready` двигает
`WorkbenchComponent.mount()`, остальные — `diode/workbenchStartup.ts`. Кто
стартует не сразу, ждёт фазу сам: `onDidChangePhase` — синхронно в момент
перехода (реестр contributions, фоновый прогрев грамматик), `when(phase)` —
промисом.

**Прощание** — в два шага, общих для выхода, перезагрузки окна и выхода по
команде инспектора:
1. **подтверждение** — `requestShutdown(onProceed)` последовательно спрашивает про
   «грязные» элементы участников через `DialogService.confirmSave` (Cancel прерывает
   прощание, как и Save, который не сохранил — untitled без пути; чистый выход —
   синхронно, до первого await). Шов — интерфейс
   `IShutdownParticipant` (`collectDirty(): IShutdownDirtyItem[]` — имя +
   `isStillDirty()` + `save()` с overwrite → `Promise<boolean>` «сохранилось»):
   Workbench объявляет, `EditorService`
   реализует структурно, регистрирует его `WorkbenchComponent`;
2. **прощание** — `shutdown(reason, then)` (аналог vscode `onWillShutdown`):
   асинхронная фаза `onWillShutdown` (участник отдаёт промис через
   `event.join(promise)`, общий тайм-аут `SHUTDOWN_JOIN_TIMEOUT_MS` = 2 с),
   затем синхронная `onShutdownSync` в порядке, обратном подписке, и только потом
   `then`. Повторный вызов присоединяется к первому прощанию; сбой участника не
   останавливает остальных.

Участники подписываются там, где создаются: extension host — в
`extensionHostModule` (вежливый `ExtensionHost.shutdown()` с `deactivate()`
расширений в асинхронной фазе, `disposeNow()` — SIGKILL недоушедшему — в
синхронной), watcher дерева — в `fileWatcherModule`, а созданное до DI (стор
состояния — `flushSync`, терминал — `teardown`, сокет инспектора) — владелец
процесса `main.ts`. Чем закончится прощание, решает шов `HostProcessDIToken`
(`services/lifecycle/common/hostProcess.ts`, `exit()` / `restart()`; биндит
`lifecycleModule` хуками из `main.ts`): `quitAction` → `exit`,
`reloadWindowAction` → `restart` — замена процесса новым с теми же аргументами
(`base/node/restartProcess.ts`). Первый reload превращает текущий процесс в
супервизор (`spawnSync` со `stdio: "inherit"`), дальнейшие делает уже он — так
терминал не отбирается у нового окна и процессы не копятся. Отсюда требование:
к `restart` все субпроцессы уже сняты — асинхронная фаза идёт до `spawnSync`,
пока event loop ещё крутится, а то, что не вышло за тайм-аут, добивается
сигналом в синхронной фазе (не убитый ребёнок пережил бы своё окно, watcher —
ещё и со всеми inotify-подписками). Нужна перезагрузка потому, что вклады
расширений сканируются один раз на старте: установленное из UI начинает работать
именно после неё. `process.on("exit")` в `main.ts` остаётся страховкой сброса
состояния для путей мимо прощания (SIGINT в терминальном backend'е).

## Строка меню

- `browser/menuBarComponent.ts` — `Component`; владеет
  `MenuBarElement` (`view.id = "menuBar"`; стили — `getMenuStyles`), строит
  top-уровень из submenu-записей `MenuId.MenubarMainMenu`, а entries каждого
  меню резолвит лениво при открытии попапа через живые `IMenu`
  (см. [Menus.md](Menus.md)); `view` вставляет владелец корневой view
  (`BodyElement.setMenuBar`).

## Layout и сайдбар

- `services/layout/browser/layoutService.ts` — логика workbench-layout'а: сайдбар
  (видимость/`toggleSidebar`/`nudgeSidebarWidth`/`resetSidebarWidth`) и
  нижняя панель (`isPanelVisible`/`setPanelVisible`; истина видимости — в
  `PanelService`, layout и контекст-ключ `panelVisible` следуют за
  `onDidChangeVisibility`). Персист layout'а поверх `IStateService`
  (`common/stateKeys.ts`): `restoreLayout()` до первого кадра (+ синхронизация истины
  в PanelService), write-through `captureLayout()` по
  `WorkbenchLayoutElement.onDidChangeLayout` (drag сэша и команды; во время
  restore глушится re-entrancy-guard'ом). Сам `WorkbenchLayoutElement` остаётся
  контролом у владельца корневой view (`WorkbenchComponent`) и приходит через
  late-init шов `attachLayout`.
- `browser/parts/sidebar/sidebarService.ts` — реестр вьюлетов сайдбара и
  переключатель (activity bar'а нет, роль играют команды `workbench.view.*`;
  показ вьюлета — подмена контента сайдбара через `LayoutService`). Своих
  вьюлетов ему больше никто не приносит: единственный регистратор —
  `ViewsService` ([Views.md](Views.md)).
- Экшены: `browser/actions/layoutActions.ts` (toggle sidebar Ctrl+B, show explorer
  Ctrl+Shift+E, reveal active file, width-команды, toggle panel Ctrl+J,
  Problems Ctrl+Shift+M) и `contrib/terminal/browser/terminalActions.ts` (toggle Ctrl+` / new
  Ctrl+Shift+` на tier kitty/csi-u) — поверх LayoutService/PanelService/
  TerminalService/WorkbenchContextKeys.

## Персист открытых редакторов

- `browser/workbenchStateService.ts` — персист открытых редакторов (headless):
  `openWorkspace` (per-project стор), `captureOpenEditors` (write-through —
  собственная подписка на `EditorService.onActiveEditorChanged`),
  `getOpenEditorsToRestore`/`restoreOpenEditors` (реплей выживших путей +
  активная вкладка). См. [State.md](../State.md).

## Статус-бар

- `services/statusbar/common/statusBarService.ts` — реестр записей статус-бара (аналог
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
- `browser/parts/statusbar/statusBarComponent.ts` — `Component`; **композиционный
  корень** из примитивов tuidom (`view` = `HFlexElement`, `view.id = "statusBar"`:
  краевые `FillerElement`-паддинги, лейблы сегментов `TextLabelElement`,
  fill-филлер в середине). Отдельных разделителей нет: каждый сегмент несёт по
  пробелу с краёв, поэтому соседей разделяют ровно две клетки, а блок подсветки
  накрывает сегмент с воздухом — как элемент статус-бара в VS Code. Дерево
  строится один раз и мутируется по `onDidChangeEntries`: при неизменном числе
  сегментов — только `setText` (путь курсора `Ln X, Col Y`), пересборка
  `replaceChildren` — лишь при смене состава; лейблы живут в пулах, клик резолвит
  запись по (стороне, индексу) в момент клика. Корень несёт токены
  `statusBar.foreground`/`statusBar.background` в `style` — дети наследуют цвета каскадом.
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
  `ready`, см. [Contributions.md](Contributions.md)): `browser/parts/editor/editorStatusContribution.ts`
  (правые, порядок VS Code: `Ln X, Col Y` · Indentation (`Spaces: N`/`Tab Size: N`)
  · Encoding · EOL · Language; Encoding/EOL кликабельны — команды
  `changeEncoding`/`changeEOL` через `CommandRegistry`; Indentation инертен —
  команд смены отступов пока нет) и
  `services/terminalEnvironment/node/terminalEnvStatusContribution.ts` (tier + моды).
  Активный редактор приходит через **интерфейсный шов**: Workbench объявляет
  `IActiveEditorStatusSource`/`IActiveEditorStatus` (минимальный срез:
  `onActiveEditorChanged`, курсор/отступы/encoding/EOL/язык), `EditorService`
  соответствует ему структурно; связывание — биндинг
  `ActiveEditorStatusSourceDIToken` в `src/vs/diode/modules/workbenchModule.ts`.
  Chord-хинт публикует `KeybindingDispatcher` как обычную запись сервиса.

## Нижняя панель

- `browser/parts/panel/panelService.ts` — таб-строка нижней Panel: набор вкладок, активная
  вкладка и **видимость** панели. Вкладки заводит только `ViewsService`
  (контейнер с `location: "panel"` = вкладка), фичи в этот реестр не ходят.
  События:
  `onDidChangeViews`, `onDidChangeActiveView`, `onDidActivateView`
  (пользовательская активация — клик по табу; программный `setActiveView` его
  **не** порождает — на нём висят ленивые фичи), `onDidChangeVisibility`
  (за ней следует `LayoutService`: двигает `WorkbenchLayoutElement`
  и контекст-ключ `panelVisible`).
- `browser/parts/panel/panelComponent.ts` — `Component`; владеет
  `PanelContainerElement` (`view.id = "panel"`, стили —
  `getPanelContainerStyles`), отражает реестр сервиса (вкладки/контент/актив)
  и возвращает клик по табу в `PanelService.activateView`. Виджет живёт рядом,
  в `parts/panel/panelContainerElement.ts` (приехал из `@tuidom/elements`), и
  сам видимостью панели не распоряжается: клик по кнопке `×` в хвосте
  таб-строки компонент переводит в команду `workbench.action.closePanel`
  (`CLOSE_PANEL_COMMAND_ID`) — ту же дверь, что у Ctrl+J и палитры.
  Кнопка старше таб-строки: на узкой панели рисуется поверх хвоста вкладок
  и в этих колонках срабатывает она (эталон в этом случае уводит вкладки в
  overflow). Глиф — `×`, как у `EditorTabItemElement`, а **не codicon**:
  PUA-глифы codicon'ов в текстовом дампе кадра неотличимы, сценарий не
  проверил бы кнопку; хит-бокс — `inspectState().close`.
- **Общая основа частей с таб-строкой** (у эталона — `AbstractPaneCompositePart`
  под `PanelPart` и `AuxiliaryBarPart`): реестр вкладок + видимость —
  `parts/paneCompositePartService.ts`, компонент — `paneCompositePartComponent.ts`,
  возврат фокуса в редактор при уходе контента со сцены —
  `paneCompositeFocusContribution.ts`. `PanelService`/`PanelComponent`/
  `PanelFocusContribution` — их наследники ради своих DI-токенов. Вид части
  задают опции `PanelContainerElement` (`IPanelContainerOptions`: токены фона и
  текста, полоса `panel.border`, отступ контента, подсказка пустой части).

Обитатели панели:

- `contrib/markers/browser/problemsComponent.ts` — `Component`; дерево
  «файл → маркеры» (`TreeViewElement` поверх `ProblemsTreeDataProvider`,
  `view` = `ScrollBarDecorator`, `view.id = "problemsView"`; стили —
  `getProblemsTreeStyles` + `getScrollBarStyles`). Регистрирует контейнер и
  view PROBLEMS (`PROBLEMS_VIEW_ID`, `location: "panel"`); пока маркеров нет —
  тело view `null` и секция рисует placeholder. Reveal маркера — через **интерфейсный шов**
  `IMarkerRevealTarget` (`openUri` + `getActiveEditor` с
  `goToPosition`/`revealRange`); `EditorService` соответствует
  структурно, биндинг `MarkerRevealTargetDIToken` — в `src/vs/diode/modules/workbenchModule.ts`.
  Большие наборы (jdtls на монорепе — ~24k маркеров по ~1.7k файлам вешали UI-поток на минуты):
  изменения сводятся в окно 64 мс (как `MarkersView` эталона), пересчёт — не больше одного за раз,
  файлы раскрываются одним `TreeViewElement.expandElements`.
- `contrib/terminal/browser/terminalService.ts` — headless-оркестратор терминала:
  инстансы (id/title/session), lazy spawn через `TerminalSessionFactory`,
  регистрация контейнера/view TERMINAL (`TERMINAL_VIEW_ID`, `location: "panel"`
  по умолчанию; вид переносимый) + подписка на его активацию
  (`ViewsService.onDidActivateView` — в любой части, куда вид перенесли),
  чистка PTY при выходе шелла/dispose. События:
  `onDidOpenInstance`/`onDidCloseInstance`/`onDidChangeActiveInstance`/
  `onDidRequestFocus`.
- `contrib/terminal/browser/terminalPanelComponent.ts` — view-владелец терминала:
  строит `TerminalViewElement` по каждому инстансу, вкидывает виджет
  активного в TERMINAL-вкладку (через `ViewsService.setViewBody`), красит
  виджеты (`getTerminalViewStyles`). **Не** наследник `Component`: корневого
  контрола нет — его UI это несколько виджетов. ВАЖНО: у `TUIElement` нет
  unmount-хуков, поэтому компонент **обязан** сам dispose'ить виджеты — при
  закрытии инстанса и при своём `dispose()`.
- `contrib/terminal/browser/terminalEditorService.ts` — терминалы вкладками
  в области редакторов (`TerminalLocation.Editor`): инстанс `target: "editor"`
  плюс вкладка `TerminalEditorPane` (`vscode-terminal:/<id>`), колонка —
  `columnToEditorGroup` (`services/editor/common/editorGroupColumn.ts`, общий
  с `showTextDocument`). Устройство — [Terminal.md](Terminal.md),
  «Терминал в области редакторов».
- `contrib/markers/browser/diagnosticsService.ts` — headless-проводник диагностик
  поверх `MarkerService`: поставщик — валидатор активного settings.json,
  потребитель — editor squiggles (Problems — второй потребитель того же
  реестра). Редакторы приходят через шов `IDiagnosticsEditorSource` /
  `IDiagnosticsEditor` (`EditorService`/`TextEditorPane`
  структурно; биндинг `DiagnosticsEditorSourceDIToken` — в `workbenchModule.ts`).

## Вторичная боковая панель

Secondary Side Bar (`browser/parts/auxiliarybar/`) — правая колонка `WorkbenchLayoutElement` во всю высоту (выравнивание панели
`center`: нижняя панель — только под редактором). Контейнеры с
`location: "auxiliarybar"` живут в ней вкладками, как в нижней панели: у
эталона при `workbench.activityBar.location=default` то же самое.

- `auxiliaryBarService.ts` — реестр вкладок и видимость (истина видимости;
  `LayoutService` двигает layout и ключ `auxiliaryBarVisible`).
- `auxiliaryBarComponent.ts` — `view.id = "auxiliarybar"`, в одежде сайдбара:
  фон/текст `sideBar.*` (своих токенов у эталона нет), без полосы
  `panel.border`, первая колонка — под саш (у эталона там `sideBar.border`).
  Контрибьютор ключей `auxiliaryBarFocus` и `activeAuxiliary`.
- `auxiliaryBarActions.ts` — `workbench.action.toggleAuxiliaryBar`
  (Ctrl+Alt+B), `closeAuxiliaryBar` (кнопка `×`), `focusAuxiliaryBar`,
  `previous/nextAuxiliaryBarView`. Показ отдаёт фокус активному контейнеру,
  как `setAuxiliaryBarHidden(false)` эталона.
- Не хватает ширины — первой ужимается вторичная панель (`LayoutPriority.Low`
  эталона), затем сайдбар; редактор держит 20 колонок. Ширина по умолчанию —
  динамическая: как у сайдбара (30), но не шире четверти окна; ресайз — саш
  и `workbench.action.increaseViewSize`/`decreaseViewSize` (часть с фокусом,
  `LayoutService.resizeFocusedPart`).
- Видимость на старте — `workbench.secondarySideBar.defaultVisibility` для
  впервые открытого воркспейса, дальше — сохранённая
  (`workbench.auxiliaryBar.hidden`); часть без единого контейнера не
  показывается вовсе. Ключи состояния — [State.md](../State.md).
- Не поддержано (отступления названы): развёртывание (`maximize/restore`,
  значения `maximized*` настройки значат «видима»),
  `workbench.sideBar.location`, `secondarySideBar.showLabels`/`forceMaximized`,
  drag & drop видов.
