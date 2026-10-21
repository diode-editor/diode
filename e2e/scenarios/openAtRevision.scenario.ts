import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// A revision opens as a read-only `name (ref)` tab: the git: provider supplies the content,
// the tab has no file on disk.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A repo with a branch one change behind main. */
function makeRepo(): { repoDir: string; trackedFile: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-rev-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    const trackedFile = join(repoDir, "greeting.ts");
    writeFileSync(trackedFile, 'export function greet(name: string) {\n    return "hi " + name;\n}\n');
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    git(repoDir, "branch", "release-1.0");
    writeFileSync(
        trackedFile,
        'export function greet(name: string) {\n    return "hello, " + name + "!";\n}\n\nexport const VERSION = 2;\n',
    );
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "v2");
    return { repoDir, trackedFile };
}

const { repoDir, trackedFile } = makeRepo();

export default defineScenario({
    name: "open-at-revision",
    title: "Open File at Revision: read-only вкладка файла на ревизии",
    open: [repoDir, trackedFile],
    cols: 100,
    rows: 22,
    // Needs the extension host: the git extension serves the revision content.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("VERSION"));
        // Wait for the git extension to activate: edit → gutter bar → undo.
        await editor.sendKey("End");
        await editor.sendText("Z");
        await editor.waitForText((t) => t.includes("┋") || t.includes("┃"));
        await editor.sendKey("Ctrl+Z");

        await editor.sendKey("Ctrl+P");
        await editor.sendText(">Open File at Revision");
        await editor.waitForText((t) => t.includes("Open File at Revision"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Pick a branch or tag"));
        await editor.capture("picker");

        await editor.sendText("release");
        await editor.waitForText((t) => t.includes("release-1.0"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("greeting.ts (release-1.0)"));
        await editor.capture("revision-tab");
    },
});
