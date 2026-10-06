# Diode — Гайд по тестированию

Общие правила и паттерны тестирования для каждого слоя проекта.

---

## Общие принципы

- Тестовый фреймворк — **Vitest** (`describe`, `it`, `expect`, `vi`)
- Файлы с тестами лежат рядом с исходниками: `Foo.ts` → `Foo.test.ts`
- Если тестов много, разбиваем по категориям: `Foo.Events.test.ts`, `Foo.Layout.test.ts`
- Не лезем в приватные поля через bracket notation (`obj["privateField"]`) — тестируем публичный контракт
- Моки и шпионы (`vi.fn()`, `vi.spyOn()`) — только для внешних зависимостей и сайд-эффектов
- «Ключа нет» проверяет `toStrictEqual`, а не `toEqual`: `toEqual` считает `{ field: undefined }` равным `{}`
- Ожидаемое значение — литералом, а не импортированной константой из проверяемого модуля: ассерт через ту же константу не замечает, что её значение поменяли
- Двойник не должен совпадать по форме с ответом: двойник, отдающий активную вкладку **первой** в `getEditors()`, не отличает «взял активную» от «взял первую»
- Env в тестах — `vi.stubEnv` / `vi.unstubAllEnvs` (динамический `delete process.env[name]` запрещён линтом); `EACCES` инсценируют `chmod 0o500` на **родителе** (`vi.spyOn(fs, …)` в ESM невозможен — «Module namespace is not configurable»); группу процессов читают из `/proc/self/stat` полями после последней `)` (в `comm` бывают пробелы и скобки), `pgrp` — `fields[2]`

### Перечень вместо набора кейсов

Когда правило должно касаться **каждого** поля или каждой точки (все текстовые поля wire-типов проходят через раковину codicon'ов), набор кейсов забывает новичка, а перечень — нет. Образец — `src/vs/workbench/api/browser/extensionTextSinks.test.ts`: гейт №1 типовой, `Readonly<Record<TextFields<IWire…>, IFieldPolicy>>`, где `TextFields<T> = { [K in keyof T]-?: string extends T[K] ? K : never }[keyof T]` собирает поля со свободной строкой (литеральные объединения отсеиваются сами) — новое поле без политики краснит `npm run typecheck`; гейт №2 поведенческий — на каждое поле кейс через настоящую раковину. Оба гейта проверяй **в обе стороны**: вживи поле в wire-тип (typecheck обязан покраснеть) и откати продуктовые файлы (кейсы обязаны покраснеть) — иначе перечень декорация.

### Приёмы отладки

- **Форму входа снимай с живого источника, а не угадывай.** Временный `console.log` под `process.env.DIODE_PROBE` + одноразовый тест на `createExtensionTestHarness` со стоковым сервером: tsserver на «убрать неиспользуемый импорт» шлёт два смежных удаления, а не одно — на этой форме и жил баг #331.
- **Фаззер вместо чтения кода.** Случайные последовательности операций `EditorViewState` (25 шагов × 8000) с инвариантом «все выделения внутри документа»; случайные батчи правок; round-trip `applyEdits(inverseEdits)` на алфавите `"ab\n"`. Каждый нашёл настоящий баг за минуты; разное число падений после частичной починки показывает, что багов больше одного.
- **Зонд-`throw`** в сеттер (позиция вне документа) или в строку кода + прогон всего юнит-сьюта показывает настоящих продюсеров среди существующих тестов и то, какой тест держал покрытие ветки.
- **Трейс из бандла** (`dist/main.js`): сдвиг номеров строк относительно исходника постоянный — вычти его и попадёшь в конкретный `if`.
- **«Редактор съел текст / не та реакция на клавишу» — сначала проверь, кто владеет клавишей при видимом оверлее** (Enter и Tab у suggest-попапа, Enter у find), и только потом ядро. «`{` + Enter стирает текст» (#328) оказался не autoIndent, а попапом автодополнения, укравшим Enter.

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

Чтобы ассерт отрисовки ловил ошибку, а не проходил мимо неё:
- кадр снимай на экране **больше** элемента — запись за край элемента иначе молча пропадает;
- мышь проверяй на смещённом элементе (не в `(0,0)`), иначе путаница локальных и экранных координат не видна;
- «не покрашено» проверяй цветом ячейки, а не символом; полуинтервал `[a, b)` — с обеих сторон границы; target события — внутри зоны, а не на её краю.

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
- Для сложных сценариев (folding + cursors) используем DSL из `src/vs/editor/test/common/trackDSL.ts`

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

## Тестовые утилиты

### AppTestHarness (`TestUtils/AppTestHarness.ts`)
Boot-харнесс интеграционных тестов над `WorkbenchComponent`: `createAppTestHarness({ workspaceFolder?, size?, openFile?, focusEditor? })` собирает тестовый DI-контейнер, монтирует корневой компонент и оборачивает его view в `TestApp`. Возвращает `{ testApp, workbench, commands, container, activeEditor(), dispose() }`. Харнесс синхронный — async-активация (`await workbench.activate()`, `fileIndexReady`) остаётся в тесте. Воркспейсом не владеет — композиция с `createTempWorkspace` (см. канонический сниппет в разделе Workbench).

### TempWorkspace (`TestUtils/TempWorkspace.ts`)
Временный воркспейс: `createTempWorkspace({ prefix?, files? })` → `{ dir, writeFile(rel, content), path(rel), dispose() }`. Сид-файлы поддерживают вложенные пути; `dispose()` — рекурсивный `rmSync`, безопасен в `afterEach`/`finally`.

**Снося каталог, сначала глуши писателей.** `dispose()` каталога не останавливает того, кто в него пишет: `StateService` пишет с debounce'ом и своим `mkdir` **пересоздаёт** только что снесённый путь — каталог «воскресает» уже после теста. Поэтому владелец гасит писателя (`state.dispose()`, `await harness.dispose()`) **до** сноса каталога, а не после. Так же с процессами: пока субпроцесс расширений жив, он пишет в `tmpDir` харнесса, и сносить каталог можно только после его фактического выхода.

### Корень временных каталогов прогона (`TestUtils/tmpRoot.ts`)
`globalSetup` обоих конфигов заводит на прогон один корень в `os.tmpdir()` и направляет в него `TMPDIR`. Тестам менять ничего не надо: `os.tmpdir()` читает переменную при каждом вызове, поэтому любой `fs.mkdtemp` попадает внутрь корня — вместе со спавнящимися процессами, которые наследуют окружение (user-data редактора в e2e тоже там). Teardown сносит корень целиком.

Это **страховка, а не замена уборке за собой**: при SIGKILL, OOM-убийстве воркера или падении по таймауту `afterEach` не бежит вовсе. Корень такого прогона подбирает следующий — владелец помечен в `owner.pid`, и корень с мёртвым владельцем сносится (признак — живость процесса, а не возраст: долгий мутационный гейт не должен попасть под уборку соседнего прогона).

Прогон, которому нужен свой родитель корня (тесты самого `tmpRoot`), задаёт `DIODE_TEST_TMP_PARENT`; путь корня доступен тестам в `DIODE_TEST_TMP`. Эта же переменная — метка прогона для процессов: её наследует всё, что прогон запустил, и перед сносом корня (своего в teardown, бесхозного при старте) процессы с ней добиваются (Linux, `TestUtils/processSweep.ts`) — сироты убитого воркера держали гигабайты.

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

Чего харнесс не делает и что легко упустить:
- **ошибку активации расширения глотает** — увидеть её можно только через опцию `logger`;
- workbench-contributions не поднимает (нет `setContext` и прочих их эффектов), стоки (`outputSink`, `statusBarItemSink`, `quickInputSink`, …) по умолчанию не подключены, сервис настроек ядра — NULL-заглушка (`configurationService`; с дефолтами реестра — `createTestConfigurationService()` из `TestUtils/testConfigurationService.ts`);
- `activateEvents` по умолчанию `["*"]`; ленивую активацию драйвят `activateEvents: []` + `harness.host.activateByEvent(...)`;
- `subprocessLoader: "node"` для ESM-расширений — tsx в субпроцессе маскирует отсутствие ESM-хука, и тест зеленел бы на сломанном пути;
- `workspaceFolders` принимает путь (uri харнесс поднимет сам) или готовый дескриптор для не-`file:` схемы;
- subprocess-тестам нужен явный `{ timeout }` у `it` — дефолтных 5 секунд форку со стоковым сервером не хватает;
- тест **продюсера** провода без субпроцесса — `FakeChild.sent` (`extensionHost.lifecycle.test.ts`, там же `armNextChild()` для позднего спавна).

### Учёт утечек (`TestUtils/disposableLeaks.ts`)
`const disposables = ensureNoDisposablesAreLeakedInTestSuite();` в начале тестового файла (или `describe`) — аналог одноимённого хелпера vscode. Перед каждым тестом ставит `DisposableTracker` (`vs/base/common/lifecycle.ts`), после — валит тест, если созданное в нём через примитивы lifecycle (`Disposable`, `DisposableStore`, `toDisposable`, …) осталось неосвобождённым; отчёт — по корням, со стеком места создания. Объекты самого теста отдавай в `disposables.add(…)` — они освобождаются после теста. Упавший тест утечки не проверяет. Синглтоны уровня процесса выводятся из учёта `markAsSingleton`.

Включается **по сьютам, храповиком снизу вверх** (`base/common` → `platform` → сервисы), не глобально: литералы `{ dispose }` трекер не видит, а известные неосвобождаемые владельцы протекли бы в сотнях файлов (docs/TODO/Lifecycle.md, §7). Включённый сьют остаётся включённым.

---

## E2E

`npm run test:e2e` гоняет настоящий бинарь как чёрный ящик (конфиг `vitest.e2e.config.ts`, сьюты и helpers — в `e2e/`). Два транспорта: **инспектор** (`--headless` + WebSocket → структурный кадр/дерево) и **PTY** (`node-pty` + ANSI-парсер, для проверок реального вывода). Детали и статус — [TODO/E2E.md](TODO/E2E.md).

### Прогон: сборка, воркеры, автоповтор, уборка

**Сборка — неизменяемая, из кэша по хешу исходников** (`scripts/e2e-artifacts.mjs`, зовёт `e2e/globalSetup.ts`). Ключ — sha256 от СОДЕРЖИМОГО входов бинаря: blob-хеш каждого файла рабочей копии (отслеживаемого и нет, кроме игнорируемых) по `src/ extensions/ package*.json tsconfig.json tsup.config.ts scripts/{build,pack}-*.mjs …` — от состояния git он не зависит, коммит/amend/squash с тем же деревом дают ту же сборку (тесты `*.test.ts` и `e2e/` — не входы: правка теста бинарь не пересобирает), плюс версия node/платформа и `node_modules/.package-lock.json` (его меняют и `npm ci`, и `engine:link`). Сборка идёт в `~/.cache/diode-e2e/<key>.tmp-<pid>/`, публикуется атомарным `rename` в `<key>/` и становится read-only. Отсюда:

- повторный прогон, второй проход автоповтора, соседний worktree на том же дереве — **попадание в кэш**, ноль секунд сборки (промах — ~30 с на 4 ядрах);
- рабочий `dist/` прогон **не трогает**: ручной `build:sea` посреди e2e больше ничего не ломает (раньше `tsup clean` сносил бинарь из-под воркеров — ENOENT/ETXTBSY, 30-секундные таймауты), а редактор, открытый сценарием на репозитории, не смотрит на сотни МБ записи в `dist/`;
- два сеанса, которым нужен один ключ, не собирают его дважды: замок `<key>.lock` (mkdir + pid владельца, замок мёртвого снимается), второй ждёт первого;
- хранятся `DIODE_E2E_CACHE_KEEP` (по умолчанию 3) последних по использованию сборок, плюс любая, на которой сейчас идёт прогон (`.in-use/<key>@<pid>`). Корень кэша — `DIODE_E2E_CACHE_DIR`. Посмотреть — `node scripts/e2e-artifacts.mjs --list`, ключ текущего дерева — `--key`.

Версия в e2e-сборке пиннится в `nightly-e2e` (если `DIODE_VERSION` не задан): обычная сборка зашивает `nightly-<sha HEAD>`, и любой коммит, даже docs-only, давал бы новый бинарь. Именно не-semver: у сборки без релизной версии проверка `engines.diode` в магазине считается пройденной (`resolveCompatibleVersion.ts`), а semver-заглушка вроде `0.0.0-e2e` её проваливает — так упали все сценарии, ставящие ruff (`diode >=0.3.1`). Воркер сам не собирает никогда — пути приходят в `DIODE_E2E_BINARY`/`DIODE_E2E_SELFEXTRACT`. Вне прогона (`npm run screenshots`, бенчи) `getBinaryPath()` берёт ту же сборку из кэша.

**Воркеров — по ядрам и памяти** (`planWorkers` в `scripts/e2e-plan.mjs`): меньшее из половины ядер, `(память − 2 ГБ) / 1,5 ГБ` и `(свободно сейчас − 1 ГБ) / 1,5 ГБ`, не меньше одного. 1,5 ГБ — худший воркер: форк vitest + редактор + субпроцесс расширений + языковой сервер. Свободная память — потому что машина общая: соседний мутационный гейт держит гигабайты, и прогон, посчитанный от полной памяти, уходил в OOM. Расчёт печатается в начале прогона; `DIODE_E2E_WORKERS=<n>` — явно. Сценарии-демо нарезаны на четыре файла `e2e/scenarios-<N>.test.ts` (каждый N-й сценарий по имени, нарезка до импорта — `e2e/scenarios/suite.ts`): одним файлом это был самый длинный файл прогона (812 с из 1194 на двух воркерах), который не делится между воркерами и при флаке повторяется целиком.

**Тяжёлая полоса.** Файлы с настоящими JVM (redhat.java: syntax- и standard-сервер) — `e2e/marketplace/marketplace.test.ts` и `e2e/scenarios-heavy.test.ts` (сценарий `java-lsp`) — вынесены в отдельный проект vitest `e2e-heavy` (`sequence.groupOrder: 1`, `maxWorkers: 1`): он идёт ПОСЛЕ остальных и строго по одному. Замер: две JVM-пары разом на 7,6 ГБ дали пик 6,3 ГБ и таймауты обеих (и соседнего `rename-symbol` от голода по CPU). Список узкий намеренно — всё, что туда попадает, теряет параллельность; новый потребитель JVM — в `HEAVY` в `vitest.e2e.config.ts` (сценарий — в `HEAVY_SCENARIOS` в `suite.ts`). Проекты с разным `maxWorkers` в vitest 4 обязаны иметь разный `groupOrder`, а группы идут последовательно — поэтому полоса именно «после», а не «рядом».

**Автоповтор упавших файлов** (`scripts/e2e.mjs` — это и есть `npm run test:e2e`): проход 1 — весь набор с JSON-репортом в `reports/e2e/`; проход 2 — только упавшие файлы, одним воркером, на том же бинаре. Код 0 — только если второй проход зелёный. Упавшие в первом и зелёные во втором печатаются в итоге списком **FLAKY** — с тестами и первой строкой ошибки (в CI ещё и в `$GITHUB_STEP_SUMMARY` и аннотацией). Флак не прячется: он виден в каждом прогоне, пока его не починят. Повтора нет, если упало больше `DIODE_E2E_RETRY_MAX` (8) файлов — это поломка, а не флак; если vitest вышел с ошибкой без упавших файлов (необработанная ошибка, globalSetup); при `DIODE_E2E_RETRY=0`. `retry` самого vitest выключен намеренно: он повторяет молча и под той же нагрузкой. Аргументы уходят vitest как есть: `npm run test:e2e -- e2e/mouse.test.ts`. Итог — `reports/e2e/summary.md`/`summary.json`.

**Уборка процессов** — три уровня, от узкого к широкому (`e2e/helpers/processGroup.ts`):

1. редактор стартует лидером своей группы (`detached` у headless, `setsid` внутри node-pty), и `dispose` сигналит всей группе;
2. субпроцесс расширений с языковыми серверами живёт в СВОЕЙ группе — до него групповой сигнал не доходит. Каждая сессия метит окружение `DIODE_E2E_SESSION=<uuid>`, и `appSession` после `dispose` даёт помеченным процессам 2 с выйти самим и добивает остальных, называя их в stderr («добиты процессы, пережившие сессию») — это утечка, о ней стоит знать. `HeadlessSession.dispose` сам по метке не добивает: иначе `languageServerTeardown.test.ts` (прощание LSP по `deactivate`) стал бы пустым;
3. убитый воркер (таймаут, OOM) до `dispose` не доходит вовсе. Тогда работает метка прогона `DIODE_TEST_TMP=<корень>`: teardown корня прогона перед сносом добивает все процессы с ней, а следующий прогон — процессы бесхозного корня (`src/TestUtils/tmpRoot.ts`, поиск — `src/TestUtils/processSweep.ts`).

Поиск по метке читает `/proc/<pid>/environ` — только Linux; на macOS/Windows остаются групповой сигнал и уборка каталогов.

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

### Расширения из магазина (сетевой сьют)

`e2e/marketplace/` — прогон магазина на текущем коде. Берёт **всё, что сейчас опубликовано** в
реестре (`https://diode-editor.github.io/registry/v1/`; адрес — из клиентского `DEFAULT_REGISTRY_URL`,
а не своей копии строки), ставит последнюю версию каждой записи собранным бинарём и проверяет, что
она работает: индекс и мета по сети → артефакт (наш с Pages либо чужой с open-vsx) → `sha256` →
установка → запуск редактора. Отвечает на два вопроса разом — жив ли магазин и не сломало ли
очередное изменение diode расширения, которые в нём лежат.

- **Кейсы порождаются из живого каталога**, а не из таблицы наших чеков: новая запись в магазине
  попадает под прогон сама, без правок в e2e. Состав магазина мы тестом не полицейским — отсутствие
  чека ничего не блокирует.
- `checks.ts` — необязательные поведенческие смоуки: чек дёргает настоящую функциональность и
  смотрит на состояние редактора через инспектор (`EditorElement.state.tabSize`, текст кадра), без
  ввода в PTY, поэтому кроссплатформенно. Глубина видна в имени кейса: «ставится из магазина» против
  «ставится из магазина и работает в редакторе».
- `sample-extension/` — исходник синтетического расширения `test.sample-lang`, которое лежит в
  магазине: декларативный вклад языка и грамматики, без кода и без extension host'а (рантайм-путь
  закрывает `test.tab-setter`). Пересобирается детерминированно —
  `node scripts/pack-vsix.mjs e2e/marketplace/sample-extension <out>.vsix` печатает `sha256`/`size`
  для записи реестра; те же байты при пересборке — условие того, что пин можно проверить сверкой.
- Версия из `Installed <id>@<version>` сверяется с `latest` в индексе — ставим именно то, что
  получит пользователь; несовместимость свежей записи с текущим билдом видна здесь.
- Разбор живого `index.json` нормативным `parseRegistryIndex` — единственное место, где ловится
  расхождение упрощённых проверок сборщика реестра (он живёт в репозитории сайта и наших типов не
  видит) с форматом.

Сьют зависит от сети и от состояния публикации, то есть **может шуметь**, и это принято сознательно:
он краснеет ровно тогда, когда пользователь получил бы нерабочий магазин. Ретраев нет — они прятали
бы этот сигнал. Для работы без сети — `DIODE_E2E_OFFLINE=1` (в CI не выставляется).

### Тесты на стоковые расширения — из магазина (конвенция)

Так пишутся ВСЕ тесты, чей предмет — работа стороннего (стокового) расширения в Diode; это план,
а не компромисс одной задачи. Разделение ответственности:

- **Герметично** тестируем функциональность редактора и API расширений — на СВОИХ синтетических
  расширениях (`e2e/marketplace/sample-extension`, фикстуры вроде `test.tab-setter`).
- **Из магазина** тестируем стоковые расширения: расширение приезжает из публичного реестра,
  **последней опубликованной совместимой версией**. Сторонние `.vsix` в репозиторий не коммитим и
  версию в тестах не пиним — пин (URL + `sha256`) живёт в записи реестра, его обновление = PR в
  репозиторий сайта. Герметичность здесь жертвуется сознательно: обновилась запись и сьюты
  покраснели — это не шум, а сигнал бежать и чинить (совместимость diode либо запись магазина).

Следствие разделения: **сетевой стоковый сьют не может быть единственным гейтом нашего
контракта.** Его предмет — работа чужого кода в Diode; если по пути он опирается на наш контракт
(will-save participants, `TextEditor.options`, completion-провайдеры, core-команды…), этот
контракт обязан быть отдельно закрыт герметичным тестом на синтетическом расширении — иначе в
оффлайне и при пропуске сетевых сьютов контракт остаётся без гейта. Прецедент — миграция
`editorconfig-stock`: проводка `group.saveParticipant` получила герметичный e2e на фикстуре
`user-data-with-will-save` (`e2e/sea-extensions.test.ts`), а тест делегирования в
`extensionHost.willSave.test.ts` перешёл со своей копии команды на настоящую из
`whitespaceActions.ts`.

Как расширение попадает в тест:

- **e2e и сценарии** — установка по id: `installVsix: ["<publisher>.<name>"]` (аргумент без
  суффикса `.vsix` CLI трактует как id из публичного реестра — тот же путь, что у пользователя).
  Сценарию — пометка `network: true`.
- **Юнит-сьюты ext-host'а** — общий хелпер `fetchStockVsix(id)`
  (`src/TestUtils/stockVsix.ts`): клиентский резолв версии (мета →
  `resolveCompatibleVersion` → `sha256`) + кэш в `node_modules/.cache`.
- Всюду — скип в оффлайне: `DIODE_E2E_OFFLINE=1` пропускает такие сьюты (юнитам и e2e —
  `skipIf(MARKETPLACE_OFFLINE)` из `src/TestUtils/marketplaceEnv.ts`, сценариям — `network: true`).

Действующие сьюты по этой конвенции: `extensionHost.pythonLsp*`, `e2e/pythonLsp.test.ts`,
сценарий `python-lsp`, `e2e/editorconfig-stock.test.ts`, `extensionHost.maptzRegionfolder`,
сценарий `region-folding`. Закоммиченных сторонних `.vsix` в репозитории больше нет; стока,
которого нет на Open VSX, это тоже касается — такой vsix перевыкладывается в реестре
(`kind: "proxy-hosted"`, лицензия должна разрешать редистрибуцию). Новые тесты на стоковые
расширения пишутся сразу по конвенции; предпосылка — расширение опубликовано в магазине
([Marketplace.md](TODO/Marketplace.md)).

### Extensions view (герметичный сьют)

`e2e/extensionsView.functional.test.ts` — сам магазин в UI: вьюлет `EXTENSIONS`, поиск, бейджи,
страница расширения. Реестр — **файловая фикстура** `e2e/fixtures/registry/` (`--registry <dir>`),
поэтому сети сьют не касается: состояния карточек в фикстуре заданы прямо
(`acme.sample` — не установлен, `test.tab-setter` — установлен 0.0.1 при реестровых 0.0.2,
`old.legacy` — требует `vscode ^99`), а «жив ли настоящий магазин» отвечает сетевой сьют выше.

Бейджи проверяются не по кадру, а по тексту строки из инспектора (`#extensionsGroup-…`): сайдбар
узкий, и в кадре хвост строки обрезан — ассерт на кадр ловил бы ширину панели, а не содержание.

`e2e/extensionsInstall.functional.test.ts` — установка целиком: кнопка на странице → распакованный
каталог в `<user-data>/extensions` → перезагрузка окна → работающий вклад. Реестр здесь строится
на лету (`e2e/helpers/registryFixture.ts`) и содержит **настоящие** `.vsix`: пакует их продовый
`scripts/pack-vsix.mjs`, поэтому фикстура не проверяет саму себя. Расширение-исходник —
`e2e/marketplace/sample-extension` (язык `.diodesample` + грамматика, без кода): его вклад виден в
статус-баре, и «работает после перезагрузки» проверяется наблюдаемым эффектом, а не файлом на диске.

Перезагрузка окна в e2e требует переподключения: процесс заменяет себя новым, старый сокет
инспектора умирает, а новый слушает **тот же порт** — это делает `HeadlessSession.reconnect()`.
Ввод, который запускает перезагрузку, ответа не получает (окно уходит вместе с сокетом), поэтому
шлётся `sendKey(...).catch(...)`, а не `key(...)` с ожиданием покоя.

### Скриншот-демо (screenshots)

Визуальные фичи демонстрируются **сценариями** в `e2e/scenarios/` (`*.scenario.ts`). Сценарий — это `defineScenario({ name, open, run })`: `run(editor)` получает драйвер над настоящим бинарём (headless) и шлёт команды (`sendKey`, `sendText`, `waitForText`) + снимает кадры (`capture("shot")`). Механика захвата: `HeadlessSession` (реальный SEA-бинарь с `--headless` + инспектор по WebSocket) → `GridSnapshot` → `gridToSvg` → PNG через resvg (всё в `e2e/helpers/`; растеризатор — только тулинг, не в редакторе).

- `npm run screenshots` — прогоняет все сценарии, пишет PNG в `screenshots/` (в `.gitignore`) + `screenshots/INDEX.md`-галерею.
- `e2e/scenarios-<N>.test.ts` (четыре среза, `e2e/scenarios/suite.ts`) гоняют те же сценарии в `npm run test:e2e` (и в CI) — страховка, чтобы демо не протухли; функциональных ассертов там нет.
- `e2e/helpers/renderScreenshot.test.ts` — гейт на «тофу»: шрифты в `e2e/fonts/` обязаны покрывать все кадры спиннера, и два разных кадра обязаны давать разные PNG.

**Шрифты растеризатора.** В `e2e/fonts/` два семейства, порядок значим: `Hack Nerd Font Mono` несёт текст и кодиконы, `DejaVu Sans` подхватывает то, чего у Hack нет, — прежде всего брайль (U+2800), из которого сделан спиннер прогресса. Системных шрифтов на CI-раннерах и в дев-контейнере нет вовсе (`fc-list` пуст), поэтому fallback обязан лежать в репозитории. Непокрытый глиф resvg рисует пустым `.notdef`-квадратом — строковые ассерты этого не видят (в #272 так и уехало в PR), поэтому проверка живёт отдельным тестом, а не глазами.

**Анимация ломает settle.** Settling-глаголы (`sendKey`, `sendText`, клики) ждут «кадр устоялся» — 40 мс без новых кадров. Пока в заголовке крутится спиннер прогресса, такой тишины не наступает, и каждый settling-ввод честно висит до таймаута. Поэтому во время живой анимации шлём только `waitForText`/`waitForState`/`captureFrame`, а если ввод всё же нужен — с `settle: false` (см. `e2e/scmProgress.functional.test.ts` и сценарий `scmProgress`). Долгую операцию для демо делает настоящий `pre-commit`-хук со `sleep` — медленным становится сам git, а не наш код.

### Политика: визуальные фичи требуют скриншот-демо

Фича с видимой/внешней составляющей обязана добавить/обновить сценарий в `e2e/scenarios/` и посмотреть на его кадры своими глазами. PNG к телу PR прикладывать не обязательно: работу принимают по зелёному CI и запуску редактора из ветки (правила — [AGENTS.md](../AGENTS.md), [PR.md](PR.md)).

---

## Живой прогон редактора (`npm run drive`)

Харнесс фейкает рендер и ввод — ровно те области, где живут баги, поэтому перед
«готово» редактор запускают по-настоящему и смотрят на кадр. Для этого есть
инструмент с долгоживущей сессией: каждый шаг — отдельный вызов, как в браузере.

```bash
npm run drive -- start --file src/a.ts='const x = 1;\n' --open src/a.ts   # из исходников, ждёт готовности
npm run drive -- palette "View: Toggle Panel Visibility"
npm run drive -- exec workbench.action.files.save
npm run drive -- screen --numbered          # кадр текстом с координатами
npm run drive -- output Extensions --tail 20
npm run drive -- stop                       # ноль процессов, ноль временных каталогов
```

Полный список команд — `npm run drive -- help`; рецепты и ловушки (попап
автодополнения крадёт Enter, тосты закрывают низ панели, `ArrowDown` а не `Down`) —
скилл [`.claude/skills/drive/SKILL.md`](../.claude/skills/drive/SKILL.md);
устройство — [arch/DevTooling.md](arch/DevTooling.md#toolsdrive). Методы инспектора
`Diode.*` (готовность, команды, OUTPUT, контекст-ключи) доступны любому клиенту
`--inspect-tui`, не только инструменту.

---

## Быстрый цикл по диффу (`check:diff`)

Внутренний цикл «поправил — проверил» не должен ждать полный линт и все 857 тест-файлов. `npm run check:diff` берёт файлы ветки (`git diff` от `merge-base origin/main HEAD` + неотслеженные, только `src/**`, `extensions/**` `.ts`) и последовательно гонит:

1. `tsc --noEmit --incremental` — по всей программе (тип ломается не там, где правка), buildinfo в `node_modules/.cache/diode/`; повторный прогон — секунды.
2. `eslint --cache --cache-strategy content` — только изменённые файлы.
3. `vitest related --run <файлы>` — тесты, которые транзитивно импортируют изменённое.

```bash
npm run check:diff                     # tsc + eslint + vitest related
npm run check:diff -- --near           # тесты только соседние: Foo.ts → Foo.test.ts, Foo.*.test.ts
npm run check:diff -- --coverage       # + покрытие изменённых не-тестовых файлов
npm run check:diff -- --base <ref>     # другая база (стек PR: база — ветка родителя)
npm run check:diff -- --skip tsc,lint  # пропустить шаги
npm run check:diff -- --list           # только показать файлы диффа
```

- Правка в `base/` или `platform/` по графу импортов тянет сотни тестов (`strings.ts` → 230 файлов, ~5 мин). Для них — `--near`: правка рядом с одним тестом проверяется за ~30 с вместе с типами и линтом.
- `--coverage` выключает храповик на этот прогон (`thresholds.autoUpdate=false` и нули): на подмножестве тестов глобальные 100% краснеют и переписывают `vitest.config.ts`. Отчёт `text` по изменённым файлам, с полностью покрытыми.
- Под лизу команда не попадает: она нарочно лёгкая.

**Это не гейт сдачи.** Кэш type-aware eslint не перепроверяет файл, если тип поменялся в его зависимости, `related`/`--near` не видят тестов вне графа, а покрытие подмножества — не храповик. Перед PR — как раньше: `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run test:mutation` (тяжёлые — под лизой).

---

## Гейты в CI без PR

Тяжёлый гейт можно прогнать не на своей машине, а на раннере GitHub — на своей ветке, без PR:

```bash
npm run ci:run -- mutation              # static | test | mutation | e2e | e2e-windows | all
npm run ci:run -- mutation --base <sha> # база диффа; по умолчанию merge-base с origin/main
npm run ci:run -- e2e --no-push         # ветка уже запушена (скрипт сверит remote с HEAD)
```

[`scripts/ci-run.mjs`](../scripts/ci-run.mjs) пушит ветку по https, запускает `ci.yml` вручную
(`workflow_dispatch`) только с выбранным гейтом, ждёт конца и **возвращает вердикт кодом выхода**:
0 — зелёный, 1 — красный, 2 — прогон не состоялся (push, dispatch). На провале печатает хвост логов
упавших шагов (включая шаги под `continue-on-error`); полные логи упавших job’ов и артефакты прогона — отчёт Stryker (`mutation.json`,
`.html`, лог) — ложатся в `reports/ci/<run id>/`.

Для мутационного гейта, e2e и покрытия это **предпочтительный путь**: лиза машине не нужна,
соседние сеансы не голодают, а раннер не страдает флаками от голода по CPU. Прогон идёт минуты
(на 2 vCPU: static ~1.5 мин, test ~5.5, mutation инкрементально ~4.5, e2e ubuntu ~13.5, windows ~8,
плюс `npm install`) — агенту запускать в фоне (`run_in_background`). Инкрементальный кэш Stryker'а
у ручных прогонов свой, по имени ветки: второй прогон той же ветки быстрее первого.

`all` — то же, что гоняет PR, кроме комментариев в PR: отчёты остаются в summary прогона.

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

### Что и почему исключаем из метрики

Исключения (`coverage.exclude`) добавляем **только** если файл попадает в одну из категорий:

1. **Чистые типы** — интерфейсы `I*.ts`, `*.d.ts`, barrel-`index.ts`. Исполнять нечего; чистый интерфейс добавляем в **явный список** exclude (глоб `I*.ts` НЕ используем — см. ниже).
2. **Непокрываемое юнит-тестами** — subprocess-точки входа (`extensionHostSubprocess`, `treeWatcherMain`), SEA-детект (`isSea`, `createDefaultAssetAccess`), RPC-стаб в subprocess (`vscodeNamespace`), DI-проводка (`vs/diode/modules/**`), null-object заглушки. Это проверяется e2e (`vitest.e2e.config.ts`), а не юнит-тестами.

   Точка входа субпроцесса — это `process.send`/`process.on`/`process.exit`, и подменять их в общем прогоне дороже, чем поднять настоящий процесс. Где такой прогон дёшев, он и есть гейт: рядом с исключённым entry живёт `*.integration.test.ts`, который спавнит его тестовым входом (`*.testEntry.ts`, тоже исключён — исполняется только в форке) и проверяет сквозняк через настоящий IPC. Так закрыты `runAsNode` (eval-режим) и watcher-процесс (правка файла на диске → колбэк в процессе редактора). v8-покрытие форка не видит — поэтому entry в exclude, а не в храповике.

**Важно:** реальную логику в файлах с префиксом `I*` (например хелперы `createRange` в `IRange.ts`, `NULL_STATE` в `IState.ts`, `isScrollable` в `IScrollable.ts`) **не прячем** — её покрываем. Поэтому интерфейсы исключаем поимённо, а не глобом `src/**/I*.ts`.

### Ловушки 100%

- Храповик живёт в `npm run test:coverage`, а не в `npm test` (`vitest run` без порогов): зелёный `npm test` не значит зелёный CI. Гоняй `test:coverage` после **каждой** правки продуктового кода, а не только в конце.
- Ветка, покрытая недетерминированно (локально `catch` исполнился, в CI нет), — повод вынести код в функцию с честными тестами, а не ставить `v8 ignore`.
- Плейсхолдер-замыкание (`{ dispose: () => undefined }` до ответа делегата) — отдельная непокрытая функция; лечится порядком: создать подписку до сборки объекта, чтобы колбэк замыкался на локальные переменные.

---

## Мутационное тестирование (Stryker)

```bash
claude-lease run -- npm run test:mutation   # дифф против свежего origin/main, под лизой на ресурс «машина»
npm run test:mutation -- --scope-only       # только показать, что будет мутировано (лиза не нужна)
npm run test:mutation -- --force            # пересчитать всё, не переиспользуя прошлый прогон
npm run test:mutation -- --base <ref>       # другая база диффа (ветка соседа, SHA)
```

База задаётся **только** флагом `--base`; без него скрипт сам делает `git fetch origin main` и
берёт merge-base с `origin/main` (нет сети — что есть локально, затем `main`) и печатает, какую
базу и какой SHA взял. Позиционный аргумент — ошибка: раньше база была первым позиционным, и
`npm run test:mutation -- X` молча брал `main` (npm-скрипт сам ставит флаги впереди), а `X`
уезжал Stryker'у как имя конфига.

Локальный прогон идёт **без статических мутантов и инкрементально** (`--ignoreStatic --incremental`
в `package.json`) — ровно так же, как PR-гейт в CI; статику добирает ночной прогон. Почему так и
что это стоит — [ниже](#цена-прогона-и-инкрементальный-режим).

**Прогон — под лизой.** Машина одна, а сеансов на ней несколько: два Stryker'а разом дают флаки и
OOM вместо результата. Что берётся под лизу — [`.claude/leases.json`](../.claude/leases.json),
как этим пользоваться — скилл [`heavy-run`](../.claude/skills/heavy-run/SKILL.md). Нет команды
`claude-lease` — машина без ограничений, запускай напрямую.

Полный `npm run lint` тоже под лизой: замерено — соседний сеанс держал его 13 минут на 40–70% CPU
и трижды подряд свалил чужой мутационный гейт на dry run (`extension host subprocess did not become
ready in 5000ms` в случайных файлах). Он же OOM-ится на дефолтной куче. `npm test` под лизу пока НЕ
взят — он самый частый, и его сериализация стоит дороже. Но цена отказа замерена: на загруженной
машине полный прогон дал 361 с и три плавающих падения (каждый раз в разных subprocess-тестах,
поодиночке все зелёные), под лизой — 219 с и ноль. Так что перед сдачей его всё равно стоит
запускать через `claude-lease run -- npm test`, даже пока политика его не ловит.

**Обязательный шаг перед сдачей фичи.** Не «когда есть время» — покрытие и мутационный балл закрывают разные дыры, и без второго первое даёт ложное зелёное.

### Зачем, если есть храповик покрытия

Покрытие говорит «эта строка исполнилась», а не «эту строку кто-то проверил». Тест, который проходит по всем веткам и не делает ни одного осмысленного ассерта, даёт **100% по всем четырём метрикам** — и не ловит ничего. Замерено на трёхстрочной функции: 100% покрытия против **11% мутационного балла**, 8 выживших мутантов из 9.

Stryker вносит в код мелкие поломки (`<` → `<=`, `if (x)` → `if (true)`, вырезает вызов) и смотрит, упадёт ли хоть один тест. Упал — мутант **убит**, тесты работают. Не упал — мутант **выжил**, и это место можно испортить незаметно.

Замер на смердженной фиче #261 (мульти-курсор): покрытие 100%, каждый из 597 мутантов покрыт каким-то тестом, `# no cov` = 0 — и **78 выживших**. Из настоящих находок: никто не проверял, что клавиатурные бинды вообще привязаны (`parseKeybinding("shift+alt+up")` → `parseKeybinding("")` выживал), и что каретка доезжает до экрана (`ensureCursorVisible()` → `;` выживал).

### Что мутируем

Только код, который тронула задача: новые файлы целиком, правленые — диапазонами строк из хунков. Легаси-долг в старых файлах не всплывает. Скоуп считает [`scripts/mutation-diff.mjs`](../scripts/mutation-diff.mjs) — в StrykerJS нет `--since` (это опция Stryker.NET, их постоянно путают).

Тесты не мутируются: Stryker портит **исходники**, метрика висит на коде. Сужать набор тестов вручную не надо — раннер сам гоняет только тесты, транзитивно импортирующие мутируемый файл (`vitest.related`).

> **Stryker флейкает, гейт — нет.** Тот же коммит от прогона к прогону даёт у Stryker'а разные наборы выживших, поэтому каждого выжившего гейт перепроверяет сам вживлением точного мутанта и делит на классы — [ниже](#гейт-сам-перепроверяет-каждого-выжившего-вживлением). Разоблачать фантомов руками не нужно.

### Выживший мутант — не всегда дыра

Порог `thresholds.break: 100`, и достижим он только вместе с явными исключениями. Часть мутантов **эквивалентна**: их нельзя убить никаким тестом, потому что поведение не изменилось. Такие гасим комментарием с причиной:

```ts
// Stryker disable next-line EqualityOperator: при value === min обе ветки возвращают min — эквивалентный мутант
if (value < min) return min;
```

Погашенные выпадают из знаменателя балла, поэтому 100% достижимо честно, а каждое исключение видно в ревью — та же механика осознанности, что у списка исключений покрытия.

Отдельно про соблазн: убить мутанта `title: "Remove Secondary Cursors"` → `title: ""` можно ассертом на текст пункта меню. Такой тест ломается при любом переименовании и не ловит ни одного бага. Гейт не отличает его от полезного — отличать должен автор. Когда мутант не указывает на реальное поведение, правильный ответ — `// Stryker disable` с причиной, а не ассерт ради балла.

### Гейт сам перепроверяет каждого выжившего вживлением

Stryker на этом проекте **врёт про выживших**, и врёт по-разному от прогона к
прогону (разбор — [TODO/MutationGateFlake.md](TODO/MutationGateFlake.md)):

- **промах подбора тестов** — `coverageAnalysis: perTest` и `vitest.related`
  не видят часть покрывающих тестов, и мутант гоняется чужим набором;
- **потеря результата** — у связки `@stryker-mutator/vitest-runner@10` ↔
  `vitest@4` прогон следом за оборванным по `bail: 1` не выполняет ни одного
  теста (`testsCompleted: 0` при сотне покрывающих: файлы остаются в состоянии
  `run`, раннер отбрасывает всё без результата —
  [stryker-js#6073](https://github.com/stryker-mutator/stryker-js/issues/6073),
  чинит [#6146](https://github.com/stryker-mutator/stryker-js/pull/6146), не влит);
- **`RuntimeError`** — раннер падает на мутанте, и такой мутант вообще не
  входит в балл.

Поэтому после прогона Stryker'а [`scripts/mutation-diff.mjs`](../scripts/mutation-diff.mjs)
отдаёт **каждого** мутанта, которого Stryker не записал убитым (Survived,
NoCoverage, RuntimeError), в [`scripts/verify-mutants.mjs`](../scripts/verify-mutants.mjs).
Тот вносит **ровно мутанта Stryker'а** — диапазон `location.start`–`location.end`
из отчёта заменяется на `replacement` в `files[f].source` — в песочницу (копия
проекта в `.stryker-tmp/verify-*`, node_modules симлинком; рабочее дерево не
трогается никогда) и гоняет vitest этапами:

1. тесты из `coveredBy` мутанта и соседние `<имя>*.test.ts`;
2. все тесты, транзитивно импортирующие файл (граф импортов — то, что делает
   `vitest related`, одним проходом без сервера vite);
3. с `--verify-full` — весь сьют.

Упал тест — проверяется, что это мутант: упавшие файлы гоняются **без** мутанта
(уликой считается только тест, зелёный без него) и ещё раз **с** ним (падение
должно повториться — флак фантомом не становится). Без мутанта гоняются только
упавшие файлы, и результат кэшируется на прогон: связанный набор горячего файла
— сотни тест-файлов. Вердикт — класс:

| Класс | Что значит | Что делать |
|---|---|---|
| `phantom` | Тест, зелёный без мутанта, с ним краснеет (и повторно). Stryker соврал. | Ничего. В отчёте мутант становится `Killed` с причиной `verified by injection` и именами убивших тестов. **Не гасить** `Stryker disable`. |
| `real` | Вживлён, все подобранные тесты зелёные. Настоящая дыра. | Тест на поведение — или `// Stryker disable next-line <мутатор>: причина`, если мутант эквивалентный. Остаётся `Survived`/`NoCoverage` и роняет балл. |
| `real` + `equivalent-candidate` | То же, плюс эвристика: граничный `<`↔`<=`, человекочитаемая строка, охраняющее `if`, у которого убит соседний `→ true/false`. | Подсказка, а не вердикт: гейт красит так же. Посмотри код — часто это и есть случай для `Stryker disable` с причиной. |
| `runtime-error` | Ни один тест не упал, а vitest упал сам: unhandled error/rejection, падение воркера. И без мутанта — не падает. | Чинить **код**: исключение улетает мимо стека теста (см. раздел ниже). Красит CI, хотя балл Stryker'а его не видит. |
| `inconclusive` | Вердикта нет: тесты красные и без мутанта, падение не повторилось, нет ни одного теста, кончился `--verify-budget`. | Причина — в строке вердикта. Красный без мутанта сьют чинится первым; «нет тестов» — значит, файл не импортирует ни один тест. |
| `timeout` | vitest с мутантом не уложился (по умолчанию 120 с + 3 с на тест-файл, `--verify-timeout`). | Обычно мутант зациклил синхронный код. Таймаут не убитый и не фантом: посмотри мутанта; на медленной машине — подними таймаут. |
| `stale` | Исходник на диске не тот, к которому Stryker применил мутанта. | Отчёт протух — перегони гейт. Не находка в коде. |

**Вердикт гейта** — две половины по итоговому отчёту и только по мутантам
скоупа: балл по формуле Stryker'а (`RuntimeError`, `CompileError`, `Ignored`
вне знаменателя) против `thresholds.break` — его роняет `real`, — и классы без
вердикта (`runtime-error`, `inconclusive`, `timeout`, `stale`), которые красят
гейт сами, мимо балла: «не смогли проверить» — не «проверено». Одинаково
локально и в CI. Исход — `reports/mutation/gate.json` (`empty-scope` / `passed`
/ `failed` / `error`, плюс `classes` и `blocking`), вердикты по мутантам —
`reports/mutation/verdict.json`, таблица — в консоли и в комментарии к PR.

Не код возврата Stryker'а: инкрементальный Stryker дописывает в отчёт и в свой
балл старые результаты вне текущего `--mutate` (прошлые ветки, код до ребейза).
Скрипт выбрасывает их сразу после прогона — их не перепроверяют и не
показывают. Отчёт удаляется перед запуском Stryker'а, а отчёт старше старта —
ошибка: упади Stryker до записи отчёта, гейт не прочтёт чужой (исход `error`).

Руками то же самое — по любому `mutation.json`, в том числе скачанному из
артефактов CI (`--root` — распакованный снимок его коммита со своим `npm ci`):

```bash
claude-lease run -- node scripts/verify-mutants.mjs [<mutation.json>] [--filter <путь>] [--root <проект>]
```

Почему не второй прогон Stryker'а, как было до волны 2: точечный прогон
построчным скоупом лечил потерю результата (`--disableBail`), но не промах
подбора тестов, и сам флакал на своём initial test run — весь сьют, включая
сетевые тесты стоковых расширений (#339: 60-секундный таймаут
typescript-language-server уронил перепроверку, и семь фантомов стали красным
гейтом). Проверено на отчётах CI тех PR, на снимках их коммитов: #339 — 7
phantom + 2 runtime-error за минуту; #343 — 8 phantom + 4 real, и это ровно те
четыре настоящие дыры, которые руками записали в фантомы, вживив `if (false)` на
всё условие вместо левого операнда `||` (`wireTypes.ts:2208`). Дорогой класс —
`real`: ему нужен весь этап 2 (у `wireTypes.ts` — 209 импортирующих тест-файлов,
пара минут на 4 ядрах).

> **Вживлять — ровно мутанта.** Если проверяешь руками: Stryker часто мутирует
> ПОЛОВИНУ выражения (левый операнд `||`), и `if (false)` на всё условие
> проверяет другой мутант. И адресовать мутанта — по `location`, а не по тексту
> строки: в большом файле она бывает не уникальна. Скрипт делает и то и другое.

### «Раннер упал на мутанте» — тоже не проверено, и это почти всегда наш код

`RuntimeError` в отчёте (`Test runner crashed. Tried twice to restart it…`) —
не флак инструмента, а сигнал, что мутант заставил код **кинуть мимо стека
теста**: из микротаска, таймера или слушателя события. Цепочка такая:

1. мутант ломает слушателя — например, `if (entry.paneView === null) continue`
   → `if (false)`, и `refreshTitleActions` идёт в неприаттаченный контейнер;
2. слушателя зовут из `queueMicrotask` (так устроен коалесинг
   `ContextKeyService.onDidChange`), поэтому исключение не принадлежит ни
   одному тесту: **ни один тест не падает**, vitest пишет unhandled error;
3. раз падений нет, `vitest-runner` уходит в ветку «ошибка вне прогона тестов» и
   ломается на её сериализации: vitest отдаёт не `Error`, а плоский клон, у
   которого собственный `toString` — строка `"Function<toString>"`, и `String()`
   над ним кидает `Cannot convert object to primitive value`;
4. Stryker дважды перезапускает воркер и записывает мутанта в `RuntimeError`.

Ключевое: **мутанты в статусе `RuntimeError` не входят в знаменатель балла**, то
есть прогон с ними выходит нулём. Раньше такой мутант молча уезжал непроверенным
— именно так и произошло в #272. Теперь гейт смотрит не на код возврата, а на
отчёт: каждый `RuntimeError` перепроверяется вживлением, и если vitest с
мутантом падает вне тестов (а без него — нет), это класс `runtime-error`, и гейт
краснеет с выдержкой из `Unhandled Errors`.

Что делать, когда увидел такой мутант: смотреть **не на инструмент, а на
слушателя**. Исключение, улетевшее из микротаска, в проде роняет редактор
целиком: обработчика `uncaughtException` у нас нет, так что процесс умирает
(терминал тут спасает `process.on("exit")` внутри tuidom), а остальные слушатели
этого события не получают вовсе — цикл обрывается на первом же кинувшем. То есть
находка настоящая, просто выглядит как поломка Stryker'а. Долгий ответ — общий `Emitter`
с локализацией ошибок слушателя (как `onUnexpectedError` у vscode) — это #275.

**Общий эмиттер есть: `vs/base/common/event.ts`** (план миграции —
[TODO/Events.md](TODO/Events.md)). Событие на нём ловит синхронное исключение
слушателя и отдаёт его в `onUnexpectedError`, остальные слушатели событие
получают. Чтобы изоляция не превратила «слушатель кинул → тест упал» в «слушатель
кинул → тишина», общий `setupFiles` vitest'а
(`src/TestUtils/unexpectedErrors.setup.ts`) на каждый тест ставит обработчик,
который копит непредвиденные ошибки и **роняет тест** в `afterEach` (упавший тест
не трогает). Мутант, ломающий слушателя, получает честный `Killed` вместо
`RuntimeError`. Тест, которому нужен свой обработчик, ставит его сам через
`setUnexpectedErrorHandler`. В проде ошибки уходят в лог: `main.ts` и субпроцесс
extension host'а ставят обработчик рядом с `unhandledRejection`.

Граница: эмиттер ловит только **синхронный** бросок. Отказ fire-and-forget
промиса внутри слушателя по-прежнему уходит в `unhandledRejection`. Пока событие
не переведено на `Emitter` (или речь про промис), у конкретного мутанта остаётся
штатный выход — `// Stryker disable next-line <мутатор>: причина` с честной
причиной («раннер падает на unhandled error из микротаска, см. #275»). Это ровно
тот случай, для которого гашение и придумано: мутант указывает на дыру в
архитектуре событий, а не в тестах этой строки.

### Два прогона: на PR и ночью

| | На PR (`ci.yml`, job `mutation`) | Ночью (`mutation.yml`) |
|---|---|---|
| Скоуп | дифф PR | всё, влившееся за окно |
| Статические мутанты | пропускаются (`--ignoreStatic`) | проверяются |
| Инкрементально | да: `reports/stryker-incremental.json` в кэше по ветке | нет |
| Результат | комментарий в PR, job краснеет | тикет с меткой `mutation` |
| Цена (замер на #261) | ~12 минут | ~41 минута |

Отчёт собирает [`scripts/mutation-report.mjs`](../scripts/mutation-report.mjs): сводка по статусам, а дальше каждый выживший — настоящим diff'ом строки со ссылкой на неё в коде. Не «`ConditionalExpression` → `true`», а:

````diff
- if (value < min) return min;
+ if (true) return min;
````

Разница не косметическая: по имени мутатора и замене место в коде не восстановить, не открыв файл, — а именно этот шаг решает, будет отчёт прочитан или пролистан. Исходник берётся из самого JSON-отчёта (`files[].source`), поэтому рендер не зависит от состояния рабочего дерева. Список обрезается по числу записей и по бюджету символов комментария, и обрезанный список честно сообщает, сколько скрыл — полный всегда лежит в HTML-отчёте среди артефактов прогона.

**Статический мутант** — тот, что сидит в коде времени загрузки модуля: таблицы-константы, регистрации команд и биндов. `coverageAnalysis: perTest` на них не работает (привязать исполнение к конкретному тесту нечем), поэтому на каждого гоняется весь связанный набор тестов — по ~21 секунде против ~1.3 у обычного. На фиче #261 это 82 мутанта из 597, съедающие 29 минут из 41.

Отсюда разделение: PR-гейт должен быть по карману на каждый пуш, поэтому статику там пропускаем; она не теряется, а уезжает в ночной прогон, снятый с критического пути. Балл в комментарии к PR это оговаривает явно — он выше не потому, что дыр нет, а потому что часть смотрели не здесь.

Ночной прогон намеренно **не краснит** job: балл ниже 100 для него штатный исход, находки уезжают в тикет. Красным он станет только от настоящего сбоя — иначе его перестали бы читать.

Сбой от «нечего мутировать» отличается по `reports/mutation/gate.json`, а не по отсутствию отчёта: с 2026-09-13 по 2026-10-04 ночной прогон три недели зеленел за 0.4 минуты, падая на первом же `git diff` (окно в 270 коммитов дало 11.7 МБ вывода, `spawnSync` с дефолтным буфером в 1 МБ убивал git с `ENOBUFS` и пустым stderr), — а workflow читал «нет отчёта» как пустое окно. Теперь нет `gate.json` или исход `error` — job красный и база `mutation-baseline` не двигается. Скоуп широкого окна (тысячи диапазонов, ~200 КБ) уходит Stryker'у не флагом `--mutate` (Linux режет один аргумент на 128 КиБ), а копией конфига в `reports/stryker.scope.json`. Окно, которое не укладывается в `timeout-minutes`, сужают ручным запуском с промежуточным `base` — см. комментарий у шага «Сдвинуть базу» в `mutation.yml`.

### Цена прогона и инкрементальный режим

Замер на скоупе PR #297 (18 файлов, 850 мутантов), полностью — в
[TODO/TestRunTime.md](TODO/TestRunTime.md). Считать надо не wall-time на сильной
машине, а CPU-минуты: на четырёх ядрах они и превращаются в ожидание.

| Прогон | 16 ядер, wall | CPU-мин | На 4 ядрах |
|---|--:|--:|--:|
| со статикой (старый локальный дефолт) | 10 мин | 115 | ~35–40 мин |
| `--ignoreStatic` | 4,5 мин | 46 | ~12–15 мин |
| `--ignoreStatic --incremental`, повтор без правок | 45 с | 2,7 | ~1 мин |
| … после добавленного теста или правки строки | 43 с | 3,3 | ~1 мин |

Отсюда локальный дефолт в `package.json`: `--ignoreStatic --incremental`.

**Статика** — 12% мутантов и 60% CPU: на каждого гоняется весь related-набор
(~45 CPU-с против ~3). Локально её нет по той же причине, что и на PR; ночной
прогон её проверяет как проверял. Из 16 выживших со статикой на #297 пятнадцать
были статическими `StringLiteral` в UI-строках.

**Инкрементальный режим** ([Stryker `--incremental`](https://stryker-mutator.io/docs/stryker-js/incremental/)):
результаты прошлого прогона лежат в `reports/stryker-incremental.json` (в
`.gitignore`; в CI — кэш по ветке), и мутант заново не гоняется, если его код не
менялся, а убивший его тест — тот же; выживший гоняется снова, если появились
тесты. Ровно цикл «выживший → тест → перегон», и он теперь стоит минуту, а не
пятнадцать. Два следствия, о которых надо знать:

- Выжившие из прошлого прогона переиспользуются как выжившие — в том числе
  потерянные по bail и фантомы неполного `vitest.related`. Вердикт вживления в
  incremental-файл не попадает (его пишет Stryker), поэтому фантомы
  перепроверяются каждый прогон заново — это этап 1, секунды на мутанта.
- Мутанты вне текущего скоупа, которые Stryker дописывает из incremental-файла
  (локально он один на все ветки), из отчёта и балла выбрасываются — см.
  «Вердикт» выше.
- Сомневаешься в кэше (правил конфиг Stryker'а, обновил vitest, странный балл) —
  `npm run test:mutation -- --force` пересчитывает всё с нуля.

### Песочница Stryker'а не должна менять файлы

`"disableTypeChecks": false` в `stryker.config.json` — не мелочь. По умолчанию
Stryker вставляет `// @ts-nocheck` в начало каждого `.js/.ts` под `src/` своей
песочницы (и вырезает прочие `// @ts-…`), а под `src/` лежат и тестовые ДАННЫЕ:
фикстуры diff-корпуса `__fixtures__/*/1.js`. Строка сверху сдвигает номера строк
ожидаемого diff'а, `difficult-move` краснеет, и Stryker падает на initial test run
на любом PR, чей связанный набор доходит до корпуса. Типы при прогоне мутантов
никто не проверяет (vitest транспилирует esbuild'ом), так что директива не нужна.

### Ограничение, о котором надо знать

Мутировать весь репозиторий нельзя: 998 файлов дают ~110 000 мутантов, то есть дни непрерывного счёта. Оба прогона работают только по диффу, и это не оптимизация, а условие существования.

## Перф-гейт и бенчмарк открытия файла

Публичные цифры [docs/public/BENCH-OPEN.md](public/BENCH-OPEN.md) снимает `npm run bench:open`
(`e2e/bench/benchOpen.ts`): SEA-бинарь в PTY, чёрный ящик по таймстемпам чанков stdout плюс белый
ящик — трасса вех `performance.mark` того же процесса (`DIODE_STARTUP_TRACE=<файл>`,
см. [arch/Common.md](arch/Common.md#вехи-старта-performancets)). Главная цифра — «наших мс» =
до текста − пол node, где пол — `node -e ""` тем же PTY-спауном (`node --version` отвечает до
подъёма V8 и полом быть не может). После открытия бенч гоняет нагрузку (вставка, Enter, undo,
Ctrl+End, поиск) и меряет латентность клавиши до кадра; колонка peak RSS — `VmHWM` процесса.
Локально: `npm run bench:open -- --sizes=small,medium,xlarge --runs=5 --label="условия"` — под лизой
`heavy-run` (бенч собирает SEA).

Гейт: `e2e/bench/startupBudget.bench.ts` в `npm run test:perf` (`vitest.perf.config.ts` включает
`e2e/bench/**/*.bench.ts`) меряет `small` тем же модулем и роняет прогон, если медиана «наших мс»
над полом node выше бюджета `STARTUP_BUDGET_OURS_MS`. Бюджет — храповик: этап «Кухня»
([TODO/OpenPerformance.md](TODO/OpenPerformance.md)) зажимает его по мере снятия стоимости; ослаблять
без замера нельзя. Vitest bench своих бюджетов не умеет — исключение из функции бенча роняет файл
с ненулевым кодом, этим гейт и пользуется.

## Неопубликованный движок tuidom в diode

До публикации новой версии `@tuidom/*` (её запрашивают у человека) правку движка проверяют в diode через tgz, а не `npm link`: в checkout tuidom `exports` смотрят на `.ts`, и симлинк работает только под tsx.

- `npm run engine:link` — собирает tgz из checkout tuidom (`TUIDOM_DIR` или `--tuidom <dir>`) и ставит все шесть пакетов в `node_modules` одной командой, не трогая `package.json`/lock. Проверять typecheck/test/build (`build:sea` — под лизой), а не `npm start`: tsx маскирует ESM-дыры.
- `npm run engine:status` — что стоит сейчас; `npm run engine:unlink` — вернуть пакеты из реестра (`npm ci`).
- До выхода версии diode на неё не завязывается: коммитов с link-режимом не бывает.
