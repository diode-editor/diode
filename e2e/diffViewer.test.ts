import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { explorerTitle } from "./helpers/explorerTitle.ts";
import type { HeadlessApp } from "./helpers/appSession.ts";
import { startHeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";

// Linux only: needs the extension host — the git extension serves the HEAD version.

const runOnLinux = process.platform === "linux" ? describe : describe.skip;

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

interface Repo {
    dir: string;
    file(rel: string): string;
}

function makeRepo(committed: Record<string, string>): Repo {
    const dir = mkdtempSync(join(tmpdir(), "diode-diff-e2e-"));
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "Test");
    git(dir, "config", "commit.gpgsign", "false");
    for (const [rel, content] of Object.entries(committed)) {
        writeFileSync(join(dir, rel), content);
    }
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
    return { dir, file: (rel) => join(dir, rel) };
}

const TRACKED = [
    ...Array.from({ length: 12 }, (_, i) => `const value${String(i)} = ${String(i)};`),
    "export function greet(name) {",
    '    return "hi " + name;',
    "}",
    "",
].join("\n");

/** Invokes the command via the command palette — exactly like a user. */
async function invokeCompare(session: HeadlessSession): Promise<void> {
    await session.key("Ctrl+P");
    await session.text(">Compare Active File with HEAD");
    await session.waitForText((t) => t.includes("Compare Active File with HEAD"));
    await session.key("Enter");
}

async function tabs(session: HeadlessSession): Promise<{ label: string; active: boolean; readOnly: boolean }[]> {
    const strip = await session.node("EditorTabStripElement");
    return (strip?.state?.tabs ?? []) as { label: string; active: boolean; readOnly: boolean }[];
}

runOnLinux("Diff viewer (functional e2e)", () => {
    const repos: Repo[] = [];
    let app: HeadlessApp | null = null;

    function repo(committed: Record<string, string>): Repo {
        const r = makeRepo(committed);
        repos.push(r);
        return r;
    }

    async function open(openArgs: string[], cwd: string, cols = 100): Promise<HeadlessSession> {
        app = await startHeadlessApp({ open: openArgs, cwd, cols, rows: 24 });
        return app.session;
    }

    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    afterAll(() => {
        for (const r of repos) rmSync(r.dir, { recursive: true, force: true });
    });

    async function teardown(): Promise<void> {
        await app?.dispose();
        app = null;
    }

    // ── C. Live gutter (map 10) ─────────────────────────────────────────────
    it("live gutter: editing a tracked file shows the ┋ bar before saving", async () => {
        const r = repo({ "greeting.txt": "alpha\nbravo\ncharlie\ndelta\n" });
        const s = await open([r.dir, r.file("greeting.txt")], r.dir);
        try {
            await s.waitForText((t) => t.includes("charlie"));
            // Edit line 2 WITHOUT saving.
            await s.key("ArrowDown");
            await s.text("XX");
            await s.waitForText((t) => t.includes("XXbravo"));
            // The bar must appear from the edit itself (the main bug of the PR).
            await s.waitForText((t) => t.includes("┋"), { timeoutMs: 15_000 });
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── A+B. Command + tab against the live buffer (map 1,2,3,4) ─────────────
    it("Compare with HEAD: opens a live ↔ HEAD tab with +/- for an unsaved edit", async () => {
        const r = repo({ "greeting.js": TRACKED });
        // Wider than the default: the long edited line must fit in two columns.
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await s.waitForText((t) => t.includes("greet"));

            // Edit the return line WITHOUT saving — the diff must be computed against the buffer.
            await s.key("Ctrl+End");
            await s.key("ArrowUp");
            await s.key("ArrowUp");
            await s.key("End");
            await s.text(" // changed");
            await s.waitForText((t) => t.includes("// changed"));
            // Wait for git-ext activation + original availability: the bar in the gutter.
            await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });

            await invokeCompare(s);
            await s.waitForText((t) => t.includes("↔ HEAD"), { timeoutMs: 15_000 });

            const frame = frameToText(await s.captureFrame());
            // Diff against the buffer: the edit shows as a plus.
            expect(frame).toContain("// changed");
            expect(frame).toMatch(/[+]/u);
            // Unchanged regions are folded.
            expect(frame).toMatch(/unchanged line/u);

            // The tab is active and NOT read-only: the modified side is the live buffer.
            const strip = await tabs(s);
            const diffTab = strip.find((t) => t.label.includes("↔ HEAD"));
            expect(diffTab, `tabs: ${JSON.stringify(strip)}`).toBeDefined();
            expect(diffTab?.readOnly).toBe(false);
            expect(diffTab?.active).toBe(true);

            // Focus moved to the diff side — a real editor.
            expect(await s.focusedType()).toBe("EditorElement");
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── B. Live editable diff: an edit in a side reaches the buffer (PR-4) ──
    it("typing in a diff side edits the file buffer, the diff recomputes itself", async () => {
        const r = repo({ "greeting.js": TRACKED });
        // Wider than the inline threshold: the test asserts a side-by-side N-/N+ pair.
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await s.waitForText((t) => t.includes("greet"));
            await s.key("End");
            await s.text(" // edited");
            await s.waitForText((t) => t.includes("// edited"));
            await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });
            await invokeCompare(s);
            await s.waitForText((t) => t.includes("↔ HEAD"), { timeoutMs: 15_000 });

            // Cursor in the modified side (0,0): typing goes to the live buffer.
            await s.text("ZZQ");
            await s.waitForText((t) => t.includes("ZZQconst"));
            // Live recompute (debounce 200) marks the line as a changed pair.
            await s.waitForText((t) => {
                const line = t.split("\n").find((l) => l.includes("ZZQconst"));
                return line !== undefined && line.includes("1-") && line.includes("1+");
            }, { timeoutMs: 15_000 });

            // The edit is visible in the regular file tab too — the model is shared.
            await s.key("Ctrl+P");
            await s.text("greeting.js");
            await s.key("Enter");
            await s.waitForFocus("EditorElement");
            await s.waitForText((t) => t.includes("ZZQconst"));
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── B. The cursor drives the viewport (map 5) ────────────────────────────
    it("the diff scrolls with the cursor (diff taller than the viewport)", async () => {
        // Commit one line and add 80 unique ones to the buffer — added lines
        // aren't folded, so the diff is guaranteed taller than the 24-row screen.
        const r = repo({ "long.txt": "HEADLINE\n" });
        const s = await open([r.dir, r.file("long.txt")], r.dir);
        try {
            await s.waitForText((t) => t.includes("HEADLINE"));
            await s.key("Ctrl+End");
            const block = "\n" + Array.from({ length: 80 }, (_, i) => `row${String(i).padStart(3, "0")}`).join("\n");
            await s.text(block);
            await s.waitForText((t) => t.includes("row079"));
            await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });
            await invokeCompare(s);
            await s.waitForText((t) => t.includes("↔ HEAD"), { timeoutMs: 15_000 });

            const top = frameToText(await s.captureFrame());
            expect(top).toContain("row000");
            expect(top).not.toContain("row079"); // off-screen at the start
            // The cursor moves down, the viewport follows it.
            for (let i = 0; i < 20; i++) await s.key("PageDown");
            const bottom = frameToText(await s.captureFrame());
            expect(bottom).toContain("row079");
            // Ctrl+Home returns to the top. Ctrl+Home specifically, not Home: since the
            // cursor appeared, Home means "start of line", as in VS Code.
            await s.key("Ctrl+Home");
            const backTop = frameToText(await s.captureFrame());
            expect(backTop).toContain("row000");
            expect(backTop).not.toContain("row079");
            const sides = await s.nodes("EditorElement");
            expect(sides.at(-1)?.state?.selections).toEqual([
                { anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 }, collapsed: true },
            ]);
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── A. Re-invoking after a new edit refreshes the snapshot (map 9) ────────
    it("Compare again after a new edit shows a fresh snapshot", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await s.waitForText((t) => t.includes("greet"));
            await s.key("End");
            await s.text(" // AAAA");
            await s.waitForText((t) => t.includes("// AAAA"));
            await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });
            await invokeCompare(s);
            await s.waitForText((t) => t.includes("↔ HEAD"), { timeoutMs: 15_000 });
            expect(frameToText(await s.captureFrame())).toContain("// AAAA");

            // Return to the text editor via Quick Open and add a second edit.
            await s.key("Ctrl+P");
            await s.text("greeting.js");
            await s.key("Enter");
            await s.waitForFocus("EditorElement");
            await s.key("End");
            await s.text(" // BBBB");
            await s.waitForText((t) => t.includes("// BBBB"));

            // The user invokes Compare again, expecting to see both edits.
            await invokeCompare(s);
            await s.waitForText((t) => t.includes("↔ HEAD"), { timeoutMs: 15_000 });
            const frame = frameToText(await s.captureFrame());
            const strip = await tabs(s);
            const diffCount = strip.filter((t) => t.label.includes("↔ HEAD")).length;
            // Exactly one diff tab (dedup by resource — this is expected).
            expect(diffCount).toBe(1);
            // The tab reflects the current buffer (both edits): the command refreshes the
            // already open diff tab of the same resource with a fresh snapshot in place
            // (`DiffEditorPane.setInput`), rather than reactivating the old one with the AAAA snapshot.
            expect(frame).toContain("// BBBB");
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── A. Untracked file → notice (map 6) ──────────────────────────────────
    it("untracked file: the command reports there is nothing to compare with", async () => {
        const r = repo({ "tracked.txt": "committed\n" });
        writeFileSync(r.file("fresh.txt"), "brand new file\n");
        const s = await open([r.dir, r.file("fresh.txt")], r.dir);
        try {
            await s.waitForText((t) => t.includes("brand new file"));
            // Let the git extension activate (otherwise the notice is for the wrong reason).
            await s.waitForText((t) => t.includes("fresh.txt") || t.includes(explorerTitle(r.dir)), { timeoutMs: 10_000 });
            await invokeCompare(s);
            await s.waitForText((t) => t.includes("No changes to compare"), { timeoutMs: 15_000 });
            // There must be no diff tab.
            const strip = await tabs(s);
            expect(strip.some((t) => t.label.includes("↔ HEAD"))).toBe(false);
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── A. Clean file with git ACTIVE (map 8) ───────────────────────────────
    it("clean file with active git: opens a ↔ HEAD tab, not a notice", async () => {
        const r = repo({ "same.txt": "one\ntwo\nthree\n" });
        const s = await open([r.dir, r.file("same.txt")], r.dir);
        try {
            await s.waitForText((t) => t.includes("three"));
            // Deterministically force git extension activation: dirty the buffer until
            // the bar appears, then revert — now the provider is surely up,
            // and the buffer equals HEAD again.
            await s.key("End");
            await s.text("Z");
            await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });
            await s.key("Ctrl+Z");
            await s.waitForText((t) => !t.includes("┋") && !t.includes("┃"));

            await invokeCompare(s);
            await s.waitForText((t) => t.includes("↔ HEAD") || t.includes("No changes"), { timeoutMs: 15_000 });
            const strip = await tabs(s);
            const openedDiff = strip.some((t) => t.label.includes("↔ HEAD"));
            // A committed file HAS a version in git — the "has no version in git" message would be wrong.
            expect(openedDiff).toBe(true);
            // The empty diff says what matters (US-11).
            expect(frameToText(await s.captureFrame())).toContain("The files are identical");
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── D. Diff as a text surface: cursor, selection, copy ──────────────────

    /** Edits the buffer and opens the diff; focus stays in the diff pane. */
    async function openDiffFor(s: HeadlessSession, edit: string): Promise<void> {
        await s.waitForText((t) => t.includes("greet"));
        await s.key("Ctrl+End");
        await s.key("ArrowUp");
        await s.key("ArrowUp");
        await s.key("End");
        await s.text(edit);
        await s.waitForText((t) => t.includes(edit.trim()));
        await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });
        await invokeCompare(s);
        await s.waitForText((t) => t.includes("↔ HEAD"), { timeoutMs: 15_000 });
        await s.waitForFocus("EditorElement");
    }

    /** State of the modified side (the last EditorElement in the pair's tree). */
    const selectionOf = async (s: HeadlessSession) => (await s.nodes("EditorElement")).at(-1)?.state;

    it("arrow keys move the cursor in the diff", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir);
        try {
            await openDiffFor(s, " // moved");

            expect((await selectionOf(s))?.selections).toEqual([
                { anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 }, collapsed: true },
            ]);

            await s.key("ArrowDown");
            await s.key("ArrowRight");
            await s.key("ArrowRight");

            // Document coordinates: ArrowDown from a folded region's header
            // jumps over the hidden lines and the placeholder zone.
            const state = await selectionOf(s);
            const active = (state?.selections as { active: { line: number; character: number } }[])[0].active;
            expect(active.line).toBeGreaterThan(1);
            expect(active.character).toBe(2);
            // The side is the live buffer: editing is possible.
            expect(state?.readOnly).toBe(false);
        } finally {
            await teardown();
        }
    }, 120_000);

    it("Shift+End selects the line, Ctrl+C copies the text without the gutter", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await openDiffFor(s, " // ZZQQ");

            // Click to put the cursor on the added line — the one drawn with
            // the `+` marker and two line numbers on the left.
            const frame = frameToText(await s.captureFrame()).split("\n");
            const row = frame.findIndex((line) => line.includes("ZZQQ"));
            expect(row).toBeGreaterThan(0);
            expect(frame[row]).toMatch(/\+/u); // specifically the added line, with the marker
            // Take coordinates from the pane itself: the sidebar is on the left, and an absolute x=20
            // would land in the file tree, taking focus away from the diff.
            const view = await s.waitForNode("DiffPaneElement");
            await s.click(view.box.x + view.box.width - 2, row);

            await s.key("Home");
            await s.key("Shift+End");
            expect((await selectionOf(s))?.hasSelection).toBe(true);
            await s.key("Ctrl+C");

            // Paste into the Quick Open input: it's empty and exposes its content
            // character by character, so it checks the clipboard more precisely than any frame.
            await s.key("Ctrl+P");
            await s.key("Ctrl+V");
            const input = await s.waitForNode("InputElement");

            // Exactly the line text: no line numbers, no `+` marker — they live in the
            // gutter, not in the document. Home landed on the first non-whitespace char, as
            // in the editor, so there's no indentation either.
            expect(input.state?.value).toBe('return "hi " + name; // ZZQQ');
            await s.key("Escape");
        } finally {
            await teardown();
        }
    }, 120_000);

    it("mouse drag selects diff lines", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir);
        try {
            await openDiffFor(s, " // dragme");

            const node = await s.waitForNode("DiffPaneElement");
            // The right half of the pair is the modified side; +1 on y skips the
            // column header row.
            const x = node.box.x + Math.floor(node.box.width / 2) + 8;
            const y = node.box.y + 1;
            await s.sendMouse({ action: "press", button: "left", x, y });
            await s.sendMouse({ action: "move", button: "left", x: x + 5, y: y + 2 });
            await s.sendMouse({ action: "release", button: "left", x: x + 5, y: y + 2 });
            await s.waitForIdle();

            expect((await selectionOf(s))?.hasSelection).toBe(true);
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── F. Comparison command family (US-3, US-6) ───────────────────────────
    it("Compare with Saved: '(on disk) ↔ file' tab for an unsaved edit", async () => {
        const r = repo({ "notes.txt": "alpha\nbravo\ncharlie\n" });
        const s = await open([r.dir, r.file("notes.txt")], r.dir, 140);
        try {
            await s.waitForText((t) => t.includes("charlie"));
            await s.key("ArrowDown");
            await s.text("XX");
            await s.waitForText((t) => t.includes("XXbravo"));

            await s.key("Ctrl+P");
            await s.text(">Compare Active File with Saved");
            await s.waitForText((t) => t.includes("Compare Active File with Saved"));
            await s.key("Enter");
            await s.waitForText((t) => t.includes("(on disk) ↔ notes.txt"), { timeoutMs: 15_000 });

            const frame = frameToText(await s.captureFrame());
            expect(frame).toMatch(/2-\s+bravo/u);
            expect(frame).toMatch(/2\+\s+XXbravo/u);
        } finally {
            await teardown();
        }
    }, 120_000);

    it("Compare Active File With...: the picker opens a diff of two files", async () => {
        const r = repo({ "left.txt": "alpha\nLEFT\n", "right.txt": "alpha\nRIGHT\n" });
        const s = await open([r.dir, r.file("left.txt")], r.dir, 140);
        try {
            await s.waitForText((t) => t.includes("LEFT"));

            await s.key("Ctrl+P");
            await s.text(">Compare Active File With...");
            await s.waitForText((t) => t.includes("Compare Active File With..."));
            await s.key("Enter");
            // Picker for the second side: narrow to right.txt and confirm.
            await s.waitForText((t) => t.includes("Select a file to compare with"), { timeoutMs: 15_000 });
            await s.text("right");
            await s.waitForText((t) => t.includes("right.txt"));
            await s.key("Enter");
            await s.waitForText((t) => t.includes("left.txt ↔ right.txt"), { timeoutMs: 15_000 });

            const frame = frameToText(await s.captureFrame());
            expect(frame).toMatch(/2-\s+LEFT/u);
            expect(frame).toMatch(/2\+\s+RIGHT/u);
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── G. Open File at Revision (DiffEditable PR-1) ─────────────────────────
    it("Open File at Revision: read-only tab with the branch content", async () => {
        const r = repo({ "story.txt": "alpha\nbravo\n" });
        git(r.dir, "branch", "old-branch");
        writeFileSync(r.file("story.txt"), "alpha\nbravo\ncharlie\n");
        git(r.dir, "add", "-A");
        git(r.dir, "commit", "-qm", "second");
        const s = await open([r.dir, r.file("story.txt")], r.dir);
        try {
            await s.waitForText((t) => t.includes("charlie"));
            // Wait for git extension activation (otherwise the picker is empty).
            await s.key("End");
            await s.text("Z");
            await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });
            await s.key("Ctrl+Z");

            await s.key("Ctrl+P");
            await s.text(">Open File at Revision");
            await s.waitForText((t) => t.includes("Open File at Revision"));
            await s.key("Enter");
            await s.waitForText((t) => t.includes("Pick a branch or tag"), { timeoutMs: 15_000 });
            await s.text("old-branch");
            await s.key("Enter");
            await s.waitForText((t) => t.includes("story.txt (old-branch)"), { timeoutMs: 15_000 });

            const frame = frameToText(await s.captureFrame());
            // Branch content: there's no third line.
            expect(frame).toContain("bravo");
            expect(frame).not.toContain("charlie");
            // The tab is read-only — with a lock in the tab.
            const strip = await tabs(s);
            const revTab = strip.find((t) => t.label.includes("(old-branch)"));
            expect(revTab?.readOnly).toBe(true);
            // Typing doesn't change the content.
            await s.text("EDIT");
            expect(frameToText(await s.captureFrame())).not.toContain("EDIT");
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── H. Diff v2: two real editors (DiffEditable PR-3/PR-4) ───────────────
    it("v2: tab of two editors — alignment, fold placeholders, cursor in a side", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await s.waitForText((t) => t.includes("greet"));
            await s.key("Ctrl+End");
            await s.key("ArrowUp");
            await s.key("ArrowUp");
            await s.key("End");
            await s.text(" // v2");
            await s.waitForText((t) => t.includes("// v2"));
            await s.waitForText((t) => t.includes("┋") || t.includes("┃"), { timeoutMs: 15_000 });

            await invokeCompare(s);
            await s.waitForText((t) => t.includes("↔ HEAD"), { timeoutMs: 15_000 });

            const frame = frameToText(await s.captureFrame());
            // A pair of changed lines at the same height on both sides of the divider.
            const pair = frame.split("\n").find((l) => l.includes('"hi "') && l.includes("// v2"));
            expect(pair).toBeDefined();
            expect(pair).toContain("│");
            // Paired fold placeholder.
            const plaque = frame.split("\n").find((l) => l.includes("unchanged lines"));
            expect(plaque?.split("│").filter((p) => p.includes("unchanged lines"))).toHaveLength(2);

            // The cursor lives in the side: arrow down moves the selection.
            await s.key("ArrowDown");
            const editorNodes = await s.nodes("EditorElement");
            expect(editorNodes.length).toBeGreaterThanOrEqual(2);
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── E. Side-by-side: resize keeps the cursor (US-23; inline fallback — PR-5) ──
    it("US-21: narrow terminal — auto inline with ghost text, resizing back restores the columns", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await openDiffFor(s, " // wide");

            // Wide: two columns with side headers.
            expect(frameToText(await s.captureFrame())).toContain("│");

            // The cursor moves down in the right (modified) side.
            await s.key("ArrowDown");
            const caretBefore = ((await selectionOf(s))?.selections as { active: { line: number } }[])[0].active
                .line;

            // Narrow: the pane is below the threshold — inline. A shared header, the changed
            // HEAD line shows as a ghost (no number), the edit — with a marker.
            await s.resize(100, 24);
            await s.waitForText((t) => t.includes("HEAD ↔ greeting.js"), { timeoutMs: 15_000 });
            const inlineFrame = frameToText(await s.captureFrame()).split("\n");
            const ghost = inlineFrame.find((l) => l.includes('return "hi " + name;') && !l.includes("// wide"));
            expect(ghost).toBeDefined();
            expect(ghost).not.toMatch(/\d/u);
            expect(inlineFrame.find((l) => /\d+\+\s+.*\/\/ wide/u.test(l))).toBeDefined();

            // Back: side-by-side, the cursor on its line (US-23).
            await s.resize(140, 24);
            await s.waitForText((t) => t.split("\n").some((l) => l.includes("HEAD") && l.includes("│")), {
                timeoutMs: 15_000,
            });
            const after = await selectionOf(s);
            expect((after?.selections as { active: { line: number } }[])[0].active.line).toBe(caretBefore);
        } finally {
            await teardown();
        }
    }, 120_000);

    it("US-22: 'Diff: Toggle Inline View' switches the mode and is remembered", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await openDiffFor(s, " // toggle");
            expect(frameToText(await s.captureFrame())).toContain("│");

            await s.key("Ctrl+P");
            await s.text(">Diff: Toggle Inline View");
            await s.waitForText((t) => t.includes("Toggle Inline View"));
            await s.key("Enter");
            // Wide terminal, but inline mode is forced.
            await s.waitForText((t) => t.includes("HEAD ↔ greeting.js"), { timeoutMs: 15_000 });

            // The reverse toggle restores the columns.
            await s.key("Ctrl+P");
            await s.text(">Diff: Toggle Inline View");
            await s.waitForText((t) => t.includes("Toggle Inline View"));
            await s.key("Enter");
            await s.waitForText((t) => t.split("\n").some((l) => l.includes("HEAD") && l.includes("│")), {
                timeoutMs: 15_000,
            });
        } finally {
            await teardown();
        }
    }, 120_000);

    // ── I. Compare New Untitled Text Files (US-37, PR-4) ─────────────────────
    // ── J. PR-5: hunk revert and live HEAD shift (US-31) ────────────────────
    it("Diff: Revert Hunk reverts the edit under the cursor right from the diff", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await openDiffFor(s, " // revertme");
            await s.waitForText((t) => t.includes("// revertme"));

            // The cursor is on the changed line: it's visible, no click needed —
            // put it there by searching the hunk with arrows? No: revert finds the hunk by
            // the cursor — move it there with commands (the return line is visible).
            const frame = frameToText(await s.captureFrame()).split("\n");
            const row = frame.findIndex((line) => line.includes("// revertme"));
            expect(row).toBeGreaterThan(0);
            const view = await s.waitForNode("DiffPaneElement");
            await s.click(view.box.x + view.box.width - 2, row);

            await s.key("Ctrl+P");
            await s.text(">Diff: Revert Hunk");
            await s.waitForText((t) => t.includes("Revert Hunk"));
            await s.key("Enter");

            // The edit is reverted; the live recompute removed the hunk markup.
            await s.waitForText((t) => !t.includes("// revertme"), { timeoutMs: 15_000 });
            // And it's gone from the file buffer too (the model is shared) — Ctrl+Z would bring it back.
            await s.key("Ctrl+P");
            await s.text("greeting.js");
            await s.key("Enter");
            await s.waitForFocus("EditorElement");
            expect(frameToText(await s.captureFrame())).not.toContain("// revertme");
        } finally {
            await teardown();
        }
    }, 120_000);

    it("US-31: a git commit outside the app refreshes the HEAD side of an open diff", async () => {
        const r = repo({ "greeting.js": TRACKED });
        const s = await open([r.dir, r.file("greeting.js")], r.dir, 140);
        try {
            await openDiffFor(s, " // live-head");
            await s.waitForText((t) => t.includes("// live-head"));

            // "Commit from the terminal": does the working tree already contain the edit? No —
            // the edit isn't saved. Change HEAD differently: commit the NEW file content
            // directly to git, as a rebase/pull would.
            const committed = TRACKED.replace('return "hi " + name;', 'return "hi " + name; // live-head');
            writeFileSync(r.file("shadow.tmp"), committed);
            git(r.dir, "update-index", "--add", "--cacheinfo", "100644",
                execFileSync("git", ["hash-object", "-w", r.file("shadow.tmp")], { cwd: r.dir })
                    .toString()
                    .trim(),
                "greeting.js");
            git(r.dir, "commit", "-qm", "shadow-commit");

            // The diff refreshes the HEAD side by itself: the hunk is gone, the sides match
            // (the whole file is an unchanged region; the edit is hidden by its fold).
            await s.waitForText((t) => !t.includes("// live-head") && t.includes("unchanged lines"), {
                timeoutMs: 30_000,
            });
        } finally {
            await teardown();
        }
    }, 120_000);

    it("Compare New Untitled: both sides are editable, the diff is live, closing asks", async () => {
        const r = repo({ "seed.txt": "seed\n" });
        const s = await open([r.dir], r.dir, 140);
        try {
            // Under full-run load, startup and the command palette can be slow.
            await s.waitForText((t) => t.includes(explorerTitle(r.dir)), { timeoutMs: 60_000 });
            await s.key("Ctrl+P");
            await s.text(">Compare New Untitled Text Files");
            await s.waitForText((t) => t.includes("Compare New Untitled Text Files"), { timeoutMs: 15_000 });
            await s.key("Enter");
            await s.waitForText((t) => t.includes("Untitled-1 ↔ Untitled-2"), { timeoutMs: 15_000 });

            // Typing goes to the right side (focus in modified).
            await s.text("hello");
            await s.waitForText((t) => t.includes("hello"));
            // Live recompute marks the line as added: a + marker at line 1.
            await s.waitForText((t) => {
                const line = t.split("\n").find((l) => l.includes("hello"));
                return line !== undefined && line.includes("1+");
            }, { timeoutMs: 15_000 });

            // Closing a tab with an unsaved untitled side — a confirm dialog.
            await s.key("Ctrl+W");
            await s.waitForText((t) => t.includes("Untitled-2") && t.includes("ave"), { timeoutMs: 15_000 });
            await s.key("Escape");
            await s.waitForText((t) => t.includes("Untitled-1 ↔ Untitled-2"), { timeoutMs: 15_000 });
        } finally {
            await teardown();
        }
    }, 120_000);
});
