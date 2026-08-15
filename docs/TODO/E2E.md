# E2E и Inspector-протокол

## Phase 1 — [~] E2E против собранного SEA-бинаря

Готово: `vitest.e2e.config.ts` + `npm run test:e2e`; helpers (`buildOnce`, `DiodeSession` поверх `node-pty`, `AnsiScreen`-парсер); сьюты `sea-startup` / `sea-assets` / `sea-extensions` (см. `e2e/`). Подробности — [docs/TESTING.md](../TESTING.md) (раздел «E2E»).

**Открыто (Phase 1.x):**
- [ ] CI: документировать build-essential / python3 для нативной сборки `node-pty`. Возможна замена на `@homebridge/node-pty-prebuilt-multiarch` при проблемах.
- [ ] Расширить кейсы: открытие директории как workspace + проверка, что fixture виден в файловом дереве.
- [ ] Снять зависимость от точной фразы из комментария (`fixture used`) — заменить на стабильный маркер в фикстуре.
- [ ] **e2e-cross-platform**: `renders fixture text on screen` и `applies syntax highlighting` пропускаются на Windows и macOS. На Windows ConPTY инжектирует `CSI K` / clearing sequences после resize, стирая строки которые рендерер уже вывел; `stdout.on("resize")` внутри ConPTY-процесса ненадёжен → delta-рендерер не знает что нужен полный redraw. Нужно либо добавить в `NodeTerminalBackend` принудительный механизм полного сброса при потере синхронизации (watchdog по неизменному грид-хешу?), либо перейти на Inspector-протокол (Phase 2) для e2e вместо PTY-парсинга.

## Phase 2 — Inspector-протокол

Вынесено в отдельный документ: [Inspector.md](Inspector.md) — там же подготовительный рефакторинг TUIElement-иерархии и выделение основы приложения, на которой поднимается порт инспектора.

## Phase 3 — [x] Инфраструктура функциональных e2e

Phase 1 давала «запустился и что-то нарисовал», Phase 2 — инспектор. Между ними
зияла дыра: **функциональные** e2e, которые водят приложение как пользователь и
проверяют поведение. Дыру видно по тестированию PR #197 (панель Output): шесть
дефектов прошли мимо 5882 зелёных юнит-тестов и 100% покрытия, потому что
смотреть туда, куда смотрит пользователь, было нечем и неудобно.

Закрыто — итог в [docs/TESTING.md](../TESTING.md) (раздел «E2E»). Что сделано:

- [x] **Изолированный запуск для всех потребителей** — `e2e/helpers/appSession.ts`
  (`prepareAppEnv` + `startHeadlessApp`/`startPtyApp`) и vitest-обёртки
  `e2e/helpers/useApp.ts` (`useHeadlessApp`/`usePtyApp`). Один временный корень
  изолирует `--user-data-dir` + HOME/XDG + cwd. `runScenario` и все сьюты
  (`mouse`, `inspector-real-app`, `sea-*`, `selfextract`, `editorconfig-stock`)
  переведены; прогон больше не трогает реальный `~/.diode` и корзину.
- [x] **Словарь фокуса** — `focusedLeaf`/`focusPath` (`e2e/helpers/query.ts`),
  `session.focusedType()` и `waitForFocus(type)`.
- [x] **Локаторы вместо координат** — селектор-адрес (`$`/`$$`/`boxOf`/`centerOf`
  в `query.ts`), `session.node`/`nodes`/`clickNode`/`wheelNode`; контентный
  `clickText`. `panelTabPoint`-костыль заменён геометрией из
  `PanelContainerElement.inspectState().tabs`.
- [x] **Читаемый дамп кадра при падении** — `dumpFrame` (`e2e/helpers/frame.ts`) +
  `dumpSession` (кадр + путь фокуса + скелет дерева + stderr), печатается из
  `onTestFailed`.
- [x] **Мышь в сценариях** — `ScenarioDriver` получил
  `getDocument`/`waitForNode`/`sendMouse`/`click`/`clickNode`/`wheel`.
- [x] **Пробы переписаны** — `e2e/outputPanel.test.ts` и
  `e2e/outputPanelRegression.test.ts` на общих хелперах: 0 `sleep`, выделение
  из `editor.state.selections`, координаты из `inspectState`/`clickText`.
  `probeHarness.ts` удалён.
- [x] **Механика ожиданий (Phase 2)** — серверный `TUIDom.waitForIdle` +
  settle-глаголы + `waitUntil`; `inspectState()` виджетов в `NodeSnapshot.state`.
- [x] **Параллельный прогон** — сборка в `globalSetup`, `fileParallelism` с
  дефолтом «половина ядер», ручка `DIODE_E2E_WORKERS`.

### Найденные дефекты

- [ ] **Открытый find + открытие второй вкладки роняет фокус, ввод уходит в
  невидимую вкладку.** `Ctrl+F` → набрать запрос → `Ctrl+P` → выбрать другой файл
  → Enter. Фокус не стоит ни на одном элементе; дальнейший набор молча правит
  первую, уже скрытую вкладку (на экране второй файл, а грязнеет первый).
  Без открытого find тот же сценарий отрабатывает нормально. Пре-существующий:
  воспроизводится одинаково на `main` (c3fa124), на head PR #197 до фикса
  (cda7424) и после (255d596). Тест-документ — `it.fails` в
  `e2e/outputPanelRegression.test.ts`; когда починим, он покраснеет.

## Команды
```bash
npm run build:sea      # собрать dist/diode
npm run test:e2e       # e2e тесты против бинаря
npm test               # обычные unit-тесты (e2e не запускаются)
```
