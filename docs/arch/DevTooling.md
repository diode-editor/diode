# demos/ · Stories (`*.stories.ts`) · TestUtils/

Часть архитектуры Diode — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).

## demos/
Демо-приложения для ручного тестирования отдельных компонентов (`src/demos/`). Движковые демо-хосты (как напрямую поднимается `TuiApplication` на `NodeTerminalBackend`) уехали в `demos/` репозитория tuidom.

## Stories (`*.stories.ts`)
Интерактивные демо-сценарии виджетов живут **рядом с компонентами** (`*.stories.ts`) и экспортируют именованные функции-стори. Контракт — `src/StoryRunner/StoryTypes.ts` (`StoryContext { app, body, args, afterRun }`, `StoryMeta { title }`).

Контракт story (`StoryContext`/`StoryModule`) приходит из пакета — `@tuidom/testing/storyTypes` (в diode остался шим `src/StoryRunner/StoryTypes.ts`). Истории движковых виджетов уехали вместе с tuidom в [github.com/tuidom/tuidom](https://github.com/tuidom/tuidom); в diode остаются только diode-интеграционные (`src/StoryRunner/stories/`). **Браузер** историй (дерево всех story + Ctrl+K-поиск, аналог веб-Storybook) — отдельный сайд-проект **`tuidom/storybook`**: он ссылается на соседний checkout diode (`../../diode`), сканирует его `src/**/*.stories.ts` и запускает выбранную story; после выноса tuidom его shim нужно переключить на пакет/репозиторий tuidom (не сделано, follow-up). Запуск — из репозитория storybook (`npm run storybook`), при diode рядом на диске.

## TestUtils/
Общие утилиты для тестов (визуальные assertions для экрана). `ExtensionTestHarness.createExtensionTestHarness({ initialFile?, extensions? })` поднимает реальный `EditorService` (+ `EditorGroupComponent`) + `ExtensionHost` поверх `TestApp`/`MockTerminalBackend`. `ExtensionHost` форкается через `subprocessSpawnArgsForTests()` — `node --import tsx/esm src/vs/platform/extensions/Host/__fixtures__/subprocessEntry.ts` (в vitest `process.argv[1]` указывает на vitest CLI, не на `main.ts`). Тестовые расширения лежат рядом — `*.cjs` файлы с `exports.activate = function(ctx) { var vscode = require("vscode"); ... }`.

## tools/drive

`npm run drive -- <команда>` — живой прогон редактора, которым агент водит diode
как браузер: долгоживущая headless-сессия между вызовами CLI. Рецепты и ловушки —
скилл [`.claude/skills/drive/SKILL.md`](../../.claude/skills/drive/SKILL.md); здесь — устройство.

- **Сессия = процесс + запись.** `start` поднимает редактор detached (своя группа
  процессов, stdout/stderr в `<корень>/drive/*.log`) в изолированном корне
  `$TMPDIR/diode-drive-<имя>-*` (раскладка и изоляция HOME/XDG — `prepareAppEnv`
  из `e2e/helpers/appSession.ts`) и пишет запись в `.drive/sessions/<имя>.json`
  этого checkout'а (у каждого worktree свой реестр) и её копию в
  `<корень>/drive/session.json`. Каждый следующий вызов переподключается к порту
  инспектора — сервер держит сколько угодно сокетов, отдельный демон не нужен.
- **Из исходников без обёртки:** `node --import <url tsx> src/vs/diode/main.ts` —
  один процесс (pid записи — сам редактор), абсолютный URL tsx резолвится из
  любого cwd, `reloadWindow` перезапускается с тем же `execArgv`. Перед стартом —
  `scripts/build-extensions.mjs` (быстро, esbuild). `--binary` — `dist/diode`.
- **Готовность** — `Diode.whenReady`: резолвится в тот же момент, что
  `complete: true` трассы старта (`exthost:activated` + фаза `eventually`).
- **Уборка по маркеру.** Все процессы сессии наследуют env
  `DIODE_DRIVE_SESSION=<имя>:<корень>`; `stop`/`gc` находят их по
  `/proc/<pid>/environ` — в том числе ушедших из группы (`setsid` у языковых
  серверов). `gc` сиротой считает процесс, чей лидер (из `session.json` корня)
  мёртв, — поэтому живые сессии соседних worktree он не трогает, а мёртвые
  убирает. Зомби считается мёртвым (init контейнера пожинает не всегда).
- **Методы `Diode.*`** (`src/vs/diode/diodeInspectorMethods.ts`) — сервисы
  портами, регистрация через публичный `InspectorCore.register`; клиент —
  `tools/drive/driveClient.ts`.
