# MenuRegistry (`src/vs/platform/actions/common/`)

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).

Пункты меню собираются декларативно из реестра (аналог `MenuRegistry`+`MenuId` в
VS Code), а не хардкодятся списками в местах открытия. Так `when`-видимость и
группировку пунктов задаёт данные, а сборщик (контекст-меню редактора/Explorer,
меню-бар) лишь запрашивает готовый список.

**Точки.** `MenuId` — расширяемый класс с id-уникальностью (как в vscode):
встроенные точки — статические инстансы (`EditorContext`, `ExplorerContext`,
`EditorTitleContext`, `EditorTitle`, `MenubarMainMenu` + `MenubarFileMenu`/`MenubarEditMenu`/…),
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
`menuItemsOfAction(action)` по `WORKBENCH_ACTIONS` (оба массива — в агрегаторе) — конвенция явных массивов
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
hasSavedTabs }` — вкладка под правым кликом (хелперы — `browser/actions/menuContexts.ts`).

**`EditorContext` — контекст-меню редактора.** Состав и группы — дословно
upstream'ские: `navigation` (Go to Definition, Find All References) →
`1_modification` (Rename Symbol, Change All Occurrences, Format Document,
Format Selection, Refactor…, Source Action…) → `1_quickfix` (Quick Fix) →
`9_cutcopypaste` (Cut, Copy, Paste) → `z_commands` (Command Palette…). Пункты
языковых фич гейтятся ключами `editorHas*Provider`, которые по реестрам
`ILanguageFeaturesService` выставляет `LanguageFeatureContextKeys`
(контрибьютор контекст-ключей): без провайдера под документ пункт не
показывается — меню не обещает нерабочее. Undo в этом меню нет (его нет и в
эталоне — отмена живёт на Ctrl+Z и в меню Edit).

**Пункты расширений (`contributes.menus`/`submenus`).** Мост
`registerExtensionMenus` (`services/extensions/common/extensionMenuContributor.ts`,
аналог upstream `menusExtensionPoint.ts`) переводит строковые id точек VS Code
(`editor/context`, `editor/title`, `explorer/context`, `scm/resourceState/context`,
`view/title`, …) в наши `MenuId` и кладёт пункты в реестр через
`appendMenuItem`. Разбор — как в эталоне: `group@order` → группа и порядок,
`when` → when-выражение, `title` пункта перебивает титул команды, ключом
`menus` может быть и собственное подменю расширения из `contributes.submenus`
(его точка получает id `ext:<расширение>:<submenu>`, поэтому одноимённые
подменю разных расширений не схлопываются). **Неизвестная точка, пункт без
команды и ссылка на необъявленное подменю — строка в лог и пропуск пункта**, а
не падение: манифест пишет чужой человек. `commandPalette` — не меню, а фильтр
палитры; пункты оттуда пока не применяются, и про это есть та же строка в логе.
`when` расширений смотрят на upstream-имена ключей, поэтому рядом с нашими
выставляются `editorTextFocus` и `editorLangId`. Иконка пункта — иконка его
команды из `contributes.commands` любого расширения (как `MenuItemAction`
эталона): строка ровно `"$(имя)"` или `"$(имя~модификатор)"` известного
codicon'а (`ThemeIcon.fromString`) становится глифом, модификатор не рисуется;
SVG (путь или `{ light, dark }`) в терминале не нарисовать — у пункта иконки нет.

**`EditorTitle` — панель действий группы** (VS Code `editor/title`,
`EditorTabsControl.editorActionsToolbar`). У каждой группы своя:
`EditorTitleActions` (`browser/parts/editor/`) — та же строка, что у полосы
контролов в таб-строке панели (`ViewContainerHeaderElement` без названия), и то
же правило разбора, что у заголовков view (`views/titleMenuEntries.ts`): пункт
`navigation` с иконкой — кнопка справа от вкладок, остальное — попап «⋯».
Пере-резолв — по `ContextKeyService.onDidChange` и смене состава меню; пустое
меню места не занимает — ряд вкладок остаётся голым `EditorTabStripElement`.
Настройка `workbench.editor.editorActionsLocation` (эталонная): `default` — в
ряду вкладок, `hidden` и `titleBar` — панели нет (заголовка окна у нас нет, как
у эталона без своего title bar).
Контекст открытия — `{ groupId }`; аргументов команды пункт не получает
(у эталона — ресурс активного редактора группы). Встроенных пунктов эталона
(Split Editor, «⋯» с Close All/Close Saved/…) пока нет — панель наполняют
расширения (Claude Code: accept/reject предложенного диффа, Open in Terminal).

**`EditorTitleContext` — меню вкладки** (VS Code `editor/title/context`).
Открывает `EditorGroupComponent` по `EditorTabStripElement.onTabContextMenu`;
цель — вкладка **под курсором**, а не активная (правый клик активную не меняет,
как в VS Code). Поэтому команды пунктов адресуются парой `(groupId, index)` из
`editorTabTargetArg` (резолв — `browser/actions/editorTabTarget.ts`, фолбэк на активную
вкладку, если аргументов нет: палитра и клавиатура), а видимость решается
императивно через `visible(context)`: глобальные when-ключи вкладку под курсором
не различают, а `enablement` тут не поможет — он гасит пункт, а не адресует его.
Пункты закрытия ходят через
`EditorService.closeEditors` — общая серия закрытий с confirm-диалогом по
несохранённым и прерыванием на Cancel (см. «Закрытие с подтверждением» в
[EditorPart.md](EditorPart.md#editorservice)).

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
каждым кейбиндом, см. `WorkbenchContextKeys.update`). Резолвит только показанный
контейнер (активный вьюлет сайдбара, активная вкладка панели): скрытый лишь
помечается и досчитывается при показе (`SidebarService.onDidChangeActiveViewlet`,
`PanelService.onDidChangeActiveView`) — как у эталона, где тулбар заголовка живёт
только у открытого композита. На старте собраны все 8 контейнеров, видны два.

**`enablement` — доступность против видимости.** У `CommandAction`,
`CommandMenuPlacement` и `IMenuContribution` рядом с `when` есть `enablement`
(аналог `precondition`/`enablement` VS Code): `when` пункт прячет, `enablement`
гасит — пункт остаётся на месте, но приглушён и не исполняется. Placement
наследует значение экшена, своё — сужает (AND). Принуждение живёт на самой
команде (обёртка в `registerAction`), поэтому накрывает все пути запуска: пункт
меню, inline-кнопку, кейбинд, палитру и программный `execute`; `enablement`
дополнительно складывается в `when` биндинга, иначе диспетчер проглотил бы
клавишу впустую. Резолвнутый пункт несёт `enabled` (`IResolvedMenuItemEntry`) —
его читает заголовок view и рисует кнопку токеном `disabledForeground`, а попап
«⋯» — серым пунктом (`MenuItemEntry.disabled` движка): стрелки его пропускают,
клик и Enter ничего не делают. Палитра команд недоступную команду не показывает
вовсе — по `enablement`; фильтра палитры по `when` пока нет (трекер —
[TODO/README.md](../../TODO/README.md#workbench)).

**Границы vs contribution/Action.** Menu-placement — *где показывать команду*
(данные, co-located на экшене). Command+keybinding — экшен (поведение, [Commands.md](Commands.md)).
Event-проводка — contribution ([Contributions.md](Contributions.md)).

Не перенесено из vscode: `alt`-пункты (альтернатива по Alt) и user hide-toggle
(`isHiddenByDefault`) — нужна поддержка в `PopupMenuElement` и персист
([TODO/README.md](../../TODO/README.md#workbench)).

**Группы и вложенность.** `MenuRegistry.getMenuItemGroups` отдаёт пункты
разложенными по группам (склейка сепараторами — `joinMenuGroups`): это нужно
потребителям, которые рисуют группы по-разному — заголовок view показывает
`navigation` inline-кнопками, а остальное уводит в «⋯». Вложенные submenu в
попапах поддержаны: `MenuService.getEntries/getEntryGroups` резолвят их
рекурсивно (`seen` рвёт циклы `MenuId`), `PopupMenuElement` рисует
`type: "submenu"` дочерним попапом.
