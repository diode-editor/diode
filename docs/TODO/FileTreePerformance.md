# [~] Производительность больших файловых деревьев

При открытии большой директории Diode тормозил: медленное открытие воркспейса и
лаги при навигации. Главные блокеры (синхронный walk + рекурсивный watch на старте,
дорогой `search` на каждое нажатие) уже устранены — см. «Сделано». Остаток —
точечные фиксы в «Будущих фиксах».

## Как запускать бенчи

```
npm run test:perf
```

Конфиг — `vitest.perf.config.ts` (отдельный от обычного `npm test`, не влияет на
coverage). Бенчи: `src/**/*.bench.ts`, общие фикстуры — `src/TestUtils/perfFixtures.ts`.

| Бенч | Что меряет |
| --- | --- |
| `FileSearchService.bench.ts` → `activate / index N files` | время фонового обхода до готовности индекса (с уступками event loop) |
| `FileSearchService.bench.ts` → `search …` | стоимость одного запроса в Quick Open |
| `FileTreeDataProvider.bench.ts` → `getChildren …` | раскрытие одного большого каталога |
| `TreeViewElement.bench.ts` → `refresh / toggleExpand / render` | flatten + O(N) сканы + рендер кадра |

## Baseline (для отслеживания регрессов; абсолют зависит от машины)

| Бенч | mean |
| --- | --- |
| `activate / index 1000 files` | ~5 мс |
| `activate / index 10000 files` | ~66 мс фонового обхода (event loop **не** блокируется) |
| `search` basename-фрагмент (10k индекс) | ~1.9 мс на нажатие |
| `search` path-фрагмент (10k индекс) | ~5.4 мс на нажатие |
| `search` непроходной запрос (10k) | ~0.03 мс (отсев по bitmask) |
| `getChildren` 5000 записей | ~7.9 мс |
| `refresh()` дерева на 2000 раскрытых узлов | ~35 мс |
| `render viewport` (40 строк) | ~0.85 мс/кадр (норм) |

## Сделано

- **Индекс строится в фоне** (`FileSearchService`). Чанкованный async-обход
  (`fs.promises.readdir` + уступка event loop через `setImmediate`); `activate()`
  неблокирующий. **Рекурсивный chokidar-watcher на весь воркспейс убран** — он
  душил event loop (отсюда лаги всего редактора). Свежесть по триггеру:
  `refreshIfStale()` при открытии Quick Open, живое наполнение через
  `onIndexChanged`; допускается eventual freshness.
- **`search` ускорен** без смены движка: предвычисление кейс-фолдинга и basename
  в `FileSearchEntry` (раньше считалось на каждое нажатие), дебаунс ввода в
  `QuickOpenService` (leading-edge + коалесинг, `SEARCH_DEBOUNCE_MS = 16`),
  и дешёвый **отсев по char-presence bitmask** (`charMask` в `FuzzySearch.ts`,
  поля `basenameBits`/`relativePathBits`) до дорогого fuzzy-match. Отсев — это
  необходимое условие fuzzy-матча, состав/порядок выдачи не меняются (регресс-тест
  «выдача с отсевом == сырой матчер» в `FileSearchService.Search.test.ts`).
  Результат на 10k: basename ~7.6→~1.9 мс, path ~12.5→~5.4 мс, непроходной запрос
  ~1.6→~0.03 мс.

TreeView оставлен как есть: загрузка ленивая (один уровень на раскрытие), рендер
ограничен вьюпортом — расходы реальные, но не доминирующие (см. «Будущие фиксы»).

## Будущие фиксы (вне scope текущей задачи)
- [ ] Инкрементальная сверка индекса от watcher'ов file-tree (раскрытые папки).
- [ ] IDEA-style CamelHumps в `FuzzySearch.ts` (заглавная буква запроса → только
      на «горбе»/начале слова); точка расширения — `isWordBoundary` + ветка матчинга.
- [ ] Дальнейшее ускорение `search`: бюджет на кадр; и/или замена движка
      (fzf-for-js / порт VS Code fuzzyScore / WASM).
- [ ] .gitignore-фильтр (сократить N для обхода и поиска).
- [ ] Индекс по ключу в TreeViewElement (Map key→node) вместо линейных сканов
      (`findElementByKey` / `restoreSelection` сейчас O(flatNodes)).
