import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRegistryFixture } from "../helpers/registryFixture.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Установка из магазина тянет `extensionDependencies`, как VS Code: без
// вопросов, вместе с расширением. У Lang Pack своих вкладов нет — только
// зависимость на Sample Lang; после Install в списке установленных оба, и оба
// ждут перезагрузки окна.
//
// Реестр — файловая фикстура с НАСТОЯЩИМИ `.vsix` (как в extensions-install).

const registry = await createRegistryFixture(join(mkdtempSync(join(tmpdir(), "diode-scenario-registry-")), "registry"), [
    {
        id: "test.lang-pack",
        version: "0.0.1",
        sourceDir: resolve(repoRoot, "e2e", "marketplace", "dependent-extension"),
        displayName: "Lang Pack",
        description: "Depends on Sample Lang",
        readme: "# Lang Pack\n\nNo contributions of its own: installing it brings Sample Lang along.",
    },
    {
        id: "test.sample-lang",
        version: "0.0.2",
        sourceDir: resolve(repoRoot, "e2e", "marketplace", "sample-extension"),
        displayName: "Sample Lang",
        description: "Language .diodesample with a grammar",
    },
]);

export default defineScenario({
    name: "extensions-install-dependencies",
    title: "Extensions: установка тянет extensionDependencies",
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
        for (let i = 0; i < 4; i++) await editor.sendKey("F7");
        // Страница Lang Pack — первой записи каталога: фокус в список, Enter.
        // Без фильтра: он сузил бы и список установленных, а на кадре нужны оба.
        await editor.sendKey("Tab");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForNode("#extensionPage-test-lang-pack");

        // Фокус страницы стоит на первой кнопке — это Install.
        await editor.sendKey("Enter");
        // Список установленных: и Lang Pack, и пришедший с ним Sample Lang, оба
        // ждут перезагрузки.
        await editor.waitForText(
            (t) => t.includes("Reload Window") && t.includes("INSTALLED") && /Sample Lang\s+0\.0\.2\s+Reload/u.test(t),
        );
        await editor.capture("installed-with-dependency");
    },
});
