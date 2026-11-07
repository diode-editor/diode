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
References 4, Testing 6 (`order` эталона; есть, пока есть контроллер тестов); в панели PROBLEMS 0, OUTPUT 1, TERMINAL 2, TEST RESULTS 3 (есть, пока есть
результат запуска тестов) — это порядок вкладок,
первая активна. Поздний `attachContainer` вставляет вкладку в позицию по
`order`; контейнер без `order` встаёт после упорядоченных. View — секция внутри
него: `{id, containerId, title, order, body, placeholder?, focus,
minBodyHeight?, canToggleVisibility?, collapsed?, hideByDefault?,
requiresWorkspaceFolder?, canMoveView?}`. `containerId` —
реестровая связь, а не свойство контрола: перенос view между контейнерами —
смена поля записи (см. «Расположение видов» ниже). `collapsed` (как у `IViewDescriptor` VS Code) — ТОЛЬКО
начальное состояние секции; сохранённый выбор пользователя его перебивает
(см. персист ниже). С `canToggleVisibility` не путать: тот про «можно ли
секцию скрыть». `hideByDefault` (эталонный флаг дескриптора) — секция стартует
скрытой, пока пользователь не включит её в «⋯» (OPEN EDITORS в Explorer);
сохранённая видимость его перебивает.
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
  пробуждения ленивых фич, как прежний `setActiveView`; `focus: false` и в
  сайдбаре показывает вьюлет, не трогая фокус — `showViewlet(id, true, false)`,
  как `openPaneComposite(id, location, focus)` эталона: на этом стоит
  `treeView.reveal(…, { focus: false })`, #877), `closeView` (прячет
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
Абзац (`kind: "paragraph"`) может нести ссылки: подпись рисуется в тексте
цветом `textLink.foreground` с подчёркиванием и переносится вместе с ним;
у каждой ссылки — фокусируемый ребёнок на её первом куске (Tab, Enter/Space,
клик), клик по перенесённому хвосту ловит сам элемент. Сфокусированная
ссылка выглядит как сфокусированная кнопка. Цель кнопки и ссылки —
`{ command, args }` или `{ url }` (внешняя ссылка расширения). Поле
`enablement` у кнопки или ссылки — непрозрачное условие, которое элемент
отдаёт `updateEnablement(isEnabled)`: ложное приглушает
(`disabledForeground`), выводит из Tab-обхода и гасит действие — как
`precondition` эталона.
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
вовсе, а единственная секция занимает его место и не сворачивается; в панели
у секции нет и своей строки заголовка — им служит таб
(`IPaneOptions.headerVisible: false`). Скрыли предпоследнюю секцию —
контейнер сам стал merged, вернули — заголовки разъехались.

**Шапка merged — заголовок секции, не контейнера** (#898, решение человека).
Слитая шапка сайдбара показывает заголовок единственной секции с её
`description`: Explorer — имя папки (`DIODE`), Source Control со скрытым
GRAPH — `CHANGES`, вьюлет расширения с одним видом — заголовок вида (в том
числе из `TreeView.title`). 2+ видимых секции — шапка снова заголовок
контейнера. Отступление от эталона: upstream `ViewPaneContainer.getTitle`
пишет `КОНТЕЙНЕР: СЕКЦИЯ`. Переключатель контейнеров, подменю «⋯» и вкладка
в панели по-прежнему называют контейнер. Заголовок секции Explorer —
`explorerViewTitle` (`explorerComponent.ts`): имя воркспейса из
`workspaceLabel` (общее с заголовком окна терминала) или `NO FOLDER OPENED`,
обновляется по `onDidChangeWorkspaceFolders` через `setViewTitle`.

**Видимость секций** — `setViewVisible`/`isViewVisible`/`getContainerViews`;
последнюю видимую скрыть нельзя. Персист (`workbench.views.state`,
write-through по действию пользователя) хранит свёрнутость, веса и скрытость.
Для `hideByDefault` одного списка скрытых мало (его отсутствие в `hidden` —
это и «пользователь показал», и «стор про секцию не знает»), поэтому стор
пишет ещё `visible` — показанные секции с этим флагом; не названная там
секция остаётся скрытой, в том числе по стору старых версий. Если в
контейнере не осталось видимых секций (испорченный стор, снятый вид, секция
с флагом зарегистрировалась первой), возвращается первая секция без флага.

**Секция по содержимому** — `setViewContentBounds(viewId, {min, max})`
(эталон: `minimumBodySize`/`maximumBodySize` плюс `LayoutPriority.Low` у
`OpenEditorsView`). Такая секция берёт свой вес в строках, зажатый в
`[min, max]` — до перетаскивания это `min`, — а остальные делят остаток по
весам; перетаскивание её границы тоже ограничено `[min, max]`. OPEN EDITORS
пересчитывает границы на каждое изменение списка: `min` = min(строк,
`explorer.openEditors.visible`), но не меньше `minVisible`, `max` = max(строк,
`minVisible`).

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
- **Тело — дерево расширения**: до `createTreeView`/`registerTreeDataProvider`
  секция пустая (или welcome, см. ниже); регистрация
  ставит телом `ExtensionTreeView` (`api/browser/extensionTreeView.ts`: строка
  `TreeView.message` над `TreeViewElement`) через `ExtensionTreeViewsAdapter` —
  см. «Деревья расширений» в [Extensions.md](../Extensions.md). Дерево для
  вида, чей `when` сейчас ложен, `ViewsService` держит и отдаёт секции, когда та
  зарегистрируется (`setViewBody`/`setViewTitle` на незарегистрированный вид).
- **Заголовок секции** — `TreeView.title` заменяет название (заглавными),
  `TreeView.description` приглушённо рядом (`ViewsService.setViewTitle`).
  Меню заголовка секции резолвится с ключом `view = <id>` поверх глобальных
  (`MenuService.getEntryGroups(…, keys)`, как scoped context key service эталона),
  поэтому `when: view == <id>` у `view/title` расширений работает.
- **Меню пункта** (`MenuId.ViewItemContext`, `view/item/context`; эталон —
  `TreeMenus` в `browser/parts/views/treeView.ts`). `ExtensionTreeView`
  резолвит его на каждую строку через адаптер (`MenuService.getEntryGroups` с
  ключами `view = <id>` и `viewItem = <contextValue>`, у строки без
  `contextValue` ключа нет): группа `inline` — `ITreeItem.actions` строки
  (глиф иконки команды или её title), прочее — контекстное меню
  (`onContextMenu` виджета: правый клик, Shift+F10, Menu); пусто — меню не
  открывается. Пункт команды, которой нет в реестре, строка не показывает
  (строка в Output, один раз на команду; эталон отбрасывает такой пункт ещё при
  чтении манифеста, у нас команда может появиться позже). Команде уходит
  `{ $treeViewId, $treeItemHandle }`, субпроцесс превращает его в объект
  провайдера (см. [Extensions.md](../Extensions.md), «Деревья расширений»).
  Мультивыбор — `MultipleSelectionActionRunner` эталона: при `canSelectMany` и
  клике по строке внутри выделения из нескольких меню — пересечение пунктов
  всех выделенных (по id команды, подменю — по названию), вторым аргументом —
  массив выделенных; inline-глиф — со своей строкой. Ошибка команды — тост.
  Глифы перерисовываются (`redraw` — без запроса к субпроцессу) на смену
  состава меню и на смену ключа, который читают его `when`/`enablement`/`toggled`
  (`MenuRegistry.getMenuContexts`, как `getMenuContexts` эталона), а `viewItem`
  берётся из строки — refresh с новым `contextValue` виден сразу.
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
- **`viewsWelcome`** (`api/browser/viewsWelcomeExtensionPoint.ts` — разбор,
  `api/browser/extensionViewWelcomes.ts` — показ). Записи собираются по id
  вида в порядке манифеста при старте (`workbenchStartup`) и отдаются
  синглтону `ExtensionViewWelcomes`; id не проверяется — вид может прийти
  позже или быть чужим, у встроенных видов записи не показываются. Запись без
  строковых `view`/`contents` — строка в лог; `group` (proposed API)
  игнорируется. Тело секции решает `ExtensionViewWelcomes` (аналог
  `ViewWelcomeController` + `TreeViewPane.shouldShowWelcome`): welcome, пока
  дерева нет или его корень пуст (до первого ответа — тоже пуст, как
  `_isEmpty` эталона) **и** `TreeView.message` пуст **и** подходит хоть одна
  запись; иначе дерево. Подходят все записи с истинным `when` (без `when` —
  всегда), `"default"` — только если других нет. Строка `contents` — абзац,
  строка из одной ссылки — кнопка, пустые пропускаются; между строками —
  пустая строка (аналог отступов абзацев и кнопок эталона). `command:<id>?<JSON>`
  — команда с аргументами (массив — как есть, иначе одним аргументом, как
  `CommandOpener`), `http(s):` — `IExternalOpener`, прочие схемы — ничего.
  Пересчёт — на каждое изменение `ContextKeyService` (`setContext`
  расширения, `config.*`); тот же набор записей оставляет элемент (и фокус),
  меняется только `enablement`. Адаптер деревьев ставит тело не сам, а через
  `ExtensionViewWelcomes.setTree`.
- **Активация.** `contributes.views` даёт неявный `onView:<id>`
  (`activationEvents.ts`), `bindViewActivation` (проводка в
  `extensionHostModule`) активирует его на `onDidShowView` любого вида — как
  эталон; показ до регистрации расширений ждёт барьера `ExtensionService`.
- Не поддержаны: `visibility: hidden`, `viewsWelcome` для встроенных видов
  (`explorer`, `scm`, …), иконки `$(name)` в тексте welcome, иконки контейнеров и
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
  `browser/parts/views/treeView.ts`). У деревьев расширений их заполняет меню
  `view/item/context` (группа `inline`) — ниже.
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

## Testing

Контейнер `workbench.view.extension.test` («Testing», `order: 6`) и вид `workbench.view.testing` (TEST
EXPLORER) — `contrib/testing/browser/testingExplorerView.ts` (`TestingExplorerComponent`), эталон —
`testingExplorerView.ts` с иерархической проекцией. Вид регистрируется, пока истинно `testing.providerCount
> 0` (`when` эталона): контейнер появляется с первым контроллером и уходит с последним (`hideIfEmpty`).

- **Пустое состояние** — welcome эталона («No tests have been found…», кнопка «Install Additional Test
  Extensions...» → `testing.searchForTestExtension`), пока ни у одного корня нет детей и ни один не занят.
  Поиск расширений не знает `@category:`, поэтому кнопка ищет слово `testing` (отступление).
- **Шапка** — поле фильтра с глифом `filter` справа («More Filters...» эталона: клик — меню «Show Only
  Failed Tests» / «Show Only Executed Tests» с галочкой, пункт дописывает или убирает `@failed`/`@executed`)
  и сводка `ResultSummaryView`: без результатов «No test results yet.»; во время запуска — спиннер,
  `passed/totalWillBeRun` живых запусков и время с начала старейшего, перерисовка раз в 200 мс
  (`SUMMARY_RENDER_INTERVAL`); после — иконка доминирующего состояния последнего запуска его цветом, счёт,
  длительность и `↻` справа (`testing.reRunLastRun`).
  Фильтр — `common/testExplorerFilter.ts` (`setText` + `TestsFilter` эталона): термы через запятую,
  подстрока подписи теста или предка, `!` исключает, `@ctrlId:tag` — тег, `@failed` — упавшие (вычисленное
  состояние), `@executed` — с результатом; всё — И. Совпадение раскрывает дерево до себя. ArrowDown из
  поля — в дерево, ArrowUp с первой строки — в поле, Escape чистит поле (на пустом — как в Search, ничего).
- **Дерево** — `TreeViewElement` поверх зеркала `TestService`: с одним контроллером корни — его тесты,
  с двумя и больше — сами контроллеры. Порядок — `TreeSorter` эталона: «Sort by Location» (по
  умолчанию — так у эталона в storage: строка в одном файле, иначе `sortText ?? label`), «Sort by Status»,
  «Sort by Duration» в «⋯» (группа `sortBy`, ключ `testing.explorerViewSorting`, выбор — в state воркспейса).
  Строка: иконка состояния `testingStatesToIcons` своим цветом `testing.icon*` (`testingColors.ts`),
  Running — спиннер; подпись, приглушённое `description: длительность` (`formatDuration`). Состояние —
  последний результат теста из `TestResultService.getStateById`, у родителя поднятое детьми по
  `statePriority`; длительность родителя — сумма детей. После запуска предки упавших раскрываются;
  `testing.followRunningTest` ведёт курсор за запущенным тестом (до ближайшего показанного предка, а с
  `testing.alwaysRevealTestOnStateChange` или для упавшего — раскрывая). `TestItem.error` — строка-ребёнок цветом `list.errorForeground`, тест с ней раскрыт
  (`TestTreeErrorMessage` эталона). Занятый (`busy`) и раскрывающийся тест крутит спиннер: пока такой
  есть, у вида открыт прогресс `ProgressService` (общий такт и спиннер в заголовке). Раскрытие
  `Expandable`-узла (и корня контроллера при показе) зовёт `TestService.expandTest(id, 0)`, по разу на
  состояние. Диффы перечитывают дерево целиком, раскрытие и курсор держатся по id.
- **Меню строки** — `MenuId.TestItem` (`testing/item/context`) с ключами строки `view`, `testId`
  (последний сегмент), `controllerId`, `testing.testItemHasUri`; группа `inline` — глифы справа с отступом в
  колонку (`inlineActionsRightPadding: 1`), прочее — контекстное меню. Общие помощники с деревьями
  расширений — `browser/parts/views/treeItemMenu.ts`. Команде уходит `{ $testId }`.
- **Go to Test** — Enter/клик по листу с `uri` открывает файл на `range.start`, фокус остаётся в дереве;
  `testing.editFocusedTest` (`Alt+Enter` при `focusedView == 'workbench.view.testing'`, inline и в меню при
  `testing.testItemHasUri`) уводит фокус в редактор. Inline — решение спеки (у эталона только меню).
- **Заголовок** — Refresh Tests / Cancel Test Refresh на одном месте (`navigation`, 10), Run Tests
  (`testing.runSelected`, видимые тесты: без фильтра — все, с ним — совпавшие без скрытых) / Cancel Test
  Run (`testing.cancelRun`, `Ctrl+; Ctrl+X`) — на одном месте (11) по `testing.isRunning`; Collapse All
  Tests и Clear All Results — в «⋯» (`displayAction`), там же сортировки. На строке — Run Test
  (`testing.run`, inline и `builtin@1`, тест с видимыми потомками) перед Go to Test. Команды палитры:
  Run All Tests (`Ctrl+; A`), Rerun Failed Tests (`Ctrl+; E`, упавшие по всем результатам), Rerun Last Run
  (`Ctrl+; L`, те же цели и профили, если они ещё есть), Rerun Failed Tests from Last Run — реруны
  доступны при `testing.hasAnyResults`.
- Не сделано: count badge (`testing.countBadge` — activity bar нет), View as List/Tree, Hide/Unhide Test,
  Show in Active File Only, Debug/Coverage-пункты (решения человека), выбор профиля («Execute Using
  Profile...», «Select Default Profile», «Configure Test Profiles»), Fuzzy Match, печать символа из дерева
  в фильтр. В заголовке ещё Show Output (`testing.showMostRecentOutput`, `navigation` 16) — панель
  TEST RESULTS ниже.

### TEST RESULTS

Контейнер `workbench.panel.testResults` («Test Results», панель, `order: 3` — после TERMINAL) и вид
`workbench.panel.testResults.view` — `contrib/testing/browser/testResultsView.ts` (`TestResultsComponent`),
эталон — `TestResultsView` (`testingOutputPeek.ts`), `TestResultsViewContent`, `OutputPeekTree`. Вид
регистрируется, пока у `TestResultService` есть результаты (`when: testing.hasAnyResults` эталона, по самому
событию сервиса — ключ ставится в микротаске, а вид нужен до автооткрытия): вкладка появляется с первым
запуском, «Clear All Results» её убирает (`hideIfEmpty`). `canMoveView: true`, `canToggleVisibility: false`.

- **Раскладка** — `TestResultsSplitElement`: содержимое и дерево пополам (`Sizing.Distribute`), дерево справа,
  `testing.resultsView.layout: treeLeft` — слева; Toggle Tree Position (`testing.toggleResultsViewLayout`,
  `arrow-swap` в заголовке, `navigation` 18) переключает настройку, выбор строки остаётся. Минимумы эталона в
  ячейках: содержимое ≥ 25, дерево ≥ 12; не влезает — первым сжимается дерево (до нуля). Отступление: sash
  нет, пропорция фиксирована.
- **Дерево** (`getRootChildren` эталона) — задачи последнего запуска с задачами в корне, прочие — под «1 older
  result» / «{0} older results», каждый запуск свёрнут (подпись — «Test run at {0}» с локальным временем
  старта, иконка — доминирующее состояние или спиннер). Задача (спиннер, пока идёт) → тесты с состоянием
  ≥ Running или с сообщениями, по приоритету состояния, описание — цепочка родителей до корня контроллера
  через « ‹ » → сообщения-ошибки (первая строка, «+ N more lines»). Задачи и тесты раскрываются при первом
  появлении. Компактных строк эталона (тест с единственным сообщением одной строкой) нет.
- **Действия строки** (`TreeActionsProvider` эталона без Debug-пунктов — дебагера нет) — свои, не меню:
  у задачи Show Result Output, пока идёт — Cancel Test Run (`testing.cancelRun` с `resultId`, `taskId`), иначе
  Rerun Last Run и при падениях Rerun Failed Tests (`testing.reRunFailedFromLastRun`); у старого запуска
  Show Result Output (одна задача), Rerun Test, Rerun Failed Tests; у теста и сообщения Go to Test (есть
  `uri`), Show Result Output (есть вывод), Run Test (`testing.hasRunnableTests`), в контекстном меню после
  разделителя — Reveal in Test Explorer (`_revealTestInExplorer` → `TestingExplorerComponent.revealTest`).
  Клик выбирает строку, Enter на тесте — Go to Test (решение спеки; у эталона Enter открывает сообщение).
  У сообщения — Go to Error (`debug-stackframe`, есть `location`: файл на начале диапазона, клавиатура — в
  редактор) и пункты расширений `testing/message/context` (группа `inline` — глифы, прочие — контекстное
  меню). Ключи меню сообщения (`testMessageMenu.ts`): `testMessage` (`contextValue`), `testResultOutdated`
  (всегда `false` — результаты не устаревают), `testId`, `controllerId` и семейство `resource*` по месту
  сообщения, иначе по `uri` теста (эталон видит активный редактор — при peek это файл сообщения). Аргумент
  команды — `IWireTestMessageArg` (`{ $testMessageTestId, message }`), хост расширений превращает его в
  `{ test, message }` (`TestMessageMenuArgs` эталона; второго аргумента-задачи эталона нет).
- **Содержимое** — `TestResultsOutput` (`TerminalMessagePeek` эталона): терминальная поверхность без
  процесса (`ExtensionPtySessionFactory`), свежая на каждый выбор; цвета — `TerminalColorsService`
  (`applyTerminalColors`), курсор спрятан, ввода и фокуса нет (клавиши остаются воркбенчу), прокрутка —
  колесом. Задача — весь её вывод, тест — его `appendOutput` в этой задаче (срезы `offset`/`length`).
  Живой запуск дописывает вывод
  по `LiveTestResult.onDidAppendOutput`. Пустой вывод — тексты эталона «The test run did not record any
  output.» / «The test case did not report any output.» (`formatMessageForTerminal`); «Test output is only
  available for new test runs.» не бывает — результаты живут в памяти. Выделения и копирования нет: их нет
  и у терминала.
- **Сообщение** — `TestMessageView` (`CallStackWidget` эталона с сообщением верхним кадром) встаёт на место
  поверхности вывода (`TestResultsSplitElement.setContent`). Выбор показа — правило эталона (`messageShow`):
  есть `expected` и `actual` — diff (`TestMessageDiffFactory`: `DiffEditorPane2` со снапшот-сторонами, только
  чтение, подписи «Expected result» / «Actual result», всегда бок о бок — `useInlineViewWhenSpaceIsLimited:
  false`, настройки редактора — `editorConfiguration.apply`); иначе markdown (`markdown: true` на проводе) —
  `stripMarkdown` ховера, без ссылок; иначе plain — `removeAnsiEscapeCodes` (модель эталона без ANSI; цвета
  эталон возвращает декорациями — у нас нет). Текст — `TestMessageTextElement`: перенос по словам с отступом
  строки, прокрутка колесом. Отступление: компактного вида однострочного diff нет — у редактора нет
  `lineNumbers: off`. Под сообщением — кадры `stackTrace` строками (`label`, `файл:строка:колонка`; без `uri` —
  `descriptionForeground`), Enter или клик по кадру с `uri` открывает файл на позиции, клавиатура уходит в
  редактор; стеку — не меньше трёх строк и до половины высоты. Со стеком над сообщением шапка — шеврон и
  метка теста, клик по ней сворачивает/разворачивает сообщение; Collapse Stack Frames
  (`testing.collapsePeekStack`, `collapse-all` в заголовке TEST RESULTS и палитра при `testing.peekHasStack`;
  у эталона — заголовок peek) сворачивает его. Отступление: кадр — строка без кода вокруг (эталон встраивает
  редактор на кадр), сворачивать, кроме сообщения, нечего. Пункты `testing/message/content` — кнопки в шапке
  (`FloatingClickMenu` эталона, видны всегда). «Debug Test» у кадра не показываем — дебагера нет (решение
  2026-11-04). (`TestingProgressUiService` эталона, внутри компонента): на старт запуска без
  `preserveFocus` по `testing.automaticallyOpenTestResults` — `openOnTestStart` (по умолчанию) открывает
  вид без фокуса, `openOnTestFailure` — на первом упавшем тесте, `openExplorerOnTestStart` — Test Explorer,
  `neverOpen` — ничего. Первая задача нового запуска выбирается сама. Show Output
  (`testing.showMostRecentOutput`, `Ctrl+; Ctrl+O`, при `testing.hasAnyResults`) открывает вид с фокусом и
  первой задачей последнего запуска. Clear All Results — и в заголовке TEST RESULTS (`navigation`).

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
- **Call hierarchy** — вторая секция контейнера, `references-view.hierarchy` (`CallHierarchyComponent`, модель —
  `callHierarchyModel.ts`), как у расширения `references-view` эталона; peek ядра не делаем. Секция существует, только
  пока есть дерево: регистрируется при первом показе, снимается при Dismiss и при показе списка ссылок (тот же
  `dismiss`, сессия освобождается). Переключаем секции `setViewVisible`, а не `closeView`: `closeView` прячет весь
  контейнер. Смена направления перекореняет на выбранной строке **в той же сессии**, без нового `prepare`: элемент уже
  лежит в субпроцессе, а его документ может быть не открыт и не синхронизирован (`documentSync.resolve` ответил бы
  `null`). В `legacy`-терминале Shift+Alt+H не доезжает, а `ctrl+k ctrl+h` занят Output: там команда только в палитре
  и контекстном меню. «No results.» в секции — когда единственный корень без детей; `prepare` без ответа — тост, дерево
  не трогаем.
- **Type hierarchy** — тот же view `references-view.hierarchy`: `TypeHierarchyComponent` и `CallHierarchyComponent` —
  наследники `HierarchyComponent`, разница описана в `IHierarchyKind`. У каждого своё дерево и сессия, но секция одна:
  показ одного дерева снимает другое через `onWillShow` (зависимость односторонняя, типы знают о вызовах). Секция общая,
  поэтому `when` кнопок заголовка проверяет не только режим, но и `callHierarchyVisible`/`typeHierarchyVisible`. Клавиши у
  Show Type Hierarchy нет, как и у эталона. Enter ведёт на `selectionRange.start` в обоих направлениях; остальное
  (перекоренение, «No results.», тост) — как у call hierarchy.
- **Дерево расширений** — встроенное `extensions/references-view` (`vscode.references-view`): часть одноимённого расширения
  эталона, `setInput`/`getInput` и дерево `references-view.tree` поверх `createTreeView`. Через него `redhat.java` показывает
  свою иерархию типов. **Отступление:** в эталоне это один вид, у нас нативный список ссылок живёт рядом с id
  `references-view.list` и уступает место, пока он пуст. Истории, подсветки в редакторе и обхода F4 у этого дерева нет.
- **Peek-виджета (`Shift+F12`) нет осознанно**: это редактор внутри оверлея со своим
  скроллом и роутингом клавиш, в терминале панель полезнее. Нет и истории прошлых
  запросов, удаления результата и переключателя list/tree. Каретка не на слове —
  команда молчит, а не показывает пустую панель.
