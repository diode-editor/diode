# Область редактора

Часть справочника по слою Workbench — модель слоя и каноны в [../Workbench.md](../Workbench.md).
Попапы и виджеты над редактором (find, suggest, …) — [EditorWidgets.md](EditorWidgets.md).

## Модели буферов

- `common/editor/textEditorModel.ts` — `BaseTextEditorModel` (аналог upstream
  `BaseTextEditorModel`): буфер без view и без файловых осей — `TextDocument`
  (один на всю жизнь модели), язык, EOL, история отмены, правки через
  прикреплённые вью (`ITextEditTarget`), события буфера. Замена содержимого
  целиком — **в том же документе** (`TextDocument.setText`: событие контента с
  `isFlush`, версия растёт, история отмены забывается).
  `common/editor/syntheticTextModel.ts` — `SyntheticTextModel`: буфер, чьё
  содержимое даёт владелец (Output, виртуальный документ `jdt:`, снимочная
  сторона диффа) — `appendContent`/`replaceContent`, без save/encoding/watch/dirty.
- `services/textfile/common/textFileModel.ts` — per-file модель (аналог
  `ITextFileEditorModel`) поверх `BaseTextEditorModel`: файл с диска либо
  untitled — dirty-статус против диска (`isModified` = versionId + EOL-ось),
  ось encoding, запись на диск (`save`/`saveAs`/`saveWithEncoding` +
  `TextFileSaveParticipant`), перечитка (`revertToDisk`/`reopenWithEncoding`) и
  слежение за файлом на диске
  через `IFileWatcher` (авто-перечитка чистого буфера / `hasDiskConflict` у
  «грязного» / `isOrphaned` у удалённого — вкладка зачёркнута). Удалённый
  файл и вкладки (эталон `EditorService.handleDeletedFile`): удаление
  изнутри редактора — `FileOperation.Delete` файлового сервиса или, для
  корзины, которая идёт мимо сервиса, `IBulkEditBuffers.didDelete` →
  `EditorService.handleDeletedFile` — закрывает ЧИСТЫЕ вкладки файла и всего
  под удалённым каталогом; внешнее — только при
  `workbench.editor.closeOnFileDelete` (дефолт `false`: вкладка остаётся
  зачёркнутой). Вкладка с несохранёнными правками не закрывается никогда. **Владеет движком undo**: `UndoManager` (класс — в
  `src/vs/editor`) — один на документ (перечитка его чистит, а не пересоздаёт); модель сама
  роутит шаги в `UndoRedoService` (`undoContext`), а `undo/redo(view)`
  принимают «действующую вью», которой восстанавливается снимок выделений.
  **Не** singleton-сервис: экземпляр на файл, но один при любом числе вкладок —
  реестр `TextFileModelRegistry` (`acquire(uri)` → ref-count-ссылка, вкладка
  владеет ссылкой, модель умирает с последней; untitled/synthetic — мимо
  реестра). Модели раздаёт `TextFileModelService`
  (`services/textfile/common/textFileModelService.ts`, DI; аналог upstream
  `ITextFileService.files`/`.untitled`): реестр, `createUntitledModel` со
  сквозной нумерацией, модельная обвязка (watcher, пайплайн save-участников —
  `addSaveParticipant`, порядок регистрации = порядок исполнения) и
  `onDidSaveModel` (после перепривязки ключа реестра). Правки, которые модель применяет сама (участник, `setEol`,
  `applyExternalEdits`), идут через шов `ITextFileEditTarget` — прикрепляет
  каждый парный компонент (целей может быть несколько — сплит-вью; действующую
  передаёт вызывающий, `markDirty` вещается всем).

## Вкладка: компонент и панель

- `browser/parts/editor/editorComponent.ts` — `Component`; владеет
  `EditorElement` + view-state + токен-кешем (`view` = `ScrollBarDecorator`),
  принимает модель в конструктор (модель может делиться несколькими
  компонентами — по вью на группу): view-state и `EditorElement` живут с ним
  всё время (перечитка — обычное событие контента: каретка ремапится, на
  `isFlush` компонент пере-детектит отступ, сразу пересчитывает фолды и
  клампит скролл), по
  `onDidChangeLanguage` и `TokenizationRegistry.onDidChange` пересаживает
  токенизатор, по контенту пересчитывает folding-регионы (микротаск-коалесинг).
  Чужие правки документа (другая вью, undo, владелец буфера) строчно ремапят
  выделения/фолды/скролл каждой вью — `EditorViewState.remapForDocumentChange`
  по `onDidChangeContent` (свои мутаторы гейтятся и пересчитывают себя точно).
  Здесь же view-API: курсор/reveal/goToPosition, декорации (search/markers/
  gutter change-bars), folding-команды, контекст-меню редактора;
  цвета — токены в `editor.style={fg,bg}`, остальное — каскадом.
- `browser/parts/editor/textEditorPane.ts` — пара «модель + view-компонент» одного
  открытого редактора (аналог editor input + pane): владеет временем жизни
  модели (`BaseTextEditorModel`) + `EditorComponent` и делегирует единый API по
  принадлежности; файловые операции — через `fileModel` (`TextFileModel | null`):
  у синтетики ответы честные (`save` → `"no-file"`, перечитка → `false`,
  кодировка по умолчанию), а Save As синтетики (`fileActions`) пишет копию и
  открывает её обычным файлом, как upstream. Это поверхность «активного редактора» для потребителей
  (экшены, Find/Completion, host-адаптеры, швы `IActiveEditorStatus`/
  `IDiagnosticsEditor`/`IMarkerRevealEditor`/`IGotoLineEditor` — выполняются
  структурно делегатами в модель/компонент).
- **Ролевые интерфейсы — в `services/editor/common/`**: `IEditorService`
  (`editorService.ts`, + `IOpenUriOptions`, `IEditorSavedMeta`) и
  `IEditorGroupsService` (`editorGroupsService.ts`, + `IGroupsChangeEvent`);
  токены `EditorServiceDIToken`/`EditorGroupsServiceDIToken` типизированы
  интерфейсами, классы в `browser/` их реализуют. Типы панелей и групп
  интерфейсы берут `import type` из browser (layers-check `import type` не
  считает). Узкие швы фич (`IGotoLineEditorSource`, `IDiagnosticsEditorSource`,
  …) остаются своими интерфейсами. Тестам команд над текущим буфером целый
  сервис не нужен: `createTestActiveEditorService(editor)`
  (`src/TestUtils/testActiveEditorService.ts`) — типизированный фейк роли
  «активный редактор», члены вне роли бросают.

## Группы редакторов

- `services/editor/browser/editorGroupsService.ts` — `EditorGroupsService`
  (DI; аналог upstream `IEditorGroupsService`, но headless — у upstream его
  реализует view-часть `EditorPart`): полоса групп
  (`groups`/`activeGroup`/`viewColumnOf`/`groupOf`), операции полосы
  (`newGroup`/`focusGroup`/`notifyGroupFocused`/`moveActiveEditorToGroup`/
  `joinTwoGroups`/`joinAllGroups`/`moveActiveGroup`, сторона «рядом» —
  `sideGroup`), схлопывание опустевших групп, отказ по месту —
  `canAddGroupHook` + лог. Пер-группная модель — `editorGroupModel.ts`
  (`EditorGroup`: вкладки, активная, MRU-серии Ctrl+Tab,
  `insertPane`/`detachPane` без dispose, пер-группный дедуп `findPaneIndex`;
  контракт порядка событий `onDidChangeEditors` → фокус →
  `onDidChangeActivePane`). Вкладок сам не создаёт: сплит
  (`splitActiveGroup(fill)`) и открытие в группу (`openInGroup(group, fill)`,
  `openInNeighborGroup`) получают колбэк «наполни группу» от
  `EditorService` — новая группа активна ДО наполнения, `onDidActiveGroupChange`
  уходит после. События: `onDidChangeEditors` (агрегат групп),
  `onDidChangeActivePane` (активная вкладка полосы любого вида),
  `onDidActiveGroupChange`, `onDidGroupsChange({kind: added|removed|moved})`,
  `onDidChangeMruCycle` (агрегат серий Ctrl+Tab групп — снимок замороженного
  MRU-списка с позицией цикла на каждом шаге, `null` на конце серии; питает
  оверлей переключателя). Вкладки по позиции, `activateTab` и MRU-серия
  (`cycleMru`/`endMruCycle`) — у самой группы (`activeGroup.*`); уход фокуса
  в другую группу завершает серию прежней. `cycleEditor(±1)` — шаг по
  ВИЗУАЛЬНОМУ порядку вкладок всей полосы с заворотом (VS Code
  `nextEditor`/`previousEditor`, Ctrl+PgDn/PgUp) — без hold-сессии, каждый
  шаг коммитится в MRU сразу; `getOpenEditorsMru`/`revealPane` — пикер
  открытых редакторов.
- **Блокировка группы** (upstream `isLocked`/`lock`, `editorGroupFinder.ts`).
  `EditorGroup.lock(bool)` + `onDidChangeLocked`; сервис агрегирует в
  `onDidChangeGroupLocked` (ключ `activeEditorGroupLocked`, кнопка-замок
  «Unlock Group» в `editor/title` своей группы — по `groupLocked` контекста
  бара, а не по глобальному ключу). Автоблокировка — как в
  `EditorGroupView.openEditor`: новая вкладка первой в группе при ≥2 группах
  запирает группу, если её `IEditorPane.editorId` включён в
  `workbench.editor.autoLockGroups` (дефолт — `terminalEditor: true`, то есть
  терминал вкладкой «рядом» — `claude` из Claude Code). Выбор группы для
  открытия — `services/editor/common/editorGroupFinder.ts`
  (`findGroup`/`peekGroup`, порт `doFindGroup`): явная группа — как есть;
  без группы — первая незапертая по `getGroupsByMru()` (активная — первой);
  «рядом» — сосед, если не заперт; запертая группа принимает ресурс, который
  в ней уже открыт; всё заперто — новая группа справа от активной
  (`addGroup`, не активирует). Через `findGroup` идут `openUri`, `openPane`
  без группы (дифф, расширения), `openTextSnapshot`, `newUntitled`,
  `ViewColumn.Active/Beside` (`columnToEditorGroup(…, resource)`); явная
  колонка расширения (`ViewColumn.Two`) запертой группы не обходит. Команды
  `workbench.action.{lock,unlock,toggle}EditorGroupLock` — палитра; пункта
  «Lock Group» в «⋯» заголовка нет (отступление: он один дал бы «⋯» в каждой
  группе), `precondition` по состоянию замка тоже нет — наш `enablement`
  глобальный и гасил бы кнопку неактивной запертой группы.
- `parts/editor/editorPartComponent.ts` — часть «область редактора» (аналог
  `EditorPart`): владеет `@tuidom/elements/editorpart/editorPartElement` (полоса N
  вью + N−1 сашей, нормированные веса, min-клампы 20×5, максимизация,
  `canFit`) и по `EditorGroupComponent` на группу; политика долей (сплит
  делит долю источника пополам); хуки сервису (`canAddGroupHook`,
  `focusGroupContentHook`) и персисту (`onDidChangeGroupLayout`,
  `IEditorGroupsLayoutView` для `WorkbenchStateService`).
- `browser/parts/editor/editorGroupComponent.ts` — контрол ОДНОЙ группы;
  **композиционный корень** из примитивов tuidom: `view` = `OverlayHostElement`
  (локальный OverlayLayer для find-виджета группы; `view.id =
  "editorGroup-<groupId>"`) поверх `VFlexElement` [`EditorTabStripElement`
  (1 ряд), контент-слот (остаток; пустой — фон-филлер `editor.background`,
  focusable у пустой группы)]: по `group.onDidChangeEditors` вставляет view
  активной вкладки и перерисовывает табы (метки с минимальной разводкой тёзок
  пер-стрип, иконки, маркер изменённости — `getTabStripStyles`); клики по
  табам возвращает в группу (`activateTab`; крестик — `EditorService.closeEditor(group,
  index)`, тот же confirm-флоу, что у Ctrl+W); любой фокус
  в поддереве капчурится → `notifyGroupFocused` (клик мышью делает группу
  активной). Разводка меток тёзок вынесена в `parts/editor/tabLabels.ts`
  (`computeTabLabels`) — общая с оверлеем переключателя.
- `parts/editor/tabSwitcherComponent.ts` + `tabSwitcherElement.ts` — видимый
  список серии Ctrl+Tab (аналог editor picker'а VS Code): пока Ctrl удержан,
  поверх редактора висит MRU-список вкладок текущей группы с подсветкой
  позиции цикла (метки `computeTabLabels`, иконки, маркер изменённости;
  скользящее окно `maxVisibleItems`); гаснет по концу серии. Компонент чисто
  реактивный поверх `EditorGroupsService.onDidChangeMruCycle` (+ страховка
  `onDidActiveGroupChange`), команды про него не знают; overlay-сессия —
  passthrough без фокуса и без гашения глобальных биндов, хост — late-init
  шов `attachHost(BodyElement)`. Элемент — композиция `QuickPickFrameElement`
  + HFlex-строк, презентационный (ввода не принимает). Шагать по видимому
  списку можно и стрелками: `tabActions.ts` вешает на `nextEditorInGroup`/
  `previousEditorInGroup` дополнительные бинды Ctrl+Вниз/Ctrl+Вверх (+
  Shift-варианты для серии с Ctrl+Shift+Tab) под `when: tabSwitcherVisible` —
  контекст-ключ, который `WorkbenchContextKeys` берёт из **видимости
  оверлея** (`TabSwitcherComponent.isOpen()`). Он же разводит их с
  `scrollLineUp`/`scrollLineDown`, сидящими на тех же аккордах: список погас —
  прокрутка редактора вернулась.

Известные люфты групп:

- **Read-only — на вкладке, а не на документе.** Флаг живёт на view-state вкладки:
  две вкладки одного документа могут разъехаться по read-only (гейты правок общие —
  модель одна). Переезд флага на модель — вместе с `files.readonly*`
  ([TODO/ReadonlyEditor.md](../../TODO/ReadonlyEditor.md)).
- **Сплит untitled-вкладки и untitled-диффа** дублем не делится: у untitled общей
  модели в реестре нет, и новая группа открывается пустой. Keyboard Shortcuts — одна
  на окно и не повторяется.
- **Рестор сессии** не поднимает вкладки недисковых схем (`jdt:`) и диффы с
  `git:`-стороной: провайдер схемы появляется только с активацией расширения, а
  рестор идёт раньше. Дифф встаёт в конец группы, а не на своё место.
- **`DocumentTokenStore` и пересчёт folding — на компонент**, а не на модель:
  при N вью документа работа дублируется; консолидация — по перф-сигналу.
- **Контекстное меню вкладки** без Pin / Keep Open и Reopen Editor With…, без
  вызова с клавиатуры (элементы вкладок не `focusable`, у VS Code тоже) и без меню
  на пустом месте полосы.
- **Закрытие с подтверждением** (`EditorCloseHandler`): Save у untitled не
  предлагает Save As — вкладка остаётся; Close All — последовательные диалоги, а не
  один со списком; запросы подтверждения по разным вкладкам одновременно не
  поддержаны (`DialogService.showConfirmSaveDialog` перезаписывает колбэки).
- **Quick Open Ctrl+Enter** (открыть beside) не сделан — нужен альтернативный
  accept в контракте QuickAccess; Explorer Ctrl+Enter работает через
  `openUri({group: "beside"})`.
- Перенос вкладки в соседнюю группу на legacy — чорд с Alt (`Ctrl+K Alt+→`):
  Ctrl+K ←/→ заняты word-motion-фолбэками.

## EditorService

- `services/editor/browser/editorService.ts` (аналог `IEditorService`) — логика
  «редакторов» без view поверх полосы (`editorGroups` — тот же
  `EditorGroupsService` из DI): активный редактор (`getActivePane`/
  `getActiveEditor`/`getActiveTabPane`), все редакторы (`getEditors()` —
  все группы), открытие (`openFile`/`openUri` — `{group:"beside"}` — Open to
  the Side, `openPane`, `openTextSnapshot`, `openDetached`, `newUntitled`).
  Сплит и копия в группу (`splitActiveGroup`/`copyActiveEditorToGroup`)
  остаются здесь: они, как и рестор сессии, повторяют вкладку по
  **рецепту** фабрики её вида — `IEditorPaneFactory` в `editorPaneFactory.ts`:
  `typeId` (upstream id input'а), `describe(pane)` → plain-рецепт,
  `serialize`/`deserialize`, `open(рецепт, {group, focus})`, `singleton`
  (сплит/копия не повторяют). Текстовая фабрика — своя у сервиса
  (`{uri, viewState}` через `openUri(uri, {group, viewState})`), фабрики
  contrib приходят списком `EditorPaneFactoriesDIToken` (собирает
  `workbenchModule`; Keyboard Shortcuts —
  `contrib/preferences/browser/keybindingsEditorPaneFactory.ts`, дифф —
  `contrib/diff/browser/diffEditorPaneFactory.ts`, рецепт — спеки сторон
  `openDiffPair`). Модели — `textFileModels` (`TextFileModelService` из DI:
  одна `TextFileModel` на ресурс, вкладка владеет ref-count-ссылкой); вью
  вкладки собирает `TextEditorPaneBuilder`; `displayName`/`suggestedSaveName`;
  применение `editor.*`-настроек (`TextEditorConfiguration`,
  `textEditorConfiguration.ts`, не DI-сервис: сервис держит его как
  `editorConfiguration` и отдаёт колбэком список поверхностей — вкладки и стороны
  диффов; live-reload по `onDidChangeConfiguration`, Alt+Z — session-override
  `toggleWordWrap`), группа-уровневые швы host'а
  (`saveParticipant`; языковые провайдеры — в реестре `ILanguageFeaturesService`), `IShutdownParticipant`
  (`collectDirty` — дедуп по документу). **Закрытие с подтверждением** —
  одна точка `closeEditor(group, pane|index)` / `closeEditors(group, panes)` /
  `closeAllEditors(group)` → `Promise<boolean>` (аналог upstream
  `IEditorGroup.closeEditor`; `false` — вето). Реализация — `EditorCloseHandler`
  (`editorCloseHandler.ts`, не DI-сервис, держит `DialogService`): «надо ли
  спросить» (`needsCloseConfirm` — документ не виден больше ни на одной
  поверхности полосы, считая стороны диффов) и развязка диалога — Save
  закрывает, только если сохранилось всё (`"no-file"` у untitled — вето),
  Don't Save закрывает, Cancel обрывает серию; перед вопросом вкладка
  активируется, повторный запрос по той же панели присоединяется к открытому
  диалогу. События: `onActiveEditorChanged` (сужение
  `EditorGroupsService.onDidChangeActivePane` до текста: смена вкладки
  активной группы ЛИБО активной группы), `onEditorSaved`, `onDidChangeEditors`
  (агрегат групп + detached-панели и сохранения). Порядок на границе
  сервисов — вкладки → активный редактор → активная группа
  (`editorGroupsService.test.ts`).

## Привязка фич к активному редактору

- `services/editor/browser/activeEditorBinding.ts` — `bindActiveEditor(source,
  (editor, store) => …)`: привязка фичи к активному редактору, наш аналог
  времени жизни upstream `IEditorContribution`. Тело вызывается для текущего
  редактора сразу и для каждого следующего; подписки кладутся в `store` и
  снимаются, как только редактор перестаёт быть активным. `source` — узкий
  `IActiveEditorSource<E>` (`getActiveEditor` + `onActiveEditorChanged`).
- `parts/editor/editorStateCancellation.ts` — `EditorStateCancellationTokenSource`
  (аналог upstream `editor/contrib/editorState`): токен, который отменяется на
  правку документа (`EditorStateFlag.Value`) и/или движение каретки
  (`EditorStateFlag.Position`) панели; принимает родительский токен. Им
  гасится ответ, ставший неуместным, пока человек печатал или двигал каретку.

## Дифф-вкладка

- `browser/parts/editor/diffEditorPane2.ts` — живая дифф-вкладка (DiffEditable):
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
  `contrib/diff/browser/diffSnapshotRefreshContribution.ts` по `onDidChangeFile` (US-31).
  Узкая панель (порог 100 колонок элемента, гистерезис) или тумблер
  «Diff: Toggle Inline View» (персист `DIFF_VIEW_MODE_STATE`) переводят пару
  в **inline**: original скрыт, modified на всю ширину, удалённые строки —
  зоны-призраки (`computeInlineLayout`).

Открытые пункты и осознанные люфты — [TODO/Diff.md](../../TODO/Diff.md).

### Сравнение — пара сторон

Дифф — пара `{original, modified}`, каждая сторона — `{uri, label, текст}`, и **откуда взялся
текст, вкладке знать не нужно**. «Сравнить два файла» и «дифф из Changes» — один виджет; разница
только в левой стороне: с диска или версия из `HEAD`, которой на диске нет. Виртуальная левая
сторона и есть граница между фичами. Источники: файл на диске (`file:`-провайдер), открытый буфер
(общая модель — несохранённые правки видны, буфер побеждает диск), ревизия git (`git:`-провайдер,
меняется только ref в query), буфер обмена (`IClipboard`), пусто (удалённый/untracked файл).
«Сравнить с пустым» и «с буфером обмена» — не спецслучаи, а обычная пара, где у стороны нет файла.

Отсюда идентичность вкладки — **упорядоченная пара источников**, а не «путь + ревизия»: та же
пара → обновление снимка на месте и активация, другая пара того же файла → отдельная вкладка,
`(лево, право)` ≠ `(право, лево)`. Режим отображения (side-by-side/inline) — свойство вкладки, а
не пары: переключается на лету без пересчёта диффа.

Подтверждение формы — в API эталона: отдать редактору готовый дифф нельзя, есть только
`QuickDiffProvider.provideOriginalResource(uri): Uri` — расширение отдаёт **URI исходной
версии**, дифф считает workbench (`contrib/scm/browser/quickDiffModel.ts` резолвит оригинал
текстовой моделью и пересчитывает по `onDidChangeContent`; разбора вывода `git diff` там нет).

Команды сравнения (`contrib/diff/browser/compareActions.ts`) — варианты заполнения двух сторон
поверх одного ядра «открыть дифф пары» (`openDiffPair`); ошибка чтения стороны — нотис в
статус-баре, вкладка не открывается:

| id | Палитра | Пара |
|---|---|---|
| `workbench.files.action.compareFileWith` | File: Compare Active File With… | активный ↔ выбранный в пикере Quick Open (открытые вкладки, затем файлы workspace) |
| `workbench.files.action.compareWithSaved` | File: Compare Active File with Saved | `(on disk)` ↔ буфер; без файла на диске недоступна |
| `workbench.files.action.compareWithClipboard` | File: Compare Active File with Clipboard | `Clipboard` ↔ файл |
| `selectForCompare` / `compareFiles` | Select for Compare / Compare with Selected | выбранный первым ↔ текущий; when-ключ `resourceSelectedForCompare`, рестарт не переживает |
| `diode.scm.compareWithRevision` | Git: Compare Active File with Revision… | `(ref)` ↔ файл; файла на ref нет — левая пуста |
| `vscode.diff` | — (для расширений) | `(leftUri, rightUri, title?)` — тот же путь, что у пользовательских команд |

Clipboard читает **внутренний регистр Diode**, а не системный буфер: `OscClipboard.readText()`
намеренно не спрашивает терминал. Текст из другого приложения выглядит как «сравнили с пустым»,
а не как ошибка. Original в «сравнить два файла» — как в VS Code: первый выбранный (активный).

### Кто считает дифф

**Change set** (какие строки изменились) отделён от **раскладки** (выравнивание, филлеры, свёртка,
декорации — `diffV2Layout`). Раскладка — наша всегда; change set считает перенесённый движок
эталона (`editor/common/diff/`) по двум буферам. `git diff` не парсим, потому что:

- для side-by-side нужны оба текста, `git show HEAD:path` зовётся всё равно, а имея два буфера,
  посчитать дифф дешевле, чем восстанавливать старую сторону из тел ханков (`\ No newline at end
  of file`, переименования, бинарники, EOL/`.gitattributes`);
- дифф от диска отстаёт от буфера: change-bars гуттера залипали бы до сохранения, у VS Code они
  живые;
- git не умеет два произвольных файла, буфер против диска, untitled и файл вне репозитория;
- нет intra-line: `--word-diff` — другой формат, склеивать с построчным неудобно.

За git остаются список изменённых файлов со статусами, содержимое любой ревизии и **детект
переименований** (`git diff -M` — парование путей, уровень списка файлов).

### Свёртка и порог side-by-side

Свёртка неизменённых кусков — **отступление от эталона**: у VS Code
`hideUnchangedRegions.enabled: false` (`contextLineCount: 3`, `minimumLineCount: 3`,
`revealLineCount: 20`), у нас включена — в терминале строк на экране мало. Параметры берём
upstream'овские; логика — по мотивам `UnchangedRegion.fromDiffs`
(`editor/browser/widget/diffEditor/diffEditorViewModel.ts`), написана заново, а не скопирована
(класс завязан на `observable`). Плашка «⋯ N unchanged lines» — одна на обе колонки; между
ханками хранится не контент, а число скрытых строк, текст достаёт рендер.

Дефолтный режим — side-by-side с авто-фолбэком в inline. Порог — `SIDE_BY_SIDE_MIN_COLS = 100`
колонок **ширины самого элемента**, не терминала: сайдбар и скроллбар съедают ~20 колонок, так что
это терминал от ~120. Урок живого запуска: порог 120 по элементу оставлял inline даже на
140-колоночном терминале.

## История навигации

**История навигации** (`services/history/browser/historyService.ts`, аналог
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
