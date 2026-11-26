import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";
import { changeUntilSeen } from "./untilSeen.ts";

// Files and the branch change via `git`/`writeFileSync`, not the editor: changes made outside the editor must show up
// on their own.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-live-watch-demo-"));
    git(repoDir, "init", "-q", "-b", "main");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), "export const version = 1;\n");
    writeFileSync(join(repoDir, "util.ts"), "export const twice = (n: number) => n * 2;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "feat: start");
    return repoDir;
}

const repoDir = makeRepo();

export default defineScenario({
    name: "scm-live-watch",
    title: "Source Control picks up changes made outside the editor (external git and disk writes)",
    open: [repoDir],
    cols: 100,
    rows: 24,
    // Needs the extension host — the git extension publishes the status.
    skipOn: ["win32", "darwin"],
    userKeybindings: [{ key: "alt+c", command: "workbench.view.scm" }],
    async run(editor) {
        await editor.sendKey("Alt+C");
        await editor.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("main"));
        await editor.capture("clean");

        await changeUntilSeen(
            editor,
            () => {
                writeFileSync(join(repoDir, "app.ts"), "export const version = 2;\n");
                writeFileSync(join(repoDir, "notes.md"), "# notes\n");
            },
            (t) => t.includes("app.ts") && t.includes("notes.md"),
        );
        await editor.capture("worktree-changes");

        git(repoDir, "add", "app.ts");
        await editor.waitForText((t) => t.includes("Staged Changes"));
        await editor.capture("staged-outside");

        git(repoDir, "checkout", "-q", "-b", "feature");
        await editor.waitForText((t) => t.includes("feature"));
        await editor.capture("branch-switched");
    },
});
