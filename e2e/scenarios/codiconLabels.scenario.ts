import { resolve } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { CODICON_GLYPHS } from "../../src/vs/base/common/codicons.generated.ts";
import { dumpFrame, frameLine } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// An extension's `$(name)` is replaced by a glyph everywhere the `codicon-demo` fixture writes markup.
// Assertions check cells, not words: private-use glyphs are indistinguishable in a text dump, and a "word on the
// frame" check would pass on the literal too. The input box's initial value and the log lines must carry
// `$(no-such-icon)` verbatim: they are not substituted (the value goes back to the extension, a log is not markup).

const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-codicon-demo");

/** Font character for a codicon name, from the same source of truth the substitution uses. */
function glyph(name: string): string {
    const found = CODICON_GLYPHS[name];
    if (found === undefined) throw new Error(`codicon-labels: в таблице нет значка "${name}"`);
    return found;
}

function puaOnFrame(frame: GridSnapshot): Set<string> {
    const found = new Set<string>();
    for (let y = 0; y < frame.rows; y++) {
        for (let x = 0; x < frame.cols; x++) {
            const char = frame.cells[y * frame.cols + x].char;
            const code = char.codePointAt(0);
            if (code !== undefined && code >= 0xe000 && code <= 0xf8ff) found.add(char);
        }
    }
    return found;
}

function expectGlyphs(frame: GridSnapshot, step: string, names: readonly string[]): void {
    const present = puaOnFrame(frame);
    const missing = names.filter((name) => !present.has(glyph(name)));
    if (missing.length > 0) {
        throw new Error(`codicon-labels/${step}: на кадре нет глифов ${missing.join(", ")}\n${dumpFrame(frame)}`);
    }
}

/** No `$(` markup may remain on the frame: once the glyph is there, a literal would be a second copy. */
function expectNoMarkup(frame: GridSnapshot, step: string): void {
    for (let y = 0; y < frame.rows; y++) {
        if (frameLine(frame, y).includes("$(")) {
            throw new Error(`codicon-labels/${step}: на кадре остался литерал $(…)\n${dumpFrame(frame)}`);
        }
    }
}

/** Requires verbatim text in the cells: substitution would drop an unknown name. */
function expectVerbatim(frame: GridSnapshot, step: string, needle: string): void {
    const lines: string[] = [];
    for (let y = 0; y < frame.rows; y++) lines.push(frameLine(frame, y));
    if (!lines.some((line) => line.includes(needle))) {
        throw new Error(`codicon-labels/${step}: на кадре нет дословного "${needle}"\n${dumpFrame(frame)}`);
    }
}

async function openPalette(editor: ScenarioDriver, query: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(query);
}

export default defineScenario({
    name: "codicon-labels",
    title: "Значки $(name) от расширения во всех раковинах: палитра, quick pick, поле ввода, прогресс, Output, полоса",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 24,
    // Extension host scenario: the CI safety net runs on Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        // 1. Status bar. The `$(check) Ready` item is the one sink that already
        //    worked before; here it guards against regression.
        const ready = await editor.waitForText((t) => t.includes("Ready"), { timeoutMs: 30_000 });
        expectGlyphs(ready, "status-bar", ["check"]);
        expectNoMarkup(ready, "status-bar");
        await editor.capture("status-bar");

        // 2. Palette: both the command's title AND category come from the manifest.
        //    The item label is `category: title`, with icons in both halves.
        await openPalette(editor, "Pick a Target");
        const palette = await editor.waitForText((t) => t.includes("Codicon Demo: ") && t.includes("Pick a Target"));
        expectGlyphs(palette, "palette", ["beaker", "list-selection"]);
        expectNoMarkup(palette, "palette");
        await editor.capture("palette");

        // 3. Extension quick pick: title, placeholder, labels and descriptions.
        await editor.sendKey("Enter");
        const pick = await editor.waitForText((t) => t.includes("first target") && t.includes("release"), {
            timeoutMs: 30_000,
        });
        expectGlyphs(pick, "quick-pick", ["beaker", "search", "file", "git-branch"]);
        expectNoMarkup(pick, "quick-pick");
        await editor.capture("quick-pick");
        await editor.sendKey("Escape");

        // 4. Input box: title and prompt render glyphs, while the INITIAL VALUE
        //    stays verbatim, unknown icon name included.
        await openPalette(editor, "Ask for a Port");
        await editor.sendKey("Enter");
        const input = await editor.waitForText((t) => t.includes("which port should the server use"), {
            timeoutMs: 30_000,
        });
        expectGlyphs(input, "input-box", ["edit", "info"]);
        expectVerbatim(input, "input-box", "$(no-such-icon) 8080");
        await editor.capture("input-box");
        await editor.sendKey("Escape");

        // Second showing: placeholder and validation message. It is a separate
        // command because the validation message REPLACES the prompt line, so
        // prompt and validation cannot appear on the same frame.
        await openPalette(editor, "Ask with Validation");
        await editor.sendKey("Enter");
        const empty = await editor.waitForText((t) => t.includes("for example 8080"), { timeoutMs: 30_000 });
        expectGlyphs(empty, "input-placeholder", ["edit", "search"]);
        expectNoMarkup(empty, "input-placeholder");

        await editor.sendKey("x");
        const invalid = await editor.waitForText((t) => t.includes("digits only"), { timeoutMs: 30_000 });
        expectGlyphs(invalid, "validation", ["error"]);
        expectNoMarkup(invalid, "validation");
        await editor.capture("validation");
        await editor.sendKey("Escape");

        // 5. Progress: our `withProgress` always goes to the status bar, i.e.
        //    `ProgressLocation.Window`, whose label expands icons.
        await openPalette(editor, "Codicon Demo: Reindex");
        await editor.sendKey("Enter");
        const progress = await editor.waitForText((t) => t.includes("Indexing") && t.includes("phase one"), {
            timeoutMs: 30_000,
        });
        expectGlyphs(progress, "progress", ["sync", "rocket"]);
        expectNoMarkup(progress, "progress");
        await editor.capture("progress");
        await openPalette(editor, "Codicon Demo: Stop");
        await editor.sendKey("Enter");

        // 6. The Output channel name arrives two ways at once: as the command title
        //    `Output: Show <name>` in the palette and as the item label in the channel
        //    picker. The channel's LINES stay verbatim: a log is not markup.
        await openPalette(editor, "Output: Show Codicon Demo");
        const channelCommand = await editor.waitForText((t) => t.includes("Output: Show"), { timeoutMs: 30_000 });
        expectGlyphs(channelCommand, "output-command", ["output"]);
        expectNoMarkup(channelCommand, "output-command");
        await editor.capture("output-command");
        await editor.sendKey("Escape");

        await openPalette(editor, "Codicon Demo: Show Log");
        await editor.sendKey("Enter");
        const log = await editor.waitForText((t) => t.includes("log lines stay verbatim"), { timeoutMs: 30_000 });
        expectGlyphs(log, "output-panel", ["output"]);
        expectVerbatim(log, "output-panel", "$(no-such-icon) still here");
        await editor.capture("output-panel");
    },
});
