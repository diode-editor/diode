import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Формат для языков, которых не покрывает ни один LSP: НАСТОЯЩИЙ стоковый
// `esbenp.prettier-vscode` ставится ИЗ МАГАЗИНА и форматирует markdown и json —
// до него `Ctrl+K Ctrl+E` на `.md` отвечал «No formatter for 'markdown'
// installed». Демо закрывает видимую часть: пункт Prettier в статус-баре и
// буфер после формата (нужного текста в исходных файлах нет).
//
// Язык выбран намеренно НЕ typescript: на `.ts` формат давал бы встроенный
// tsserver, и сценарий проверял бы не prettier.

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
        // Активная вкладка — последняя открытая (data.json).
        await editor.waitForText((t) => t.includes('{"name":"demo"'));
        // Пункт статус-бара prettier появляется в конце activate(): к этому
        // моменту провайдеры формата уже зарегистрированы.
        await editor.waitForText((t) => t.includes("Prettier"), { timeoutMs: 120_000 });
        await editor.capture("before");

        // Формат документа — досягаемый на любом терминале чорд.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+E");
        await editor.waitForText((t) => t.includes('{ "name": "demo", "deps": [1, 2, 3] }'), { timeoutMs: 60_000 });
        await editor.capture("json-formatted");

        // Та же команда на markdown: заголовок и маркеры списка.
        await editor.sendKey("Ctrl+PageUp");
        await editor.waitForText((t) => t.includes("#   Hello"));
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+E");
        await editor.waitForText((t) => t.includes("- item one") && t.includes("- item two"), { timeoutMs: 60_000 });
        await editor.capture("markdown-formatted");
    },
});
