import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Indentation indicator demo (VS Code parity): the status bar shows the active
// editor's effective indentation between Ln/Col and the encoding — "Spaces: N"
// for space-indented files, "Tab Size: N" for tab-indented ones. Both values
// come from content detection at open time.

const spacesFile = resolve(repoRoot, "e2e", "fixtures", "indentDemoSpaces.ts");

export default defineScenario({
    name: "indentationStatus",
    title: "Status bar indentation indicator (Spaces / Tab Size)",
    open: [repoRoot, spacesFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        // The 2-space fixture is detected as space indentation.
        await editor.waitForText((t) => t.includes("Spaces: 2"));
        await editor.capture("spaces");

        // Quick Open → the tab-indented fixture: the segment flips to Tab Size.
        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        await editor.sendText("indentDemoTabs");
        // Ждём строку ПИКЕРА (имя + каталог «e2e/fixtures»): само имя файла видно
        // и в Explorer, и Enter до обновления отфильтрованного списка ушёл бы впустую.
        await editor.waitForText((t) => t.includes("e2e/fixtures"));
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("Tab Size: 4"));
        await editor.capture("tab-size");
    },
});
