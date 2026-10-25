import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";


function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

const FILES = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];

/** Five committed files, all modified: one "Changes" group to walk with Space. */
function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-scm-space-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    for (const file of FILES) writeFileSync(join(repoDir, file), "export const v = 1;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    for (const file of FILES) writeFileSync(join(repoDir, file), "export const v = 2;\n");
    return repoDir;
}

const repoDir = makeRepo();

function cursorIs(id: string): (state: Record<string, unknown> | undefined) => boolean {
    return (state) => state?.cursorId === id;
}

export default defineScenario({
    name: "scm-space-stage",
    title: "Source Control: Space on a file stages or unstages it and moves to the next file",
    open: [repoDir],
    cols: 100,
    rows: 26,
    // Needs the extension host — the git extension publishes the change set.
    skipOn: ["win32", "darwin"],
    userKeybindings: [{ key: "alt+c", command: "workbench.view.scm" }],
    async run(editor) {
        await editor.sendKey("Alt+C");
        await editor.waitForNode("#scmRow-worktree-e-ts");
        await editor.sendKey("ArrowDown");
        await editor.waitForState("#changesList", cursorIs("scmRow-worktree-a-ts"));
        await editor.capture("before");

        // No waiting between presses: each one acts on the file the cursor already moved to.
        await editor.sendKey(" ");
        await editor.sendKey(" ");
        await editor.sendKey(" ");
        await editor.waitForNode("#scmRow-index-c-ts");
        await editor.waitForText((t) => /Staged Changes\s+3/.test(t) && /Changes\s+2/.test(t));
        await editor.waitForState("#changesList", cursorIs("scmRow-worktree-d-ts"));
        await editor.capture("three-staged");

        // Back up into Staged Changes: Space there unstages.
        await editor.sendKey("Home");
        await editor.sendKey("ArrowDown");
        await editor.waitForState("#changesList", cursorIs("scmRow-index-a-ts"));
        await editor.sendKey(" ");
        await editor.waitForNode("#scmRow-worktree-a-ts");
        await editor.waitForText((t) => /Staged Changes\s+2/.test(t) && /Changes\s+3/.test(t));
        await editor.waitForState("#changesList", cursorIs("scmRow-index-b-ts"));
        await editor.capture("unstaged");
    },
});
