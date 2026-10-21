import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// What is made slow is not our code but `git commit` itself — via a real pre-commit hook with
// `sleep`; the extension host, the diode.git.op dispatcher and the mutation queue are all real.

const SWITCH_KEYS = [
    { key: "alt+c", command: "workbench.view.scm" },
    { key: "alt+m", command: "workbench.scm.focus" },
];

function gitQ(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeSlowRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-scm-progress-"));
    gitQ(repoDir, "init", "-q");
    gitQ(repoDir, "config", "user.email", "t@example.com");
    gitQ(repoDir, "config", "user.name", "Test");
    gitQ(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), 'export const a = "one";\n');
    gitQ(repoDir, "add", "-A");
    gitQ(repoDir, "commit", "-qm", "init");
    writeFileSync(join(repoDir, "app.ts"), 'export const a = "two";\n');
    gitQ(repoDir, "add", "-A");

    const hook = join(repoDir, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nsleep 3\n");
    chmodSync(hook, 0o755);
    return repoDir;
}

interface ButtonState {
    label?: string;
    disabled?: boolean;
}

describe("SCM: git operation progress (functional e2e)", () => {
    let app: HeadlessApp | null = null;

    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    afterEach(async () => {
        await app?.dispose();
        app = null;
    });

    it("a commit with a slow hook spins the spinner in the title and in the button", async () => {
        const repo = makeSlowRepo();
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
        const { session } = app;

        await session.key("Alt+M");
        await session.waitForFocus("ScmCommitInputElement");
        // The extension activates asynchronously: without a published staged group
        // Ctrl+Enter would be a no-op — the transport command does not exist yet.
        await session.waitForNode("#scmGroup-index");

        await session.text("feat: slow");
        await session.key("Alt+Enter");

        // During the animation use only waits and snapshots: settling input would never get a "quiet"
        // frame while the spinner ticks.
        await session.waitForState("#paneHeader-workbench-scm-changes", (s) => (s as { busy?: boolean })?.busy === true);
        await session.waitForState("#scmActionButton", (s) => {
            const state = (s ?? {}) as ButtonState;
            return state.disabled === true && (state.label ?? "").includes("Committing");
        });

        // While busy, a repeated Ctrl+Enter starts nothing: the command is
        // disabled (enablement) rather than queued second in the mutation queue.
        await session.key("Alt+Enter", { settle: false });

        await session.waitForState(
            "#paneHeader-workbench-scm-changes",
            (s) => (s as { busy?: boolean })?.busy === false,
            { timeoutMs: 30_000 },
        );
        await session.waitForState("#scmActionButton", (s) => (s as ButtonState)?.disabled === false, {
            timeoutMs: 30_000,
        });
        expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: repo }).toString().trim()).toBe("feat: slow");
        // Exactly one commit on top of init — the second press went nowhere.
        expect(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repo }).toString().trim()).toBe("2");
    }, 180_000);
});
