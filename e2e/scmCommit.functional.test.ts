import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { frameToText } from "./helpers/frame.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";


const SWITCH_KEYS = [
    { key: "alt+c", command: "workbench.view.scm" },
    { key: "alt+m", command: "workbench.scm.focus" },
];

function gitQ(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-scm-commit-"));
    gitQ(repoDir, "init", "-q");
    gitQ(repoDir, "config", "user.email", "t@example.com");
    gitQ(repoDir, "config", "user.name", "Test");
    gitQ(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), 'export const a = "one";\n');
    gitQ(repoDir, "add", "-A");
    gitQ(repoDir, "commit", "-qm", "init");
    writeFileSync(join(repoDir, "app.ts"), 'export const a = "two";\n');
    return repoDir;
}

interface InputState {
    value?: string;
    showsPlaceholder?: boolean;
}

describe("SCM commit input box (functional e2e, spec SourceControl.md)", () => {
    let app: HeadlessApp | null = null;

    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    afterEach(async () => {
        await app?.dispose();
        app = null;
    });

    it("US-13: input box with a placeholder inside the Source Control section, above the list", async () => {
        const repo = makeRepo();
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
        const input = await session.waitForNode("#scmCommitInput");
        expect((input.state as InputState).showsPlaceholder).toBe(true);
        // The placeholder is clipped by the sidebar width. e2e is pinned to tier=legacy, where Ctrl+Enter
        // is just Enter: the hint must name the reachable Alt+Enter.
        expect(frameToText(await session.captureFrame())).toContain("Message (Alt+Enter");

        const changesHeader = await session.waitForNode("#paneHeader-workbench-scm-changes");
        const list = await session.waitForNode("#changesView");
        expect(input.box.y).toBeGreaterThan(changesHeader.box.y);
        expect(input.box.y).toBeLessThan(list.box.y);

        const button = await session.waitForNode("#scmActionButton");
        expect(button.box.y - input.box.y).toBe(2);
    }, 120_000);

    it("US-14: workbench.scm.focus focuses the input; Down moves into the list", async () => {
        const repo = makeRepo();
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
        const { session } = app;

        await session.key("Alt+M"); // workbench.scm.focus from Explorer
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
        await session.waitForFocus("ScmCommitInputElement");

        await session.key("ArrowDown");
        await session.waitForFocus("ListViewElement");

        await session.key("Alt+M");
        await session.waitForFocus("ScmCommitInputElement");
    }, 120_000);

    it("US-16/US-18: Ctrl+Enter commits staged changes and clears the input; an empty message is refused", async () => {
        const repo = makeRepo();
        gitQ(repo, "add", "-A"); // stage the app.ts edit
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
        const { session } = app;

        await session.key("Alt+M");
        await session.waitForFocus("ScmCommitInputElement");
        // The extension activates asynchronously: wait for the staged group to be published,
        // otherwise Ctrl+Enter is a no-op (the transport command does not exist yet).
        await session.waitForNode("#scmGroup-index");
        await session.key("Alt+Enter");
        await session.waitForText((t) => t.includes("commit message is empty"));
        expect(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repo }).toString().trim()).toBe("1");

        await session.text("feat: change");
        await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "feat: change");
        await session.key("Alt+Enter");

        await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "");
        await session.waitForNoNode("#scmGroup-index");
        expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: repo }).toString().trim()).toBe(
            "feat: change",
        );
        expect(execFileSync("git", ["status", "--porcelain=v1"], { cwd: repo }).toString()).toBe("");
    }, 120_000);

    it("US-17: empty index — smart commit asks and commits all tracked files", async () => {
        const repo = makeRepo(); // app.ts modified, not staged
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
        const { session } = app;

        await session.key("Alt+M");
        await session.waitForFocus("ScmCommitInputElement");
        await session.waitForNode("#scmGroup-worktree"); // extension is active
        await session.text("feat: smart");
        await session.key("Alt+Enter");

        await session.waitForText((t) => t.includes("There are no staged changes to commit."));
        // Default focus is on Cancel; the arrow moves it to Commit All.
        await session.key("ArrowLeft");
        await session.key("Enter");

        await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "");
        expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: repo }).toString().trim()).toBe("feat: smart");
    }, 120_000);

    it("US-19/US-20: amend changes the last commit; undoCommit returns the message to the input", async () => {
        const repo = makeRepo();
        gitQ(repo, "add", "-A");
        gitQ(repo, "commit", "-qm", "feat: second");
        app = await useHeadlessApp({
            open: [repo],
            keybindings: [...SWITCH_KEYS, { key: "alt+d", command: "git.undoCommit" }, { key: "alt+n", command: "git.commitStagedAmend" }],
            cols: 100,
            rows: 30,
        });
        const { session } = app;

        await session.key("Alt+M");
        await session.waitForFocus("ScmCommitInputElement");
        // The GRAPH section opens collapsed, and the extension does not run `git log` until it is expanded.
        await session.clickNode("#paneHeader-workbench-scm-graph", { dx: 3 });
        await session.waitForText((t) => t.includes("feat: second"));

        // Amend with a new message (the index is empty — no allowEmpty needed: --amend permits it).
        await session.text("feat: amended");
        await session.key("Alt+N");
        await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "");
        expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: repo }).toString().trim()).toBe(
            "feat: amended",
        );
        expect(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repo }).toString().trim()).toBe("2");

        await session.key("Alt+D");
        await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "feat: amended");
        expect(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repo }).toString().trim()).toBe("1");
    }, 120_000);

    it("US-15: the message draft survives a restart", async () => {
        const repo = makeRepo();
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30, keepRoot: true });
        const root = app.env.root;
        {
            const { session } = app;
            await session.key("Alt+M");
            await session.waitForFocus("ScmCommitInputElement");
            await session.text("fix: typo");
            await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "fix: typo");
            await app.dispose();
            app = null;
        }

        // Same root: user-data-dir (and the workspace store with the draft) survive the restart.
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30, root });
        const { session } = app;
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
        await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "fix: typo");
    }, 120_000);
});
