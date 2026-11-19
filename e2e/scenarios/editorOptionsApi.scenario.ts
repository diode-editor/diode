import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `window.onDidChangeTextEditorOptions` (#1231). The demo extension shows the last event per view column in the
// status bar as `C<column> <tabSize>/<insertSpaces>/<cursorStyle> #<events>`. The settings change through the
// workspace's `.diode/settings.json`, as a person editing it; the folder lives in a temp directory. A file of unknown
// language without indentation: nothing to detect, no language server to shift the status bar.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-editor-options-demo-"));
const sampleFile = join(sampleDir, "notes.hello");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-editor-options");

function writeWorkspaceSettings(settings: Record<string, unknown>): void {
    mkdirSync(join(sampleDir, ".diode"), { recursive: true });
    writeFileSync(join(sampleDir, ".diode", "settings.json"), JSON.stringify(settings, null, 4));
}

export default defineScenario({
    name: "editor-options-api",
    title: "window.onDidChangeTextEditorOptions: settings changes and an assignment to the editor that is not active",
    seedUserData: userData,
    open: [sampleDir, sampleFile],
    cols: 120,
    rows: 24,
    settings: { "editor.tabSize": 4, "editor.insertSpaces": true },
    userKeybindings: [{ key: "f7", command: "editorOptionsDemo.tabSize8InColumn1" }],
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async prepare() {
        writeFileSync(sampleFile, "first\nsecond\nthird\n");
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("C1 4/true/1 #0") && t.includes("Spaces: 4"), {
            timeoutMs: 20_000,
        });
        await editor.capture("activated");

        writeWorkspaceSettings({ "editor.tabSize": 2 });
        await editor.waitForText((t) => t.includes("C1 2/true/1 #1") && t.includes("Spaces: 2"), {
            timeoutMs: 10_000,
        });
        await editor.capture("tab-size-setting");

        // `Block` is 2 in `vscode.TextEditorCursorStyle`.
        writeWorkspaceSettings({ "editor.tabSize": 2, "editor.cursorStyle": "block" });
        await editor.waitForText((t) => t.includes("C1 2/true/2 #2"), { timeoutMs: 10_000 });
        await editor.capture("cursor-style-setting");

        // The split is active; the extension assigns to column 1. Only that editor changes and reports.
        await editor.sendKey("Ctrl+\\");
        await editor.waitForText((t) => t.includes("C2 2/true/2 #0"), { timeoutMs: 10_000 });
        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("C1 8/true/2 #3") && t.includes("C2 2/true/2 #0"), {
            timeoutMs: 10_000,
        });
        await editor.waitForText((t) => t.includes("Spaces: 2"));
        await editor.capture("assigned-to-column-1");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("1");
        await editor.waitForText((t) => t.includes("Spaces: 8"), { timeoutMs: 5000 });
        await editor.capture("column-1-focused");
    },
});
