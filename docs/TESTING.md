# Diode — Гайд по тестированию

Общие правила и паттерны тестирования для каждого слоя проекта.

---

## Общие принципы

- Тестовый фреймворк — **Vitest** (`describe`, `it`, `expect`, `vi`)
- Файлы с тестами лежат рядом с исходниками: `Foo.ts` → `Foo.test.ts`
- Если тестов много, разбиваем по категориям: `Foo.Events.test.ts`, `Foo.Layout.test.ts`
- Не лезем в приватные поля через bracket notation (`obj["privateField"]`) — тестируем публичный контракт
- Моки и шпионы (`vi.fn()`, `vi.spyOn()`) — только для внешних зависимостей и сайд-эффектов

---

## Workbench (интеграционные тесты приложения)

Корневой `WorkbenchComponent` и связки Service ↔ Component тестируем как **чёрный ящик**: компонент создаёт UI-дерево и связывает поведение. Проверяем результат через DOM-элементы и визуальное состояние, а не через внутренние поля компонента.

### Что проверяем
- Структуру созданного DOM-дерева (`querySelector`, `querySelectorAll`)
- Состояние фокуса (`testApp.focusedElement`)
- Реакцию на пользовательский ввод через DOM (`testApp.sendKey(...)`)
- Визуальный результат рендера (`expectScreen`)
- Текстовое содержимое через DOM-элементы (например, текст в `EditorElement`)

### Чего НЕ делаем
- Не обращаемся к внутренним компонентам/сервисам через bracket notation: ~~`workbench["editorService"]`~~
- Не шпионим за методами внутренних объектов компонента
- Не проверяем внутреннее состояние — только наблюдаемое поведение через DOM

### Как создаём тестовое окружение
Используем `createAppTestHarness()` + `createTempWorkspace()` из `TestUtils/` — не собираем контейнер и temp-каталоги руками. Канонический вид:

```ts
let ws: ITempWorkspace;
let h: IAppHarness;

beforeEach(() => {
    ws = createTempWorkspace({ files: { "alpha.txt": "Alpha content" } });
    h = createAppTestHarness({ workspaceFolder: ws.dir });
});

afterEach(() => {
    h.dispose();
    ws.dispose();
});
```

Харнесс даёт `h.testApp`, `h.commands`, `h.workbench`, а suite-specific сервисы достаём через `h.container.get(ThemeServiceDIToken)`. Низкоуровневый примитив под харнессом — тестовый профиль `createTestContainer()` (см. [DI.md](DI.md#профили)); напрямую он нужен только если тест не про `WorkbenchComponent`.

### Пример: проверяем набор текста через DOM

```ts
// Плохо — лезем в приватное поле компонента
const editorService = workbench["editorService"];
expect(editorService.getActiveEditor()?.getText()).toBe("hi");

// Хорошо — проверяем через DOM-элемент или рендер
const editor = testApp.querySelector("EditorElement");
expect(editor.getText()).toBe("hi");
```

---

## TUIDom

Движок вынесен в отдельный репозиторий ([github.com/tuidom/tuidom](https://github.com/tuidom/tuidom)) и приходит пакетами `@tuidom/*` — его собственные тесты живут там. В diode остаются тесты **потребления** движка: компоненты поверх виджетов, интеграция с приложением.

Тест-харнесс приходит из пакета (`@tuidom/testing/*`); diode-обёртки `src/TestUtils/{TestApp,renderElement}.ts` дополняют его **живой палитрой Dark+** (`computeThemeVars` — тот же код темы, что в приложении; сам пакет по умолчанию использует data-снапшот `testing/darkPlusStyleVars`, регенерируемый из diode). Пользуйся обёртками, не пакетным харнессом напрямую — иначе тест увидит снапшот вместо живой темы.

### Что проверяем
- Layout и координатную систему (`performLayout`, `localToGlobal`)
- Диспетчеризацию событий (capture/bubble фазы, `dispatchEvent`)
- Фокус и tab-навигацию
- Визуальный рендер через `expectScreen` + `screen` tagged template

### Паттерны
- Для построения деревьев используем хелпер `ContainerElement` или конкретные виджеты
- У виджетов проверяем визуальный результат через `renderElement` → `expectScreen`

```ts
it("renders a 6x3 box", () => {
    const backend = renderElement(new BoxElement(), 6, 3);
    expectScreen(backend, screen`
        +----+
        |    |
        +----+
    `);
});
```

`renderElement` покрывает только single-shot рендер (layout → render → flush). Мультифреймовые сценарии, доступ к `TerminalScreen` или ненулевой `globalPosition` — ручной сетап, не форсим хелпер.

---

## Editor

Тестируем модели данных: `TextDocument`, `EditorViewState`, `UndoManager`. Это чистая логика без UI — unit-тесты в классическом смысле.

### Что проверяем
- Вставку, удаление, замену текста в `TextDocument`
- Мульти-курсор, выделения, навигацию в `EditorViewState`
- Undo/redo стек
- Folding-регионы

### Паттерны
- Простые тесты — создаём `TextDocument` и `EditorViewState` напрямую
- Для сложных сценариев (folding + cursors) используем DSL из `EditorTestUtils/TrackDSL.ts`

```ts
it("types with two cursors on the same line", () => {
    const doc = new TextDocument("aabb");
    const state = new EditorViewState(doc, [
        createCursorSelection(0, 2),
        createCursorSelection(0, 0),
    ]);
    state.type("X");
    expect(doc.getText()).toBe("XaaXbb");
});
```

---

## Rendering

Тестируем примитивы рендеринга: ячейки, грид, diff-алгоритм, ANSI-вывод.

### Что проверяем
- Корректность `Cell` (сравнение, клонирование)
- Операции `Grid` (инициализация, запись/чтение ячеек, копирование)
- Diff-рендеринг в `TerminalRenderer` (минимальный ANSI-вывод)
- Парсинг и упаковку цветов

### Паттерны
Прямое создание объектов, проверка через `expect`:

```ts
it("produces no output when grids are identical", () => {
    const a = new Grid(new Size(3, 2));
    const b = new Grid(new Size(3, 2));
    b.copyAllCellsFrom(a);
    renderer.render(a, b);
    expect(output).toBe("");
});
```

### Ассерт на саму ячейку: `char`, `width`, `style`

`backend.getBgAt/getFgAt/getTextAt` отвечают только про цвета и текст. Когда виджет кладёт
**частичный** патч ячейки (`setCell(x, y, { bg })` — фон поверх уже отрисованного глифа),
проверять надо ещё и то, что патч не стёр символ и его ширину. Для этого есть
`app.app.screen.getCell(new Point(x, y))` → `ReadonlyCellData` (`char`, `width`, `style`):

```ts
const head = app.app.screen.getCell(new Point(gw, 0));
expect(head.char).toBe("漢");
expect(head.width).toBe(2); // широкий символ уцелел под блочной кареткой
expect(app.app.screen.getCell(new Point(gw + 1, 0)).style).toBe(StyleFlags.None);
```

Эталон — `src/vs/editor/browser/editorElement.multiCursorGeometry.test.ts`. `MockTerminalBackend`
флаги стиля не хранит, поэтому через `backend` такую проверку не сделать.

---

## Input

Тестируем пайплайн парсинга ввода: токенизация сырых байтов, парсинг клавиш, сериализация.

### Что проверяем
- Токенизацию stdin-потока (`tokenize`)
- Парсинг клавиатурных событий (`KeyInputParser`)
- Обратную сериализацию клавиш (`serializeKey`)
- Обработку мыши

### Паттерны
Чистые функции — подаём вход, проверяем выход:

```ts
it("parses simple character", () => {
    const result = parseInput("a");
    expect(result.key).toBe("a");
});
```

---

## Common

Тестируем DI-контейнер и базовые утилиты.

### Паттерны
Классические unit-тесты без зависимостей:

```ts
it("resolves a registered token", () => {
    const container = new Container();
    const token = new Token<string>("test");
    container.bind(token, () => "value");
    expect(container.get(token)).toBe("value");
});
```

---

## Тестовые утилиты

### AppTestHarness (`TestUtils/AppTestHarness.ts`)
Boot-харнесс интеграционных тестов над `WorkbenchComponent`: `createAppTestHarness({ workspaceFolder?, size?, openFile?, focusEditor? })` собирает тестовый DI-контейнер, монтирует корневой компонент и оборачивает его view в `TestApp`. Возвращает `{ testApp, workbench, commands, container, activeEditor(), dispose() }`. Харнесс синхронный — async-активация (`await workbench.activate()`, `fileIndexReady`) остаётся в тесте. Воркспейсом не владеет — композиция с `createTempWorkspace` (см. канонический сниппет в разделе Workbench).

### TempWorkspace (`TestUtils/TempWorkspace.ts`)
Временный воркспейс: `createTempWorkspace({ prefix?, files? })` → `{ dir, writeFile(rel, content), path(rel), dispose() }`. Сид-файлы поддерживают вложенные пути; `dispose()` — рекурсивный `rmSync`, безопасен в `afterEach`/`finally`.

### timing (`TestUtils/timing.ts`)
- `flushMicrotasks(turns = 3)` — прокачка microtask-очереди (continuation'ы QuickInput/QuickOpen после `commands.execute`)
- `settle(ms = 200)` — real-time ожидание subprocess/RPC-эффектов (ExtensionHost-тесты)

### domQueries (`TestUtils/domQueries.ts`)
DOM-аксессоры над `TestApp`: `quickPickByTitle(app, title)`, `tabLabels(app)`, `typeText(app, text)`.

### renderElement (`TestUtils/renderElement.ts`)
Single-shot рендер standalone-элемента: `renderElement(element, width, height, { constraints?, resolveStyles? })` → `MockTerminalBackend` для `expectScreen` (см. раздел TUIDom).

### TestApp (`TestUtils/TestApp.ts`)
Обёртка для интеграционных тестов: создаёт `TuiApplication` с `MockTerminalBackend`, предоставляет:
- `sendKey(key)` — эмуляция нажатия
- `querySelector(name)` — поиск элементов в DOM-дереве
- `focusedElement` — текущий элемент с фокусом
- `app` — доступ к `TuiApplication`

### expectScreen (`TestUtils/expectScreen.ts`)
Визуальная проверка рендера через tagged template:

```ts
expectScreen(backend, screen`
    +----+
    |    |
    +----+
`);
```

### ExtensionTestHarness (`TestUtils/ExtensionTestHarness.ts`)
Для тестов extension host'а: `createExtensionTestHarness({ initialFile?, extensions? })` поднимает реальный `EditorService` (+ `EditorGroupComponent` как view группы) + `ExtensionHost` поверх `TestApp`. Subprocess форкается через `subprocessSpawnArgsForTests()`; тестовые расширения — `*.cjs`-файлы с `exports.activate` из `__fixtures__`, регистрация — `extensionFixture(id, file)` (расширяемые поля добавляются спредом), путь к каталогу — `EXTENSION_FIXTURES_DIR`. Unit-тесты RPC без subprocess'а используют `createInProcessChannelPair()`.

---

## E2E

`npm run test:e2e` (отдельный конфиг `vitest.e2e.config.ts`) собирает SEA-бинарь один раз (`e2e/globalSetup.ts`) и гоняет его как чёрный ящик. Два транспорта: **инспектор** (`--headless` + WebSocket → структурный кадр/дерево) и **PTY** (`node-pty` + ANSI-парсер, для проверок реального вывода). Сьюты и helpers — в `e2e/`. Детали и статус — [TODO/E2E.md](TODO/E2E.md).

### Изолированный запуск

Любой e2e поднимает бинарь через **`e2e/helpers/appSession.ts`** — единственную реализацию hermetic-запуска. Один временный корень на сессию изолирует всё, чтобы прогон не трогал реальный `~/.diode` разработчика:

```
<root>/
  user-data-dir/   → --user-data-dir (settings, keybindings, globalState, extensions)
  home/            → HOME/USERPROFILE + XDG_{DATA,CACHE,CONFIG}_HOME (корзина, кеши)
  workspace/       → cwd процесса (diode.log, ext-host folders) + сид-воркспейс
```

В тестах — vitest-обёртки из **`e2e/helpers/useApp.ts`**: `useHeadlessApp(opts)` / `usePtyApp(opts)`. Сессия сама убирается по `onTestFinished`, при падении печатает пост-мортем (кадр, фокус, дерево) — ни `afterEach`, ни ручного `dispose` не нужно. Опции: `files` (сид-воркспейс), `settings`, `keybindings`, `installVsix`, `seedUserData` (копия фикстуры user-data-dir), `open`, `root`/`keepRoot` (рестарт-тесты), `isolateHome: false` (опт-аут).

```ts
const { session } = await useHeadlessApp({
    files: { "sample.ts": SAMPLE },
    keybindings: [{ key: "alt+u", command: "workbench.action.output.toggleOutput" }],
    open: ["sample.ts"],
});
```

### Ожидания вместо `sleep`

Гоняем приложение settle-глаголами и предикатами, **не** `sleep`. После инъекции ввода `key`/`text`/`click`/`clickNode`/`wheel`/`resize` сами ждут, пока рендер устоялся (серверный `TUIDom.waitForIdle`: счётчик кадров стабилен + нет отложенного рендера). Сырые `sendKey`/`sendText`/`sendMouse` (без settle) — для тестов на гонки; `settle: false` — точечный опт-аут.

Предикатные ожидания (`e2e/helpers/waitFor.ts`, единый примитив `waitUntil`): `waitForNode(sel)`, `waitForNoNode(sel)`, `waitForFocus(type)`, `waitForState(sel, pred)`, `waitForText(pred)`, `waitForDocument(pred)`.

⚠️ **idle ≠ «все эффекты завершились».** Асинхронные хвосты — ответ ext-host'а, debounce `StateService` на диск — idle не ловит. Под них — предикат по дереву/кадру/файлу, а НЕ увеличенный `quietMs` (пример: `waitForPanelPersisted` в `e2e/outputPanel.shared.ts` ждёт запись состояния файлом перед рестартом).

### Локаторы и состояние виджетов

Целимся **селектором-адресом** (`e2e/helpers/query.ts`), а не координатой: `Tag`, `#id`, `@role`, потомок через пробел. `session.node(sel)`/`nodes(sel)`, `clickNode(sel, {dx,dy})`, `wheelNode`. `nodeId` эфемерен (`rebuild` его протухает) — поэтому селектор вычисляется каждый раз.

Ассертим **состояние виджета**, а не пиксели: у ключевых виджетов есть `inspectState()` (см. ниже), результат приходит в `NodeSnapshot.state`. Курсор/выделение/readonly редактора, активная вкладка панели, элементы quick-pick — читаются как данные:

```ts
const ed = await session.node("EditorElement");
expect(ed?.state?.readOnly).toBe(true);
expect(ed?.state?.hasSelection).toBe(true);
```

Контентный локатор для клика по тексту — `clickText(session, needle, {dx, maxX})` (см. `e2e/outputPanel.shared.ts`).

### `inspectState()` — контракт виджета

Виджет, чьё наблюдаемое состояние нужно тестам, переопределяет `TUIElement.inspectState(): Record<string, unknown> | undefined` (база — `undefined`). Правило: отдаём **наблюдаемое** состояние (то, что видит пользователь), а не внутренности; результат JSON-сериализуемый, пересекает провод инспектора и является **публичным контрактом** — покрывается юнит-тестом рядом с виджетом (`*.inspectState.test.ts`). Реализовано у `EditorElement`, `PanelContainerElement`, `QuickPickElement`, `SelectBoxElement`, `PopupMenuElement`, `EditorTabStripElement`.

### Параллельный прогон

Изоляция позволяет гонять файлы параллельно. По умолчанию — **половина ядер** (тяжёлый SEA-бинарь + PTY + ext-host subprocess на файл; на 4-ядерной машине четыре бинаря насыщают CPU и тайминг-чувствительные тесты флейкают). Переопределяется `DIODE_E2E_WORKERS`; `=1` — полностью последовательный прогон (для медленного/загруженного раннера).

### Функциональные e2e

Помимо smoke-сьютов и скриншот-сценариев в `e2e/` живут **функциональные** тесты: водят приложение как пользователь (клавиши, мышь, рестарт) и проверяют поведение — где фокус, что видно, дошёл ли ввод. Эталон — `e2e/outputPanel.test.ts` и `e2e/outputPanelRegression.test.ts` (панель Output, PR #197): ни одного `sleep`, координаты — из `inspectState`/контентных локаторов, выделение — из `editor.state.selections`. Новые функциональные тесты пишем на общих хелперах (`useApp` + `query` + settle-глаголы + `waitFor*`).

### Скриншот-демо (screenshots)

Визуальные фичи демонстрируются **сценариями** в `e2e/scenarios/` (`*.scenario.ts`). Сценарий — это `defineScenario({ name, open, run })`: `run(editor)` получает драйвер над настоящим бинарём (headless) и шлёт команды (`sendKey`, `sendText`, `waitForText`) + снимает кадры (`capture("shot")`). Механика захвата: `HeadlessSession` (реальный SEA-бинарь с `--headless` + инспектор по WebSocket) → `GridSnapshot` → `gridToSvg` → PNG через resvg (всё в `e2e/helpers/`; растеризатор — только тулинг, не в редакторе).

- `npm run screenshots` — прогоняет все сценарии, пишет PNG в `screenshots/` (в `.gitignore`) + `screenshots/INDEX.md`-галерею.
- `e2e/scenarios.test.ts` гоняет те же сценарии в `npm run test:e2e` (и в CI) — страховка, чтобы демо не протухли; функциональных ассертов там нет.

**Анимация ломает settle.** Settling-глаголы (`sendKey`, `sendText`, клики) ждут «кадр устоялся» — 40 мс без новых кадров. Пока в заголовке крутится спиннер прогресса, такой тишины не наступает, и каждый settling-ввод честно висит до таймаута. Поэтому во время живой анимации шлём только `waitForText`/`waitForState`/`captureFrame`, а если ввод всё же нужен — с `settle: false` (см. `e2e/scmProgress.functional.test.ts` и сценарий `scmProgress`). Долгую операцию для демо делает настоящий `pre-commit`-хук со `sleep` — медленным становится сам git, а не наш код.

### Политика: визуальные фичи требуют скриншот-демо

Фича с видимой/внешней составляющей обязана добавить/обновить сценарий в `e2e/scenarios/` и приложить PNG к PR (правило — в [AGENTS.md](../AGENTS.md)).

---

## Покрытие (Coverage)

```bash
npm run test:coverage      # = vitest run --coverage
```

В отчёте включён `skipFull: true` — показываются **только недопокрытые** файлы (полностью покрытые скрыты). Конфиг — [vitest.config.ts](../vitest.config.ts).

### Политика: покрываем весь новый код

Цель — 100% покрытия по всему, что реально исполняется. Это закреплено **храповиком** `coverage.thresholds` с `autoUpdate: true`:
- если покрытие падает ниже зафиксированной планки — прогон/CI **краснеет**;
- если покрытие выросло — vitest сам поднимает числа порогов в конфиге (коммить их).

Бэклог недопокрытого реального кода — [TODO/Coverage.md](TODO/Coverage.md).

### Что и почему исключаем из метрики

Исключения (`coverage.exclude`) добавляем **только** если файл попадает в одну из категорий:

1. **Чистые типы** — интерфейсы `I*.ts`, `*.d.ts`, barrel-`index.ts`. Исполнять нечего; чистый интерфейс добавляем в **явный список** exclude (глоб `I*.ts` НЕ используем — см. ниже).
2. **Непокрываемое юнит-тестами** — реальный tty (`NodeTerminalBackend`), subprocess-точка входа (`ExtensionHostSubprocess`), SEA-детект (`IsSea`, `createDefaultAssetAccess`), RPC-стаб в subprocess (`VscodeNamespace`), DI-проводка (`Workbench/Modules/**`), null-object заглушки. Это проверяется e2e (`vitest.e2e.config.ts`), а не юнит-тестами.

**Важно:** реальную логику в файлах с префиксом `I*` (например хелперы `createRange` в `IRange.ts`, `NULL_STATE` в `IState.ts`, `isScrollable` в `IScrollable.ts`) **не прячем** — её покрываем. Поэтому интерфейсы исключаем поимённо, а не глобом `src/**/I*.ts`.

---

## Мутационное тестирование (Stryker)

```bash
npm run test:mutation                  # дифф против main
npm run test:mutation -- --scope-only  # только показать, что будет мутировано
```

**Обязательный шаг перед сдачей фичи.** Не «когда есть время» — покрытие и мутационный балл закрывают разные дыры, и без второго первое даёт ложное зелёное.

### Зачем, если есть храповик покрытия

Покрытие говорит «эта строка исполнилась», а не «эту строку кто-то проверил». Тест, который проходит по всем веткам и не делает ни одного осмысленного ассерта, даёт **100% по всем четырём метрикам** — и не ловит ничего. Замерено на трёхстрочной функции: 100% покрытия против **11% мутационного балла**, 8 выживших мутантов из 9.

Stryker вносит в код мелкие поломки (`<` → `<=`, `if (x)` → `if (true)`, вырезает вызов) и смотрит, упадёт ли хоть один тест. Упал — мутант **убит**, тесты работают. Не упал — мутант **выжил**, и это место можно испортить незаметно.

Замер на смердженной фиче #261 (мульти-курсор): покрытие 100%, каждый из 597 мутантов покрыт каким-то тестом, `# no cov` = 0 — и **78 выживших**. Из настоящих находок: никто не проверял, что клавиатурные бинды вообще привязаны (`parseKeybinding("shift+alt+up")` → `parseKeybinding("")` выживал), и что каретка доезжает до экрана (`ensureCursorVisible()` → `;` выживал).

### Что мутируем

Только код, который тронула задача: новые файлы целиком, правленые — диапазонами строк из хунков. Легаси-долг в старых файлах не всплывает. Скоуп считает [`scripts/mutation-diff.mjs`](../scripts/mutation-diff.mjs) — в StrykerJS нет `--since` (это опция Stryker.NET, их постоянно путают).

Тесты не мутируются: Stryker портит **исходники**, метрика висит на коде. Сужать набор тестов вручную не надо — раннер сам гоняет только тесты, транзитивно импортирующие мутируемый файл (`vitest.related`).

### Выживший мутант — не всегда дыра

Порог `thresholds.break: 100`, и достижим он только вместе с явными исключениями. Часть мутантов **эквивалентна**: их нельзя убить никаким тестом, потому что поведение не изменилось. Такие гасим комментарием с причиной:

```ts
// Stryker disable next-line EqualityOperator: при value === min обе ветки возвращают min — эквивалентный мутант
if (value < min) return min;
```

Погашенные выпадают из знаменателя балла, поэтому 100% достижимо честно, а каждое исключение видно в ревью — та же механика осознанности, что у списка исключений покрытия.

Отдельно про соблазн: убить мутанта `title: "Remove Secondary Cursors"` → `title: ""` можно ассертом на текст пункта меню. Такой тест ломается при любом переименовании и не ловит ни одного бага. Гейт не отличает его от полезного — отличать должен автор. Когда мутант не указывает на реальное поведение, правильный ответ — `// Stryker disable` с причиной, а не ассерт ради балла.

### «Выжил» с нулём выполненных тестов — не находка

У связки `@stryker-mutator/vitest-runner@10` ↔ `vitest@4` есть дефект: часть
мутантов прогоняется так, что **не выполняется ни один тест** — в отчёте у них
`testsCompleted: 0` при сотне покрывающих, а в логе видно `Tests 33 skipped (47),
tests 0ms`. Ни одного упавшего теста нет, и Stryker записывает такого мутанта в
выжившие. Набор таких мутантов плавает от прогона к прогону: один и тот же
коммит давал 1, 5 и 6 «выживших», причём каждый из них при ручной подстановке в
код валит от одного до четырёх тестов. Ни `coverageAnalysis: off`, ни
`--maxTestRunnerReuse 1` этого не лечат.

Поэтому [`scripts/mutation-diff.mjs`](../scripts/mutation-diff.mjs) различает две
вещи: «никто не заметил» и «ничего не запускали». Выживший с `testsCompleted > 0`
— настоящая находка, гейт падает сразу. Выжившие с нулём — непроверенные:
скрипт гоняет их вторым, точечным прогоном (скоуп в диапазон строк самого
мутанта — там прогон надёжен), и вердикт берётся оттуда. Перепроверенные мутанты
получают в отчёте статус `Killed` с причиной, так что в комментарии к PR видно,
что их гоняли отдельно. Пустая перепроверка (в скоуп не попал ни один мутант) —
это падение, а не зелёный: тихо-зелёный гейт хуже отсутствующего.

### Два прогона: на PR и ночью

| | На PR (`ci.yml`, job `mutation`) | Ночью (`mutation.yml`) |
|---|---|---|
| Скоуп | дифф PR | всё, влившееся за окно |
| Статические мутанты | пропускаются (`--ignoreStatic`) | проверяются |
| Результат | комментарий в PR, job краснеет | тикет с меткой `mutation` |

Отчёт собирает [`scripts/mutation-report.mjs`](../scripts/mutation-report.mjs): сводка по статусам, а дальше каждый выживший — настоящим diff'ом строки со ссылкой на неё в коде. Не «`ConditionalExpression` → `true`», а:

````diff
- if (value < min) return min;
+ if (true) return min;
````

Разница не косметическая: по имени мутатора и замене место в коде не восстановить, не открыв файл, — а именно этот шаг решает, будет отчёт прочитан или пролистан. Исходник берётся из самого JSON-отчёта (`files[].source`), поэтому рендер не зависит от состояния рабочего дерева. Список обрезается по числу записей и по бюджету символов комментария, и обрезанный список честно сообщает, сколько скрыл — полный всегда лежит в HTML-отчёте среди артефактов прогона.
| Цена (замер на #261) | ~12 минут | ~41 минута |

**Статический мутант** — тот, что сидит в коде времени загрузки модуля: таблицы-константы, регистрации команд и биндов. `coverageAnalysis: perTest` на них не работает (привязать исполнение к конкретному тесту нечем), поэтому на каждого гоняется весь связанный набор тестов — по ~21 секунде против ~1.3 у обычного. На фиче #261 это 82 мутанта из 597, съедающие 29 минут из 41.

Отсюда разделение: PR-гейт должен быть по карману на каждый пуш, поэтому статику там пропускаем; она не теряется, а уезжает в ночной прогон, снятый с критического пути. Балл в комментарии к PR это оговаривает явно — он выше не потому, что дыр нет, а потому что часть смотрели не здесь.

Ночной прогон намеренно **не краснит** job: балл ниже 100 для него штатный исход, находки уезжают в тикет. Красным он станет только от настоящего сбоя — иначе его перестали бы читать.

### Ограничение, о котором надо знать

Мутировать весь репозиторий нельзя: 998 файлов дают ~110 000 мутантов, то есть дни непрерывного счёта. Оба прогона работают только по диффу, и это не оптимизация, а условие существования.
