import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRegistryFixture } from "../helpers/registryFixture.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Установка расширения из UI: страница с кнопками и её состояние после
// установки — приглашение перезагрузить окно (docs/TODO/ExtensionsView.md).
//
// Реестр — файловая фикстура с НАСТОЯЩИМ `.vsix`: демо ставит расширение
// по-настоящему, поэтому ни сети, ни того, что опубликовано в магазине, здесь
// не требуется. Фикстуру собираем на импорте модуля: путь к реестру нужен уже в
// `extraArgs`, то есть до запуска редактора.

const registry = await createRegistryFixture(join(mkdtempSync(join(tmpdir(), "diode-scenario-registry-")), "registry"), [
    {
        id: "test.sample-lang",
        version: "0.0.2",
        sourceDir: resolve(repoRoot, "e2e", "marketplace", "sample-extension"),
        displayName: "Sample Lang",
        description: "Синтетическое расширение магазина: свой язык и грамматика",
        readme: "# Sample Lang\n\nЯзык .diodesample для демо магазина: расширение ставится из этой страницы.",
    },
]);

export default defineScenario({
    name: "extensions-install",
    title: "Extensions: установка расширения со страницы магазина",
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
        for (let i = 0; i < 3; i++) await editor.sendKey("F7");

        // Страница расширения: фокус в список, первая запись каталога, Enter.
        await editor.sendKey("Tab");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForNode("#extensionPage-test-sample-lang");
        await editor.waitForText((t) => t.includes("Not installed"));
        await editor.capture("page");

        // Фокус страницы стоит на первой кнопке — это Install.
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Reload Window"));
        await editor.capture("installed");
    },
});
