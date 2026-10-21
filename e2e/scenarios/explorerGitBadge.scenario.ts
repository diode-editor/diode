import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A dedicated temp repository, so the frame doesn't depend on the state of the diode repo. */
function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-explorer-badge-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), "export const a = 1;\n");
    writeFileSync(join(repoDir, "readme.md"), "# demo\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    writeFileSync(join(repoDir, "app.ts"), "export const a = 2;\n");
    writeFileSync(join(repoDir, "untracked.md"), "new\n");
    return repoDir;
}

const repoDir = makeRepo();

export default defineScenario({
    name: "explorer-git-badge",
    title: "The git status letter in the tree is inset from the right edge",
    open: [repoDir],
    cols: 100,
    rows: 20,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => {
            const row = t.split("\n").find((line) => line.includes("app.ts"));
            return row !== undefined && row.includes("M");
        });
        await editor.capture("badges");
    },
});
