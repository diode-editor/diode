# Editor

Часть архитектуры Diode — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).

Модель текстового редактора и виджет-мост к TUIDom: хранение текста (Piece Tree эталона, см. «Хранение текста» ниже), view-state (scroll/selections/folding/cursor), undo/redo, интерфейсы. **Ключевой инвариант: Editor не зависит от Theme и Extensions напрямую — только через интерфейсы `ITokenStyleResolver` и `ILanguageService`.**

**Стили.** Специализированные цвета редактора (гуттер, номера строк, word-highlight, indent-guides, fold-контрол, squiggles) — токены темы (`editorLineNumber.*`, `editorGutter.*` и т. п.), которые `EditorElement` резолвит из каскада var-scope: палитру кладёт в корень `WorkbenchComponent`, дефолты токенов — в `styleTokens.ts` пакета `@tuidom/core` (см. [Theme.md](Theme.md)). Основные fg/bg редактора `EditorComponent` задаёт токенами в `editor.style = { fg, bg }`.

Документ публикует структурные изменения через `ITextDocument.onDidChangeContent` (`{ startLine, oldEndLine, newEndLine, isFlush? }`; `isFlush` — замена содержимого целиком `setText`, upstream `isFlush`: перечитка с диска идёт в тот же документ) — точка расширения для всех per-document подсистем (токенайзер, decorations, marker tracking). Батч правок применяется снизу вверх (координаты нижних не плывут), а события летят в документном порядке и **последовательно**: каждое следующее адресует документ, в котором предыдущие уже применены, поэтому `applyEdits` сдвигает его границы на накопленную разницу строк. Слушателю это и нужно — он двигает свои позиции по одному событию за раз (`EditorViewState.remapForDocumentChange`); без сдвига нижняя правка адресовала строки мимо документа. Вслед за построчными событиями батч отдаёт одно `onDidChangeModelContent` (`{ changes, versionId, eol, isFlush }`, upstream `IModelContentChangedEvent`): точные правки `{ range, text }` в порядке применения — по убыванию, в координатах до каждой правки, так что последовательное применение к копии строк до батча даёт текст после; у `setText` правок нет, `isFlush`. Его потребитель — зеркала документа (синхронизация с extension host'ом), которым мало границ строк. Язык живёт на документе: `languageId`, `setLanguage` (no-op при совпадении, **не** бампает versionId → смена языка не делает документ dirty), `onDidChangeLanguage`.

**Набор символа — событие, а не эвристика.** `EditorElement.onDidType(text)` (upstream `ICodeEditor.onDidType`) приходит после правки печатного символа с клавиатуры — и когда символ ушёл в пару языка: auto-close `(` (вставлено `()`), typeover `)` (правки нет), auto-surround. Вставка, Enter, undo/redo, правки расширений и read-only событием не считаются. Проброс — `EditorComponent.onDidType` (слушатели на компоненте, переживают пересоздание виджета при перечитке) → `TextEditorPane.onDidType`. Потребители — триггер-символы попапов (suggest, parameter hints) вместо восстановления «строка выросла на символ» из пары событий контента и каретки.

**Слежение за файлом на диске (à la VS Code).** `TextFileModel` (Workbench) хранит снимок `diskStat` и слушает внешние изменения через `IFileWatcher`. Чистый буфер — молча перечитывается (`revertToDisk`); «грязный» — взводит `hasDiskConflict`. `save({ overwrite? })` сверяет текущий stat с `diskStat`: параллельная правка → `SaveOutcome === "conflict"`, пока пользователь не подтвердит перезапись. Собственные записи отсеиваются сверкой stat. **Удалённый файл** — режим orphaned эталона: пропавший файл перепроверяется через `ORPHAN_CHECK_DELAY_MS` (100 мс, атомарная запись чужим редактором — удаление и тут же новый файл), и если его всё ещё нет — `isOrphaned` + `onDidChangeOrphaned` (агрегат — `TextFileModelService.onDidChangeModelOrphaned`). Текст буфера жив, сохранение пересоздаёт файл; вернувшийся файл флаг снимает. Вкладка такой модели зачёркнута, окрашена `list.errorForeground` (`TabInfo.isDeleted` движка) и подписана `(deleted)` — хвост добавлен по решению человека сверх эталона: зачёркивание (SGR 9) рисуют не все терминалы. Закрытие вкладок удалённого файла — у `EditorService` ([workbench/EditorPart.md](workbench/EditorPart.md#editorservice)).

## Координаты: ядро 0-based, вендор 1-based
Ядро diode — **0-based `{ line, character }`** (`core/iPosition.ts`, `core/iRange.ts`): это конвенция
API расширений VS Code и LSP, к ним — без конверсий. Код эталона, перенесённый дословно
(`//@diode:vendored`: diff-движок, `core/{position,range}.ts`, `model/textModelTokens.ts`,
`model/pieceTreeTextBuffer/`), живёт в координатах эталона — строки и колонки **с 1** — и руками не правится. Граница —
адаптер за нашим интерфейсом, и **±1 только в нём** (пример — `tokens/documentTokenStore.ts`:
`lineNumber - 1` в узкой `ITextModel`, `line + 1` в вызовах перенесённого). Перевод ядра на
1-based отвергнут человеком (2026-10-19): месяцы работы ради совпадения с эталоном.
Ловушка — два `IPosition`/`IRange`: наши (`line`/`character`, `start`/`end`) и эталонные в
`core/position.ts`/`core/range.ts` (`lineNumber`/`column`, `startLineNumber`…); TS их различает,
глаз — не всегда.

## Хранение текста: Piece Tree эталона
`TextDocument` (`model/textDocument.ts`) реализует неизменный `ITextDocument` поверх узкого 0-based
`IDocumentBuffer` (`model/iDocumentBuffer.ts`): документ владеет версиями, валидацией правок, декорациями
и событиями, буфер — текстом. Буферов два: `PieceTreeDocumentBuffer` (`model/pieceTreeDocumentBuffer.ts`) —
адаптер над перенесённым `PieceTreeTextBuffer` (`model/pieceTreeTextBuffer/`, вендор), строка, длина строки,
правка — O(log n) от размера файла; и read-only `DiskTextBuffer` — [документ на диске](#документ-на-диске).
±1 и вся подгонка семантики piece tree — в адаптере, вендор не правится:
- **EOL — как у эталона по умолчанию** (`PieceTreeTextBufferBuilder.finish(normalizeEOL = true)`,
  `files.eol` = auto): при загрузке и `setText` переводы строк приводятся к преобладающему
  (`\r\n`, если им кончается больше половины строк), он же — `eol` документа и буфера. Смешанные
  EOL, как и раньше, не сохраняются; одиночный `\r` — перевод строки (раньше оставался символом в
  строке). Наружу всё LF-канонично: `getText`, `getTextInRange`, правки и обратные правки — с
  `\n`, `serialize` — с `eol`. `setEol` переписывает буфер (`setEOL` эталона, O(n)), `versionId`
  не трогает.
- **Правка приводится к документу** (`validateRange` эталона): края — в пределах строк, `\r\n` и
  `\r` в тексте — `\n` (иначе события и зеркало, режущие по `\n`, разошлись бы с буфером).
  Пересекающиеся правки — отказ `Overlapping ranges are not allowed!` до любых изменений.
- **Батч — одним `buffer.applyEdits`** в документном порядке (он же `_sortOpsAscending` буфера),
  `_isTracked`, чтобы буфер не схлопнул ≥1000 правок в одну. Построчные события и батч-событие
  считаются из самих правок, обратные — из `reverseEdits` буфера.
- **BOM.** Билдер снимает ведущий U+FEFF в отдельное поле; наш декодер BOM уже снял, поэтому
  адаптер возвращает символ в текст.
- **Построчный доступ** — O(log n) на строку (`string[]` давал O(1)): полный проход по 200k
  строкам ~20 мс вместо ~1 мс. `getLineLength` считается через `getLineContent` (кэш поиска узла и
  последней строки), а не `buffer.getLineLength` — тот без кэша спускается по дереву дважды, и
  проход длин стоил бы ~110 мс. Полные проходы вью (фолдинг, проекция, ширина) — этап 2
  [OpenPerformance](../TODO/OpenPerformance.md); вхождения слова уже сняты с пути кадра (ниже,
  `wordHighlighter`).
- **Полный текст — не на горячих путях** (A4). Файл читается кусками по 4 МБ
  (`textFileModel.readFileChunks`; не 64 КБ эталона — декод больше ~1 МБ node отдаёт внешней
  строкой вне кучи V8, а куски по 64 КБ раздували кучу: peak RSS +40 МБ на 13 МБ файле), потоковый декодер (`encodingStream.ts`) отдаёт куски текста
  прямо билдеру (`createTextBufferFactoryFromChunks` → `TextDocument`/`setText` принимают фабрику,
  как `createTextBufferFactoryFromStream` эталона): ни буфера всего файла, ни строки всего текста.
  Граница куска может резать `\r\n` и суррогатную пару (держит билдер) и многобайтовую
  последовательность (держит декодер). Сохранение кодирует снимок `createSnapshot()` (куски буфера
  уже с EOL документа — правки буфер приводит к нему сам; мелкие склеиваются до 64 КБ, как
  `TextModelSnapshot`) **потоком**: `encodeStream` отдаёт байты кусками ~1 МБ, `IFileService.writeFile`
  принимает поток (`FileWriteContent`, как `VSBufferReadableStream` эталона), диск пишет его по кускам
  во временного соседа — буфера байтов всего файла нет (4.5 OpenPerformance). Сохранённое состояние —
  версия и EOL на момент снимка: правка, набранная, пока байты едут на диск, в файл не попала и
  оставляет буфер грязным. Снимок читает куски старого дерева по смещениям в его буферах, а `setEOL` эталона
  перестраивает буферы на месте — смена EOL во время записи писала в файл смесь LF/CRLF (QA 4.5); поэтому
  `setEol` адаптера строит новое дерево из снимка, а старое остаётся тем, кто его ещё читает (O(n), как и было). `serialize()` остаётся для тех, кому нужна строка. Строки без склейки —
  `getLinesContent()` (QuickDiff). `getText()` — только потребителям, которым нужен весь текст
  (провайдеры, формат, синхронизация на открытии).
- **Цена.** В бандле `tsup` const-enum'ы (`CharCode`) инлайнятся; под vitest каждый доступ — через
  namespace импорта, и построение буфера на 36 МБ там ~10× медленнее, чем в бинаре.

## Encoding (кодировка на дисковой границе)
`Encoding.ts` — сосед EOL-оси (`EndOfLine.ts`): кодировки адресуются строковыми id VS Code (`utf8`, `utf8bom`, `utf16le`, `windows1251`, …) из таблицы `SUPPORTED_ENCODINGS` (`{id, label, statusLabel, iconvName, bom?}`); byte↔text — `decodeBuffer`/`encodeText` (асинхронные) и синхронный `decodeBufferByBOM` (открытие файла без явной кодировки). utf-8 и UTF-16 идут нативно через `Buffer` (байт в байт как iconv-lite, который делегирует их тем же примитивам node; держат тесты «native codecs == iconv-lite»), остальные кодировки — через `iconv-lite`, ленивый кусок бандла (`importLazyModule`, docs/arch/Common.md), поэтому явная кодировка и запись асинхронные; `reopenWithEncoding` возвращает промис и не применяет результат, если буфер за время декода перечитали, перепривязали или закрыли. **По кускам** — `encodingStream.ts` (`decodeStreamByBOM`/`decodeStream`/`encodeChunks`): те же правила, склеенный результат == разовому на любых разрезах (тесты `encodingStream.test.ts`); отдельным модулем, чтобы роль extension host (ей нужен только разовый `decodeBuffer`) не тащила его в свой кусок. iconv-кодировки в нём — разово (куски копятся): потоковый декодер iconv-lite 0.7.3 теряет символы gb18030 на границе куска, а такие кодировки бывают только у явного Reopen with Encoding. Детект **только по BOM** (utf8bom/utf16le/utf16be, как VS Code по умолчанию), иначе utf-8; explicit-кодировка («Reopen with Encoding») побеждает сниф, кроме промоушена explicit `utf8`+BOM → `utf8bom`. BOM отрезается до декода и никогда не попадает в текст; на записи utf8bom и оба utf16 всегда пишут свой BOM.

**В отличие от EOL, состояние кодировки живёт на `TextFileModel`, а не на `TextDocument`:** это свойство байтового представления на диске — документ видит только строки, перекодировка происходит в `loadDocumentFromDisk`/`save`/`saveAs`. Смена кодировки не undoable и не входит в `isModified` (как в VS Code): `reopenWithEncoding` заменяет документ целиком (подтверждение у «грязного» буфера — забота вызывающего), `saveWithEncoding` сохраняет сразу. События — `onDidChangeEncoding` на модели; снапшот save-участника (`ISaveSnapshot`) несёт `encoding` read-only (парного `ISaveEdit` нет — расширения не меняют кодировку через will-save).

## Contrib: контекстное меню (`editor/contrib/contextmenu/`)
Политика контекстного меню редактора — `ContextMenuController` (аналог upstream `editor/contrib/contextmenu`), **первый editor-contrib с DI-токеном** (`static dependencies` на platform-сервисы: `ContextMenuService`, `IConfigurationService`; правило «токен рядом со своим типом» — [../DI.md](../DI.md)). Слушает событие `contextmenu` (правый клик / ContextMenu-клавиша / Shift+F10, сливает движок) на обвязке пары (`EditorComponent.view`), сам `EditorElement` берёт из цели события. Политика как в upstream: клик вне выделения переставляет каретку, внутри — не трогает; клавиатурный триггер якорит меню на каретке; `editor.contextmenu: false` оставляет только перестановку каретки. Состав пунктов — `MenuId.EditorContext` через platform-`ContextMenuService`; сам виджет `EditorElement` про меню не знает ничего.

## Folding
Модель — в `EditorViewState` как «линза» проекции документа на видимые строки. `IFoldingRegion { startLine, endLine, isCollapsed }` прячет тело, оставляя заголовок; курсорная навигация и `revealRange` пропускают/раскрывают свёрнутое. Источник областей — `FoldingRangeProvider.computeIndentationFolds` (по отступам, как VS Code); провайдерские области расширений — из реестра `ILanguageFeaturesService.foldingRangeProvider` (мержатся поверх, пересчёт на каждую регистрацию; см. [Extensions.md](Extensions.md)). Пока провайдер не ответил на правку, стоят прежние области, сдвинутые правкой, — промежуточной раскладки «только по отступам» нет: у неё другие стартовые строки (Java-метод с многострочной сигнатурой по отступам — две области), и свёрнутое мигало бы на каждое нажатие, как и в VS Code, где старая модель живёт до нового ответа. Рендер: фолд-контрол в гуттере + inline-маркер `⋯` + indent-guides `│`. Команды и бинды — `workbench/contrib/folding/browser/foldingActions.ts`.

**Пересчёт — ленивый** (`EditorComponent`, этап 2 [OpenPerformance](../TODO/OpenPerformance.md)): проход по отступам читает каждую строку файла (~100 мс на 200 К строк), поэтому он не идёт ни на клавише, ни на пути к первому кадру. Как `FoldingController.updateScheduler` эталона: открытие, правка и смена реестра провайдеров взводят `RunOnceScheduler` с задержкой от последнего триггера; задержка — `FeatureDebounce` (`languageFeatureDebounceService.for(…, 'Folding', { min: 200 })`: 300 мс до первого замера, дальше среднее время пересчёта с ответом провайдера, в пределах 200 мс … 200²), так что медленный провайдер и огромный файл спрашиваются реже. Правка сразу отменяет запрос в полёте (его ответ описывал бы текст до правки; области на экране правка сдвигает сама, `adjustFoldingRegionsForEdits`). С провайдером проход по отступам делается только после его ответа. Перезагрузка документа (`isFlush`) — исключение: пересчёт сразу, старые области ничего не значат, а восстановление вьюпорта после внешней правки опирается на то, что reveal курсора уже случился. Кап — `editor.foldingMaximumRegions` (дефолт 5000, как `MAX_FOLDING_REGIONS_FOR_INDENT_DEFAULT`): `limitFoldingRegions` (`contrib/folding/foldingRegionsLimit.ts`) режет объединённый список (provider ∪ indentation) по уровню вложенности, как `RangesCollector.toIndentRanges` эталона — целые уровни, пока влезают, затем первые области по порядку документа; индикатор «folding regions limit reached» в статус-баре не перенесён. Тестам, ждущим пересчёт, — fake timers и `TestUtils/foldingClock.ts`; в тестовой фабрике `createEditorPane({ file })` открывает файл до сборки компонента, как `EditorService` (а `pane.openFile` после сборки — это путь перезагрузки).

## Ширина контента и горизонтальный скроллбар
`EditorElement.contentWidth` (его читает `ScrollBarDecorator` движка в layout и render) — **ширина, известная на сейчас**, а не ширина всего файла: как `ViewLines._maxLineWidth` эталона, максимум по уже измеренным строкам, который растёт по мере того, как длинные строки попадают на экран. Меряет `LineWidthCache` (`viewModel/lineWidthCache.ts`, этап 2 [OpenPerformance](../TODO/OpenPerformance.md)): в геттере — строки на рядах вьюпорта (`measureLines`, так что кадр и его скроллбар согласованы, а reveal курсора на длинной строке не выходит за известную ширину); остальной файл — порциями `WIDTH_SWEEP_BATCH_LINES` в `runWhenGlobalIdle` (`EditorElement.runWidthSweep`, отступление от эталона, который чужие строки не меряет вовсе: у нас скроллбар через доли секунды показывает честную ширину). Порция, поднявшая максимум, дозаказывает кадр; отключение элемента от дерева (`onDidDisconnect` — закрытая вкладка, скрытая группа) останавливает развёртку, подключение возобновляет. Правка снимает ширину только с тронутых строк (их переизмеряет следующий кадр — они в вьюпорте — или развёртка); максимум пересчитывается обходом массива чисел, без измерений, и только если ушла строка, державшая его. Ширина одной строки — `measureTextWidth` движка с капом `STOP_RENDERING_LINE_AFTER` (ASCII-префикс без сегментации), плюс плашка обрезки. Под wrap `contentWidth = viewportWidth`, кеш не спрашивается.

## Word wrap
Та же «линза» умеет и обратную проекцию: word wrap разворачивает одну логическую строку в несколько **рядов-фрагментов**. Проекция — `IViewProjection` (`viewModel/viewProjection.ts`, аналог `ViewModelLinesFromProjectedModel` эталона) за `EditorViewState.buildProjection`: без свёрнутых фолдов, wrap и view zones это `IdentityProjection` — ряд и есть строка, массивов нет; иначе `ArrayProjection` — параллельные массивы `rowDocLine` (номер строки ≥ 0 или отрицательный код зоны) + `rowStartOffset` (offset начала фрагмента) + `firstRows` (O(1) `logicalToVisualLine`). Кэш держит стампы версий документа/фолдов/зон и снапшот эффективной wrap-ширины и tabSize, но правка документа **не пересобирает** массивы: правки с последней сборки сливаются в один диапазон строк (`mergeLineChanges`, две системы координат — базовая и текущая) и накатываются на месте (`applyLineChange`: ряды `[startLine, oldEndLine]` регенерируются для `[startLine, newEndLine]`, хвост сдвигается на дельту, как `onModelLinesInserted/Deleted` эталона). Проекция зависит от фолдинга только через свёрнутые диапазоны (`collectHiddenRanges`): пересчёт областей после правки, оставивший их теми же (со сдвигом правки — `shiftHiddenRanges`), кэш не трогает; правка по заголовку или за край свёрнутого тела, перезагрузка документа (`isFlush`), смена зон/wrap/tabSize — полная сборка. Точки переноса — чистая `computeLineBreakOffsets` (`viewModel/lineBreaksComputer.ts`: перенос после пробельного прогона, жёсткая резка длинных слов по графемам, хвост за `STOP_RENDERING_LINE_AFTER` не сканируется) с инкрементальным `LineBreaksCache` (близнец `LineWidthCache`). Ширину вьюпорта во view-state пишет `EditorElement.performLayout` — до render, потому что `contentHeight` читает скроллбар в layout-проходе; смена ширины дозаказывает кадр. Рендер и хит-тесты смотрят на фрагмент «колоночным окном» целой строки (`viewLineRange`/`viewLineStartColumn`/`viewLineForPosition`); вертикальная навигация ходит по рядам с липкой колонкой относительно начала фрагмента, Home/End — по границам фрагмента. При активном wrap `scrollLeft ≡ 0` (кламп в сеттере) и `contentWidth = viewportWidth`. Настройки `editor.wordWrap`/`editor.wordWrapColumn` + Alt+Z (session-override в `EditorService`); стороны диффа форсят off (`TextEditorPane.wordWrapForcedOff`). Упрощения v1 и follow-up'ы — [../TODO/WordWrap.md](../TODO/WordWrap.md).

## Multi-cursor
Курсор в модели с самого начала множественный: `EditorViewState.selections` — это `ISelection[]`, мутаторы строят по правке на выделение, навигация делает `map`, `IUndoElement` носит снимки `before/afterSelections`. Поверх этого добавлены три вещи.

**Нормализация — в сеттере `selections`, а не у каждого вызывающего.** `sortAndMergeSelections` (`common/core/sortAndMergeSelections.ts`, аналог `CursorCollection.normalize` в VS Code) сортирует по началу диапазона (тайбрейк по концу — иначе порядок держался бы на стабильности `Array.sort`) и сливает пересечения: с участием каретки — даже касающиеся, у двух непустых — только настоящее перекрытие (выделения встык остаются разными). Направление объединения наследуется от **позже добавленного** участника: команды дописывают новое выделение в хвост массива, значит именно им рулит пользователь. Писателей у поля много (навигация, правки, мышь, undo, find, расширения), и «не забудь нормализовать» было бы приглашением к багу; заодно `onDidChangeCursorPosition` теперь всегда несёт финальный набор — `HistoryService.capture()` читает позицию синхронно внутри листенера.

**Первичное выделение — `selections[0]`, то есть самое верхнее в документе.** За ним стоит аппаратный курсор терминала, подсветка активного номера строки, `primaryCursorLine/Column` и статус-бар. Отдельного «последнего добавленного» индекса нет: он потянул бы за собой каретку, occurrence-подсветку, фолдинг-у-курсора, completion и десятки тестов. Командам, которым надо показать именно добавленное выделение, служит `revealSelection(selection)` — точечная альтернатива `ensureCursorVisible()`.

**Каретки в кадре.** Аппаратный курсор терминала физически один, поэтому при `selections.length > 1` `paintCarets` (`browser/textViewRendering.ts`) рисует **все** каретки ячейками — инверсным блоком `editorCursor.foreground`/`editorCursor.background` поверх всех слоёв (как `.cursors-layer` в VS Code: бьёт выделение, search-match и squiggle). Частичный `CellPatch` без `char`/`width` сохраняет глиф, а у широкого символа движок красит и ячейку-продолжение. Все, а не только вторичные, — потому что `gridToSvg` игнорирует аппаратный курсор, и демо-кадр показывал бы дыру на месте первичной каретки. При одном курсоре проход не запускается вовсе: картинка остаётся ровно прежней. Проход инвертирован (карта «видимая строка → экранная» на кадр + кэш `DisplayLine`), иначе `logicalToVisualLine` на каждую каретку давал бы O(кареток × строк).

`insertCursorAbove/Below` дублируют каждое выделение на соседнюю **видимую** строку, поэтому каретка на скрытой фолдингом строке не возникает by construction, а «повторное нажатие наращивает пачку» получается даром из слияния. Alt+клик (`toggleCursorAt`) ставит или снимает каретку; последнюю не снимает. Escape (`removeSecondaryCursors`) гейтится when-контекстом `editorHasMultipleSelections`, иначе перехватывал бы Escape у find-виджета и попапа автодополнения. Команды и бинды — `workbench/contrib/multicursor/browser/multiCursorActions.ts`.

**Каретки после батча правок — из обратных правок, а не арифметикой.** `applyDocumentEdits` возвращает обратные правки уже в координатах применённого документа, и конец каждой ровно накрывает вставленный текст — это и есть новая каретка (`selectionsAfterEdits`). Свой расчёт по исходным координатам копил сдвиг колонки только для соседей на одной строке и на батче с многострочной правкой уводил каретки за пределы документа (отрицательная колонка, колонка за концом строки) — а каретка за концом строки роняла рендер на occurrence-подсветке. Перекрытия в батче при этом запрещены контрактом `applyEdits`, поэтому мультикурсорное удаление по границе слова (две каретки внутри одного слова просят удалить до одного начала) объединяет диапазоны — `clipDeletionOverlaps`, поведение vscode. Батч из ненадёжного источника (правки расширения) объединять нельзя — его проверяет `hasOverlappingEdits` на входе и отбивает целиком (`Overlapping ranges are not allowed` в vscode; отказ all-or-nothing, см. [Extensions.md](Extensions.md)).

Потребители, которые мультикурсор не поддерживают, гейтятся явно: автодополнение (попап якорится на одной каретке, accept вставил бы правку мимо остальных) и occurrence-подсветка (слова под кареткой не одно). Copy/Cut работают через `getSelectedTexts()` и склеивают выделения переводом строки — иначе Cut удалял бы больше, чем скопировал.

## `editor/contrib/multicursor/` (семейство «выделить следующее вхождение»)
Ctrl+D и родня — состояние плюс чистые функции, без DI и подписок.

**Сессия** (`IMultiCursorFindSession`) — что ищем (`searchText`, `wholeWord`, `matchCase`) и куда доехали (`lastAdded`). Живёт полем `EditorViewState.multiCursorSession`: так она умирает вместе со вью бесплатно, а тип импортируется `import type` (как `IFoldingRegion` — рантайм-зависимости `common → contrib` нет). **Инвалидация — снимком**, а не хуком в сеттере: сессия помнит выделения, которые сама произвела, плюс `versionId`; разошлись — начинаем заново от текущего первичного. Снимок ловит любую причину (мышь, стрелки, undo, правка расширением, find) одним механизмом, тогда как хук потребовал бы флага реентрантности в самом горячем сеттере модели, а забытый флаг давал бы молчаливый баг. `idealColumn` в сравнении игнорируется — его двигает вертикальная навигация мимо курсора.

**Шаг** (`multiCursorCommands.ts`): от схлопнутой каретки первый Ctrl+D только выделяет слово под ней (и запоминает поиск по целым словам); дальше каждый шаг ищет следующее вхождение от `lastAdded`, с заворотом через край документа и пропуском уже выделенных — заворот плюс пропуск дают завершаемость, после того как выделено всё, команда становится стабильным no-op. `mode: "move"` (Ctrl+K Ctrl+D) переносит последнее добавленное вместо добавления нового. Прокрутка — `revealSelection(added)`, а не `ensureCursorVisible()`: первичное выделение самое верхнее, и вьюпорт уехал бы не туда. `selectHighlights` (Ctrl+Shift+L) вьюпорт не двигает вовсе — пользователь смотрит в конкретное место.

**Осознанное расхождение с VS Code:** `matchCase` жёстко `true`. В VS Code ось берётся из состояния find-виджета (по умолчанию выключена), и Ctrl+D на `foo` цепляет `FOO`, портя регистр при наборе; Ctrl+D — инструмент рефакторинга. Поле в интерфейсе оставлено швом к `FindService`.

**Один сканер на всех.** `findTextMatches(document, query, { matchCase, wholeWord })` (`editor/contrib/find/findMatches.ts`) — общее ядро для подсветки find-виджета, подсветки вхождений слова под кареткой и этого семейства; `findMatches` остался тонкой обёрткой. Третий набор осей иначе стал бы третьей копией цикла.

**Порядок применения батча и обратные правки** (`TextDocument.applyEdits`, `editor/common/model/textDocument.ts`). Снизу вверх — это ровно `[...docOrder].reverse()`, а не отдельная сортировка по убыванию: `Array.sort` стабилен, и правки с **совпадающими** диапазонами (две вставки нулевой ширины в одну точку — их дают обратные правки двух соседних удалений) склеились бы задом наперёд (тот же порядок у `_sortOpsDescending` буфера). Обратные правки — `reverseEdits` буфера (`_getInverseEditRanges` эталона): считаются в координатах применённого документа от конца предыдущей правки в двух системах сразу: позиция на той же старой строке, что конец предыдущей, уезжает на её новую строку со сдвигом колонки (склейка строк), ниже — сдвигается только строка. Наш прежний `computeInverseEdits` был портом того же алгоритма; ещё более ранний вариант с накопительными дельтами терял колоночный сдвиг на многострочной правке, и Ctrl+Z после quick fix перемешивал текст (#331); оба бага ловит фаззинг round-trip'а `applyEdits(inverseEdits)` на алфавите `"ab\n"`, а форму правок tsserver (два смежных удаления вместо одного) видно только на живом сервере.

## `editor/contrib/wordHighlighter/` (F7 / Shift+F7)
`moveToWordHighlight` — переход по подсвеченным вхождениям слова под кареткой (upstream `WordHighlighter.moveNext/moveBack`): каретка на начало следующего/предыдущего вхождения, циклически, вьюпорт едет к цели. Набор вхождений — тот же `computeWordOccurrences`, что рисует подсветку, и те же гейты (одна схлопнутая каретка): нет подсветки — нет и перехода (upstream гасит команду предусловием `hasWordHighlights`; своего контекст-ключа нет — команда тихий no-op). Подсветка лексическая: `DocumentHighlightProvider` расширений не проведён. Экшены — `workbench/contrib/wordHighlighter/browser/wordHighlighterActions.ts` (`when: editorTextFocus`, вес `EditorContrib`, как у эталона).

**Подсветка вхождений — вне кадра, как `WordHighlighter` эталона.** Вхождения считаются по всему файлу без лимита (эталон тоже: `model.findMatches` в главном потоке, выключает только выше `isTooLargeForTokenization`), поэтому `EditorElement` никогда не ищет их в `render`. Запрос (`requestOccurrences`) ставят явное движение каретки, включение настройки и создание элемента; кадр после запроса взводит таймер на 50 мс (`runDelayer` эталона, повторный взвод — дебаунс), таймер ищет и просит кадр. Каретка внутри уже подсвеченного слова набор не пересчитывает (`_run`). Правка набор сбрасывает (`onDidChangeModelContent → _stopAll`), а движение каретки, которое пришло вместе с правкой (набор, Enter, undo — та же синхронная задача, что и событие контента), запроса не ставит: у эталона это `CursorChangeReason` ≠ `Explicit`, у нас — пометка задачи до микрозадачи. Порядок событий внутри задачи бывает любым: `EditorViewState` переносит выделения (`remapForDocumentChange`) прямо в событии контента, раньше, чем его услышит элемент, — поэтому правка ещё и отзывает запрос, поставленный в той же задаче (без этого undo на xlarge возвращал поиск по 200 тыс. строк). Подсветка возвращается со следующим явным движением; уже взведённый таймер правка не отменяет — как и `_stopAll` эталона не трогает `runDelayer`. `editor.occurrencesHighlightDelay` (эталон, дефолт 0) не поддержан — задержка после поиска равна нулю. Гейт «одна схлопнутая каретка» проверяется ещё и при рисовании, так что выделение гасит подсветку в том же кадре.

**Фоны диапазонов — по видимой области.** Строки экрана кадр собирает один раз (`buildViewportRows`, `browser/textViewRendering.ts`: логическая строка, фрагмент под wrap, `DisplayLine` лениво) — все проходы фона и волн берут их оттуда, а не спрашивают проекцию на каждый диапазон. Отсортированные непересекающиеся наборы (вхождения, совпадения поиска) режутся двумя двоичными поисками до видимых строк (`paintSortedRangeBackgrounds`), так что цена кадра следует за экраном, а не за числом совпадений: до этого 200 тыс. вхождений `const` × строки экрана стоили сотни мс на каждую клавишу.

## `editor/contrib/smartSelect/` (Expand / Shrink Selection)
Порт `editor/contrib/smartSelect` эталона. `provideSelectionRanges` спрашивает языковые провайдеры реестра (`selectionRangeProvider`) и встроенные: слова (`wordSelections.ts` — подслово camelCase/`_`, слово `DEFAULT_WORD_REGEXP`, строка из пробелов, документ) — всегда, скобки (`bracketSelections.ts`) — только когда языковых провайдеров нет. Эталон берёт скобки у токенизатора (`model.bracketPairs`); у нас — пары `brackets` language configuration, найденные в тексте, а скобки в строках и комментариях отсекает предикат по TextMate-токенам (`tokenCodeAt.ts` поверх `standardTokenTypeAt`; строки за фронтиром токенизации и с устаревшим кэшем считаются кодом). Ответы сливаются в цепочку «каждая ступень строго шире предыдущей», с `editor.smartSelect.selectLeadingAndTrailingWhitespace` при выходе на другие строки вставляются ступени «строки без отступа» и «строки целиком». `SmartSelectController` держит стек ступеней на каретку (мультикурсор — по иерархии на каждую) и забывает его по любой посторонней смене выделения или правке. Команды и сервис — `workbench/contrib/smartSelect/browser/`.

## Набор: пары языка и табстопы

**Пары языка.** Планировщик — чистая функция `planAutoClose` (`editor/common/languages/autoClosing.ts`): решение для одной схлопнутой каретки в порядке typeover закрывающей → многосимвольный open (самый длинный, `/**` → ` */`) → закрытие только перед концом строки или символом из `autoCloseBefore` → кавычка не удваивается после символа слова. Перехват — `EditorElement.tryTypePaired`: непустые выделения уходят в auto-surround, а для кареток решение **общее** — разъехавшиеся (у одной typeover, у другой вставка) откатываются к обычному набору (упрощение против пер-курсорных команд эталона). `notIn: string/comment` не учитывается — у планировщика нет токенов.

**Tab по табстопам.** `EditorViewState.indentUnitAt(pos)`: при `insertSpaces` вставляется `tabSize - (видимая колонка % tabSize)` пробелов, при табах — один `\t` (эталон — `TabOperation._replaceJumpToNextIndent`). Добавка у каждой каретки своя, поэтому `type(text)` расцеплен на `typeEach(textFor)`: `buildEditsFromSelections` спрашивает текст на **каждую** правку батча — это общий путь для любой позиционно-зависимой вставки. Сознательно не взято из эталона: выравнивание по табстопу самого отступа при многострочном Tab (`ShiftCommand` с `useTabStops`; у нас — один уровень, симметрично `computeOutdentRemoval`), Tab по выделению ровно на всю строку как отступ строки, reindent строки из одних пробелов по `autoIndent`.

## Line operations (строчные операции)
Перенос семейства `editor/contrib/linesOperations` VS Code: дубль строк (`copyLinesUp/DownAction`, `duplicateSelection`), перенос (`moveLinesUp/DownAction`), удаление (`deleteLines`) плюс клипбордная семантика `editor.emptySelectionClipboard`. Расчёт — **чистые функции** `viewModel/lineOperations.ts` (по документу и нормализованным выделениям считают правки и итоговые выделения), применение — тонкие мутаторы `EditorViewState` (`applyLineOperation`: правки + сдвиг фолдов + кламп выделений к документу; один `IUndoElement` на операцию). Мультикурсор — по VS Code: блоки строк выделений (конец на колонке 0 не захватывает свою строку) при дубле не дублируют общую строку дважды, при move/delete смежные блоки сливаются и едут одним куском (иначе правки пересеклись бы); блок, упёршийся в край документа, стоит, остальные едут. Бинды — линуксовый канон VS Code (`ctrl+shift+alt+↑/↓` у copy — `shift+alt+↑/↓` занят мультикурсором), экшены — `workbench/contrib/linesOperations/browser/lineOperationActions.ts`, пункты в меню Selection.

**`emptySelectionClipboard` (дефолт true):** Ctrl+C/Ctrl+X без выделения копируют/вырезают строку каретки целиком (с `\n`; соседние каретки одной строки — один раз). Вставка такой строки **линейная** — ложится строкой выше курсорной, каретка остаётся у своего текста: системный буфер несёт голый текст, поэтому маркер линейности живёт сбоку в `InMemoryClipboardMetadataManager` (`platform/clipboard/common/clipboardMetadata.ts`, синглтон как в VS Code) и валиден только при точном совпадении текста с последней записью нашего Copy/Cut — чужое содержимое буфера вставляется как обычно. Copy идёт через панель (`getSelectedTexts()`, право диффа фильтровать), и только пустой результат откатывается на `viewState.getTextToCopy` — потому работает и на read-only стороне диффа; Cut/Paste — `viewState.cutSelections`/`pasteText`.

## Токенизация: швы (`editor/common/languages/`, `editor/common/tokens/`)
Подсветка синтаксиса разделена как в VS Code: *источник токенов / хранилище / резолвер стиля / рендер*. Контракты:
- **`IState`** + `NULL_STATE` — состояние токенайзера на границе строк.
- **`ITokenizationSupport`** (`editor/common/languages.ts`, шим upstream) — `tokenizeEncoded(line, hasEOL, state)` → `EncodedTokenizationResult`: **бинарные токены эталона** — `Uint32Array`, по два числа на токен (начало + метаданные `encodedTokenAttributes.ts`: язык, `StandardTokenType`, `FontStyle`, индексы цвета текста/фона в colorMap темы). TextMate отдаёт их `IGrammar.tokenizeLine2`; скоупов в токенах нет — тему матчит сам vscode-textmate.
- **`TokenizationRegistry`** (`TokenizationRegistryDIToken`) — `register`/`get`/`onDidChange` по languageId.
- **`DocumentTokenStore`** (`tokens/`) — кеш токенов на вью (его держит `EditorComponent`), подписан на `onDidChangeContent`. Адаптер к перенесённой из эталона токенизации (`model/textModelTokens.ts`, аналог upstream `TokenizerSyntaxTokenBackend`): хранилище end-state'ов с очередью невалидных строк (сходимость по равенству состояний — эталонная), **фон** (`DefaultBackgroundTokenizer`: куски по ~1 мс, уступает через `setTimeout0` = `setImmediate`, токены — событием `onDidChangeTokens`, `EditorElement.handleTokensChanged` перерисовывает, только если строки на экране), **вьюпорт** (`tokenizeViewport(top, bottom)` из рендера каждый кадр: до фронтира фона — точно, за ним — эвристика по отступам `findLikelyRelevantLines`, которую фон потом перекрашивает; тот же вьюпорт той же версии второй раз не угадывается) и **каретка** (`forceTokenization` — явные команды вроде smart select; `tokenizeIfCheap` — автокомплит, как `suggestModel` эталона). Токены — бинарные (B2, [TODO/VscodeModel.md](../TODO/VscodeModel.md)): на строку `Uint32Array` концов токенов и метаданных, отдаётся upstream `LineTokens` (`tokens/lineTokens.ts`, вендор); правленая строка пуста до пересчёта (отступление B1, у эталона — `ContiguousTokensStore` со сдвигом). Вид токена (`standardTokenType.ts`: строка/комментарий для автокомплита и smart select) — из метаданных. Инвариант первого кадра сохранён: вьюпорт в начале файла токенизируется синхронно, `small` открывается сразу с подсветкой.
- **`ITokenStyleResolver`** — `resolve(metadata) → ResolvedTokenStyle`; реализация — `ColorMapTokenStyleResolver` (цвета — colorMap темы из `TokenizationRegistry.getColorMap()`, `ColorId` 0–1/0–2 — «цвет редактора»; аналог CSS-классов `mtk<id>` эталона). **Editor зависит только от этого интерфейса, не от Theme.**
- **`ILanguageService`** — `languageId` по пути файла + display name. **Editor зависит только от интерфейса, не от Extensions.** Реализацию (`LanguageRegistry`) поставляет слой Extensions.
- `editor/common/languages/builtin/` — заглушки (`PlainTextTokenizer`, `WordTokenizer`) как fallback; `workbench/services/textMate/` — адаптер над `vscode-textmate`/`vscode-oniguruma` с защитой от ReDoS. Конкретные грамматики поставляют builtin-расширения.

## Семантические токены (второй слой поверх TextMate)
Перенос семантической подсветки эталона; провайдеры — только у расширений (LSP), путь по RPC — «Языковые провайдеры — реестр ядра» в [Extensions.md](Extensions.md).
- **Провайдеры ядра** — `DocumentSemanticTokensProvider`/`DocumentRangeSemanticTokensProvider` (`editor/common/languages/iSemanticTokensSource.ts`; легенда, `onDidChange?`, ответ — полный `data` или дельта `edits`) в реестрах `ILanguageFeaturesService.documentSemanticTokensProvider`/`documentRangeSemanticTokensProvider`. Спрашивается только старшая группа по score (`LanguageFeatureRegistry.orderedGroups`, `contrib/semanticTokens/common/getSemanticTokens.ts`).
- **Хранилище** — `SemanticTokensStore` (`editor/common/tokens/`), одно на документ и общее для его вью: строки → четвёрки `[start, end, typeIdx, modSet]` + легенда (`SemanticTokensLines`). Полный набор (`set`) от провайдера документа заменяет всё; `setPartial` от range-провайдера — только пока полного нет. Правки документа (`onDidChangeModelContent`) сдвигают токены по правилам `sparseMultilineTokens` эталона до свежего ответа; перевод строки — только `\n`, как режет вставку модель.
- **Жизненный цикл** — `DocumentSemanticTokensFeature` (`contrib/semanticTokens/browser/documentSemanticTokens.ts`, DI-синглтон): `EditorComponent` берёт ссылку `attach(model)` (refcount по документу), на документ — `ModelSemanticColoring`, пока подсветка включена (`editor.semanticHighlighting.enabled`: булево решает само, `configuredByTheme` — флаг `semanticHighlighting` темы; переоценка на смене настройки и темы). Первый запрос сразу, дальше — адаптивная пауза 300–2000 мс (`FeatureDebounce`, `editor/common/services/languageFeatureDebounce.ts`); правка не отменяет запрос в полёте — его ответ сдвигается правками за время запроса, и запрос планируется снова; дельта накладывается на данные прошлого ответа; прошлый ответ релизится у провайдера; ошибка оставляет прежние токены. Видимую область, пока полного набора нет, докрашивает `ViewportSemanticTokens` (по вью: видимые строки ± max(20, высота), пауза 100–500 мс, ответ по устаревшей версии отбрасывается).
- **Рендер** — `paintTextLine` после TM-стиля ячейки смотрит `SemanticTokenIndex.styleAt(offset)` (тот же документный offset, что у TM, с поправкой на ghost text) и через `applySemanticStyle` заменяет только заданные темой атрибуты (маски `SEMANTIC_USE_*` эталона). Стиль — `resolveSemanticTokenStyle` (индекс типа и биты модификаторов → имена легенды → `ISemanticTokenStyleResolver`), кадровый мемо по (легенда, тип, модификаторы). **Отступление (согласовано):** эталон запекает стиль в метаданные при приёме ответа и перезапрашивает сервер на смене темы; у нас стиль берётся при отрисовке, а смена темы лишь сбрасывает кэш резолвера.

## Мост стиля токенов (`workbench/services/themes/common/`)
`createTextMateTheme(theme)` (`workbench/services/themes/common/textMateTheme.ts`, upstream `ColorThemeData.tokenColors` + `tokenColorMap`) — правила темы для vscode-textmate и colorMap: первое правило — цвета редактора (`ColorId` 1 и 2), правила без скоупа отброшены, цвета нормализованы. `ExtensionTokenizationContributor.setTheme` (upstream `TextMateTokenizationFeature._updateTheme`) отдаёт их грамматикам (`Registry.setTheme`) и colorMap — `TokenizationRegistry.setColorMap`, чьё событие по каждому языку **перетокенизирует документы** (в их токенах индексы прежней темы); та же тема повторно — без перетокенизации. Матчинг селекторов (родительские `meta.foo bar`, специфичность) — vscode-textmate. Рядом — **`SemanticTokenStyleResolver implements ISemanticTokenStyleResolver`** (`workbench/services/themes/common/`): стиль семантического токена `(тип, модификаторы, язык)` по алгоритму `getTokenStyle` эталона — сначала `semanticTokenColors` темы (вес селектора `(type|*)(.modifier)*(:language)?`, атрибуты независимо, заданное закрыто), затем дефолтные правила `TokenClassificationRegistry` (`platform/theme/common/`; стандартные типы/модификаторы/фоллбэки эталона + `contributes.semanticTokenTypes`/`Modifiers`/`Scopes` расширений через `registerExtensionSemanticTokens`), чьи TextMate-пробы ищутся в `tokenColors` темы матчером селекторов эталона (`textMateScopeMatcher.ts`). Атрибут без значения — `undefined`, то есть остаётся от TM-токена; ничего не задано — `null`. Смена темы сбрасывает его кэш (`main.ts` зовёт `setTheme`). Связывание сервисов (`TokenizationRegistry` + `TokenStyleResolver` + `LanguageService`) — на App-уровне (`main.ts`), дальше они попадают в `EditorComponent` → `EditorElement`. **Hot-swap:** `EditorComponent` подписан на `TokenizationRegistry.onDidChange` и `TextFileModel.onDidChangeLanguage` — догрузившаяся после открытия файла грамматика и ручная смена языка подхватываются без пересоздания редактора.

## Диагностики (`platform/markers/common/`)
Провайдер-агностичный реестр диагностик (аналог VS Code `IMarkerService`). **Диагностики отвязаны от источников:** LSP / problem matchers / расширения — *поставщики* (пишут `MarkerService.changeOne(owner, resource, markers)`); squiggle в редакторе, панель Problems, счётчики — *потребители* (`read`/`onDidChangeMarkers`). Поэтому MVP собирается с одним поставщиком, без LSP.
- **`IMarker`/`IMarkerData`/`MarkerSeverity`** (`Hint|Info|Warning|Error`) — модель; `IMarker` = `IMarkerData` + `owner` (неймспейс поставщика: `"settings"`, `"typescript"`, …) + `resource` — `uri.toString()`, а не путь на диске: диагностики бывают и у недисковых ресурсов. API реестра — `changeOne(owner, resource, markers[])`, `read({ resource?, owner?, severities? })`, `onDidChangeMarkers(resources[])`; точка пересчёта поставщиков — `ITextDocument.onDidChangeContent`.
- **`MarkerService`** — чистый реестр `owner → resource → IMarker[]` без DI (зеркало `TokenizationRegistry`; DI-токен — рядом с классом, `platform/markers/common/markerService.ts`, модуль — `src/vs/diode/modules/markersModule.ts`).
- **`IMarkerDecoration`** — view-проекция маркера (`range` + `severity`), чтобы Editor не зависел от `owner`/`resource`/`message`. Рендер — `EditorElement` красит покрытые ячейки severity-цветом (`editorError/Warning/Info/Hint.foreground`) + `StyleFlags.Undercurl` (на legacy-терминалах — обычный цвет). Диапазоны живут в документе как tracked decorations (`EditorViewState.setMarkerDecorations` → `ITextDocument.deltaDecorations`, stickiness `NeverGrowsWhenTypingAtEdges`, как `markerDecorationsService` эталона): правка двигает волну сразу, до новых маркеров поставщика; новый набор заменяет сдвинутый. Проводка «поставщик → реестр → потребитель» — в Workbench (`DiagnosticsService`, см. [workbench/Shell.md](workbench/Shell.md#нижняя-панель)).

## Read-only редактор

Три уровня защиты, как в VS Code:

| Уровень | VS Code | У нас |
|---|---|---|
| Опция редактора | `EditorOption.readOnly` | `EditorViewState.readOnly` |
| Гейт команд | `precondition: EditorContextKeys.writable` | `when: "textInputFocus && !editorReadonly"` |
| Runtime-гард | `CodeEditorWidget.executeEdits` → `false` | ранний выход в мутаторах `EditorViewState` |

- Флаг живёт на **`EditorViewState`**, потому что через него проходят ВСЕ правки: клавиатура и paste,
  accept completion, rename/bulk edit, `editor.applyEdit` из расширений. Мутаторы — no-op и возвращают
  `undefined`.
- **Пути мимо view-state** закрыты на `EditorPane`: `undo`/`redo`/`setEol`/`setEncoding` идут в
  `TextFileModel` напрямую (как `pushUndoStop` в `CodeEditorWidget`); `applyActiveEditorEdits` честно
  возвращает `false`, а не врёт расширению об успехе.
- Контекст-ключ `editorReadonly` — по сфокусированному `EditorElement`, симметрично `textInputFocus`.
  Команда `workbench.action.files.toggleActiveEditorReadonlyInSession` (session-скоуп), индикация — замок
  на вкладке. Фолдинг, курсор, выделение, копирование и поиск в read-only работают, как в VS Code.
- На том же флаге стоят Output-панель (detached pane: `EditorService.openDetached` +
  `TextFileModel.openSynthetic/appendOwnedContent` — как `OutputEditor extends
  AbstractTextResourceEditor` эталона) и виртуальные документы расширений. Демо —
  `e2e/scenarios/readonlyEditor.scenario.ts`.
- На нём же стоит [режим большого файла](#режим-большого-файла): вкладка такого файла открывается
  read-only.

## Режим большого файла

Аналог `largeFileOptimizations` эталона (`TextModel._isTooLargeForTokenization`, предупреждение
`LargeFileOptimizationsWarner`): файл выше порога открывается с выключенными тяжёлыми функциями.
Отступление от эталона (решение человека 2026-10-22): у эталона такой файл остаётся редактируемым, у
нас он **открывается только для чтения**, а редактирование включается кнопкой тоста — это тот же
шов, которым этап 4 OpenPerformance ([TODO](../TODO/OpenPerformance.md#этап-4--гигантские-файлы-отдельный-режим-только-чтение-со-стримингом-)) позже
подменит загрузку документа с диска на загрузку в PieceTree.

- **Порог и решение.** `editor.largeFileOptimizations` (ключ, дефолт и описание эталона) плюс наши
  ключи `editor.largeFileSizeThreshold` (МиБ символов, дефолт 20 — константа эталона) и
  `editor.largeFileLineCountThreshold` (дефолт 300 000) — порог настраиваемый по решению человека
  2026-10-23, читается на языке файла (`"[log]": { … }` работает). Чистая функция и дефолты —
  `editor/common/model/largeFileOptions.ts`; `TextFileModelService` отдаёт опции модели
  (`TextFileModel.largeFileOptions`, как `ModelService.getCreationOptions` эталона), а модель решает
  **один раз, на первой загрузке** (`openFile`/`openProvided`) по длине и числу строк готового
  piece tree — как эталон в конструкторе `TextModel`: перечитка (revert, смена кодировки, внешняя
  правка) решение не меняет. Флаг — `BaseTextEditorModel.isTooLargeForTokenization` (имя эталона),
  единственный переход true → false — `forcefullyEnableFeatures()` с событием
  `onDidChangeTooLargeForTokenization`.
- **Что выключено и где** (потребители флага те же, что у эталона):
  токенизация — `EditorComponent.ensureTokenizerForLanguage` отдаёт `PlainTextTokenizer` и не грузит
  грамматику (эталон: `tokenizerSyntaxTokenBackend`); фолдинг — `recomputeFoldingRegions` снимает
  регионы и не считает (эталон: `folding.ts`); wrap — `applyWordWrap` принудительно `off`, запрос
  конфигурации хранится отдельно (эталон: `viewModelImpl` даёт строки как есть); вхождения —
  `applyOccurrenceHighlight` (эталон: `wordHighlighter.ts`); семантические токены — документ не
  подключается к `DocumentSemanticTokensFeature`; quick diff — `QuickDiffService.refresh` отдаёт
  пустые бары (эталон — через лимит синхронизации воркера); sync в extension host —
  `IDocumentSyncSource.isTooLargeForTokenization`, `DocumentsCustomer` такой документ не открывает
  (как эталон выше `_MODEL_SYNC_LIMIT`; на 50 МБ даже дешёвый sync — ~100 мс, #794). С 4.2 выключены и
  два фоновых прохода по всем строкам: `DocumentTokenStore` в режиме не создаётся вовсе
  (`EditorComponent.applyTokenizer`: plain-токенизатор эталона всё равно обходил файл в idle и заводил
  пустой массив на строку, а документу на диске это стоило бы чтения всего файла), вью рисует без
  хранилища; `LineWidthCache` с развёрткой ширины тоже не создаётся — `EditorElement.contentWidth` в
  режиме меряет только строки вьюпорта и держит максимум увиденного (`_maxLineWidth` эталона), флаг —
  `EditorViewState.isTooLargeForTokenization`, его ставит и снимает компонент. Слова для автодополнения
  (`editor.wordBasedSuggestions`) из большого файла не берутся — как в эталоне, где воркер не видит модель
  выше лимита синхронизации; иначе `getText()` на 2 ГБ не влез бы в строку.
- **Read-only.** `TextEditorPane` при создании ставит `viewState.readOnly` по флагу модели и подписан на
  событие: «Включить редактирование» снимает read-only у всех вкладок модели (файл в двух группах).
  Контекст-ключ `editorReadonly` пересчитывает команда.
- **Тост и выход.** Фича `workbench/contrib/largeFile/`: contribution `LargeFileOptimizationsWarner`
  (фаза `ready`) по `onActiveEditorChanged` показывает вопрос-тост «<файл>: opened read-only;
  tokenization, wrapping, folding, word highlighting, quick diff and extension sync have been turned off
  for this large file …» с кнопкой **Enable Editing** — один раз на модель, не на вкладку; detached-панели
  и стороны диффа не считаются. Кнопка и команда `workbench.action.files.enableLargeFileEditing` (палитра:
  «File: Enable Editing of Large File», когда тост уже уехал) делают одно и то же:
  `model.enableEditing()` (документ на диске сначала потоком читается в память, ниже) + пересчёт контекст-ключей; компонент по событию возвращает
  токенизатор, фолдинг, wrap, вхождения и семантику, адаптер sync шлёт flush (документ открывается
  субпроцессу), quick diff пересчитывает. Отступление: эталонная кнопка «Forcefully Enable Features»
  пишет `editor.largeFileOptimizations: false` в settings.json и просит переоткрыть файл — у нас
  сессионно и для одной модели, настройка не трогается. Демо — `e2e/scenarios/largeFileMode.scenario.ts`.

## Документ на диске

Этап 4.2 [OpenPerformance](../TODO/OpenPerformance.md#этап-4--гигантские-файлы-отдельный-режим-только-чтение-со-стримингом-):
файл выше **порога размера** режима большого файла не читается в память. **Отступление от эталона:**
VS Code читает любой файл целиком (ближайшие аналоги — klogg/glogg и `less`); у нас выше 20 МиБ
(`editor.largeFileSizeThreshold`, байты на диске — эталон считает символы; ось числа строк остаётся за
in-memory путём: порог строк решается на уже построенном piece tree) документ открывается **на диске**,
только для чтения и в режиме большого файла по построению.

- **Устройство.** `DiskTextBuffer` (`editor/common/model/diskTextBuffer.ts`) — `IDocumentBuffer` за тем же
  `TextDocument` (объект документа один на модель, как и раньше: вью, undo и слушатели не узнают о
  подмене; `TextDocument.setText` принимает готовый буфер третьим видом `TextSource`). Внутри —
  **индекс начал строк** `LineStartIndex` (`lineStartIndex.ts`: блок на кусок файла, `Uint32` смещения
  относительно базы блока — 4 байта на строку, размер файла не ограничен 4 ГБ; поиск — бинарный по
  блокам), **LRU страниц** по 1 МиБ (32 штуки — константа памяти), байты — через seam
  `IRandomAccessFile` (`platform/files/common/iRandomAccessFile.ts`: `pread` синхронно для кадра и
  асинхронно для фона; node-реализация `platform/files/node/nodeRandomAccessFile.ts`, DI-токен
  `IRandomAccessFileOpenerDIToken`, биндит `filesModule`, модель получает фабрику инъекцией от
  `TextFileModelService`, как `fileWatcher`; без неё — старый путь). `IFileService` не трогаем: у него по
  решению нет синхронных методов, а кадру страница нужна сразу.
- **Первый экран и рост.** Конструктор буфера синхронно читает и индексирует первый кусок (4 МиБ), так
  что модель рождается с первым экраном; `startIndexing()` дочитывает файл асинхронно (`fs.read` в пуле
  libuv, по 4 МиБ, один скретч-буфер). Каждый кусок — событие `onDidAppendLines` → документ ретранслирует
  как `onDidChangeContent` на последней строке (как будто в её конец вписали `\n` и новые строки), **без
  бампа `versionId`** (документ не грязный) и без `onDidChangeModelContent` (зеркала у такого документа
  нет). Пока индекс строится, строка, конец которой ещё не найден, не считается (кроме случая, когда она
  единственная); по концу файла появляется последняя — пустая, если файл кончается `\n`, как в piece tree.
  Прогресс — `onDidChangeIndexing` → `TextFileModel.onDidChangeDiskIndexing`/`diskIndexing` → статус-бар
  «Indexing N%» (`contrib/largeFile/browser/largeFileIndexingStatus.ts`, следит за активной вкладкой,
  исчезает по концу; аналога в эталоне нет).
- **Чтение.** UTF-8/ASCII (решение человека 2026-10-23): `\n` — ASCII и не встречается внутри многобайтовой
  последовательности, поэтому каждая строка декодируется сама; хвостовой `\r` снимается, EOL документа —
  по первой строке. **Одиночный `\r` строкой не считается** (piece tree считает). Строка читается не
  дальше `DISK_LINE_BYTE_CAP` (1 МиБ): минифицированный JSON в 2 ГБ не должен стать строкой на первом
  кадре. BOM utf-8 — смещение первой строки; файл с BOM UTF-16 идёт старым путём (весь в piece tree,
  режим большого файла), тост дописывает «loaded into memory: reading from disk supports UTF-8 only»
  (`TextFileModel.onDiskDeclinedReason`). Декодированная строка запоминается одна (кадр просит контент
  и длину одной строки подряд). `getValueLength()` — байты без переводов строк, верхняя оценка символов.
- **Полный текст.** `getText()`/`getTextInRange()`/`serialize()`/`getLinesContent()` читают строки с диска
  и работают, пока результат влезает в строку V8; выше `MAX_STRING_LENGTH` (`buffer.constants` node,
  2^29−24, константа — common без node) — `RangeError` с понятным текстом сразу, а не после секунд
  работы. `applyEdits`/`setEol` — отказ до того, как сдвинутся версия и декорации
  (`IDocumentBuffer.isReadOnly`); вью и так read-only, это страховка от программных правок.
- **Модель (`TextFileModel`).** `openFile`: stat → выше порога → `openOnDisk` (сниф BOM по трём байтам,
  те же вехи `textfile:read/decoded/document-built`); иначе старый путь и решение по строкам. Перечитка
  (revert, внешнее изменение) модели в режиме снова идёт на диск, если файл всё ещё выше порога (новый
  буфер, старый закрывает дескриптор), и в память, если файл сжался — режим при этом остаётся («решено
  один раз»); файл, выросший выше порога, перечитывается в память, режим не включается позже (эталон).
  `save()` → `"saved"` без записи (документ не бывает грязным); `saveAs` (с 4.5) — **копия файла**
  `IFileService.copy` (текст документа и есть байты файла: read-only, UTF-8, свой EOL — копирует ядро, через
  память ничего не идёт, участникам сохранения нечего править), затем модель переоткрывается на диске по
  новому пути, чтобы строки шли из файла, который она называет; Save As в тот же путь — без копии. До 4.5
  команда отказывала тостом (QA 4.2: отказ только в логе — молчаливый сбой).
  `reopenWithEncoding` — старый путь (остальные кодировки — в память). Той же природы копирование:
  `Ctrl+A`, `Ctrl+C` на 2 ГБ — `RangeError` из `assertFitsString`, команда Copy ловит его и показывает
  тост «too large to copy» (`clipboardActions.ts`), остальные ошибки — наверх.
- **«Включить редактирование» (4.5).** `BaseTextEditorModel.enableEditing()` — асинхронный шов кнопки и
  команды: модель в памяти просто снимает режим (`forcefullyEnableFeatures()`), документ на диске сначала
  **потоком** читается в piece tree (`TextFileModel.streamIntoMemory`): куски по 4 МиБ через
  `IRandomAccessFile.read` (пул libuv), каждый после `await`, так что кадры и клавиши получают главный поток
  между кусками; декодер (`createStreamDecoder`) и билдер (`createTextBufferFactoryBuilder`) берут куски по
  одному (A4). Пока идёт чтение, на экране остаётся документ на диске (read-only, скролл и навигация
  работают), прогресс — `TextFileModel.memoryLoading` → статус-бар «Loading N%» (та же запись, что «Indexing»,
  загрузка важнее). В конце — одна замена текста flush'ем, режим снимается, вкладки становятся
  редактируемыми. Синхронный `forcefullyEnableFeatures()` документ на диске отклоняет. Повторный клик ждёт
  ту же загрузку; закрытие модели или новая загрузка отменяют текущую (`loadGeneration`) — молча. **Внешнее
  изменение файла за время чтения** (дописанный лог, ротация) загрузку не трогает: watcher'у модель отвечает
  только после переключения (`streamingForEditing`), а там сверяет stat со снятым перед чтением и перечитывает
  файл как обычное внешнее изменение — дописанное доезжает, усечённое становится тем, что в файле сейчас. Раньше
  watcher переоткрывал документ на диске под загрузкой, и та молча отменялась: вкладка оставалась read-only
  навсегда (QA 4.5). Тост режима с кнопкой закрывается, как только модель вышла из режима любым путём (команда). **Отказы** — тост-предупреждение, вкладка остаётся
  read-only, процесс жив (`ENABLE_EDITING_REFUSALS` в `largeFileActions.ts`): `too-large` — больше
  `MAX_STRING_LENGTH` (включаемые функции — `getText()` провайдеров, формат — на таком файле всё равно не
  работали бы; решение по дедлайну PR 4.2), `out-of-memory` — до старта файл × `MEMORY_PER_FILE_BYTE` (2)
  больше свободной памяти, или по ходу её осталось меньше `MEMORY_RESERVE_BYTES` (256 МиБ), `read-failed` —
  ошибка чтения. Память спрашивает `IMemoryProbe` (`platform/memory`, node — `process.availableMemory()`:
  `MemAvailable` или остаток лимита cgroup): текст из кусков по мегабайтам живёт во внешних строках вне кучи
  V8, кончается память машины, а не куча. Синхронизации с extension host после включения нет и не было:
  её лимит — 50 МБ, как `_MODEL_SYNC_LIMIT` эталона (`documentsCustomer.ts`).
- **Перечитка большого файла в памяти** (revert, авто-перечитка чистого буфера после «Включить
  редактирование») идёт тем же потоком, если файл выше порога размера: синхронное чтение 500 МБ замораживало
  редактор на секунды при каждом внешнем изменении. Старый текст остаётся и редактируется; правка за время
  чтения побеждает файл — буфер остаётся как есть, в конфликте с диском (`hasDiskConflict`), так же — при
  нехватке памяти на вторую копию. Ниже порога — синхронно, как раньше. **Замена, а не дифф** (решение 4.5):
  перечитка — `setText` одним flush'ем; `IModelService.updateModel` эталона считает построчный общий
  префикс и суффикс и применяет разницу правкой. Не переносим: сравнение строк обеих копий — проход по всему
  файлу в главном потоке (то, от чего уходим), а то, ради чего эталону дифф, у нас держит flush — курсор и
  выделения зажимаются вью (`endsClampedByFlush`), декорации — `acceptFlush`. Отличие, которое остаётся:
  эталон кладёт перечитку в undo, у нас история после перечитки начинается заново (так было и до 4.5).
  Хвост лога (дописанное в конец) дифф решил бы дешевле — это 4.4 (follow) для документа на диске.
  Модель закрывает дескриптор при dispose (`TextDocument.dispose()` → буфер).
- **Watcher и follow (`tail -f`, этап 4.4).** Событие watcher'а (`ChokidarFileWatcher`, окно коалесцирования
  50 мс — теперь **throttle, а не debounce**: окно открывает первое событие и не продлевается следующими, иначе
  лог, в который пишут чаще окна, не доехал бы никогда; окно же — потолок частоты кадров follow) →
  `TextFileModel.handleExternalFileChange` сравнивает stat. **Тот же inode и размер вырос** → `extendOnDisk` →
  `DiskTextBuffer.extendTo(size)`: байты от проиндексированного конца дочитываются (`pread`), их строки
  дорастают индекс, страница, на которой кончался файл, дочитывается на месте (в запас `allocUnsafe(pageSize)`,
  без аллокации — сброс страницы стоил перечитки мегабайта на каждую строку), строки до старого конца не
  перечитываются; событие — изменение старой последней строки (её содержимое могло дорасти) до новой,
  `isAppend: true`, без бампа версии. Хвост до куска (4 МиБ) читается синхронно в обработчике — обычный случай:
  несколько строк за окно (скретч-буфер — по размеру хвоста: 4 МиБ `allocUnsafe` на каждую строку давали
  80 МБ/с внешней памяти и GC на треть CPU follow); больше — фоновым проходом как начальная индексация (в
  статус-баре снова «Indexing N%»); рост под идущим проходом только поднимает размер, остаток проход дочитывает
  по концу раскладки. **Усечение, другой inode (ротация: rename + новый файл с тем же именем), тот же размер с
  новым mtime** → переиндексация с нуля (reload, как раньше); усечение с перезаписью дальше старого размера в одном
  окне ловит проверка хвоста: последние 4 КиБ кэшированной страницы у старого конца перечитываются и
  сравниваются (`DISK_TAIL_CHECK_BYTES`) — страница целиком, с байтами за старым концом: кадр мог прочитать её
  после записи, но до события watcher'а; не совпали — `extendTo` отказывает и модель переиндексирует; страницы
  конца в кэше нет — рост принимается на веру. Синхронный хвост читается строго до сообщённого размера: байты,
  записанные после stat, — следующему событию. Ротация и `copytruncate` в файл ниже порога → в память с
  сохранением режима, follow — состояние вкладки и переживает перечитку и смену бэкенда (QA 4.4).
  **Дописывание в документ в памяти** (любой файл ниже порога — самый частый лог) — тоже хвостом, не
  перечиткой (на растущем логе перечитка ела 102% CPU, QA 4.4): `TextFileModel.memoryEnd` помнит, сколько байт
  прочитано (не stat: файл мог вырасти после чтения) и последние 4 КиБ; тот же inode, рост, хвост читается так
  же → новые байты декодируются и `TextDocument.appendText` вставляет их в конец piece tree правкой — версия и
  событие зеркала расширений как у правки, `isAppend` для follow, документ чистый, история undo остаётся. Только
  UTF-8 (с BOM и без); иначе, а также при несовпадении хвоста, усечении, другом inode, хвосте больше куска
  (4 МиБ) и разрезанном `\r\n` (старый `\r` уже был переводом строки) — перечитка как раньше; неполная
  последовательность UTF-8 в конце ждёт следующего события.
  **Экран едет за хвостом по курсору** (решение человека 2026-10-23, как `output.smartScroll` Output-панели
  эталона и `less +F`). `EditorViewState.followingEnds` — WeakSet самих позиций, которые едут за концом: каждое
  **явное** движение курсора решает заново — набор сбрасывается, курсоры (не диапазоны) на последней строке
  попадают в него, `followTail` = «набор не пуст»; перечитка (flush) с **первым куском** сбрасывает набор и
  кладёт в него концы, которые ехали за концом до неё, — перенесёнными на новый конец (ротация, `tail -F`,
  QA 4.4), — и концы выделений, зажатые за новым концом (50 868 вместо 262 017 у усечённого 22 МиБ лога —
  QA 4.2; выделение «от строки 10 до конца файла» так и остаётся до конца), `followTail` = «активный конец
  ехал или зажат». `isAppend`-событие двигает позиции из набора на новую последнюю строку с `ensureCursorVisible`,
  остальные остаются (ремап, не через сеттер — он решает follow только для явных движений); правка — никогда не
  «конец уехал»: замена, кончающаяся на последней строке документа в памяти, зажатый курсор не двигает.
  Начальный курсор (0,0) follow не включает (однострочный первый экран минифицированного JSON не должен утащить
  за индексом). Команда `workbench.action.editor.toggleFollowTail` (аналог
  `workbench.output.action.toggleAutoScroll`; on — курсор в конец и follow, off — набор пуст, курсор на месте)
  и индикатор статус-бара `Follow: On/Off` (`contrib/largeFile/browser/largeFileFollowStatus.ts`, слева от
  `Ln/Col`, клик — toggle, виден в режиме большого файла — на диске и в памяти) — отступление: у эталона follow для файла нет.
  Замер — `npm run bench:follow` (латентность записи строки до кадра, CPU в простое и при ровной записи).
- **Поиск — фоном порциями** (этап 4.3). На документе в памяти `FindService` ходит по строкам синхронно,
  как раньше (`findMatches`); на документе с диска — `BackgroundFind`
  (`editor/contrib/find/backgroundFind.ts`): срез до 4096 строк или 512 КиБ текста (минифицированная
  строка в 1 МиБ — срез сама по себе), между срезами `setImmediate`, так что ввод и кадр идут между ними.
  Первый срез — синхронно в `start()` (плотный запрос даёт совпадения до первого кадра). Обход начинается
  со **строки курсора** и заворачивает на начало: первое найденное — то, что виджет показывает текущим (как
  `research` эталона выбирает ближайшее после курсора), список всегда в порядке документа. Прогресс —
  при первом совпадении сразу, дальше не чаще раза в 100 мс и в конце; совпадения подсвечиваются и
  попадают в скроллбар по мере прохода. Дойдя до конца проиндексированного, пока индекс строится, обход
  **ждёт роста** (`TextFileModel.onDidChangeDiskIndexing`) и продолжает с новых строк; **заворот на начало —
  только после конца индекса**: иначе совпадение выше курсора становилось текущим раньше настоящего
  следующего (QA 4.3). Кап — `MATCHES_LIMIT`
  = 19 999, как в `findModel.ts` эталона: на 2 ГБ логе каждая строка совпадает, 21,7 млн диапазонов убивали
  процесс по OOM (QA 4.2); дойдя до капа, обход останавливается, счётчик — «19999+». Счётчик во время
  прохода — «Searching…» (не красное «No results»), «N of M…», «? of M…», пока после курсора ничего не
  найдено; **отступление**: у эталона состояния «ищу» нет, он обходит модель целиком за раз. Next/Prev
  работают по собранному списку во время прохода; текущее совпадение переживает отчёты прогресса (список
  только растёт, объекты диапазонов те же). Список, упёршийся в кап, — не весь документ: за его краями и в
  дыре, которую кап после заворота оставляет между верхом файла и курсором, совпадений нет. Поэтому на
  капнутом списке **каждый** Next/Prev ищет по документу от текущего совпадения
  (`findNextMatch`/`findPreviousMatch`), ровно как `_moveToNextMatch` эталона при
  `getCount() >= MATCHES_LIMIT`, и найденное встаёт в список на своё место (QA 4.3: учёт одних краёв на 2 ГБ
  уводил `Shift+Enter` от строки 21 690 999 на 19 242). F3/Shift+F3 при закрытом виджете, если проход ещё не
  нашёл совпадение для перехода, выделяет его отчётом, который его приносит (Shift+F3 — по концу прохода:
  совпадение перед курсором знает только завершённый обход). Совпадения дальше `DISK_LINE_BYTE_CAP` (1 МиБ)
  длинной строки поиск не видит — строка читается не дальше. Новый запрос, закрытие виджета и
  смена вкладки обрывают проход. Счётные циклы написаны под мутационный гейт: срез — обход заранее
  построенного списка строк, обход документа в `findNextMatch` — по модулю числа строк, где сломанный шаг
  даёт отрицательный индекс и `RangeError`, а не зацикливание.
- **Навигация при росте индекса.** Go to Line на строку, которой в индексе ещё нет, и `Ctrl+End` — не
  зажим на середину файла: `EditorViewState` паркует курсор на временном конце и помнит цель
  (`pendingTarget`); с каждым куском индекса (`IDocumentContentChange.isGrowth` — ставит `TextDocument`
  на ретрансляции `onDidAppendLines`) курсор едет дальше — на целевую строку, когда она появилась, или на
  новый конец (`Ctrl+End` — пока индекс не кончится; после конца индекса рост бывает только от
  дописывания — follow, 4.4). Цель сбрасывают: сдвиг курсора с места парковки, выделение, второй курсор,
  любое не-ростовое изменение (правка, перечитка). `Shift+Ctrl+End` цель не ставит. Курсор, ждущий цель,
  двигается не на каждый кусок индекса, а не чаще раза в 250 мс (`growthFollowIntervalMs`), сразу, когда
  его строка появилась, и на последнем куске (`isFinalGrowth`): каждый ход — `editor.selectionChanged` и
  `layoutChanged` в extension host, на 6 ГБ их было ~80 в секунду (QA 4.3). Скроллбар растущего
  документа ничего не требовал: `contentHeight` — число строк проекции, а она с 4.2 ключуется ревизией
  контента, не `versionId`.
- **Что не закрыто (следующие PR).** Индекс плотный (4 байта/строка, 2 ГБ логов ≈ 80 МБ) — разреженный
  вариант по требованию; страница читается синхронно и при промахе кадр ждёт `pread` (из кэша ОС — доли
  мс, с холодного HDD — десятки); проход поиска декодирует каждую строку (`getLineContent`) — на 2 ГБ это
  десятки секунд фоновой работы, побайтовый `indexOf` по кускам файла дал бы разы быстрее (follow-up по
  требованию); Windows: открытый дескриптор мешает удалить/переименовать файл; бенч и гейт — 4.6.
- **Тесты.** `diskTextBuffer.test.ts` сверяет буфер с piece tree на любых размерах куска и страницы,
  `diskTextBuffer.extend.test.ts` — дорастание хвостом (синхронно, проходом, под проходом, проверка хвоста,
  страница на месте), `lineStartIndex.test.ts` — индекс с одноразовым сканом; фейк файла —
  `TestUtils/memoryRandomAccessFile.ts` (размер можно завысить — хвост для фонового прохода или «файл, который
  не влезет в строку», — притормозить чтение, чтобы шагать индексацию руками, дописать (`append`) и перезаписать
  (`rewrite`)). Follow: `editorViewState.follow.test.ts` (курсор, команда), `editorViewState.growth.test.ts`
  (зажатые flush'ем концы), `textFileModel.follow.test.ts` (дописывание, усечение, ротация, перезапись — на
  настоящих файлах). Потоковая загрузка и перечитка — `textFileModel.streamLoad.test.ts` (многокусковый файл с
  разрезанными многобайтовыми символами, отказы, отмена, правка во время перечитки). Демо —
  `e2e/scenarios/largeFileOnDisk.scenario.ts`, `largeFileFollow.scenario.ts`, «Включить редактирование» с
  прогрессом, правкой и сохранением — `e2e/scenarios/largeFileEditing.scenario.ts`.

## Tracked decorations (декорации, которые едут с текстом)
`editor/common/model/trackedDecorations.ts` — аналог дерева декораций `textModel` эталона: `ITextDocument.deltaDecorations(oldIds, [{ range, options: { description, stickiness } }])` → id, `getDecorationRange(id)` — текущий диапазон. Сдвиг — порт `nodeAcceptEdit` (`intervalTree.ts`) в позициях вместо офсетов: `TextDocument.applyEdits` двигает декорации ДО применения батча к буферу, снизу вверх по правкам (смещения внутри заменяемого диапазона меряются по старому тексту; длины нужны только строк правки до её последней, а их нижние правки не трогают), то есть раньше любых событий правки; поведение краёв — `TrackedRangeStickiness` (те же 4 значения), проверено дословной таблицей «Decorations and editing» эталона. Диапазон при добавлении приводится к документу (`validateRange`). `setText` (flush) правок не несёт — диапазоны остаются на прежних координатах, приведённые к новому тексту (отступление: эталон на `setValue` декорации сносит, но перечитку файла проводит диффом правок, и декорации переживают её). Упрощение — плоский `Map` и линейный проход на правку, без `IntervalTree`; `forceMoveMarkers`/`collapseOnReplaceEdit` нет. Владельцы — вью: декорации маркеров каждой `EditorViewState` свои и снимаются её `dispose`. Остальные декорации (поиск, вхождения, gutter-бары) пока пересчитываются владельцами — follow-up в [docs/TODO/TrackedDecorations.md](../TODO/TrackedDecorations.md).

## View-проекции декораций (`editor/common/model/`)
Провайдер-агностичные view-модели декораций, которые Editor рисует, не зная про их источник — источник резолвит всё (в т.ч. цвета) и пушит готовую проекцию.
- **`IGutterChangeDecoration`** (`range` + `color` — упакованный RGB) — «мини-полоса» в гуттере (dirty-diff/SCM, как в VS Code). `EditorElement.gutterChangeDecorations` строит на кадр `Map<логическая строка → цвет>` и рисует бар-глиф `▎` в крайней левой колонке гуттера (слева от номера строки), не трогая fold-chevron и номера; deleted-хунк — одна строка-граница (range в одну строку). Сеттер — `EditorComponent.setGutterChangeDecorations` (присвоить + `markDirty`); **цвета приходят уже резолвнутыми, `applyTheme` их не касается.** Проводку «git/SCM → цвет → декорация» поставляет отдельный source-control-слой (в этом ядре ещё не подключён).
- **`IExternalDecorations`** (`editor/common/model/iEditorDecoration.ts`) — пакет декораций от внешнего владельца вью (панель диффа v2): фоны строк (`lineBackgrounds`), intra-line диапазоны (`rangeBackgrounds`), маркеры своей колонки гуттера (`gutterMarkers`, колонка существует только при маркерах) и наполнение зон (`zones`: `fillChar` филлеров / `text` плашек). В отличие от gutter-change-баров, **цвета здесь — токены темы** (`colorToken`), резолв через `styleVar` на рендере: hot-swap темы перекрашивает бесплатно. Сеттер — `EditorComponent.setDecorations`.
- **Ghost text** (`editor/common/model/iGhostText.ts`, inline suggest) — фантомный текст, которого нет в буфере: `EditorElement.setGhostText({line, character, lines})` вклеивает `lines[0]` серым курсивом (`editorGhostText.foreground`) ФАНТОМНЫМИ КОЛОНКАМИ внутрь layout строки каретки, а под `lines[1..]` элемент сам заводит view zones (свои зоны и внешние `decorations.zones` владельца взаимоисключающи: ghost ставится только на редакторе файла, у диффа зонами владеет `diffEditorPane2`). Фантомные колонки — `ILinePhantom` + `composedLineContent`/`composedOffset`/`composedCaretOffset`/`documentOffset` (`browser/textViewRendering.ts`): строка сегментируется в `DisplayLine` вместе с фантомом (аналог injected-text декораций upstream), поэтому хвост строки уезжает вправо, а не прячется под фантом, а колонки всех проходов кадра считаются по ОДНОЙ композитной строке — текст с токенами (`paintTextLine`, фантомные слоты токен не ищут), фоны диапазонов и волны диагностик (`forEachRangeCell`), каретки (`paintCarets`/`caretLocalCell` — точка вставки остаётся СЛЕВА от фантома) и hit-test (`docPositionAt` — клик по фантому отдаёт точку вставки). Строки-зоны рисует `paintPhantomText`. Ставит `InlineCompletionsService` (workbench/contrib/inlineCompletions).
- **View zones** (`editor/common/viewModel/iViewZone.ts`, PR-2 DiffEditable) — виртуальные строки `{afterLine, size}` в проекции вью ПОСЛЕ фолдинга: выравнивают стороны диффа v2. Кодируются в массиве видимых строк отрицательными числами с якорем; каретка непроходима by construction (позиции документные), PageUp/Down шагают по строкам вью; якоря переживают правки общим ядром сдвига с фолдами. Раскладку целиком (зоны + фолд-регионы unchanged-кусков + `IExternalDecorations` обеих сторон) считает чистый `editor/common/diff/diffV2Layout.ts`; его же `computeInlineLayout` даёт inline-режим (PR-6): один редактор modified, удалённые строки original — многострочные зоны-«призраки» (`IViewZoneDecoration.lines` с пер-строчными цветами, адресация `zoneRowForViewLine(viewLine) → {anchor, offset}`).
