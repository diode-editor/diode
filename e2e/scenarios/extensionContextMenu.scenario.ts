import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";


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
    skipOn: ["win32", "darwin"],
    async prepare() {
        writeFileSync(pythonFile, "import os\nimport sys\n\n\ndef main() -> None:\n    print(os.name, sys.platform)\n");
        writeFileSync(textFile, "просто текст\n");
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("def main"));

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
