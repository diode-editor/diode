import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Язык намеренно НЕ typescript: на `.ts` формат дал бы встроенный tsserver, и сценарий проверял бы не prettier.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "prettierSample");
const notes = resolve(sampleDir, "notes.md");
const data = resolve(sampleDir, "data.json");

export default defineScenario({
    name: "prettier-format",
    title: "Формат из коробки: prettier на markdown и json",
    open: [sampleDir, notes, data],
    installVsix: ["esbenp.prettier-vscode"],
    network: true,
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes('{"name":"demo"'));
        // Пункт статус-бара появляется в конце activate(), когда провайдеры формата уже зарегистрированы.
        await editor.waitForText((t) => t.includes("Prettier"), { timeoutMs: 120_000 });
        await editor.capture("before");

        // Формат документа — досягаемый на любом терминале чорд.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+E");
        await editor.waitForText((t) => t.includes('{ "name": "demo", "deps": [1, 2, 3] }'), { timeoutMs: 60_000 });
        await editor.capture("json-formatted");

        await editor.sendKey("Ctrl+PageUp");
        await editor.waitForText((t) => t.includes("#   Hello"));
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+E");
        await editor.waitForText((t) => t.includes("- item one") && t.includes("- item two"), { timeoutMs: 60_000 });
        await editor.capture("markdown-formatted");
    },
});
