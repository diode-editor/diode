import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Магазин расширений в UI: вьюлет EXTENSIONS в сайдбаре и страница расширения
// отдельной вкладкой (docs/TODO/ExtensionsView.md).
//
// Реестр — файловая фикстура, а не публичный магазин: демо не должно зависеть
// ни от сети, ни от того, что сейчас опубликовано. Состояния карточек в ней
// заданы прямо, поэтому на кадре видны все три бейджа сразу.

const registry = resolve(repoRoot, "e2e", "fixtures", "registry");
// В user-data уже стоит test.tab-setter@0.0.1, а реестр знает 0.0.2 — на кадре
// видны сразу все состояния карточки: доступно, обновление, несовместимо.
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-tab-setter");

export default defineScenario({
    name: "extensions-view",
    title: "Extensions view: каталог магазина и страница расширения",
    open: [repoRoot],
    extraArgs: [`--registry=${registry}`],
    seedUserData: userData,
    // Настоящий Ctrl+Shift+X headless-DSL не кодирует — вешаем команду на F6.
    userKeybindings: [
        { key: "f6", command: "workbench.view.extensions" },
        { key: "f7", command: "workbench.action.increaseSidebarWidth" },
    ],
    cols: 110,
    rows: 28,
    async run(editor) {
        await editor.waitForText((t) => t.includes("EXPLORER"));
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("MARKETPLACE"));
        await editor.waitForText((t) => t.includes("Acme Sample"));
        // Сайдбар по умолчанию узкий — бейджи в него не влезают целиком.
        for (let i = 0; i < 4; i++) await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Incompatible"));
        await editor.capture("viewlet");

        // Страница расширения: фокус в список, первая запись каталога, Enter.
        await editor.sendKey("Tab");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("This readme comes from the registry meta"));
        await editor.capture("page");
    },
});
