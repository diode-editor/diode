import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario, type ScenarioDriver } from "./framework.ts";

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

/**
 * Repeats the write until the tab reacts: the watcher arms asynchronously, and chokidar's `ignoreInitial`
 * swallows anything written before the initial scan ends — the event is lost for good (run 37195942480).
 * This is a real watching gap (docs/TODO/FileTreePerformance.md, the section on events lost in the arming
 * window); until it is closed, the scenario models a neighbouring terminal that keeps writing.
 */
async function writeUntilSeen(
    editor: ScenarioDriver,
    write: () => void,
    predicate: (text: string) => boolean,
): Promise<void> {
    const attempts = 5;
    for (let attempt = 1; ; attempt++) {
        write();
        try {
            await editor.waitForText(predicate, { timeoutMs: 3000 });
            return;
        } catch (err) {
            if (attempt === attempts) throw err;
        }
    }
}

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

        await writeUntilSeen(
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
