# demos/ · Stories (`*.stories.ts`) · TestUtils/

Часть архитектуры Vexx — обзорная карта в [../ARCHITECTURE.md](../ARCHITECTURE.md).

## demos/
Демо-приложения для ручного тестирования отдельных компонентов (`src/demos/`). Движковые демо-хосты (как напрямую поднимается `TuiApplication` на `NodeTerminalBackend`) уехали в `demos/` репозитория tuidom.

## Stories (`*.stories.ts`)
Интерактивные демо-сценарии виджетов живут **рядом с компонентами** (`*.stories.ts`) и экспортируют именованные функции-стори. Контракт — `src/StoryRunner/StoryTypes.ts` (`StoryContext { app, body, args, afterRun }`, `StoryMeta { title }`).

Контракт story (`StoryContext`/`StoryModule`) приходит из пакета — `@tuidom/all/testing/storyTypes` (в vexx остался шим `src/StoryRunner/StoryTypes.ts`). Истории движковых виджетов уехали вместе с tuidom в [github.com/tuidom/tuidom](https://github.com/tuidom/tuidom); в vexx остаются только vexx-интеграционные (`src/StoryRunner/stories/`). **Браузер** историй (дерево всех story + Ctrl+K-поиск, аналог веб-Storybook) — отдельный сайд-проект **`tuidom/storybook`**: он ссылается на соседний checkout vexx (`../../vexx`), сканирует его `src/**/*.stories.ts` и запускает выбранную story; после выноса tuidom его shim нужно переключить на пакет/репозиторий tuidom (не сделано, follow-up). Запуск — из репозитория storybook (`npm run storybook`), при vexx рядом на диске.

## TestUtils/
Общие утилиты для тестов (визуальные assertions для экрана). `ExtensionTestHarness.createExtensionTestHarness({ initialFile?, extensions? })` поднимает реальный `EditorService` (+ `EditorGroupComponent`) + `ExtensionHost` поверх `TestApp`/`MockTerminalBackend`. `ExtensionHost` форкается через `subprocessSpawnArgsForTests()` — `node --import tsx/esm src/vs/platform/extensions/Host/__fixtures__/subprocessEntry.ts` (в vitest `process.argv[1]` указывает на vitest CLI, не на `main.ts`). Тестовые расширения лежат рядом — `*.cjs` файлы с `exports.activate = function(ctx) { var vscode = require("vscode"); ... }`.
