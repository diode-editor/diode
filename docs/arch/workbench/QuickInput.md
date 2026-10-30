# QuickInput и Quick Open

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).

Квик-инпут и квик-опен поверх ОДНОГО общего виджета.

- `browser/parts/quickinput/quickInputComponent.ts` — `Component`; владеет
  единственным переиспользуемым `QuickPickElement` (`view.id = "quickInput"`;
  внутри — `InputElement` строки запроса) и его overlay-сессией
  (`restoreFocus`, `closeOnEscape`, `pointerPolicy: "close-on-outside"`).
  Overlay-хост — late-init шов `attachHost(BodyElement)` (как у
  DialogService). API для сервисов-клиентов: `show()` (позиция: центр, ~10%
  от верха + open + focus), `hide()`, `isOpen()`, канал закрытия `onDidClose`
  (Escape / клик мимо / программное — один путь). Стили: пуш
  `unthemedQuickPickStyles` — пикер пока на исторической unthemed-палитре,
  маппинг на ключи темы — отдельная задача.
- `browser/parts/quickinput/quickInputService.ts` — VS Code-style QuickInput: `input(opts)`
  (InputBox: title/prompt/placeholder/value/`password`/`validateInput` —
  сообщение валидации несёт строгость, Enter блокирует только ошибка;
  валидация может быть асинхронной, устаревшие ответы отбрасываются),
  `quickPick(opts)` (фильтруемый список, `activeIndex`, `onDidChangeActive` —
  шов live-preview) и `quickPickMany(opts)` (чекбоксы, `Space` переключает,
  ответ — в порядке исходного списка; пустой набор ≠ отмена). Промисы
  резолвятся значением/выбранным айтемом или `undefined` при отмене; новый
  вызов отменяет предыдущий. На каждый показ полностью ре-инициализирует
  состояние и колбэки общего виджета.
  **Флейворное состояние общего виджета сбрасывает `resetFlavorState()`** —
  обязательный первый шаг ЛЮБОГО показа (и у Quick Open тоже): чекбоксы
  множественного выбора и маска поля пароля иначе протекают в следующего
  хозяина — палитра рисовала бы `[ ]` перед каждой командой, а Quick Open —
  звёздочки вместо запроса.
- `contrib/quickaccess/` — contribution point провайдеров Quick Open
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
  фоновый индекс за портом `IFileSearchService` (`services/search/common/fileSearch.ts`;
  реализация — `search/node/fileSearchService.ts`, список файлов — `rg --files`
  с exclude-настройками и ignore-файлами), `debounceQuery`, live-refresh по
  `onIndexChanged` с сохранением курсора, `file:line[:col]`-суффикс через
  `splitFileQuery` (`base/common/lineColumnQuery.ts`); над результатами поиска —
  **история недавних файлов** (`EditorHistoryService`, см. EditorPart.md), как
  `getEditorHistoryPicks` эталона: пустой запрос — только история, без файлов
  индекса; с запросом — история, отфильтрованная по имени (по пути, если в
  запросе есть `/`), сверху, и результаты поиска без уже показанных файлов;
  настройки `search.quickOpen.includeHistory` и
  `search.quickOpen.history.filterSortOrder`), `CommandsQuickAccessProvider` (`>`:
  `CommandRegistry.listCommands` + шорткаты из
  `KeybindingRegistry`/`ContextKeyService`, fuzzy-фильтр по подписи с
  сортировкой по очкам), `GotoLineQuickAccessProvider`
  (`:`; активный редактор — шов `IGotoLineEditorSource` → `EditorService`
  структурно, биндинг в `workbenchModule.ts`),
  `OpenEditorsQuickAccessProvider` (`edt ` — открытые вкладки,
  `workbench.action.showAllEditors`, Ctrl+K Ctrl+P: список всех групп в
  MRU-порядке через `EditorGroupsService.getOpenEditorsMru()`, переход —
  `revealPane` через границу группы; fuzzy — тот же, что у файлов
  (`fuzzyMatchPrepared` + `BASENAME_BONUS`, раскладка совпадений по колонкам —
  общий `pathMatchRanges.ts`); швы `IOpenEditorsSource` → полоса групп + `EditorService` (метки) и
  `IWorkspaceRootSource` → `ExplorerService`, оба структурно). Соседний
  hold-оверлей Ctrl+Tab (`TabSwitcherComponent`) показывает тот же MRU, но
  без ввода — это разные поверхности над одной моделью.
- **Подготовка запроса — одна на все пикеры.** Строку запроса разбирает
  `prepareQuery` (`base/common/fuzzySearch.ts`, аналог одноимённого
  `vs/base/common/fuzzyScorer.ts`): пробел — **разделитель термов**, а не
  искомый символ, совпасть обязаны все термы (AND), очки суммируются, индексы
  сводятся в один возрастающий набор. Два правила, которые легко нарушить:
  разбор идёт **после** снятия префикса провайдера (у `edt ` он сам кончается
  пробелом) и **один раз на запрос**, до цикла по записям — `PreparedQuery`
  носит и готовую маску символов (`bits`) для дешёвого отсева, которым
  пользуется индекс `FileSearchService`. Потребители: палитра, файловый пикер,
  пикер открытых редакторов, Keyboard Shortcuts. Поиск в Extensions view
  остаётся подстрочным сознательно: его матчер (`matchesExtensionQuery`) —
  часть формата реестра магазина, общего с витриной и сайтом.
  **Расширил матчер — проверь каждого потребителя, у которого выдача не
  отсортирована по очкам:** соседа ломает порядок, а не состав. Переход
  Keyboard Shortcuts на термы сделал `Show Hover` шире (`show` и `hover`
  нашлись в id чужих команд), таблица сортировалась по алфавиту, и точное
  совпадение уехало в хвост — поймал только e2e. Лечение — ранжирование
  (`TITLE_MATCH_BONUS` в `keybindingsEditorModel.ts`, как `BASENAME_BONUS`
  у файлового пикера).
- `contrib/quickaccess/browser/quickOpenService.ts` — контроллер показа Quick Open (аналог
  `QuickAccessController`): `show(prefix)` занимает общий виджет, дальше
  ведёт запрос через реестр (смена префикса на лету переключает провайдера),
  к дорогим провайдерам применяет leading+trailing debounce 16мс. О
  конкретных префиксах не знает. Он же — поставщик ключей `inQuickOpen` и
  `inFilesPicker` (провайдер без префикса): на втором висят
  `quickOpenNavigateNext/PreviousInFilePicker` — повторный Ctrl+P / Ctrl+E в
  файловом пикере шагает вниз (с Shift — вверх), как в эталоне; в `when` у них
  ещё `inputWidgetFocus`, иначе диспетчер глушит бинд за оверлеем. Подтверждение
  по отпусканию Ctrl (quick navigate эталона) нет — терминал отпускание надёжно
  не сообщает, выбор — Enter. `show(prefix, { activateSecond })` — курсор на
  второй строке (`workbench.action.quickOpenPreviousEditor`). UI — тот же `QuickInputComponent`;
  сервис-клиент, занявший виджет позже, закрывает предыдущий показ (его
  промис отменяется через `onDidClose`).
