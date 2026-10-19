# Модель документа и токенизация из VS Code

**Статус**: `[~]` — план согласован с человеком 2026-10-19; B1 (фоновая и вьюпортная
токенизация) сделан. Порядок — по очереди, каждый шаг вливается до следующего:
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

### [ ] A1. Вендор PieceTree
`model/pieceTreeTextBuffer/{pieceTreeBase,rbTreeBase,pieceTreeTextBuffer,pieceTreeTextBufferBuilder}.ts`
(~3.1k строк), `core/textChange.ts`, нужное из `model.ts` (1.6k строк интерфейсов — иссечения или
расширение шима). `core/misc/eolCounter.ts` уже перенесён с B1. Пока никем не используется.
Исходный буфер — сразу **чанкованный** (≤ 64 КБ, как `PieceTreeTextBufferBuilder`), иначе
стриминг этапа 4 OpenPerformance переделает его заново.

### [ ] A2. Вендор upstream-тестов PieceTree
Фаззинг-тесты эталона — главная гарантия корректности перенесённого дерева.

### [ ] A3. `TextDocument` поверх PieceTree за тем же `ITextDocument`
Контракт, который обязан сохраниться (тесты `textDocument.*` остаются зелёными **без правок**):
- `getText()`, `getLineContent`, `getLineLength`, `lineCount`, `getLength()`,
  `getPositionAt ↔ getOffsetAt` (O(log n));
- `applyEdits(edits[])` — батч снизу вверх; `setText(text)` (`isFlush`);
- **`onDidChangeContent`** — `{ startLine, oldEndLine, newEndLine }` с теми же координатами и в
  том же порядке (документный, последовательный — см. [arch/Editor.md](../arch/Editor.md)); на нём
  стоят `DocumentTokenStore`, декорации, маркеры, view-state;
- `onDidChangeModelContent` (точные правки для зеркала в extension host), `versionId`, декорации;
- inverse edits — из `reverseEdits` PieceTree; undo остаётся на inverse-edits, снапшоты дерева —
  опционально позже;
- честные CRLF и смешанные EOL (сейчас теряются в `split`).

### [ ] A4. Полный текст с горячих путей
Сборка из чанков чтения; `extHostDocuments.ts` (полный `getText()` на правку), QuickDiff,
`serialize` — через снапшот/итератор. `getText()` наружу — только потребителям с лимитом.

Метрика ветки A: вставка/Enter/undo на `xlarge` не зависят от размера, RSS падает.

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
