import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// The edit is not saved: the modified side is the file's live buffer, and the diff recomputes on edits by itself.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** The committed file is long enough for the collapsed unchanged region to show. */
function makeRepo(): { repoDir: string; trackedFile: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-diff-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    const trackedFile = join(repoDir, "greeting.ts");
    const body = Array.from({ length: 14 }, (_, i) => `const value${String(i)} = ${String(i)};`);
    writeFileSync(
        trackedFile,
        [...body, "export function greet(name: string) {", '    return "hi " + name;', "}", ""].join("\n"),
    );
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    return { repoDir, trackedFile };
}

const { repoDir, trackedFile } = makeRepo();

export default defineScenario({
    name: "diff-editor",
    title: "Diff tab: file changes against HEAD",
    open: [repoDir, trackedFile],
    cols: 132,
    rows: 22,
    // Needs the extension host: the git extension provides the HEAD version.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greet"));

        // Edit the function's second-to-last line without saving.
        await editor.sendKey("Ctrl+End");
        await editor.sendKey("ArrowUp");
        await editor.sendKey("ArrowUp");
        await editor.sendKey("End");
        await editor.sendText(" // changed");
        await editor.waitForText((t) => t.includes("// changed"));
        await editor.capture("edited");

        // Invoke the command the way a user does, through the palette: this also shows
        // it is listed there and found by name. Open Quick Open (Ctrl+P) and switch it
        // to commands with the `>` prefix: the e2e key DSL cannot serialize
        // Ctrl+Shift+P (the same limitation as in the folding scenario).
        await editor.sendKey("Ctrl+P");
        await editor.sendText(">Compare Active File with HEAD");
        await editor.waitForText((t) => t.includes("Compare Active File with HEAD"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("↔ HEAD"));
        await editor.capture("diff");

        // The diff is a text surface: the cursor moves and text can be selected. Move
        // it down and select a line and a half so the frame shows the selection
        // highlight over the changed-line background. In side-by-side the selection
        // lives in the active (right) column and does not spill into the left one.
        for (let i = 0; i < 4; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("Shift+ArrowDown");
        await editor.sendKey("Shift+End");
        await editor.capture("diff-selection");

        // Live diff: typing directly into a side edits the buffer, and the recompute
        // (200 ms debounce) marks the line as a changed pair on its own.
        await editor.sendKey("Ctrl+End");
        await editor.sendText("export const LIVE = true;");
        await editor.waitForText((t) => {
            const line = t.split("\n").find((l) => l.includes("LIVE"));
            return line !== undefined && line.includes("+");
        });
        await editor.capture("live-typed");

        // Expanding a collapsed region happens on both sides in sync.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+J");
        await editor.waitForText((t) => !t.includes("unchanged lines"));
        await editor.capture("unfolded");

        // Inline mode (US-22): a single editor, deleted lines shown as ghosts.
        await editor.sendKey("Ctrl+P");
        await editor.sendText(">Diff: Toggle Inline View");
        await editor.waitForText((t) => t.includes("Toggle Inline View"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("HEAD ↔ greeting.ts"));
        await editor.capture("inline");
    },
});
