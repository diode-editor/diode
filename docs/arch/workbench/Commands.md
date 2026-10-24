# Система команд

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).
Редактор keyboard shortcuts — [KeybindingsEditor.md](KeybindingsEditor.md).

## Конвенции системы команд

- ID команд, отражающих VS Code Workbench/Editor, именуются в стиле VS Code
  (`workbench.action.closeActiveEditor`).
- **Подпись команды в палитре — `category: title`**, а не сам `title`
  («Java: Switch to Standard Mode», как в VS Code). Склейку делает
  `commandPaletteLabel` (`platform/commands/common/commandRegistry.ts`) в точке
  показа; в `CommandRegistry` категория лежит отдельным полем, и `getTitle(id)`
  её НЕ приклеивает. Записать её в сам заголовок нельзя: пункт меню, подпись
  в статус-баре и метка кнопки в эталоне идут без префикса. Фильтр палитры
  матчит ту же склейку — набранное `java` находит всю группу. Источник
  категории у расширений — `contributes.commands[].category`
  (`IExtensionRegistration.commandCategories`, см.
  [Extensions.md](../Extensions.md)).
- **`args` у бинда** (VS Code-семантика): значение правила
  `keybindings.json` едет по цепочке реестр (`KeybindingResolution.args`,
  `platform/keybinding/common/keybindingRegistry.ts`) → диспатчер → команда
  и приходит **первым аргументом** `execute`; без `args` команда зовётся
  вовсе без аргументов. Перебинд и reset во вкладке шорткатов `args`
  сохраняют. Первый потребитель — строковый префилл Quick Open.
- Доступность кейбиндингов — через typed when-контексты из
  `platform/contextkey/common/contextKeys.ts` (`ContextKeyService`); фокус/UI-состояния
  обновляет `WorkbenchContextKeys.update()`.
- Кейбинды адаптируются к терминалу по трём осям — **capability** / **tier**
  (`legacy < csi-u < kitty`) / **mode** (`local`/`ssh`/`tmux`) — доступны в
  when-клаузах (`tier == 'kitty'`, `cap_osc52`, `mode_ssh`, `os == 'mac'`);
  пользовательские бинды — через `keybindings.json` (VS Code-семантика
  `-command` для unbind).
- **Слои кейбиндов** (`KeybindingRegistry`, как upstream `KeybindingResolver`):
  default (встроенные экшены, `register`) → extension (`setExtensionKeybindings`,
  `contributes.keybindings` всех расширений разом) → user (`setUserKeybindings`,
  `keybindings.json`). Старший слой сильнее младшего на той же комбинации
  независимо от веса и от того, когда слой пришёл (расширения регистрируются при
  старте позже user-правил). Снятия (`-command`) декларативны: применяются при
  сборке резолвера и убирают записи default и extension, но не user;
  `when` снятия сопоставляется включением конъюнктов (запись снимается, если её
  `when` содержит все условия снятия). Слои заменяются целиком, записи никуда
  не удаляются — поэтому смена слоя (reset во вкладке шорткатов) не сдвигает
  приоритет остальных.
- **Гейт по tier у дефолтного бинда — только в одну сторону.** Канонический
  бинд VS Code, который терминал без extended keys физически не передаёт
  (`Ctrl+Shift+<буква>`, `Shift+Alt+<буква>`, `Ctrl+Enter`, `Ctrl+Backspace`,
  `Ctrl+\``), объявляется под `when: "tier != 'legacy'"`, а рядом ставится
  **безусловный** досягаемый путь — он же первичный, потому что идёт в подпись
  палитры и меню. Образец — `searchActions.ts` / `changesActions.ts`:
  `Ctrl+K F` / `Ctrl+K G` безусловны, `Ctrl+Shift+F` / `Ctrl+Shift+G` — под
  гейтом. Обратного гейта (`tier == 'legacy'` НА ФОЛБЭКЕ) быть не должно:
  индикатор tier ≠ доставка клавиш — под tmux он поднимается и по env-хинту
  внешнего терминала, и по первой пришедшей CSI-u клавише
  (`noteExtendedKeysObserved`), а расширенные клавиши tmux при этом не
  доставляет. Такой гейт снимал фолбэк ровно в том окружении, где он
  единственный рабочий путь (F1 у палитры — редактор оставался без палитры
  вовсе). Несколько биндов на команду — норма VS Code.
- **Досягаемость — гейт сборки.** `browser/actions/keybindingReachability.test.ts`
  краснеет, если у встроенной команды все активные в окружении бинды требуют
  extended keys, и если подпись бинда в палитре/меню оказалась недостижимой.
  Критерий доставки — `requiresExtendedKeys`
  (`platform/keybinding/common/keybindingPortability.ts`), калиброванный по
  разбору ввода движка: `Ctrl+Space` (NUL) и `Shift+Tab` (CSI Z) доезжают, а
  `Ctrl+Tab`, `Alt+Tab`, `Alt+[`/`Alt+]` (вводители CSI/OSC) и любой Shift с
  печатным символом — нет. Выбор подписи живёт в
  `KeybindingRegistry.getKeybindingForCommand`: сначала доставляемая
  комбинация, и только потом порядок регистрации.
- Лидер-аккорд досягаемого пути — `Ctrl+K <клавиша>`: вьюлеты и панели берут
  букву без модификатора (`Ctrl+K F` Search, `Ctrl+K G` SCM, `Ctrl+K E`
  Explorer, `Ctrl+K M` Problems, `Ctrl+K T` Terminal), остальные — вторую
  часть с модификатором (`Ctrl+K Alt+S` Save As, `Ctrl+K Ctrl+E` Format
  Document). Занятость второй части проверяется гейтом коллизий в том же
  тесте: аккорды разбирают общий префикс, и занятую букву легко не заметить.
- Четвёртая ось — **ОС клавиатуры** и её **мак-лестница**. `os` — ОС клавиатуры,
  а не процесса: по ssh с мака раскладка маковская. Её резолвит лестница
  сигналов с провенансом (`keyboard.platform` → `LC_DIODE_PLATFORM` → имя
  терминала → локальный `darwin`). Рядом с tier строится отдельная мак-лестница
  рунгов `legacy < extended < cmd` (числовой ключ `macKeys`, 0 — не мак). Её
  решающая способность — доезжает ли Cmd (`cap_super`), и ломает её не tier, а
  tmux: под ним рунг не выше `extended`. В `tier` мак не засовывается, потому
  что «мак» не мощнее «pc». Авторы биндов пишут типизированные хелперы
  `macKeysAtLeast`/`macKeysIs`, а не строки. Механическая половина мак-раскладки —
  токен `mod` (Ctrl на pc, Cmd на `mac-cmd`), ручная — одна таблица мак-дельт
  `browser/actions/macKeybindings.ts`. Отсутствие семейства в условии значит
  «действует в обоих», поэтому бинд, досягаемый на любой платформе
  (`Alt+Backspace` у `deleteWordLeft`), объявляется при команде, а не дельтой.
  Подробно — [Keyboard.md](Keyboard.md).
- Tier определяется по env, но **под мультиплексором env-флаги хост-терминала
  (`KITTY_WINDOW_ID` и родня) не считаются доказательством**: расширенные клавиши
  доходят, только если их пропускает сам tmux (`extended-keys on`). Внутри tmux
  ждём подтверждения — probe `CSI ? u` или реально увиденный CSI-u ввод
  (`noteExtendedKeysObserved`). Иначе tier завышался и Ctrl+Shift+F приезжал
  неотличимым от Ctrl+F. Полагаться на точность tier'а в фолбэках нельзя и с
  этой осторожностью — поэтому они безусловны (см. правило про односторонний
  гейт выше).
- **Вторая часть аккорда — с модификатором, если команда переключает вкладку.**
  Парный `keypress` закреплён за целью своего `keydown`
  (`TuiApplication.pinnedKeypressTarget`), и когда команда меняет активную панель,
  эта цель уезжает из дерева: глобальный capture-обработчик `KeybindingDispatcher`
  до неё уже не достаёт и проглотить клавишу не может — голый символ печатается
  в документ, который команда только что покинула. Отсюда `Ctrl+K Ctrl+B` у
  `navigateBack`, а не `Ctrl+K -`. Баг движка — в трекере (docs/TODO/README.md).
- **Регистрация команд — два рода, как у upstream.** Статическая команда —
  `CommandAction` в массиве своей фичи: фича отдаёт один
  `<FEATURE>_ACTIONS` (`contrib/scm/browser/scmActions.ts`, `contrib/find/browser/findActions.ts`, …),
  агрегатор `workbench.common.main.ts` разворачивает массивы фич в
  `WORKBENCH_ACTIONS`, `WorkbenchComponent` регистрирует их одним циклом
  `registerAction` (список приходит токеном `CommandActionsDIToken`). Команда, которая держит
  состояние сервиса или появляется динамически, — `commands.register` в
  сервисе или contribution (аналог `CommandsRegistry.registerCommand`).
  Политика фичи над её командами живёт в фиче (`gitMutating` — в
  `scmActions.ts`). Порядок в `WORKBENCH_ACTIONS` не держит ни кейбинды
  (веса, см. ниже), ни меню: пункты групп меню сверяются срезом
  `menuContributions.slice.test.ts`.
- **`setContext`** — встроенная команда VS Code, которой РАСШИРЕНИЯ публикуют свои
  when-ключи. Регистрирует `SetContextCommandContribution` (`workbench/browser/`)
  без title: в палитре её быть не должно, это программный шов. Значение
  нормализуется: `null`/`undefined` → `false`, массив (только примитивы) и объект
  хранятся как есть — под оператор `in`. Регистрировать имя ключа не нужно.
- **When-вычислитель** — `platform/contextkey/common/contextKeyExpr.ts` (+ лексер
  `scanner.ts`), узкий порт upstream: грамматика VS Code (`&& || ! == != < <= > >=`,
  `=~ /regex/flags`, `in`, `not in`, строки в одинарных кавычках, значение справа
  без кавычек — строка: `editorLangId == java`), AST — discriminated union,
  семантика узлов — upstream (нестрогое `==`, `parseFloat` в сравнениях).
  `ContextKeyService.evaluate` разбирает строку один раз (`deserializeWhen`,
  кэш по строке) и вычисляет дерево над своими значениями. Ключи
  `config.<настройка>` сервис читает из `IConfigurationService` сам
  (`ConfigAwareContextValuesContainer` эталона): лениво, с кэшем; смена
  настройки (и её родительской секции) сбрасывает прочитанный ключ и уходит в
  `onDidChange`; массив — JSON-строкой, объект — как есть, запись `setRaw` в
  `config.*` настройку не перебивает. Незнакомый ключ —
  `undefined`, реестра имён нет, имя ключа читается целиком (`supermaven.isProUser`,
  `foo-bar`, `2fa`). Битая строка ложна. Нормализации, `implies` и
  восстановления после ошибок нет. «Ниже рунга» в мак-хелперах пишется
  `!(macKeys >= N)`, а не `macKeys < N`: по грамматике when сравнение с
  незаданным ключом ложно, а pc-бинд должен действовать и до старта окружения.
  Инвариант `builtinActions.when.test.ts`: каждая встроенная when-строка
  разбирается и ссылается только на ключи, объявленные в `ContextKeyTypes`
  (или на `mode_*`/`cap_*`). Потребители структуры работают с деревом:
  конфликт-детекция сравнивает `serializeWhen`, диспетчер считает бинд
  фокус-скоупным по ключам не под отрицанием (`whenPositiveKeys`).

### Коллизии дефолтов

Известные пересечения дефолтных биндов. Они сохранены как были: веса правил
повторяют прежний порядок регистрации, а развести их — отдельная правка. Тест
мак-раскладки держит pc-шные коллизии списком `PRE_EXISTING_PC_CONFLICTS`
(`browser/actions/macKeybindings.test.ts`), чтобы новые не прибавлялись молча.

| Клавиши | Кто выигрывает | Кто проигрывает | Почему так |
|---|---|---|---|
| Ctrl+K Ctrl+F | `workbench.action.navigateForward` (безусловный, вес `WorkbenchContrib`) | `editor.action.formatSelection` (эталон) | наш legacy-фолбэк навигации; в редакторе на pc чорд уходит в навигацию, а не в форматирование |
| Ctrl+K Ctrl+U | `editor.action.showHover` | `editor.action.removeCommentLine` (эталон) | эталонный Ctrl+K Ctrl+I у hover занят legacy-фолбэком (на legacy Ctrl+I приезжает байтом Tab) |
| Escape при открытых hover и suggest | hover (`EditorContrib + 92`) | suggest (`EditorContrib + 90`) | у эталона наоборот; так было при порядке регистрации |

## Где живут экшены

Экшен — `CommandAction`/`registerAction`: описание команды + кейбинды, поведение —
в `run(accessor)` (сервис резолвится при вызове). Экшены ядра — `browser/actions/`
(`layoutActions.ts`, `editorGroupActions.ts`, `inputActions.ts`, `tabActions.ts`,
`contextMenuActions.ts`, …) и `browser/parts/editor/` (`encodingActions.ts` —
двухуровневый пикер Reopen/Save with Encoding, `eolActions.ts` — convert/toggle/пикер
EOL); экшены фич — `contrib/<f>/browser/*Actions.ts`. Как они попадают в реестр —
«Регистрация команд» выше.

- `contrib/quickaccess/browser/quickOpenActions.ts` (Ctrl+P / Show Commands /
  goto-line / Show All Editors) — `QuickOpenService.show(prefix)` с префиксами из
  статик `PREFIX` провайдеров; строковый `args` бинда дописывается префиллом.
  Палитра команд на legacy-терминале доступна по F1: аккорд Ctrl+K Ctrl+P, как в
  VS Code, занят пикером открытых редакторов.
- `contrib/themes/browser/themeActions.ts` — `selectColorTheme` поверх
  `QuickInputService.quickPick` + `ThemeRegistry`/`ThemeService`, live-preview через
  `onDidChangeActive`, персист в `workbench.colorTheme`; здесь же `themeTypeLabel`.
- `contrib/files/browser/fileActions.ts` (Open File / Open Folder / Save As) — диалог
  файлов `IFileDialogService` (порт `SimpleFileDialog` эталона в
  `services/dialogs/browser/simpleFileDialog.ts`); открытие — команда
  `workbench.openFile`, смена воркспейса — шов `IWorkspaceFolderOpener` →
  `WorkbenchComponent` структурно, биндинг в `workbenchModule.ts`.
- Экшены под `findWidgetVisible`/`suggestWidgetVisible`
  (`contrib/find/browser/findActions.ts`, `contrib/suggest/browser/suggestActions.ts`)
  перебивают editor-команды весом правила (`KeybindingWeight`).

## Клавиатурный диспатч

`KeybindingDispatcher` (`services/keybinding/browser/keybindingDispatcher.ts`) —
резолв keydown против `KeybindingRegistry` + `ContextKeyService`, chord-режим с
таймаутами и swallow продолжения, chord-хинт/«is not a command» через
`StatusBarService`, hold-сессии через `ModifierReleaseArmory`
(`platform/keybinding/common/modifierReleaseArmory.ts`), runtime-детект CSI-u. View
не знает: владелец корневого дерева (`WorkbenchComponent`) вешает его
capture/bubble-листенеры и подключает хук-шов `hasKeyboardCapturingOverlay`; второй
хук — `updateContextKeys` — замыкает на себя `WorkbenchContextKeys`; третий — `isKeyForFocusedWidget` —
ставит терминал: клавиша остаётся default action сфокусированного виджета, команда не выполняется,
мнемоники её не видят ([Terminal.md](Terminal.md#клавиши-в-фокусе-терминала)). Пользовательские
`keybindings.json` применяет `KeybindingsEditorService`
([KeybindingsEditor.md](KeybindingsEditor.md)).

## Контекст-ключи

`WorkbenchContextKeys` (`browser/workbenchContextKeys.ts`) выставляет контекст-ключи
(`platform/contextkey/common/contextKeys.ts`) из фокуса и сервисов: `update()` читает активный элемент
из FocusManager корневой view (шов `attachView`; ключи
`textInputFocus`/`textViewFocus`/`inputWidgetFocus`/`listFocus`/
`terminalFocus`, `editorAreaFocus` — фокус где угодно внутри `EditorPartElement`, любая вкладка;
оверлеи окна живут вне части и дают false; на нём команды вкладок Ctrl+W/Ctrl+Tab/Ctrl+PgUp,
в эталоне у них `when` нет вовсе, фокусный редактор `editorReadonly`/
`editorHasMultipleSelections`) и состояние групп и истории
(`editorGroupHasEditors`/`editorTabsMultiple`/`activeEditorGroup*`/
`canNavigate*`), потом опрашивает контрибьюторов фич (ниже). Ключи с
одной точкой перехода пушит владелец: терминальное окружение
(tier/os/cap_*/mode_*/macKeys) — `TerminalEnvContextKeysContribution` по
`onDidChange` сервиса окружения (маппинг `applyTerminalEnvContextKeys` из
`services/terminalEnvironment/common/terminalEnvContextKeys.ts` общий с
Keyboard Doctor), `panelVisible` — `LayoutService` по видимости
`PanelService`. Замыкает на себя хук
`KeybindingDispatcher.updateContextKeys`; `handleFocusChange` (capture
focus/blur листенеры вешает владелец дерева) сбрасывает незавершённый чорд,
освежает ключи и рассылает смену фокуса через `FocusTracker`.

**Ключи фич — у фич.** Фича, у которой есть ключи от фокуса или своего
состояния, реализует `IContextKeyContributor`
(`platform/contextkey/common/contextKeyContributor.ts`,
`updateContextKeys(contextKeys, active)`) и встаёт строкой в явный список
`WORKBENCH_CONTEXT_KEY_CONTRIBUTORS` (агрегатор `workbench.common.main.ts`,
токен `ContextKeyContributorsDIToken`).
Центр опрашивает контрибьюторов в том же `update()` — тайминг pull общий,
ключ самоисцеляется на следующем нажатии. Ключ с одним переходом состояния
фича пушит сама (`searchViewMode`, `hasSearchResult`, scm busy).
Контрибьюторы: `SearchComponent` (`searchViewletFocus`/`searchInputBoxFocus`/
`firstMatchFocus`), виджеты над редактором — `FindService`
(`findWidgetVisible`), `CompletionService` (`suggestWidgetVisible`),
`HoverService` (`editorHoverVisible`), `ParameterHintsService`
(`parameterHintsVisible`/`parameterHintsMultipleSignatures`),
`InlineCompletionsService` (`inlineSuggestion*`), `SidebarService` —
ключи «вьюлет показан» одним генериком: ключ объявляет дескриптор
контейнера (`IViewContainerDescriptor.visibleContextKey`, например
`searchViewletVisible`), истинен он при видимом сайдбаре и активном
вьюлете. Видимость сайдбара меняется и мимо `SidebarService` (Ctrl+B,
восстановление layout'а), поэтому ключ опрашивается, а не пушится;
`ExplorerComponent` (`filesExplorerFocus`), `ScmInputComponent`
(`scmInputFocus`), `TerminalService` (`terminalIsOpen`),
`TabSwitcherComponent` (`tabSwitcherVisible`); `InputWidgetService` ключей
не ставит, но активное поле забирает в том же опросе. В центре остались
только общефокусные ключи (`textInputFocus`/`textViewFocus`/
`inputWidgetFocus`/`listFocus`/`terminalFocus`/`editorAreaFocus`), фокусный редактор
(`editorReadonly`/`editorHasMultipleSelections`), группы и история;
импортов из `contrib/` у него нет.

Сознательно не сделано: ключи групп и истории (`editorGroupHasEditors`,
`activeEditorGroup*`, `canNavigate*`) остаются на pull, а не на событиях
`EditorService`/`HistoryService` — опрос самоисцеляется, выигрыша кроме чистоты
нет. Объявлений ключей у фич в форме `RawContextKey` эталона нет, поэтому нет и
upstream-ключа `activeViewlet`; заводить их вместе.

**Смена фокуса как событие** — `FocusTracker`
(`services/focus/browser/focusTracker.ts`, `onDidChangeFocus(active)`):
`handleFocusChange` сначала освежает ключи, потом зовёт `fire`. Попапы
редактора (suggest, hover, parameter hints) подписываются сами и гаснут,
когда фокус ушёл с редактора. Это отдельный сервис без зависимостей, а не
событие центра: центр резолвит контрибьюторов при создании, и подписка фичи
на центр замкнула бы DI в цикл.
