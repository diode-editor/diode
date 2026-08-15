import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// «File: Compare New Untitled Text Files» (US-37, DiffEditable PR-4): дифф двух
// пустых безымянных буферов, обе стороны редактируются ПРЯМО в дифф-вкладке,
// живой пересчёт помечает набранное добавленным по debounce.

const workDir = mkdtempSync(join(tmpdir(), "diode-untitled-demo-"));

export default defineScenario({
    name: "compare-untitled",
    title: "Compare New Untitled: дифф двух пустых редактируемых буферов",
    open: [workDir],
    cols: 132,
    rows: 22,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("EXPLORER"));

        await editor.sendKey("Ctrl+P");
        await editor.sendText(">Compare New Untitled Text Files");
        await editor.waitForText((t) => t.includes("Compare New Untitled Text Files"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Untitled-1 ↔ Untitled-2"));
        await editor.capture("empty");

        // Печать попадает в правую сторону (фокус в modified); живой пересчёт
        // помечает строки добавленными — маркеры `+` и филлеры слева.
        await editor.sendText("Hello from the diff!");
        await editor.sendKey("Enter");
        await editor.sendText("Both sides are editable.");
        await editor.waitForText((t) => {
            const line = t.split("\n").find((l) => l.includes("Hello from the diff!"));
            return line !== undefined && line.includes("+");
        });
        await editor.capture("typed");
    },
});
