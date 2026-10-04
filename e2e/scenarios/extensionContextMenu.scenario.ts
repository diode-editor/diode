import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// `contributes.menus` от СТОКОВОГО расширения: basedpyright объявляет в
// манифесте один пункт контекст-меню редактора —
//   { "command": "basedpyright.organizeimports",
//     "title": "Pyright: Organize Imports",
//     "group": "Pyright", "when": "editorLangId == python" }
// — и он обязан появиться в меню на .py и НЕ появиться на .txt (ровно то, что
// обещает `when` манифеста). Расширение приезжает из магазина по id, как
// требует docs/TESTING.md.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-ext-menu-demo-"));
const pythonFile = join(sampleDir, "main.py");
const textFile = join(sampleDir, "notes.txt");

export default defineScenario({
    name: "extension-context-menu",
    title: "contributes.menus: пункт стокового расширения в контекст-меню редактора",
    open: [sampleDir, pythonFile],
    installVsix: ["detachhead.basedpyright"],
    network: true,
    cols: 100,
    rows: 24,
    // Extension-host сценарии гоняют subprocess — Linux only.
    skipOn: ["win32", "darwin"],
    async prepare() {
        writeFileSync(pythonFile, "import os\nimport sys\n\n\ndef main() -> None:\n    print(os.name, sys.platform)\n");
        writeFileSync(textFile, "просто текст\n");
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("def main"));

        // Пункт расширения приезжает в меню .py-файла — с титулом из манифеста.
        await waitUntil(
            async () => {
                await editor.sendKey("Shift+F10");
                const frame = await editor.captureFrame();
                const text = frame.cells.map((cell) => cell.char).join("");
                if (!text.includes("Pyright")) await editor.sendKey("Escape");
                return text;
            },
            (text) => text.includes("Pyright: Organize Imports"),
            { describe: "пункт расширения в контекст-меню .py", timeoutMs: 120_000, intervalMs: 1000 },
        );
        await editor.capture("python");
        await editor.sendKey("Escape");

        // …и НЕ приезжает в .txt: `when: editorLangId == python` — настоящий
        // контекст-ключ, а не формальность.
        await editor.sendKey("Ctrl+P");
        await editor.sendText("notes.txt");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("просто текст"));
        await editor.sendKey("Shift+F10");
        await editor.waitForText((t) => t.includes("Command Palette"));
        const frame = await editor.captureFrame();
        const text = frame.cells.map((cell) => cell.char).join("");
        if (text.includes("Pyright")) throw new Error("пункт расширения виден в .txt — when манифеста не применён");
        await editor.capture("text");
    },
});
