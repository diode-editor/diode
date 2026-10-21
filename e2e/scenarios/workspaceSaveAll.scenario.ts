import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The directory is populated in prepare: saving writes to disk, and the committed fixture must stay clean.

const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-save-all");
const sampleDir = mkdtempSync(join(tmpdir(), "diode-saveall-demo-"));
const noteFile = join(sampleDir, "notes.txt");

export default defineScenario({
    name: "workspace-save-all",
    title: "workspace.saveAll: расширение сохраняет несохранённые файлы",
    seedUserData: userData,
    open: [sampleDir, noteFile],
    cols: 100,
    rows: 24,
    // Extension host scenarios run a subprocess — Linux only.
    skipOn: ["win32", "darwin"],
    async prepare() {
        writeFileSync(noteFile, "draft\n");
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("draft") && t.includes("notes.txt ×"));
        await editor.sendText("edited ");
        await editor.waitForText((t) => t.includes("edited draft") && t.includes("notes.txt ●"));
        await editor.capture("dirty");

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Save All Demo: Save Everything");
        await editor.waitForText((t) => t.includes("Save All Demo: Save Everything"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("saveAll: true") && t.includes("notes.txt ×"), {
            timeoutMs: 20_000,
        });
        const onDisk = readFileSync(noteFile, "utf8");
        if (onDisk !== "edited draft\n") throw new Error(`notes.txt на диске не сохранён: ${JSON.stringify(onDisk)}`);
        await editor.capture("saved");
    },
});
