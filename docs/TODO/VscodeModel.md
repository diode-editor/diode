# Модель документа и токенизация из VS Code

**Статус**: `[~]` — план согласован с человеком 2026-10-19; B1 (фоновая и вьюпортная
токенизация), A1+A2 (вендор PieceTree с upstream-тестами), A3 (`TextDocument` на PieceTree) и A4
(полный текст с горячих путей) сделаны. Порядок — по очереди, каждый шаг вливается до следующего:
**B1 → A1+A2 → A3 → A4 → (замер) B2 → B3**. Жадные O(N) проходы вью — отдельно, этап 2
[OpenPerformance](OpenPerformance.md).

Цель — большие файлы как в VS Code: `Ctrl+End`, вставка, Enter, undo на `xlarge` (13 МБ,
200k строк) не зависят от размера файла (сейчас — 11.7 с / 157 / 380 / 300 мс), RSS падает. Путь —
не переписывать своё, а **вендорить эталон** механизмом diff-движка
(`scripts/import-vscode-editor.mjs`, см. [ARCHITECTURE.md](../ARCHITECTURE.md#дословный-перенос-upstream-editorcommondiff)).

## Решение о координатах

- Ядро diode остаётся **0-based `{ line, character }`** (`core/iPosition.ts`, `core/iRange.ts`,
  ~70 файлов). Это конвенция API расширений VS Code и LSP — туда без конверсий. Переход ядра на
  1-based отвергнут: месяцы работы, а выигрыш — только совпадение с эталоном.
- Код эталона **вендорится дословно** (внутри 1-based) и закрывается адаптером за нашими
  интерфейсами (`ITextDocument` и т. п.). **±1 — только в адаптере.** Пример — `tokens/documentTokenStore.ts`.
- Неприятность: вендоренный `core/position.ts` экспортирует свой `IPosition`
  (`lineNumber`/`column`), наш `core/iPosition.ts` — свой (`line`/`character`). Перепутать не даёт
  TS, но читать неудобно. Правило записано в [arch/Editor.md](../arch/Editor.md#координаты-ядро-0-based-вендор-1-based).

## Находки разведки (2026-10-19)

- **`Ctrl+End` на `xlarge` 11.7 с — синхронная токенизация**: прежний
  `DocumentTokenStore.tokenizeUpTo()` гнал TextMate по всем 200k строкам до низа вьюпорта.
  Лечится B1.
- **Открытие `xlarge` 1.5 с — не буфер**: документ строится за 27 мс, остальное — жадные
  проходы вью (этап 2 OpenPerformance).
- **Наши токены — массивы строк-скоупов** на каждый токен (`languages/iLineTokens.ts`:
  `{ startIndex, scopes: string[] }`), рендер резолвит стиль по стеку скоупов на каждом кадре.
  VS Code — бинарные `Uint32Array` (2 числа на токен, цвет из colorMap). Вероятно заметная доля
  1.15 ГБ RSS на `xlarge` — не замерено (замер — перед B2).
- Полный `getText()` на правку: `workbench/api/common/extHostDocuments.ts`; всего 35 вызовов
  `getText()` вне тестов.
- `TextDocument` (`editor/common/model/textDocument.ts`) — `string[]`, `split(/\r\n|\n/)` теряет
  смешанные EOL.

## Ветка B — токенизация

### [x] B1. Фоновая и вьюпортная токенизация
Вендор `model/textModelTokens.ts` (`TokenizerWithStateStore`, `TrackingTokenizationStateStore`,
`RangePriorityQueueImpl`, `DefaultBackgroundTokenizer`, `findLikelyRelevantLines`) и его мелких
зависимостей (`model/fixedArray.ts`, `core/misc/eolCounter.ts`, `base/common/stopwatch.ts`).
`DocumentTokenStore` — адаптер, аналог upstream `TokenizerSyntaxTokenBackend`:

- **фон** — `DefaultBackgroundTokenizer` кусками по ~1 мс, уступает через `setTimeout0`
  (`setImmediate` — осознанное отступление, см. шапку `base/common/platform.ts`);
- **вьюпорт** — `tokenizeViewport(top, bottom)` на каждый кадр: за фронтиром фона — эвристика
  (стартовое состояние угадано по строкам с меньшим отступом), фон потом перекрашивает честно;
- **каретка** — `forceTokenization` (smart select) / `tokenizeIfCheap` (автокомплит, как
  `suggestModel` эталона).

Открытый вопрос «можно ли без B2» решён так: эталон с токенами только **передаёт** их из
токенизатора в builder, не читая. Формат подменён узкими шимами по тем же путям
(`editor/common/languages.ts`, `tokens/lineTokens.ts`, `tokens/contiguousMultilineTokens*.ts`,
`languages/nullTokenize.ts`, `model.ts`, `model/mirrorTextModel.ts`), иссечены только два метода,
читающих бинарный формат (`getTokenTypeIfInsertingCharacter`, `tokenizeLinesAt`). B2 заменит шимы
upstream-файлами.

Отступления от эталона (записаны в коде):
- первый кадр `small` — сразу с подсветкой (грамматика ждётся до открытия файла,
  `workbenchStartup.ts`) — как и было;
- вьюпорт пересчитывается каждый кадр с памятью «тот же вьюпорт той же версии», а не по смене
  видимых строк: правленые строки кэша у нас пусты (у эталона — старые токены, сдвинутые правкой);
- нижняя строка вьюпорта, равная первой невалидной, досчитывается (эталон её не трогает).

Не перенесено: `editor.largeFileOptimizations` / `isTooLargeForTokenization` (20 МБ / 300k строк) —
этап 4 OpenPerformance; отладочный «второй фон» (`backgroundTokenizerShouldOnlyVerifyTokens`) — с B3.

### [ ] B2. Бинарные токены + colorMap
`tokenizeLine2` vscode-textmate, `LineTokens`/`ContiguousTokensStore` эталона вместо шимов.
Сначала — замер доли памяти/кадра на скоупы. Задевает тему (colorMap), рендер, семантические
токены, потребителей скоупов (`smartSelect/tokenCodeAt`, автозакрытие, `standardTokenType.ts` —
у VS Code `StandardTokenType` в метаданных). Вернутся иссечённые
`getTokenTypeIfInsertingCharacter` и `tokenizeLinesAt`.

### [ ] B3. Воркер
Порт `workbench/services/textMate/browser/backgroundTokenization/`
(`threadedBackgroundTokenizerFactory`, worker). Снимает задержку подсветки ~100 мс на старте
(компиляция 367 regex ~60 мс + wasm JIT ~20 мс) и разгружает главный поток.

## Ветка A — PieceTree (хранение текста)

[GOAL.md](../../GOAL.md) требует Piece Table-подобную структуру: большие файлы (десятки/сотни МБ),
дешёвый undo/redo, вставка в середину без копирования текста. VS Code — **Piece Tree**
(красно-чёрное дерево кусков с кэшем стартов строк), см.
[блог](https://code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation).

### [x] A1. Вендор PieceTree
Перенесено дословно (`scripts/import-vscode-editor.mjs`):
`model/pieceTreeTextBuffer/{pieceTreeBase,rbTreeBase,pieceTreeTextBuffer,pieceTreeTextBufferBuilder}.ts`
без единого иссечения; `core/textChange.ts`; поиск по буферу `findMatchesLineByLine` —
`model/textModelSearch.ts`, `core/{wordCharacterClassifier,characterClassifier}.ts`,
`base/common/uint.ts`. Пока никем не используется (в `dist/main.cjs` не попадает — tree-shaking).

Иссечено (причины — в скрипте):
- `TextChange` — бинарная сериализация (`write`/`read`, для undo-стека эталона в `Uint8Array`):
  тянет `base/common/buffer.ts` и `core/stringBuilder.ts`;
- `textModelSearch.ts` — `SearchParams` (разбор запроса виджета поиска, `strings.createRegExp`)
  и `TextModelSearch` (поиск по `TextModel` целиком). Остались `Searcher`, `createFindMatch`,
  `isValidMatch` — их и зовёт PieceTree. Если поиску понадобится `SearchParams` — вернуть
  иссечение и дописать шим `strings.createRegExp`.

`model.ts` — **расширение шима**, а не вендор с иссечениями: из 1.6k строк нужны ~15 объявлений
контракта буфера (`ITextBuffer`, `ITextBufferFactory`, `EndOfLinePreference`, `FindMatch`,
`SearchData`, `ApplyEditsResult`…), а файл целиком тянет ~20 модулей (декорации, события модели,
языки, undo) — иссечений было бы больше, чем оставленного. Прочие шимы: `strings.ts`
(+10 функций), `map.ts` (`LRUCache` на порядке вставки `Map`), `lazy.ts` (upstream не проходит
наш `strict`: `unknown` из `catch` в поле `Error`), `date.ts` (`safeIntl.Segmenter`),
`mirrorTextModel.ts` (`IModelContentChange` в полной форме: `rangeOffset`/`rangeLength`),
`lifecycle.ts` — алиас `Disposable._register` (имя эталона; наш `register`).

### [x] A2. Вендор upstream-тестов PieceTree
`editor/test/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.test.ts` — по upstream-пути,
дословно, перегенерируется `--check`. **87 из 87** кейсов идут в vitest и зелёные (~0.2 с), ни
один не иссечён. Mocha-глобалы — импорт из `src/TestUtils/mochaCompat.ts`, который скрипт
вставляет после баннера (`this.timeout()` — пустышка). Сьют `snapshot` зовёт `createTextModel`
эталона (весь `TextModel` с DI) — шим `editor/test/common/testTextModel.ts` ведёт эти кейсы к
буферу тем же путём, что `TextModel` эталона (фабрика билдера, `ValidAnnotatedEditOperation`,
`createSnapshot(false)`).

### [x] A3. `TextDocument` поверх PieceTree за тем же `ITextDocument`
`model/textDocument.ts` — адаптер над `PieceTreeTextBuffer` (устройство и решения —
[arch/Editor.md](../arch/Editor.md#хранение-текста-piece-tree-эталона)). Тесты `textDocument.*`,
`trackedDecorations`, `undoManager.*`, `editorViewState.*`, `documentTokenStore.*` зелёные без
правок; новые кейсы адаптера — `textDocument.pieceTree.test.ts`. Наш `computeInverseEdits` ушёл —
обратные правки из `reverseEdits` буфера.

- **EOL — нормализация при загрузке, как у эталона по умолчанию** (`normalizeEOL`), а не честное
  хранение смешанных EOL: поведение для пользователя то же, что было, кроме одиночного `\r` — он
  теперь перевод строки, как в VS Code. Честное хранение mixed EOL — не в планах (эталон его тоже
  не делает по умолчанию).
- `getLength()` и `getPositionAt ↔ getOffsetAt` в `ITextDocument` не добавлены: потребителей нет.

**Замер** (`bench:open`, локально, медианы; xlarge — 2 круга × 5 прогонов поочерёдно): до текста
и правки — в пределах шума, `Ctrl+End` на xlarge 165 → 33–86 мс, peak RSS xlarge 512 → 483 МБ,
`main.cjs` +92 КБ. **Правки на xlarge от A3 не ускорились** (вставка ~200, Enter ~340,
undo ~350 мс что до, что после): CPU-профиль клавиши (`--cpu-prof` бинаря через drive) — ~100 мс
синхронно во вью при ~10 мс на буфер: рендер маркер-декораций (`paintMarkerDecoration` по всем
маркерам TS), `buildProjection`, `visualToLogicalLine`; асинхронно — `computeIndentationFolds` и
вхождения слова (`findTextMatches`) полным проходом по строкам. Это этап 2
[OpenPerformance](OpenPerformance.md), а не буфер. Цена A3 там: полный проход `getLineContent` по
200k строк — ~20 мс вместо ~1 мс у `string[]` (O(log n) на строку), поэтому эти проходы стали
дороже в абсолюте (фолдинг ~2.4× по профилю). `getLineLength` адаптер считает через
`getLineContent` — иначе тот же проход стоил бы ~110 мс.

### [x] A4. Полный текст с горячих путей
- **Сборка из кусков чтения.** `textFileModel` читает файл кусками (`readFileChunks`), потоковый
  декодер `editor/common/model/encodingStream.ts` отдаёт куски текста билдеру
  (`createTextBufferFactoryFromChunks`; `TextDocument`/`setText` принимают фабрику): ни буфера
  всего файла, ни строки всего текста. Граница куска режет `\r\n`/суррогат (держит билдер) и
  многобайтовую последовательность utf-8 / нечётный байт UTF-16 (держит декодер); тесты на все
  разрезы — `encodingStream.test.ts`, `textDocument.chunks.test.ts`, на настоящем файле —
  `textFileModel.chunks.test.ts`.
- **Кусок — 4 МБ, а не 64 КБ эталона.** С 64 КБ peak RSS на `xlarge` был 532–536 МБ против
  477–492 у main (чередующиеся прогоны): строки кусков жили в куче V8, а прежняя одна строка
  файла — внешняя (node отдаёт декод больше ~1 МБ, `EXTERN_APEX`, вне кучи). С кусками ≥ 1 МБ —
  489–492. Вторая цена кусков: первый полный `getText()` (синхронизация с extension host на
  открытии) на одном куске был бесплатным (`substring` всей строки — та же строка), на кусках —
  копия; на 20 МБ файле 25 → 90 мс.
- **Сохранение снимком.** `TextDocument.createSnapshot()` (куски буфера уже с EOL документа,
  мелкие склеены до 64 КБ, как `TextModelSnapshot`) → `encodeChunks` (суррогат на границе ждёт
  пару). В `IFileService.writeFile` всё ещё уходит один `Uint8Array` — потоковая запись — этап 4.
- **iconv-кодировки — разово**: потоковый декодер iconv-lite 0.7.3 теряет символы gb18030 на
  границе куска (пойман тестом на разрезы), поэтому iconv получает куски склеенными; они бывают
  только у явного Reopen with Encoding.
- **Горячие `getText()` убраны:** участники сохранения (`ISaveSnapshot.text` — ленивый геттер;
  диапазон «весь документ» у code actions / format on save — по строкам), QuickDiff и дифф-редактор
  на каждую правку — `getLinesContent()` (строки оригинала QuickDiff кэшируются разбитыми),
  `positionAt` зеркала документа в extension host — без склейки всего текста.
  `extHostDocuments.ts:426` (`prev.getText()`) — **не** на правку: только на открытии/flush; правки
  зеркало и так применяет дельтой (`acceptChanges`), лимит синхронизации уже 50 Mi, как у эталона.

**Замер** (`bench:open`, локально, машина под чужой нагрузкой, load ~3.7 на 4 ядрах; два круга
main/ветка поочерёдно, по 3 прогона, медианы кругов). Бенч получил шаг «сохранение» (Ctrl+S до
`×` на вкладке).

| | до текста | peak RSS | вставка | Enter | сохранение |
| --- | ---: | ---: | ---: | ---: | ---: |
| `small` main | 243 / 222 | 213 / 204 | 61 / 62 | 31 / 16 | 20 / 22 |
| `small` A4 | 250 / 221 | 216 / 214 | 58 / 57 | 25 / 26 | 18 / 18 |
| `large` main | 485 / 404 | 277 / 274 | 109 / 73 | 87 / 44 | 45 / 57 |
| `large` A4 | 400 / 449 | 275 / 277 | 74 / 80 | 51 / 63 | 54 / 81 |
| `xlarge` main | 2389 / 2212 | 473 / 486 | 296 / 211 | 379 / 309 | 397 / 321 |
| `xlarge` A4 | 2376 / 1963 | 472 / 484 | 211 / 213 | 328 / 344 | 266 / 364 |

Всё — в пределах шума: на 13 МБ файле бенч A4 не видит ни в открытии, ни в памяти, ни в
сохранении, ни в клавише (клавишу держит вью — замер A3). Выигрыш A4 структурный: нет буфера и
строки всего файла (потолок длины строки V8 — для этапа 4), сохранение и участники не строят
строку документа, правка не строит её в QuickDiff/дифф-редакторе/зеркале расширений.

Оставлены (полный текст нужен по смыслу или вызов не на правку/кадр/сохранение): синхронизация с
extension host на открытии и flush (`documentSyncAdapter`; эталон шлёт строки —
`IModelAddedData.lines`, кандидат для этапа 4), `extHostDocuments.open`, команды (формат,
rename, code actions, whitespace, references), `applyFormattingEdits`, `bulkEditBuffers`,
`diagnosticsService` (только settings.json), `editorService` (перенос грязного файла),
`diffEditorPane2` (сверка снимка, revert куска), **word-based completions** (`completionService`:
полный текст всех документов на запрос подсказки — O(N) проход, как и у эталона в воркере; ровно
место для лимита или воркера). Остальные `.getText()` — у UI-меток, не документов.

Метрика ветки A: вставка/Enter/undo на `xlarge` не зависят от размера, RSS падает. После A3
ясно, что одной веткой A её не достать: правку на xlarge держат O(N) проходы вью (см. замер A3) —
метрика закрывается вместе с этапом 2 OpenPerformance.

## Ветка C — по замерам

- `intervalTree` для декораций (1.3k строк), если бенч покажет цену `TrackedDecorations`.
- Не переносим: `TextModel` целиком, `editStack`, скобки/гайды, tree-sitter.

## Риски

- Объём `model.ts`, который потянет PieceTree.
- Семантика событий: тесты `textDocument.*` должны остаться зелёными без правок.
- Бандл +100–150 КБ — замерить.

## Связанные файлы

- `scripts/import-vscode-editor.mjs` — перенос и `--check`
- `src/vs/editor/common/tokens/documentTokenStore.ts` — адаптер токенизации (B1)
- `src/vs/editor/common/model/textDocument.ts` — текущее хранение текста
- `src/vs/editor/common/model/iTextDocument.ts`, `iDocumentContentChange.ts` — контракт и событие
- `src/vs/editor/common/model/undoManager.ts` — undo-стек
