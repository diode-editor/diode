# tuidom → отдельный репозиторий: что вернуть в редактор перед выносом

> **Статус: вынос завершён (2026-08-13).** Движок живёт в
> [github.com/tuidom/tuidom](https://github.com/tuidom/tuidom) и ставится
> пакетами `@tuidom/*` из npm; тест-харнесс — `@tuidom/testing/*`
> (diode-обёртки с живой темой — `src/TestUtils/{TestApp,renderElement}.ts`).
> Документ ниже — исторический аудит, готовивший вынос.

`tuidom/` — «браузер» Diode (DOM-ядро, виджеты, rendering, input, backend,
inspector), кандидат на вынос в отдельный репозиторий (см.
[ARCHITECTURE.md](../ARCHITECTURE.md)). Этот документ — аудит: **что из tuidom по
смыслу принадлежит редактору/приложению и должно вернуться назад, прежде чем
tuidom уносить.**

## Инвариант выноса

tuidom не должен знать про `vs/`-мир: ни про **домен редактора** (документы,
токены, курсоры, фолдинг), ни про его **политики и UI-копирайт** (пороги, строки
кнопок, доменные дефолты), ни **импортировать** из `src/`. tuidom экспонирует
**механизмы**; политику и контент задаёт приложение (`editor`/`workbench`),
передавая их параметрами.

## Результат аудита

Метод: матрица импортов по слоям (кто кого тянет), скан tuidom на редакторную
лексику, проверка upward-импортов `tuidom → src`.

**Главное — tuidom концептуально чист.** Скан по всему tuidom на
`TextDocument / tokeniz / folding / EditorViewState / caret / editorElement` пуст
(один комментарий в scrollbar). Продакшн-код tuidom **не импортирует ничего из
`src/vs`**. Виджеты `ui/*`, которыми пользуется только workbench (button,
selectbox, panel, layout-контейнеры, editorgroup, completionlist, terminal,
titledpanel, workbenchlayout), — это **нормальная связь «приложение ↔ тулкит»**, а
не утечки: домена редактора они не знают. Масштаб работ куда меньше, чем кажется
по инстинкту «displayLine выглядит редакторным».

### 1. Вернуть в редактор — доменный блокер ✅ СДЕЛАНО

- **`tuidom/common/textLimits.ts` → `src/vs/editor/common/viewModel/longLineRendering.ts`.**
  Кодировал **политику рендера редактора** (`STOP_RENDERING_LINE_AFTER = 10 000`)
  и **UI-копирайт редактора** (`LONG_LINE_TRUNCATION_BADGE = " Long line trimmed "`);
  импортёры — только editor, 0 tuidom. Перенесён в editor-слой, ~7 путей импорта
  обновлены; поведение не изменилось (behavior-neutral). tuidom-механизмы
  (`DisplayLine.stopAfter`, `measureTextWidth`) порог не знают — редактор передаёт
  его параметром.

### 2. Пограничное — решить, но не блокер

- **`tuidom/common/measureTextWidth.ts`.** Чистый примитив ширины (никакого
  домена), но единственный потребитель сейчас — editor (`lineWidthCache`).
  Механизм, сиблинг `displayLine`/`unicodeWidth`. Варианты: **(а)** оставить в
  tuidom как общий примитив (рекомендуется — он ровно про «текст → колонки»);
  **(б)** перенести в editor до появления второго потребителя. Выносу не мешает.

### 3. Остаётся в tuidom (несмотря на «выглядит редакторным»)

- **`tuidom/common/displayLine.ts` — оставить.** Данные против инстинкта: **9
  tuidom-потребителей** (лейблы, `inputbox`, `tree`, `quickpick`, `completion`,
  `textTruncation`, …) + 2 editor + 1 workbench. Это примитив **шейпинга текста
  терминала** (графемы, ширины, табы, CJK/эмодзи, `offset ↔ колонка`) — Diode-аналог
  того, что для VSCode делает Chromium через DOM. Любой виджет, рисующий текст,
  обязан им пользоваться; это не домен редактора.
- Так же общие и остаются: `unicodeWidth`, `textTruncation`, `geometryPromitives`,
  `colorUtils`, `styleFlags`, `disposable`, `iTerminalSurface`, `typingUtils`.

### 4. Дев-тулинг, цепляющий tuidom к `vs/` — тоже развязать

Единственные `tuidom → src` рёбра — в **`.stories.ts` / `.bench.ts`** (не в проде):
тянут `src/StoryRunner`, `src/TestUtils` (`TestApp`, `perfFixtures`), а
**`tuidom/ui/inputbox/inputElement.stories.ts`** — реальные `src/vs/platform/*` и
`src/vs/workbench/contrib/files/*`. Перед выносом: истории/бенчи, зависящие от
`vs/`, перенести на сторону приложения либо развязать через порты/фикстуры.
Найти: `grep -rn 'from "\.\./\.\./\.\./src/' tuidom`.

### Внешние зависимости будущего пакета

`ws` + node builtins (`node:http/net/crypto/path`) — транспорт инспектора и
fs-доступ; `vitest` в dev. Всё leaf, без `vs/`-хвоста.

## Почему автопроверки это не ловят

`valid-layers-check` разрешает `editor → tuidom` (легальное направление вниз),
поэтому файл, физически лежащий в tuidom, но импортируемый только редактором и
кодирующий его политику, чекер **не отметит**. Это семантическая ошибка
**размещения**, а не нарушение направления зависимостей — ловится только глазом
или отдельным правилом.

## Чек-лист «прежде чем класть файл/значение в tuidom»

1. Это **механизм** (общая способность, параметризуемая) или **политика/контент**
   (порог, строка UI, доменный дефолт)? Механизм — можно в tuidom; политику/контент
   — в приложение, передавать параметром (как `stopAfter` у `DisplayLine`).
2. Знает ли файл про домен редактора (document/token/cursor/folding)? Если да — не
   в tuidom.
3. Кто импортирует? Если только `editor`/`workbench` и это **не** общий виджет —
   повод спросить «почему это в браузере».
4. Не импортирует ли из `src/` (включая истории/бенчи — их тоже развязать)?

## Порядок работ перед выносом

1. ~~Перенести **`textLimits.ts`** в editor~~ — **сделано** (`longLineRendering.ts`).
2. ~~Решить судьбу **`measureTextWidth.ts`**~~ — **решено: остаётся в tuidom** как
   общий примитив «текст → колонки» (вариант (а) из п. 2 выше).
3. ~~Развязать **`.stories.ts` / `.bench.ts` / тесты** от `src/`~~ — **сделано**
   (фаза 1 выноса): тест-харнесс переехал в `tuidom/testing/` (палитра Dark+ —
   data-фикстурой `darkPlusStyleVars.ts`), diode-зависимые истории уехали в
   `src/StoryRunner/stories/`, editor-зависимый тест — в
   `src/vs/editor/browser/editorElement.selectionClear.test.ts`. Теперь
   `grep -rn 'from ".*src/' tuidom` пуст, включая тесты/истории/бенчи.
4. Зафиксировать инвариант «tuidom не знает про `vs/`» в
   [ARCHITECTURE.md](../ARCHITECTURE.md) — после физического выноса инвариант
   станет строже сам собой: пакет из npm не может импортировать `src/**`.
