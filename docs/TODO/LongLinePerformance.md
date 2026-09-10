# Производительность на очень длинных строках

**Статус: базовый фриз устранён; межредакторная связь через кадр рендера снята
damage-tracking'ом кадра (2026-08-04).** Обнаружено на Output-панели: канал
`extensions.host.rpc` пишет строки в десятки-сотни тысяч символов, и на них
редактор подвисал, подвешивая интерфейс целиком.

## Что сделано (конспект)

Порог рендера `STOP_RENDERING_LINE_AFTER = 10 000`
(`src/vs/editor/common/viewModel/longLineRendering.ts`), аналог
`editor.stopRenderingLineAfter` в VS Code:

- **`DisplayLine.stopAfter`** (движок): за порогом сегментируется только префикс,
  `columnMap` аллоцируется по длине префикса, выставляется `isTruncated`. Дефолт
  `Infinity` — нередакторные вызовы не тронуты.
- **Инкрементальный кеш ширины** `LineWidthCache`
  (`src/vs/editor/common/viewModel/lineWidthCache.ts`): подписан на
  `onDidChangeContent`, пересчитывает только изменённые строки. Это и снимает
  Output-фриз (append бампает `versionId`, но пересчитываются 1–2 строки).
- **Единый seam** `EditorViewState.displayLineFor()` с порогом — через него идут
  все per-строчные постройки `DisplayLine` (рендер, каретка, навигация, hit-test).
- **Плашка `Long line trimmed`** на месте отреза (warning-фон); ширина учтена в
  `contentWidth`, `revealPosition` доводит скролл до неё. Пока инертна — reveal
  как в VS Code `longLinesHelper` в «Осталось». Демо — `e2e/scenarios/longLine.scenario.ts`.
- **Damage-tracking кадра** (движок, механика — [LAYOUT.md (tuidom)](https://github.com/tuidom/tuidom/blob/main/docs/LAYOUT.md)):
  экран — ретейн-буфер, кадр перерисовывает только повреждённые области; клавиша в
  основном редакторе не рендерит поддерево Output. Бенч
  `src/vs/editor/browser/crossEditorDamage.bench.ts`: сплит с устоявшейся
  10k-строкой 3.41 → 1.35 мс/клавишу (налог соседнего Output снят полностью).

## Осталось

По damage-tracking'у кадра (v1 — не хуже прежнего полного кадра):

- **Hover-damage**: движение мыши метит hover по цепочке предков
  (`mouseEventDispatcher`) — пересечение границы крупной панели повреждает её
  rect целиком. Чистый фикс — paint-damage из стилевого прохода только при
  реально изменившихся resolved-цветах.
- **Пер-item damage в `OverlayLayer`**: операции item'ов метят весь слой
  (полноэкранный rect) — печать при открытом саджесте платит полный кадр.
- **Сужение страховки consumed-key**: сейчас fallback (markDirty корня, только
  если обработчики ничего не пометили); команды, мутирующие состояние молча,
  дают полный кадр — сужать по-командно.
- **Клип-ограничение цикла строк редактора**: виджет, чей rect пересекает чужую
  маленькую damage-область, рендерит все видимые строки (клип срезает запись,
  не работу). GOAL.md §3 предписывает visibility-awareness — ограничить цикл
  строками `context.clipRect`.

По длинным строкам:

- **Пер-строчный кеш `DisplayLine`**: `displayLineFor()` усекает строку порогом,
  но не кэширует — каждый кадр гоняет `Intl.Segmenter` по префиксу до 10k
  (~5 мс на видимую 10k-строку). Инвалидация — по идентичности строки:
  `getLineContent(i)` возвращает ровно `this.lines[i]`, нетронутые строки
  сохраняют ссылку — кеш по `lineIndex` со стражем `content ===` даёт O(1)-hit.
  Посадить на `EditorViewState` за тем же seam `displayLineFor()`.
- **reveal-по-клику** за порогом (VS Code `longLinesHelper` снимает cap на клик за
  местом отреза) — сейчас курсор за порогом клампится к маркеру.
- **Конфиг** `editor.stopRenderingLineAfter` — порог захардкожен константой.
- **Ленивое окно вьюпорта**: даже с cap `DisplayLine` аллоцирует до 10k слотов, а
  `charAtColumn`/`graphemeAtColumn` — линейный скан по слотам; окно по видимым
  колонкам убрало бы и это. Тогда же — горизонтальный скролл в хвост без обрезки.
- **large-file режим** (VS Code `largeFileOptimizations`): порог по размеру файла,
  гасящий дорогие фичи при открытии гигантских файлов.
