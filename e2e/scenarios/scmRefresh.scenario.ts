import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// `git.autorefresh: false` keeps the watcher out, so only the button can bring the outside edit in. A real
// `core.fsmonitor` hook with `sleep` makes every `git status` slow — none of our code is stubbed.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-scm-refresh-demo-"));
    git(repoDir, "init", "-q", "-b", "main");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), "export const version = 1;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "feat: start");

    // A failing hook makes git fall back to a full scan: the answer is right, only late.
    const hook = join(repoDir, ".git", "hooks", "slow-fsmonitor");
    writeFileSync(hook, "#!/bin/sh\nsleep 1\nexit 1\n");
    chmodSync(hook, 0o755);
    git(repoDir, "config", "core.fsmonitor", hook);
    return repoDir;
}

const repoDir = makeRepo();

const CHANGES_HEADER = "#paneHeader-workbench-scm-changes";

export default defineScenario({
    name: "scm-refresh",
    title: "Source Control: the Refresh button in the Changes title picks up an outside edit",
    open: [repoDir],
    cols: 100,
    rows: 24,
    settings: { "git.autorefresh": false },
    // Needs the extension host — the git extension runs `git status`.
    skipOn: ["win32", "darwin"],
    userKeybindings: [{ key: "alt+c", command: "workbench.view.scm" }],
    async run(editor) {
        await editor.sendKey("Alt+C");
        // The branch arrives with the first repo-state publish, after the first (slow) `git status`.
        await editor.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("main"), { timeoutMs: 30_000 });

        writeFileSync(join(repoDir, "app.ts"), "export const version = 2;\n");
        await editor.waitForText((t) => !t.includes("app.ts"));
        await editor.capture("stale");

        // Title row: […label…][⟳ ][│][ ⋯ ] — the refresh glyph sits 6 columns left of the edge.
        const header = await editor.waitForNode(CHANGES_HEADER);
        await editor.clickNode(CHANGES_HEADER, { dx: header.box.width - 6 });
        // No settling input: while the spinner ticks, the frame never goes quiet.
        await editor.waitForState(CHANGES_HEADER, (s) => (s as { busy?: boolean } | undefined)?.busy === true);
        await editor.capture("refreshing");

        await editor.waitForText((t) => t.includes("app.ts"), { timeoutMs: 30_000 });
        await editor.waitForState(CHANGES_HEADER, (s) => (s as { busy?: boolean } | undefined)?.busy === false, {
            timeoutMs: 30_000,
        });
        await editor.capture("refreshed");
    },
});
