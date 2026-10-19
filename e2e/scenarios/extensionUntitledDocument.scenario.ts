import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `workspace.openTextDocument({ content, language })`: фикстура
// `untitled-report-demo` повторяет «Go: Locate Configured Go Tools» у golang.go —
// отчёт в безымянный markdown-документ и `showTextDocument`. Кадры: вкладка
// `Untitled-1 ●` (грязная, язык Markdown в статус-баре), затем Ctrl+S — Save As
// предлагает `Untitled-1.md`, как у File → New Untitled File.

const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-untitled-report");

export default defineScenario({
    name: "extension-untitled-document",
    title: "openTextDocument({ content, language }): отчёт расширения в безымянном документе",
    seedUserData: userData,
    cols: 110,
    rows: 22,
    async run(editor) {
        // Команда — из activate() фикстуры: ждём extension host.
        await editor.waitForReady();
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Untitled Report Demo: Locate");
        await editor.waitForText((t) => t.includes("Untitled Report Demo: Locate Configured Tools"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Untitled-1") && t.includes("# Tools Configuration"), {
            timeoutMs: 20_000,
        });
        await editor.waitForText((t) => t.includes("Markdown"));
        await editor.capture("report");

        await editor.sendKey("Ctrl+S");
        await editor.waitForText((t) => t.includes("Save As") && t.includes("Untitled-1.md"));
        await editor.capture("save-as");
    },
});
