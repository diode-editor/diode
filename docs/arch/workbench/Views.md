# Модель container↔view (`browser/parts/views/`)

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).

Общая модель container↔view (аналог
ViewContainer/PaneView/ViewsService VS Code). Ей подчиняются ВСЕ панели с
содержимым: Explorer, Search, Source Control в сайдбаре и Problems, Output,
Terminal в нижней панели.

**Дескрипторы (`viewsService.ts`).** Контейнер — «активити»:
`{id, title, label?, location: "sidebar" | "panel" | "auxiliarybar", order?,
isDefault?, rejectAddedViews?}` (`label` — название в авторском регистре для
переключателя, у встроенных его нет). Контейнер
регистрирует фича-владелец в своём конструкторе (как `registerViewContainer`
VS Code), строит их все `attachRegisteredContainers()` из `mount()` — по
`order`, а не по порядку резолва компонентов: Explorer 0 (`isDefault`),
Search 1, Source Control 2 (регистрирует `ChangesComponent`), Extensions 3,
References 4; в панели PROBLEMS 0, OUTPUT 1, TERMINAL 2 — это порядок вкладок,
первая активна. Поздний `attachContainer` вставляет вкладку в позицию по
`order`; контейнер без `order` встаёт после упорядоченных. View — секция внутри
него: `{id, containerId, title, order, body, placeholder?, focus,
minBodyHeight?, canToggleVisibility?, collapsed?,
requiresWorkspaceFolder?, canMoveView?}`. `containerId` —
реестровая связь, а не свойство контрола: перенос view между контейнерами —
смена поля записи (см. «Расположение видов» ниже). `collapsed` (как у `IViewDescriptor` VS Code) — ТОЛЬКО
начальное состояние секции; сохранённый выбор пользователя его перебивает
(см. персист ниже). С `canToggleVisibility` не путать: тот про «можно ли
секцию скрыть».
`body === null` рисует `placeholder` (аналог `viewsWelcome`); тело и виджет
заголовка меняются на месте (`setViewBody`/`setViewTitleWidget`), поэтому
место держит одну и ту же ссылку на корень контейнера всю жизнь.
`unregisterView` снимает вид, где бы он ни стоял (вид расширения, чей `when`
стал ложным); опустевший контейнер уходит с места, сохранённое состояние
секции остаётся до повторной регистрации. `focusViewHeader` — фокус для вида
без своего тела: на заголовок его секции.

**Расположение видов** (аналог `IViewDescriptorService` эталона — у нас
в том же `ViewsService`, где реестр). Место контейнера — поле записи
(`location`), дескриптор хранит место по умолчанию; контейнер вида —
`record.containerId` при `defaultContainerId` из дескриптора. API с именами
эталона: `moveViewToLocation` (новый контейнер
`workbench.views.service.<место>.<uuid>` — «New … Entry»),
`moveViewsToContainer`, `moveViewContainerToLocation`,
`getViewContainerLocation`/`getDefaultViewContainerLocation`,
`getViewContainerByViewId`/`getDefaultContainerById`, `resetViewLocation`,
`resetViewContainerLocation`, `resetViewLocations`, событие
`onDidChangeLocations`; показ на текущем месте — `openView`/
`openViewContainer` (вкладку части активирует как пользователь — ленивые
фичи просыпаются).
- Переносятся только виды с `canMoveView: true` (Explorer, Search, SCM,
  Problems, Output, Terminal); контейнер с `rejectAddedViews` (Extensions)
  чужие виды не принимает.
- Перенос не пересоздаёт тела: контейнер снимается с прежнего места
  (`removeView` части / `unregisterViewlet` сайдбара, секции разбираются)
  и собирается на новом, тела переезжают теми же объектами — живой
  терминал остаётся живым. Контейнер без видов места не занимает,
  сгенерированный без видов исчезает вместе со своей записью
  `workbench.views.state`; уехал активный вьюлет — сайдбар показывает
  дефолтный (или первый).
- Сгенерированный контейнер носит название первого своего вида (у эталона
  заглушка «User View Container» не видна: контейнер сливается с видом).
  Контейнер на чужом месте встаёт в конец таб-строки, как у эталона.
- Персист — `views.customizations` (только отличия от дефолта),
  применяется в `attachRegisteredContainers` до сборки, поздний вид встаёт
  по нему сам; Open Folder переприменяет переносы из стора проекта.
  См. [State.md](../State.md).
- Меню: «Move To ▸ Primary Side Bar / Secondary Side Bar / Panel» и «Reset
  Location» — контекстное меню вкладки части (правый клик, Shift+F10;
  `PanelContainerElement.onTabContextMenu` → `requestTabContextMenu`
  реестра части), у вьюлета сайдбара — в «⋯» заголовка (отступление:
  эталон держит это меню на иконке activity bar, а наш переключатель
  контейнеров — выпадающий список, у его пунктов контекстного меню нет).
- **Фичи не знают, где стоит их вид.** Показ, скрытие и «на экране ли»
  — словарь `ViewsService`, а не `PanelService`/`LayoutService`:
  `openView(id, focus, activate)` (`activate: false` — показ без
  пробуждения ленивых фич, как прежний `setActiveView`), `closeView` (прячет
  часть, если вид в ней активен), `isViewShown`; события
  `onDidActivateView` (пользовательская активация — спавн шелла) и
  `onDidShowView` (вид стал активным, в том числе на ресторе — ленивый
  редактор Output). Так устроены Terminal (команды, задачи, терминалы
  расширений, `hideOnLastClosed`), Output и Problems — их переключатели
  прячут ту часть, где стоит вид.
- `focusedView` — `ViewsService` как контрибьютор ключей; фокус в оверлее
  (палитра, попап) и промежуточный `null` ключ не сбрасывают — иначе
  «Move Focused View» из палитры гас бы. Команды —
  `browser/actions/viewLocationActions.ts`: `moveView`, `moveFocusedView`,
  `resetViewLocations`, `resetFocusedViewLocation`,
  `movePanelToSecondarySideBar`/`moveSecondarySideBarToPanel`; подписи
  разделителей выбора эталона («Side Bar / …») стоят справа у пункта —
  разделителей в нашем выборе нет.

**Пустое состояние — строка или блоки.** `placeholder: string` рисуется
плоской подсказкой (`No problems have been detected.`, `No output yet.`);
`placeholder: IViewWelcomeBlock[]` — интерактивным `ViewWelcomeElement`
(`viewWelcomeElement.ts`): абзацы с переносом по словам и кнопки, каждая
зовёт команду по id (как `[label](command:id)` в `viewsWelcome` эталона).
Кнопки — обычные `ButtonElement`, то есть фокусируемые: их достаёт штатный
Tab-обход движка, а `focusContainer` при показе секции ставит фокус на
первую из них вместо `focus()` дескриптора — из состояния «папка не открыта»
выход должен быть одним Enter'ом. Текст элемент рисует сам, а не
детьми-лейблами: перенос зависит от ширины, известной только в
`performLayout`, а менять там состав детей или текст прикреплённого лейбла
нельзя.

**`requiresWorkspaceFolder`** гасит секцию без открытой папки: пустое
состояние перекрывает уже построенное тело (аналог `when: workbenchState ==
empty` у `viewsWelcome`, где welcome тоже спорит с содержимым по условию, а
не по пустоте модели). Флаг стоит у Search и обеих секций Source Control —
тех, кто строит тело заранее и без папки показывал бы рабочий с виду
интерфейс, молча ничего не делающий. Explorer'у он не нужен: его тело
появляется вместе с деревом, то есть вместе с папкой. Переключение —
единственная подписка сервиса на `onDidChangeWorkspaceFolders`
(`IWorkspaceContextService`), которая меняет только тело: свёрнутость и веса
обязаны пережить открытие папки.

**Merged выводится, а не объявляется.** Контейнер с ровно одной ВИДИМОЙ
секцией сливает заголовки (как VS Code): в сайдбаре заголовка контейнера нет
вовсе, а единственная секция несёт его название и не сворачивается; в панели
у секции нет и своей строки заголовка — им служит таб
(`IPaneOptions.headerVisible: false`). Скрыли предпоследнюю секцию —
контейнер сам стал merged, вернули — заголовки разъехались.

**Видимость секций** — `setViewVisible`/`isViewVisible`/`getContainerViews`;
последнюю видимую скрыть нельзя. Персист (`workbench.views.state`,
write-through по действию пользователя) хранит свёрнутость, веса и скрытость.

**Приоритет персиста над дефолтом.** Свёрнутость в сторе — это КАРТА
`id → boolean`, а не список свёрнутых: явное `false` значит «пользователь
держит секцию развёрнутой» и перебивает `collapsed` дескриптора, отсутствие
id — «стор про секцию не знает», и действует дефолт. Списком (формат прошлых
версий) стор тоже читается: перечисленные свёрнуты, про остальные ничего не
известно. Без этого различения секция с дефолтом «свёрнута» сворачивалась бы
на каждом старте.

`restoreViewsState()` применим только когда есть ЧЕМУ применять: он
пропускает контейнер без собранного `PaneViewElement`. Поэтому он срабатывает
дважды — из `mount()` сразу после `attachRegisteredContainers()` (бутстрап:
`setWorkspaceFolder` там идёт ДО `mount`) и по `IStateService.onDidOpenWorkspace`
(Open Folder на живом приложении, где сайдбар уже собран; подписка в
конструкторе сервиса). Оба раза — строго после открытия стора проекта, иначе
прочитается стор пустого окна; write-through'а у restore нет, так что лишний
вызов безвреден. Так же устроены и остальные restore'ы view-состояния: режим
поиска (`SearchComponent`), режим SCM (`ChangesComponent`) и черновик коммита
(`ScmInputComponent`) — фича подписана на событие сама, корень их не зовёт.

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

## Переключатель контейнеров (вместо activity bar)

Колонки иконок, как у эталона, в терминале нет: она отнимала бы место у
сайдбара. Роль activity bar играет **заголовок сайдбара**: после названия
контейнера стоит шеврон (тот же глиф, что у секций), клик по названию, а
также Enter или пробел на заголовке открывают выпадающий список контейнеров
сайдбара прямо под заголовком. Текущий контейнер отмечен `●`, выбор открывает
контейнер с фокусом (`openViewContainer(id, true)`). Это отступление от
эталона, оно и заменяет activity bar.

- Кто несёт переключатель: заголовок контейнера (`ViewContainerHeaderElement`,
  2+ видимых секции) или, когда секция одна и слита с контейнером, заголовок
  этой секции (`PaneHeaderElement`, опция `switcher` у `addPane`). Зона —
  метка названия (`ViewTitleRowElement.setSwitcher`, зона `switcher` в
  `hitZone`, фон при наведении); наполнитель справа, кнопки и «⋯» работают
  как раньше.
- В панели и вторичном сайдбаре переключателя нет: там контейнеры уже
  переключаются вкладками. Контейнер, перенесённый в панель, уходит из
  списка.
- Список собирает `containerSwitcherEntries` (`containerSwitcher.ts`) из
  `getViewContainers()`: только `location: "sidebar"`, по `order`. Название —
  `label` контейнера, иначе `switcherLabel(title)`: заглавный встроенный
  `SOURCE CONTROL` читается как «Source Control», название в авторском
  регистре (у сгенерированного контейнера — название вида) не трогается.
- Контейнеры расширений (`contributes.viewsContainers.activitybar`) попадают
  в список сами — это обычные контейнеры сайдбара (раздел ниже).

## Виды расширений (`contributes.viewsContainers` / `views`)

`api/browser/viewsExtensionPoint.ts` — аналог `ViewsExtensionHandler` эталона
(`viewsExtensionPoint.ts`): `registerExtensionViews` переводит манифесты в
контейнеры и виды `ViewsService`. Зовётся из `startWorkbench` до `mount()`,
поэтому контейнеры расширений собираются вместе со встроенными и restore
layout'а находит их.

- **Контейнеры.** Ключ места: `activitybar` → сайдбар (и переключатель),
  `panel` → нижняя панель, `secondarySidebar` → вторичный сайдбар; прочие
  ключи — предупреждение в лог. id — `workbench.view.extension.<id>`,
  `order` — после встроенных (7+ в сайдбаре, как `CUSTOM_VIEWS_START_ORDER`),
  `title` хранится заглавными (как CSS `text-transform` эталона), исходное —
  в `label`. Проверка как у `isValidViewsContainer`: один плохой элемент
  (`id` вне `[a-z0-9_-]`, нет строкового `title` или `icon`) отбрасывает
  весь список этого места; пустой `title` — id. Контейнер без видимых видов
  места не занимает (`hideIfEmpty`). Команда показа
  `workbench.view.extension.<id>` («View: Show <title>») — в палитре.
- **Виды.** Ключ контейнера: `explorer`, `scm` или id из `viewsContainers`;
  неизвестный (`debug`, `test`…) — в Explorer с предупреждением, как у
  эталона. Порядок — по манифесту в своём контейнере, после встроенных
  секций в чужом (у эталона — по `group`); в Explorer и Source Control
  чужие виды стартуют свёрнутыми (`showCollapsed`), `visibility: collapsed` —
  тоже. Список с элементом без `id` отбрасывается целиком; дубль id и
  неизвестный `type` — ошибка в лог, вид пропускается.
- **Тело — заглушка**: дерево (`TreeView`-API) ещё не рисуется, секция
  показывает «Extension tree views are not rendered yet.» (`placeholder`
  блоком — переносится в узком сайдбаре). Секция нужна уже сейчас: контейнер,
  пункт переключателя, `<view>.focus` и `onView:` работают.
- **`when`** вычисляется по `ContextKeyService` и перевычисляется на каждое
  его изменение: вид регистрируется, пока условие истинно, и снимается
  `unregisterView`, когда ложно, — контейнер появляется и исчезает вместе с
  ним (`go.showExplorer` stock-расширения Go ставит само расширение через
  `setContext`).
- **Webview-виды** (`type: "webview"`) не регистрируются вовсе — в терминале
  их не нарисовать ([потолок](../../public/API-COVERAGE.md#not-supported-by-design)); контейнер из одних
  webview остаётся пустым и скрытым. Их `<view>.focus` отвечает тостом.
- **`<view>.focus`** есть у каждого вида (чат-расширения зовут его перед
  сообщением в панель, Supermaven): у древовидного — `openView(id, true)`,
  фокус на заголовок секции (`focusViewHeader`); в палитру не попадает.
- **Активация.** `contributes.views` даёт неявный `onView:<id>`
  (`activationEvents.ts`), `bindViewActivation` (проводка в
  `extensionHostModule`) активирует его на `onDidShowView` любого вида — как
  эталон; показ до регистрации расширений ждёт барьера `ExtensionService`.
- Не поддержаны: `visibility: hidden`, `viewsWelcome`, иконки контейнеров и
  видов, `contextualTitle`, `initialSize`, `group` — [трекер](../../TODO/Extensions.md#ui-вклады-viewscontainers--views).

## Общие контролы списков

- `browser/parts/views/headerBodyViewElement.ts` — общая раскладка «шапка
  натуральной высоты + тело на остаток» (Search и Extensions).
- `browser/parts/views/filteredListControl.ts` — общий каркас «строка поиска +
  виртуализованный список» поверх `HeaderBodyViewElement`: владеет проводкой
  (запрос → `onQueryChange`, активация строки → `onActivateRow`, плейсхолдер
  пустого состояния), строки строит потребитель. Вынесен на третьем потребителе
  (Extensions, Keyboard Shortcuts) по конвенции #291. Search — кандидат, но его
  шапка сложнее (include/exclude, тумблеры, счётчик) и потребует слота под
  доп. элементы; References — не кандидат: шапка без инпута, это потребитель
  голого `HeaderBodyViewElement`.

Списочных контролов два, и это осознанно, а не временно:

- **`TreeViewElement<T>`** — data-driven: потребитель отдаёт `ITreeDataProvider`
  (`getChildren`/`getTreeItem`/`getKey`), строки дерево рисует само из `ITreeItem`.
  Так же устроено API расширений (`window.createTreeView` + `TreeDataProvider`), и
  когда этот неймспейс оживёт, дерево станет его прямым исполнителем. Сегодня —
  Explorer (плюс ленивая подгрузка каталогов, которой у списка нет). Под
  `TreeItem` расширений строка умеет (с `@tuidom` 0.18.1) `description` —
  приглушённый текст после метки, обрезается первым, — и `actions` — inline-глифы
  у правого края viewport'а на строке под мышью, курсора и выделенных, клик —
  `onInlineAction` без раскрытия и открытия (эталон — `TreeRenderer` в
  `browser/parts/views/treeView.ts`). Заполнять их — дело ядра TreeView и меню
  `view/item/context` (группа `inline`).
- **`ListViewElement`** — виртуализирующий контейнер с настоящими строками-элементами:
  богатая строка — композиция обычных элементов (посимвольная подсветка,
  инлайн-кнопки через делегацию кликов). Собственные списки workbench:
  результаты поиска, Changes.

Выбор для нового списка: данные приходят провайдером или из расширения — tree;
строке нужна своя вёрстка или интерактив — list. Оба O(видимого) по кадру,
производительность не критерий. Цена двух реализаций — близнецы курсора,
мультивыбора, typeahead и `ensureVisible`, а ключ `listFocus` и команды `list.*`
перечисляют оба класса руками (третий списочный контрол — сигнал завести общий
интерфейс); трекер — [TODO/README.md](../../TODO/README.md#workbench).

## References

Find All References наполняет вьюлет сайдбара `REFERENCES` списком «файл →
строки со ссылками» (contrib `references`: `ReferencesService` — запрос → превью
строк → панель, `ReferencesComponent` — вьюлет и список). Ответы нескольких
провайдеров конкатенируются в порядке реестра, сбойный пропускается.

- **Текста строк LSP не отдаёт**, только `uri` + `range`. `referencePreview.ts`
  добирает строку из открытой модели (там видны несохранённые правки, которые
  сервер видит через didChange), иначе читает файл через
  `IFileSystemProviderRegistry` — каждый файл один раз на запрос. Хвост строки
  каппится у истока: ссылка в минифицированном файле иначе тащит в строку списка
  сотни килобайт.
- **Строки — общие с панелью поиска** (`searchResultRows`): «файл со счётчиком +
  строки с подсветкой вхождения» — одна визуальная идиома.
- **Бинды.** Основной — аккорд Ctrl+K Ctrl+R, канонический Shift+Alt+F12 — вторым:
  F-клавиша с модификаторами доезжает не на всяком терминале. F4/Shift+F4 обходят
  ссылки, не уводя фокус из редактора; те же клавиши у поиска уступают ссылкам по
  весу (`BuiltinExtension` против `WorkbenchContrib`, как у эталона) — после
  `references-view.clear` F4 снова ходит по результатам поиска. `workbench.view.references` (Ctrl+K R) —
  наше отступление: у эталона к панели возвращает иконка activity bar, у нас мышью — переключатель
  контейнеров, а клавиатуре нужен свой аккорд.
- **Peek-виджета (`Shift+F12`) нет осознанно**: это редактор внутри оверлея со своим
  скроллом и роутингом клавиш, в терминале панель полезнее. Нет и истории прошлых
  запросов, удаления результата и переключателя list/tree. Каретка не на слове —
  команда молчит, а не показывает пустую панель.
