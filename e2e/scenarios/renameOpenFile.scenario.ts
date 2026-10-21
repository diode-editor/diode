import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// The tab follows the file (like `EditorService.handleMovedFile`). Dogfooding bug: the tab stayed on the
// old path, and the very first save resurrected the old file.

const OLD_NAME = "notes.txt";
const NEW_NAME = "guide.txt";

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-rename-open-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, OLD_NAME), "Project notes.\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    return repoDir;
}

const repoDir = makeRepo();

/** The tree and the tab bar share frame lines. */
function rowsWith(text: string, name: string): string[] {
    return text.split("\n").filter((line) => line.includes(name));
}

export default defineScenario({
    name: "rename-open-file",
    title: "An open file renamed in the explorer: the tab follows it",
    open: [repoDir, join(repoDir, OLD_NAME)],
    cols: 100,
    rows: 20,
    // Status letters come from the git extension (extension host) — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => rowsWith(t, OLD_NAME).length > 0 && t.includes("Project notes."));

        await editor.sendKey("Alt+V");
        await editor.waitForText((t) => t.includes("Explorer"));
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.capture("open");

        await editor.sendKey("F2");
        await editor.waitForText((t) => t.includes("Rename") && t.includes(OLD_NAME));
        for (let i = 0; i < OLD_NAME.length; i++) await editor.sendKey("Backspace");
        await editor.sendText(NEW_NAME);
        await editor.waitForText((t) => t.includes("Rename") && t.includes(NEW_NAME));
        await editor.sendKey("Enter");

        await editor.waitForText((t) => rowsWith(t, NEW_NAME).length > 0 && !t.includes(OLD_NAME));
        await editor.capture("renamed");

        const tab = await editor.waitForNode("EditorElement");
        await editor.click(tab.box.x + 2, tab.box.y);
        await editor.sendKey("End");
        await editor.sendText(" Edited.");
        await editor.sendKey("Ctrl+S");
        await editor.waitForText(
            (t) =>
                t.includes("Project notes. Edited.") &&
                rowsWith(t, NEW_NAME).some((line) => /\bU\b/.test(line)) &&
                !t.includes(OLD_NAME),
        );
        await editor.capture("saved");
    },
});
