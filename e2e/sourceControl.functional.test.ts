import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { OPEN_FILE_BUTTON_WIDTH } from "../src/vs/workbench/contrib/scm/browser/scmChangeRows.ts";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { frameToText } from "./helpers/frame.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";


// Letters are NOT mnemonics: F/E/S/V/G/H are taken by the menu bar.
const SWITCH_KEYS = [
    { key: "alt+c", command: "workbench.view.scm" },
    { key: "alt+x", command: "workbench.view.explorer" },
    { key: "alt+t", command: "scm.action.viewAsTree" },
    { key: "alt+l", command: "scm.action.viewAsList" },
];

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

interface RepoOptions {
    committed?: Record<string, string>;
    modify?: Record<string, string>;
    untracked?: Record<string, string>;
    clean?: boolean;
    noGit?: boolean;
}

function writeAll(repoDir: string, files: Record<string, string>): void {
    for (const [rel, content] of Object.entries(files)) {
        const file = join(repoDir, rel);
        execFileSync("mkdir", ["-p", join(file, "..")]);
        writeFileSync(file, content);
    }
}

function makeRepo(opts: RepoOptions): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-scm207-"));
    if (opts.noGit === true) {
        writeAll(repoDir, opts.committed ?? {});
        writeAll(repoDir, opts.untracked ?? {});
        return repoDir;
    }
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeAll(repoDir, opts.committed ?? {});
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    if (opts.clean !== true) {
        if (opts.modify !== undefined) writeAll(repoDir, opts.modify);
        if (opts.untracked !== undefined) writeAll(repoDir, opts.untracked);
    }
    return repoDir;
}

async function open(repoDir: string, keybindings = SWITCH_KEYS): Promise<HeadlessApp> {
    return useHeadlessApp({ open: [repoDir], keybindings, cols: 100, rows: 24 });
}

function lineWith(frame: string, needle: string): string {
    return frame.split("\n").find((l) => l.includes(needle)) ?? "";
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

const APP_TS = ["export function greet(name: string) {", '    return "hi " + name;', "}", ""].join("\n");
const APP_TS_MOD = ["export function greet(name: string) {", '    return "hello " + name;', "}", ""].join("\n");

describe("Source Control in the sidebar (functional e2e, PR #207)", () => {
    let app: HeadlessApp | null = null;

    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    afterEach(async () => {
        await app?.dispose();
        app = null;
    });

    it("switches Explorer → Source Control and shows changed files with statuses", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, modify: { "app.ts": APP_TS_MOD }, untracked: { "extra.ts": "export const answer = 42;\n" } });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("EXPLORER") && t.includes("app.ts") && t.includes("extra.ts"));

        await session.key("Alt+C");
        const frame = await session
            .waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("app.ts") && t.includes("extra.ts"))
            .then(frameToText);

        expect(await session.node("#changesView")).not.toBeNull();
        expect(lineWith(frame, "app.ts")).toContain("M");
        expect(lineWith(frame, "extra.ts")).toContain("U");
        expect(await session.focusedType()).toBe("ListViewElement");
    }, 120_000);

    it("double-clicking a modified file opens the 'file ↔ HEAD' diff", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, modify: { "app.ts": APP_TS_MOD } });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("app.ts"));
        await session.key("Alt+C");
        // Wait for a POPULATED list (the extension publishes the set asynchronously) — otherwise
        // the click at y+1 lands in an empty list and nothing activates.
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("app.ts"));
        const list = await session.waitForNode("#changesView");

        // Double-click the app.ts row: the first row is the "Changes" group header,
        // the file is the row below. Four events in a row without settle fit the double-click window.
        const x = list.box.x + 2;
        const y = list.box.y + 1;
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });

        // The diff opened as the ONLY tab: the tab bar mentions app.ts exactly once
        // (the diff label); there is no file tab.
        const frame = await session.waitForText((t) => t.includes("↔ HEAD")).then(frameToText);
        const tabsLine = lineWith(frame, "↔ HEAD");
        expect(tabsLine.split("app.ts").length - 1).toBe(1);
    }, 120_000);

    it("double-clicking an untracked file opens the file itself (nothing to compare with)", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, untracked: { "extra.ts": "export const answer = 42;\n" } });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("extra.ts"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("extra.ts"));
        const list = await session.waitForNode("#changesView");

        // Rows: the "Changes" header and extra.ts below it — untracked goes into the common
        // group (app.ts is committed with no edits).
        const x = list.box.x + 2;
        const y = list.box.y + 1;
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });

        // The file itself opened (its content is all new); no diff and no notice.
        const frame = await session.waitForText((t) => t.includes("export const answer = 42;")).then(frameToText);
        expect(frame).not.toContain("↔ HEAD");
        expect(frame).not.toContain("No changes to compare");
    }, 120_000);

    it("clicking a row's inline button opens the file itself, not the diff", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, modify: { "app.ts": APP_TS_MOD } });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("app.ts"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("app.ts"));
        const list = await session.waitForNode("#changesList");

        // The Open File button appears only on the row under the pointer — hover first.
        const rowY = list.box.y + 1;
        await session.sendMouse({ action: "move", button: "none", x: list.box.x, y: rowY });

        // The `[  ]` button takes 5 columns left of the status letter (fixed 1).
        const buttonX = list.box.x + list.box.width - 1 - OPEN_FILE_BUTTON_WIDTH;
        await session.sendMouse({ action: "press", button: "left", x: buttonX, y: rowY });
        await session.sendMouse({ action: "release", button: "left", x: buttonX, y: rowY });

        const frame = await session.waitForText((t) => t.includes('"hello " + name')).then(frameToText);
        expect(frame).not.toContain("↔ HEAD");
    }, 120_000);

    it("scm.action.viewAsTree folds paths into compact folders, viewAsList restores the list", async () => {
        const repo = makeRepo({
            committed: { "src/deep/mod.ts": "export const x = 1;\n" },
            modify: { "src/deep/mod.ts": "export const x = 2;\n" },
        });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("EXPLORER"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("src/deep/mod.ts"));

        await session.key("Alt+T");
        const box = (await session.waitForNode("#changesView")).box;
        const tree = await session
            .waitForText((t) => {
                const scm = regionText(t, box);
                return scm.includes("src/deep") && !scm.includes("src/deep/mod.ts") && scm.includes("mod.ts");
            })
            .then(frameToText);
        expect(regionText(tree, box)).toContain("src/deep"); // compact chain as a single node

        await session.key("Alt+L");
        await session.waitForText((t) => regionText(t, box).includes("src/deep/mod.ts"));
    }, 120_000);

    it("right-clicking a row opens the Open File / Open Changes context menu", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, modify: { "app.ts": APP_TS_MOD } });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("app.ts"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("app.ts"));
        const list = await session.waitForNode("#changesList");

        const x = list.box.x + 2;
        const y = list.box.y + 1; // file row under the group header
        await session.sendMouse({ action: "press", button: "right", x, y });
        await session.sendMouse({ action: "release", button: "right", x, y });

        const frame = await session.waitForText((t) => t.includes("Open File")).then(frameToText);
        expect(frame).toContain("Open Changes");

        await session.key("Escape");
        await session.waitForText((t) => !t.includes("Open Changes"));
        expect((await session.getDocument()).root).not.toBeNull();
    }, 120_000);

    it("a clean repo — empty Source Control list, no crash", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, clean: true });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("EXPLORER"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));

        expect(await session.node("#changesView")).not.toBeNull();
        const frame = frameToText(await session.captureFrame());
        // The SCM viewlet replaces Explorer, so app.ts must not appear as a change.
        const scmSlice = frame.slice(frame.indexOf("SOURCE CONTROL"));
        expect(scmSlice).not.toContain("app.ts");
    }, 120_000);

    it("a non-git folder — Source Control is empty, no crash", async () => {
        const dir = makeRepo({ noGit: true, committed: { "note.txt": "plain\n" } });
        app = await open(dir);
        const { session } = app;

        await session.waitForText((t) => t.includes("EXPLORER") && t.includes("note.txt"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));

        expect(await session.node("#changesView")).not.toBeNull();
        const frame = frameToText(await session.captureFrame());
        const scmSlice = frame.slice(frame.indexOf("SOURCE CONTROL"));
        expect(scmSlice).not.toContain("note.txt");
    }, 120_000);

    it("returning to Explorer restores the file tree", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, modify: { "app.ts": APP_TS_MOD } });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("EXPLORER"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
        await session.key("Alt+X");
        await session.waitForText((t) => t.includes("EXPLORER") && t.includes("app.ts"));
        expect(await session.node("#explorer")).not.toBeNull();
        expect(await session.node("#changesView")).toBeNull();
    }, 120_000);

    it("nested files are shown by their path relative to the workspace root", async () => {
        const repo = makeRepo({
            committed: { "src/deep/mod.ts": "export const x = 1;\n" },
            modify: { "src/deep/mod.ts": "export const x = 2;\n" },
        });
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("EXPLORER"));
        await session.key("Alt+C");
        const frame = await session
            .waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("mod.ts"))
            .then(frameToText);
        expect(frame).toContain("src/deep/mod.ts");
    }, 120_000);

    it("double-clicking a deleted file (status D) opens the 'HEAD ↔ empty' diff", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, clean: true });
        // Delete the committed file on disk → unstaged deletion (D).
        execFileSync("rm", [join(repo, "app.ts")]);
        app = await open(repo);
        const { session } = app;

        await session.waitForText((t) => t.includes("EXPLORER"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("app.ts"));
        const list = await session.waitForNode("#changesView");

        const x = list.box.x + 2;
        const y = list.box.y + 1; // file row under the group header
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });
        await session.sendMouse({ action: "press", button: "left", x, y });
        await session.sendMouse({ action: "release", button: "left", x, y });

        // The file is gone from disk — the modified side is empty: the whole HEAD version shows
        // as deleted. At 100 columns the panel is below the threshold — the diff is inline (PR-6):
        // HEAD lines are shown as ghost rows without numbers; no plus lines with text.
        const frame = await session.waitForText((t) => t.includes("↔ HEAD")).then(frameToText);
        expect(frame).toContain("export function greet");
        expect(frame).toContain("HEAD ↔ app.ts");
        expect(frame).not.toMatch(/\d\+ +\S/u);
        expect(session.getStderr()).not.toMatch(/Error|Exception|unhandled/i);
    }, 120_000);

    it("the Source Control list updates live after a file is edited and saved", async () => {
        const repo = makeRepo({ committed: { "app.ts": APP_TS }, clean: true });
        const filePath = join(repo, "app.ts");
        app = await useHeadlessApp({ open: [repo, filePath], keybindings: SWITCH_KEYS, cols: 100, rows: 24 });
        const { session } = app;

        await session.waitForText((t) => t.includes("greet"));
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
        // List region only — so the name in the editor tab on the right does not count as a change.
        const box = (await session.waitForNode("#changesView")).box;
        const scmBefore = regionText(frameToText(await session.captureFrame()), box);
        expect(scmBefore).not.toContain("app.ts");

        // Edit and save the file through the editor — the extension recomputes git status
        // on onDidSaveTextDocument and publishes a new set.
        await session.clickNode("EditorElement");
        await session.text("// touch\n");
        await session.key("Ctrl+S");

        const listLine = await session
            .waitForText((t) => regionText(t, box).includes("app.ts"), { timeoutMs: 30_000 })
            .then((f) => lineWith(regionText(frameToText(f), box), "app.ts"));
        expect(listLine).toContain("M");
    }, 120_000);
});
