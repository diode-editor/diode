# Inspector-протокол + подготовительный рефакторинг TUIDom

Статус: `[ ]` открыта.

## Зачем
Конечная цель — инспектор «как браузерный дебаг-порт» для TUIDom: писать e2e,
выбирая элементы из DOM и проверяя их свойства, вместо парсинга текстового
вывода. Нынешний e2e через PTY+ANSI хрупкий — цветовые assertions падают на
Windows/macOS (см. [E2E.md](E2E.md)).

**Перед инспектором — рефакторинг**, по двум причинам:
1. Часть наследников `TUIElement` «зазря» элементы — это кастомные лейаутеры или
   контроллеры под видом элемента. Чистая иерархия → осмысленная сериализация
   дерева в инспекторе.
2. Bootstrap приложения разбросан и дублируется. Единая «основа приложения» →
   прод/тесты/инспектор поднимают TUIDom-инстанс одинаково; отдельный инстанс
   основы и поднимает порт инспектора.

## Находки аудита: кто «зазря» TUIElement

### A. Кастомные лейаутеры → композиция готовых контейнеров
Хардкодят раскладку в `performLayout`/`render` вместо `VStack`/`HFlex`/`Padding`:
- `BodyElement` (`tuidom/ui/body/bodyElement.ts`) → `VStack` + overlay-слой
- `WorkbenchLayoutElement` → `HFlex` (left-fix / center-fill / right-fix)
- `EditorGroupElement` → `VStack` (tabStrip h=1 / content fill); контроллер уже есть
- `EditorTabStripElement` → упростить (ручной `rebuildHFlex` поверх `HFlex`)
- `PopupMenuElement` → border+padding+VStack как композиция

⚠️ Блокер: `HFlex`/`VStack` держат **один** `fill`-ребёнок (TODO #6 в
[README](README.md)). Перед заменой лейаутеров, возможно, доработать
`FlexContainer` (несколько fill с весами).

### B. Контроллеры под видом элемента → логику в слой Workbench
- `MenuBarElement` (`tuidom/ui/menu/menuBarElement.ts`) — держит `activeMenu`,
  открытие/закрытие popup, навигацию, мнемоники, слушает родителя. **Чёткий
  кандидат**: перевести на пару `MenuService` ↔ `MenuBarComponent` целиком, элемент сделать тонким; связь
  callback'ами (эталон — `StatusBarComponent`/`EditorGroupComponent`).
- `ContextMenuLayer` — менеджер overlay-сессий (политики close/focus/anchor), не
  виджет. Разделить: `OverlayManager`-сервис (Workbench) + тонкий
  overlay-контейнер (TUIDom). **Инвазивно** (потребители: `WorkbenchComponent`,
  `EditorElement`, `MenuBar`, file-tree) → отдельная осторожная фаза.

### НЕ трогать (поправки к первичному аудиту)
- `EditorElement` — разделение уже корректное: `EditorViewState` (модель) /
  `EditorElement` (тонкий view) / `TextFileModel`+`EditorComponent` (I/O, save, токенизация).
  Это эталон, а не проблема.
- `QuickPickElement` — пограничный; навигация по списку нормальна для виджета,
  фильтрация уже в `QuickOpenService`. Максимум — вынести
  `selectedIndex`/`scrollOffset` в state-класс. Низкий приоритет.
- ~14 примитивов (`Box`, `TextLabel`, `TextBlock`, `Input`, `ScrollViewport`,
  `TitledPanel`, `StatusBar`, `EditorTabItem`, `BoxContainer`,
  `ScrollBarDecorator`, `PaddingContainer`, `VStack`, `HFlex`, `Button`) —
  честные, не трогаем.

### Эталон разделения (к нему приводим B)
Service/Component + тонкий Element + опц. State-класс — паттерн вынесен в
[../arch/Workbench.md](../arch/Workbench.md) (раздел «Разделение Service/Component /
Element / State»). Эталоны: `StatusBarComponent` ↔ `StatusBarElement` (уже в
Workbench-модели Service ↔ Component), `EditorGroupComponent` ↔
`EditorGroupElement`, `InputWidgetService` ↔ `InputElement` + `InputState`.

## Основа приложения (bootstrap)
- `TuiApplication` (`src/vs/base/browser/TuiApplication.ts`) уже generic ядро рантайма
  (event loop / `scheduleRender` / `renderFrame` / `focusManager` / `backend` /
  `root`) — оставляем как есть.
- Проблема — разбросанный bootstrap: `src/vs/diode/main.ts` (полный),
  `src/TestUtils/TestApp.ts` (мини-фасад), `src/TestUtils/ExtensionTestHarness.ts`
  (собирает сервисы руками, в обход DI → максимум дублирования).
- Действие: выделить `bootstrapApp(opts)` (новый `src/AppRuntime/`, слой App),
  возвращающий `{ app, workbench, container, dispose }` **без** `run()`/
  `mount()` (ответственность caller). `main.ts`, харнесс и инспектор переиспользуют.
- Инспектор: caller после `bootstrapApp()` создаёт `new InspectorServer(app)` и
  поднимает порт вокруг `app.run()` (по флагу `--inspect-tui`).

## Порядок фаз (инкрементально — не всё сразу)
1. **Основа**: извлечь `bootstrapApp()`, перевести `main.ts` и
   `ExtensionTestHarness` на неё. Низкий риск, прямой фундамент инспектора.
2. **Лейаутеры (A)**: при необходимости сперва `FlexContainer` (TODO #6), затем
   `EditorGroup`/`Body`/`Workbench`/`TabStrip`/`PopupMenu` на композицию.
3. **MenuBar (B)**: логику MenuBar целиком в `MenuService`/`MenuBarComponent`, тонкий `MenuBarElement`.
4. **ContextMenuLayer (B)**: `OverlayManager` + тонкий контейнер, мигрировать
   потребителей по одному.
5. **Инспектор**: `[~]` первый срез готов — `tuidom/inspector/` (`InspectorCore` +
   `serializeTree` + `TUIDom.getDocument` + рукописный WS-транспорт
   `InspectorServer` + `attachInspector`), тесты in-process + смоук. Дальше —
   nodeId/самоописание/grid/renderTick/CLI-флаг `--inspect-tui`.

## Инспектор — зафиксированные решения
- Свой протокол `TUIDom.*` (WebSocket+JSON, форма как у CDP), НЕ
  CDP-совместимость; DevTools frontend / Puppeteer / Playwright as-is отвергнуты
  (разрыв TUI↔HTML/CSS, нет `Runtime.evaluate`). CDP — образец формы.
- Транспорт: рукописный WebSocket поверх `node:http`, zero runtime-deps
  (GOAL.md). Слой `tuidom/inspector/` (→ TUIDom+Common). Флаг
  `--inspect-tui[=host:port]`, работает и в SEA-бинаре.
- Ввод в e2e — гибрид: действия через существующий `DiodeSession.sendKey/write`
  (PTY), новый канал только читает DOM/свойства. Поправка: в `--headless` драйвер
  уже пишет — `sendKey/sendText/sendMouse/resize`; мышь (`TUIDom.sendMouse`)
  инъектируется только этим каналом, PTY-аналога у неё нет.
- Опоры: `querySelector`/`querySelectorAll` (`src/vs/base/browser/tuiSelector.ts`),
  `resolvedStyle`/`globalPosition`/`layoutSize` (`TUIElement.ts`), грид через
  `TerminalScreen.grid`.

### Почему свой протокол, а не CDP (обоснование штурма)
- CDP стандартизован де-факто, не формально (контролирует Chromium, не W3C);
  машиночитаемая спека `ChromeDevTools/devtools-protocol`; транспорт
  ws+JSON+HTTP-discovery; формат `{id,method,params}` ≈ JSON-RPC, но не он.
  Настоящий стандарт рядом — WebDriver BiDi (W3C), но тоже про браузеры.
- Три уровня переиспользования готового:
  1. Форма протокола (ws+JSON, домены, события, discovery) — ✅ берём.
  2. Тонкий клиент (`chrome-remote-interface` / `ws`) в тестах — ✅ возможно
     (dev-dep, не нарушает GOAL.md); свой 50-строчный клиент тоже тривиален.
  3. Тяжёлый GUI (DevTools frontend / Puppeteer / Playwright) as-is — ⚠️ ловушка:
     ждут HTML-DOM, CSS computed строками, box model в пикселях,
     `Runtime.evaluate`, домены Page/Target. У нас виджеты≠теги, стиль=packed
     fg/bg+StyleFlags, геометрия в ячейках, JS-песочницы нет — маппинг дорог и хрупок.
- Вывод: CDP как образец формы, не как цель совместимости.

### Открытые вопросы — решено в e2e-инфраструктуре (Phase 3)
- **Адресация узла → селектор-как-адрес (stateless).** `nodeId` эфемерен
  (виджеты пересоздают поддеревья при обновлении данных — id протухают между
  кадрами), поэтому e2e целится
  селектором, вычисляемым каждый раз (`e2e/helpers/query.ts`: `Tag`/`#id`/`@role`/
  потомок). `nodeId` в снимке оставлен для диагностики, но адресом не служит.
- **Источник свойств → самоописание `inspectState()` на `TUIElement`.** База
  возвращает `undefined`; интерактивные виджеты переопределяют, `serializeTree`
  кладёт результат в `NodeSnapshot.state`. Плюс: свойство остаётся публичным
  контрактом виджета и покрывается юнит-тестом рядом с ним (а не растёт серверный
  сериализатор, знающий про каждый виджет).

### Открытые вопросы — ещё не трогали
- Грид-снимок `TUIDom.getGridSnapshot` + событие `renderTick` в ядре v1 или
  отдельной фазой. (Сейчас e2e снимает кадр через `captureFrame` в headless;
  «рендер устоялся» решает `TUIDom.waitForIdle`, а не событие renderTick.)
- Объём GUI: только e2e-бекенд vs + CLI-инспектор (`npm run inspect`) vs + web.

## Verification
- После каждой фазы: `npm test` (unit/integration через `TestApp`,
  querySelector-проверки структуры) и `npm run test:e2e` — зелёные.
- Bootstrap: поведение `main.ts` неизменно (e2e `sea-startup` + ручной smoke).
- Лейаутеры: `expectScreen`-снапшоты до/после совпадают.
- Инспектор (этап 5): e2e поднимает SEA-бинарь с `--inspect-tui`, ws-клиент
  выбирает элемент селектором и ассертит свойства.
