import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { frameToText } from "./helpers/frame.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Git assertions run strictly after a UI predicate has confirmed the operation finished.

const SWITCH_KEYS = [
    { key: "alt+c", command: "workbench.view.scm" },
    { key: "alt+a", command: "git.stageAll" },
    { key: "alt+u", command: "git.unstageAll" },
];

function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd }).toString();
}

function gitQ(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

interface RepoFiles {
    committed?: Record<string, string>;
    modify?: Record<string, string>;
    staged?: Record<string, string>;
    untracked?: Record<string, string>;
}

function writeAll(repoDir: string, files: Record<string, string>): void {
    for (const [rel, content] of Object.entries(files)) {
        const file = join(repoDir, rel);
        execFileSync("mkdir", ["-p", join(file, "..")]);
        writeFileSync(file, content);
    }
}

function makeRepo(opts: RepoFiles): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-scm-stage-"));
    gitQ(repoDir, "init", "-q");
    gitQ(repoDir, "config", "user.email", "t@example.com");
    gitQ(repoDir, "config", "user.name", "Test");
    gitQ(repoDir, "config", "commit.gpgsign", "false");
    writeAll(repoDir, opts.committed ?? {});
    gitQ(repoDir, "add", "-A");
    gitQ(repoDir, "commit", "-qm", "init");
    if (opts.staged !== undefined) {
        writeAll(repoDir, opts.staged);
        gitQ(repoDir, "add", "-A");
    }
    if (opts.modify !== undefined) writeAll(repoDir, opts.modify);
    if (opts.untracked !== undefined) writeAll(repoDir, opts.untracked);
    return repoDir;
}

async function open(repoDir: string): Promise<HeadlessApp> {
    return useHeadlessApp({ open: [repoDir], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
}

/** Text only inside the node's rectangle — without neighboring panels. */
function regionText(frame: string, box: { x: number; y: number; width: number; height: number }): string {
    const lines = frame.split("\n");
    const out: string[] = [];
    for (let r = box.y; r < box.y + box.height && r < lines.length; r++) {
        out.push((lines[r] ?? "").slice(box.x, box.x + box.width));
    }
    return out.join("\n");
}

const A = 'export const a = "one";\n';
const A_MOD = 'export const a = "two";\n';

/**
 * A row disappearing is not the end yet: publishing happens inside the operation, and mutating
 * git commands are still unavailable. The action button is disabled exactly for the operation's duration.
 */
async function waitForScmIdle(session: HeadlessApp["session"]): Promise<void> {
    await session.waitForState("#scmActionButton", (s) => (s as { disabled?: boolean })?.disabled === false);
}

async function clickMenuItem(session: HeadlessApp["session"], label: string): Promise<void> {
    const frame = await session.waitForText((t) => t.includes(label));
    const lines = frameToText(frame).split("\n");
    const row = lines.findIndex((l) => l.includes(label));
    const col = lines[row].indexOf(label);
    await session.click(col + 1, row);
}

/** A single click in the list only selects: four events in a row fit the double-click window. */
async function doubleClick(session: HeadlessApp["session"], x: number, y: number): Promise<void> {
    await session.sendMouse({ action: "press", button: "left", x, y });
    await session.sendMouse({ action: "release", button: "left", x, y });
    await session.sendMouse({ action: "press", button: "left", x, y });
    await session.sendMouse({ action: "release", button: "left", x, y });
}

async function doubleClickRow(session: HeadlessApp["session"], rowId: string): Promise<void> {
    const row = await session.waitForNode(rowId);
    await doubleClick(session, row.box.x + 2, row.box.y);
}

const LINES = "one\ntwo\nthree\nfour\n";

describe("SCM staging (functional e2e, spec SourceControl.md)", () => {
    let app: HeadlessApp | null = null;

    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    afterEach(async () => {
        await app?.dispose();
        app = null;
    });

    it("US-1: Staged/Changes/Untracked groups split files correctly, MM is in both groups", async () => {
        const repo = makeRepo({
            committed: { "mm.ts": A, "plain.ts": A },
            staged: { "mm.ts": A_MOD },
            untracked: { "new.ts": "export {};\n" },
        });
        // One more edit on top of the staged version: mm.ts becomes MM.
        writeFileSync(join(repo, "mm.ts"), 'export const a = "three";\n');
        writeFileSync(join(repo, "plain.ts"), A_MOD);
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("Staged Changes"));
        await session.waitForNode("#scmGroup-index");
        await session.waitForNode("#scmGroup-worktree");
        // Untracked gets no header of its own — the row goes under "Changes",
        // but keeps its group in the id (discard uses it to choose clean vs checkout).
        expect(await session.node("#scmGroup-untracked")).toBeNull();
        const newRow = await session.waitForNode("#scmRow-untracked-new-ts");
        await session.waitForNode("#scmRow-index-mm-ts");
        await session.waitForNode("#scmRow-worktree-mm-ts");
        const staged = (await session.node("#scmGroup-index"))!.box;
        const worktree = (await session.node("#scmGroup-worktree"))!.box;
        expect(staged.y).toBeLessThan(worktree.y);
        expect(worktree.y).toBeLessThan(newRow.box.y);
    }, 120_000);

    it("US-2/US-3: stage from the context menu, then unstage — the row moves between groups", async () => {
        const repo = makeRepo({ committed: { "app.ts": A }, modify: { "app.ts": A_MOD } });
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("app.ts"));
        const row = await session.waitForNode("#scmRow-worktree-app-ts");

        await session.sendMouse({ action: "press", button: "right", x: row.box.x + 2, y: row.box.y });
        await session.sendMouse({ action: "release", button: "right", x: row.box.x + 2, y: row.box.y });
        await clickMenuItem(session, "Stage Changes");

        await session.waitForNode("#scmRow-index-app-ts");
        await session.waitForNoNode("#scmRow-worktree-app-ts");
        expect(git(repo, "diff", "--cached", "--name-only").trim()).toBe("app.ts");

        await waitForScmIdle(session);
        const stagedRow = await session.waitForNode("#scmRow-index-app-ts");
        await session.sendMouse({ action: "press", button: "right", x: stagedRow.box.x + 2, y: stagedRow.box.y });
        await session.sendMouse({ action: "release", button: "right", x: stagedRow.box.x + 2, y: stagedRow.box.y });
        await clickMenuItem(session, "Unstage Changes");

        await session.waitForNode("#scmRow-worktree-app-ts");
        await session.waitForNoNode("#scmRow-index-app-ts");
        expect(git(repo, "diff", "--cached", "--name-only").trim()).toBe("");
    }, 120_000);

    it("US-5: Stage All Changes in the group header stages the whole group", async () => {
        const repo = makeRepo({
            committed: { "a.ts": A, "b.ts": A },
            modify: { "a.ts": A_MOD, "b.ts": A_MOD },
        });
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("a.ts"));
        const header = await session.waitForNode("#scmGroup-worktree");

        await session.sendMouse({ action: "press", button: "right", x: header.box.x + 2, y: header.box.y });
        await session.sendMouse({ action: "release", button: "right", x: header.box.x + 2, y: header.box.y });
        await clickMenuItem(session, "Stage All Changes");

        await session.waitForNode("#scmGroup-index");
        await session.waitForNoNode("#scmGroup-worktree");
        expect(git(repo, "diff", "--cached", "--name-only").trim().split("\n").sort()).toEqual(["a.ts", "b.ts"]);
    }, 120_000);

    it("US-6: git.stageAll / git.unstageAll from commands (untracked files are staged too)", async () => {
        const repo = makeRepo({
            committed: { "a.ts": A },
            modify: { "a.ts": A_MOD },
            untracked: { "new.ts": "export {};\n" },
        });
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("a.ts"));
        await session.waitForNode("#scmGroup-worktree");

        await session.key("Alt+A"); // git.stageAll
        await session.waitForNoNode("#scmGroup-worktree");
        await session.waitForNode("#scmGroup-index");
        expect(git(repo, "diff", "--cached", "--name-only").trim().split("\n").sort()).toEqual(["a.ts", "new.ts"]);

        await waitForScmIdle(session);
        await session.key("Alt+U"); // git.unstageAll
        await session.waitForNoNode("#scmGroup-index");
        await session.waitForNode("#scmGroup-worktree");
        await session.waitForNode("#scmRow-untracked-new-ts");
        expect(git(repo, "diff", "--cached", "--name-only").trim()).toBe("");
    }, 120_000);

    it("US-7/US-8: Shift/Ctrl multi-select and staging exactly the selection", async () => {
        const repo = makeRepo({
            committed: { "a.ts": A, "b.ts": A, "c.ts": A },
            modify: { "a.ts": A_MOD, "b.ts": A_MOD, "c.ts": A_MOD },
        });
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("a.ts"));
        const rowA = await session.waitForNode("#scmRow-worktree-a-ts");

        await session.click(rowA.box.x + 2, rowA.box.y);
        await session.key("Shift+ArrowDown");
        await session.key("Shift+ArrowDown");
        await session.waitForState("#changesList", (s) => ((s as { selectedIds?: string[] })?.selectedIds?.length ?? 0) === 3);

        // Ctrl+click on b.ts deselects it: a and c remain.
        const rowB = await session.waitForNode("#scmRow-worktree-b-ts");
        await session.sendMouse({ action: "press", button: "left", x: rowB.box.x + 2, y: rowB.box.y, ctrlKey: true });
        await session.sendMouse({ action: "release", button: "left", x: rowB.box.x + 2, y: rowB.box.y, ctrlKey: true });
        await session.waitForState("#changesList", (s) => {
            const ids = (s as { selectedIds?: string[] })?.selectedIds ?? [];
            return ids.length === 2 && !ids.includes("scmRow-worktree-b-ts");
        });

        // Right-click a.ts: after the Ctrl+click the cursor is on the deselected b.ts, and a keyboard menu
        // would target it. The targets are the whole selection.
        await session.sendMouse({ action: "press", button: "right", x: rowA.box.x + 2, y: rowA.box.y });
        await session.sendMouse({ action: "release", button: "right", x: rowA.box.x + 2, y: rowA.box.y });
        await clickMenuItem(session, "Stage Changes");

        await session.waitForNode("#scmRow-index-a-ts");
        await session.waitForNode("#scmRow-index-c-ts");
        await session.waitForNode("#scmRow-worktree-b-ts");
        expect(git(repo, "diff", "--cached", "--name-only").trim().split("\n").sort()).toEqual(["a.ts", "c.ts"]);
    }, 120_000);

    it("US-10/US-11: discard reverts a tracked file, deletes an untracked one; Esc in the dialog is a no-op", async () => {
        const repo = makeRepo({
            committed: { "app.ts": A },
            modify: { "app.ts": A_MOD },
            untracked: { "new.ts": "export {};\n" },
        });
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("app.ts"));

        const row = await session.waitForNode("#scmRow-worktree-app-ts");
        await session.sendMouse({ action: "press", button: "right", x: row.box.x + 2, y: row.box.y });
        await session.sendMouse({ action: "release", button: "right", x: row.box.x + 2, y: row.box.y });
        await clickMenuItem(session, "Discard Changes");
        await session.waitForText((t) => t.includes("Are you sure you want to discard changes in app.ts?"));
        await session.key("Escape");
        await session.waitForText((t) => !t.includes("Are you sure"));
        expect(readFileSync(join(repo, "app.ts"), "utf8")).toBe(A_MOD);

        // Now confirm: default focus is on Cancel, the arrow moves to Discard.
        await session.sendMouse({ action: "press", button: "right", x: row.box.x + 2, y: row.box.y });
        await session.sendMouse({ action: "release", button: "right", x: row.box.x + 2, y: row.box.y });
        await clickMenuItem(session, "Discard Changes");
        await session.waitForText((t) => t.includes("Are you sure you want to discard changes in app.ts?"));
        await session.key("ArrowLeft");
        await session.key("Enter");
        await session.waitForNoNode("#scmRow-worktree-app-ts");
        // Windows: git checkout restores the file with CRLF (autocrlf) — normalize.
        expect(readFileSync(join(repo, "app.ts"), "utf8").replace(/\r\n/g, "\n")).toBe(A);

        await waitForScmIdle(session);
        const newRow = await session.waitForNode("#scmRow-untracked-new-ts");
        await session.sendMouse({ action: "press", button: "right", x: newRow.box.x + 2, y: newRow.box.y });
        await session.sendMouse({ action: "release", button: "right", x: newRow.box.x + 2, y: newRow.box.y });
        await clickMenuItem(session, "Discard Changes");
        await session.waitForText((t) => t.includes("Are you sure you want to DELETE new.ts?"));
        await session.key("ArrowLeft");
        await session.key("Enter");
        await session.waitForNoNode("#scmRow-untracked-new-ts");
        expect(existsSync(join(repo, "new.ts"))).toBe(false);
    }, 120_000);

    it("US-12: context menu items per group; Esc closes without an action", async () => {
        const repo = makeRepo({
            committed: { "st.ts": A, "wt.ts": A },
            staged: { "st.ts": A_MOD },
            modify: { "wt.ts": A_MOD },
            untracked: { "new.ts": "export {};\n" },
        });
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("st.ts"));

        const stagedRow = await session.waitForNode("#scmRow-index-st-ts");
        await session.sendMouse({ action: "press", button: "right", x: stagedRow.box.x + 2, y: stagedRow.box.y });
        await session.sendMouse({ action: "release", button: "right", x: stagedRow.box.x + 2, y: stagedRow.box.y });
        let frame = frameToText(await session.waitForText((t) => t.includes("Unstage Changes")));
        expect(frame).toContain("Open File");
        // "Stage Changes" (capital S) is not a substring of "Unstage Changes".
        expect(frame).not.toContain("Stage Changes");
        await session.key("Escape");
        await session.waitForText((t) => !t.includes("Unstage Changes"));

        const wtRow = await session.waitForNode("#scmRow-worktree-wt-ts");
        await session.sendMouse({ action: "press", button: "right", x: wtRow.box.x + 2, y: wtRow.box.y });
        await session.sendMouse({ action: "release", button: "right", x: wtRow.box.x + 2, y: wtRow.box.y });
        frame = frameToText(await session.waitForText((t) => t.includes("Stage Changes")));
        expect(frame).toContain("Open Changes");
        await session.key("Escape");
        await session.waitForText((t) => !t.includes("Stage Changes"));

        expect(git(repo, "diff", "--cached", "--name-only").trim()).toBe("st.ts");
    }, 120_000);
    it("#812: Open Changes on an MM file — Changes diffs index ↔ working tree, Staged diffs HEAD ↔ index", async () => {
        const repo = makeRepo({
            committed: { "a.ts": LINES },
            staged: { "a.ts": "one\nTWO\nthree\nfour\n" },
            modify: { "a.ts": "one\nTWO\nthree\nFOUR\n" },
        });
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("Staged Changes"));

        await doubleClickRow(session, "#scmRow-worktree-a-ts");
        let frame = frameToText(await session.waitForText((t) => t.includes("a.ts (Working Tree)")));
        // The working tree edit only: `four` is in the index, `two` only in HEAD.
        expect(frame).toContain("four");
        expect(frame).toContain("FOUR");
        expect(frame).not.toContain("two");

        await doubleClickRow(session, "#scmRow-index-a-ts");
        frame = frameToText(await session.waitForText((t) => t.includes("a.ts (Index)")));
        expect(frame).toContain("two");
        expect(frame).toContain("TWO");
        expect(frame).not.toContain("FOUR");
        // Two tabs: the Staged diff does not replace the Changes one.
        expect(frame).toContain("a.ts (Working Tree)");

        // The index side is read-only: typing does not reach it.
        await session.text("zz");
        await session.waitForText((t) => t.includes("a.ts (Index)"));
        expect(frameToText(await session.captureFrame())).not.toContain("zz");
        expect(git(repo, "show", ":a.ts")).toBe("one\nTWO\nthree\nfour\n");
    }, 120_000);

    it("#812: a staged rename diffs HEAD by the old path; a staged new file with a space and Unicode shows the index", async () => {
        const repo = makeRepo({ committed: { "old.ts": LINES } });
        gitQ(repo, "mv", "old.ts", "moved.ts");
        writeFileSync(join(repo, "my fïle.ts"), "brand new\n");
        gitQ(repo, "add", "my fïle.ts");
        app = await open(repo);
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("Staged Changes") && t.includes("moved.ts") && t.includes("my fïle.ts"));

        await doubleClickRow(session, "#scmRow-index-moved-ts");
        let frame = frameToText(await session.waitForText((t) => t.includes("moved.ts (Index)")));
        // HEAD:old.ts equals the index: no added lines, not "the whole file is new".
        expect(frame).toContain("three");
        expect(frame).not.toMatch(/\d\+ +\S/u);

        const list = frameToText(await session.captureFrame()).split("\n");
        const y = list.findIndex((l) => l.includes("my fïle.ts") && !l.includes("(Index)"));
        await doubleClick(session, list[y].indexOf("my fïle.ts") + 1, y);
        frame = frameToText(await session.waitForText((t) => t.includes("my fïle.ts (Index)")));
        expect(frame).toContain("brand new");
        expect(session.getStderr()).not.toMatch(/Error|Exception|unhandled/i);
    }, 120_000);
});
