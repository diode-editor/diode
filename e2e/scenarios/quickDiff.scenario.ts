import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// The core diffs against the BUFFER, not the file on disk: the bar appears before saving.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A dedicated temp repository, so the "clean" frame does not depend on the state of the diode repo. */
function makeRepo(): { repoDir: string; trackedFile: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-quickdiff-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    const trackedFile = join(repoDir, "greeting.txt");
    writeFileSync(trackedFile, "alpha\nbravo\ncharlie\ndelta\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    return { repoDir, trackedFile };
}

const { repoDir, trackedFile } = makeRepo();

export default defineScenario({
    name: "quick-diff-live-gutter",
    title: "Change bars move while typing, before save",
    open: [repoDir, trackedFile],
    cols: 90,
    rows: 16,
    // Needs the extension host (the git extension provides the HEAD version) — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("charlie"));
        await editor.capture("clean");

        await editor.sendKey("ArrowDown");
        await editor.sendText("XX");
        await editor.waitForText((t) => t.includes("XXbravo"));

        await editor.waitForText((t) => t.includes("┋"));
        await editor.capture("live-bars");
    },
});
