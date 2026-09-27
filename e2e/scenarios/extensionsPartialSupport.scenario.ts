import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Пометка о частичной поддержке в магазине: бейдж `Partial` в строке списка и
// два списка на странице расширения — что работает и чего человек лишится.
//
// Своя фикстура реестра, а не общая: там состояния карточек (installed/update/
// incompatible) выставлены под демо бейджей состояния, и пометка поддержки —
// ортогональная им ось. Здесь ровно две записи, помеченная и обычная, чтобы на
// одном кадре была видна разница.

const registry = resolve(repoRoot, "e2e", "fixtures", "registry-partial");

export default defineScenario({
    name: "extensions-partial-support",
    title: "Extensions view: расширение, которое работает не целиком",
    open: [repoRoot],
    extraArgs: [`--registry=${registry}`],
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
        await editor.waitForText((t) => t.includes("Acme Copilot-ish"));
        // Сайдбар по умолчанию узкий — бейдж в него не влезает целиком.
        for (let i = 0; i < 4; i++) await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Partial"));
        await editor.capture("viewlet");

        // Страница помеченного расширения: заголовок в шапке, списки в теле.
        await editor.sendKey("Tab");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Partial support: some features do not work in Diode"));
        await editor.waitForText((t) => t.includes("Does not work:"));
        await editor.waitForText((t) => t.includes("Chat panel does not open"));
        await editor.capture("page");
    },
});
