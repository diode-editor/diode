# SearchPerformance — тормоза курсора в дереве результатов поиска

Статус: `[~]` — диагностика сделана, репро-тесты написаны; фиксы впереди.

Симптом: заметные лаги при движении курсора (стрелки) по дереву результатов
в окне поиска. Диагностика (2026-08-03) показала: это не один баг, а
перемножение нескольких стоимостей. Все случаи закрыты воспроизводимыми
тестами/бенчами (см. карту ниже) — тесты **пиннят текущее патологическое
поведение**; каждый фикс обязан поменять соответствующий ассерт.

## Замер (searchCursor.bench.ts, итерация = ↓ + ↑ = 4 кадра)

| фикстура | mean/итерация | ≈ на нажатие |
| --- | --- | --- |
| 200 строк, короткий `after` | 7.2 мс | ~3.6 мс |
| 200 строк, `after` 10k символов | **538 мс** | **~270 мс** |
| 10k строк, короткий `after` | 39 мс | ~20 мс |

Доминирует длина строки (×75 к базе), затем число строк (×5.4).

## Случаи и репро

1. **Необрезанный хвост строки у истока.** `formatMatchRow`
   (`src/vs/workbench/contrib/search/browser/searchResultRows.ts`) обрезает
   только `before` (24 символа); `preview.after` — весь остаток строки файла
   (`splitPreviewByBytes` в `textSearch.ts`), и rg запускается без
   `--max-columns`. Один матч в минифицированном/lock-файле кладёт в ряд
   сотни килобайт.
   Репро: `searchResultRows.longLines.test.ts`.

2. **Двойная сегментация всего текста лейбла на каждом кадре.**
   `TextLabelElement` строит `DisplayLine` (полный `Intl.Segmenter`-проход,
   слот на графему) в `performLayout` и ещё раз в `drawText`, без `stopAfter`
   и без кэша. Стоимость одного построения — [LongLinePerformance.md]
   (LongLinePerformance.md): 10k ≈ 4.9 мс, 200k ≈ 72 мс. Кап `stopAfter`
   применён только к редакторному шву.
   Репро: `tuidom/ui/text/textLabelElement.segmentationCost.test.ts`.

3. **2–3 полных синхронных кадра на одно физическое нажатие.** Парсер на
   каждый keydown синтезирует keypress (под Kitty ещё keyup), а
   `TuiApplication.handleInput` завершается безусловным `renderFrame()` на
   каждое событие; автоповтор не коалесится. Кадры keydown/keyup обычно дают
   пустой терминальный diff — CPU сожжён впустую.
   Репро: `tuidom/dom/tuiApplication.framesPerKey.test.ts`.

4. **Каждый кадр — полный.** `renderFrame` = `screen.clear()` + layout +
   render всего дерева воркбенча; `isLayoutDirty` контейнерами не читается,
   damage-tracking нет (это уже названо в [LongLinePerformance.md]
   (LongLinePerformance.md)).
   Репро: последний тест в `tuiApplication.framesPerKey.test.ts`.

5. **O(N) стилевой проход по всем строкам списка.** В `ListViewElement`
   layout/render/hitTest виртуализированы, а `performStyleResolution` — нет:
   строки — настоящие дочерние элементы, движение курсора помечает список
   subtreeStyleDirty, и базовый цикл обходит все N детей. Фокус хуже:
   `markStyleDirty` рекурсивно помечает все N хостов и лейблов.
   Репро: `tuidom/ui/list/listViewElement.styleResolutionCost.test.ts`.
   (Контраст: `TreeViewElement` рисует ряды без дочерних элементов — у
   эксплорера этой стоимости нет.)

6. **Пересборка проекции на каждый матч при стриминге результатов.**
   `appendRow` → `invalidateProjection()`; кадр во время стрима платит полный
   DFS + пересборку `visibleIndexById`.
   Репро (стоимость): существующий `listViewElement.bench.ts`
   («append 10k rows»).

## Направления фиксов (по соотношению эффорт/эффект)

1. Обрезать `preview.after` (симметрично `trimBefore`) и/или `--max-columns`
   в rg-аргументы — дёшево, убивает патологию у истока (случай 1).
2. `stopAfter`/кэш `DisplayLine` в `TextLabelElement`/`drawText` — лечит все
   лейблы, не только поиск (случай 2).
3. `handleInput` → `scheduleRender()` вместо синхронного `renderFrame()` —
   схлопывает кадры нажатия и автоповтора (случай 3).
4. Переопределить `performStyleResolution` в `ListViewElement` — O(видимого),
   как остальные проходы (случай 5).
5. Damage-tracking кадра — большая механика, трекается в
   [LongLinePerformance.md](LongLinePerformance.md) (случай 4).
