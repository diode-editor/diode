import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { dumpFrame, frameToText } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario } from "./framework.ts";

// `diode.icons.nerdFont: off` — a terminal font without Nerd Font symbols. Every cell is checked for the Private Use
// Area: a text dump hides tofu, and a "word on the frame" check would pass with an icon next to it. Glyphs tuidom
// widgets draw themselves are covered too: folder chevrons, the read-only tab lock, completion kinds. Then the user
// setting goes back to `on` and the icons return without a restart.

const APP_TS = [
    "function main(): number {",
    "    if (process.argv.length > 2) {",
    "        return 1;",
    "    }",
    '    const broken: number = "text";',
    "    return broken;",
    "}",
    "",
].join("\n");

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "diode-nerd-font-off-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "app.ts"), APP_TS);
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "guide.md"), "# Guide\n");
    writeFileSync(join(dir, "README.md"), "# Demo\n");
    writeFileSync(join(dir, "Makefile"), "all:\n\techo build\n");
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "Test");
    git(dir, "config", "commit.gpgsign", "false");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
    return dir;
}

const repoDir = makeRepo();

function puaGlyphs(frame: GridSnapshot): string[] {
    const found = new Set<string>();
    for (const cell of frame.cells) {
        const code = cell.char.codePointAt(0) ?? 0;
        const pua = (code >= 0xe000 && code <= 0xf8ff) || code >= 0xf0000;
        if (pua) found.add(cell.char);
    }
    return [...found];
}

function expectNoPua(frame: GridSnapshot, step: string): void {
    const found = puaGlyphs(frame);
    if (found.length > 0) {
        const codes = found.map((char) => `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()}`);
        throw new Error(`nerd-font-off/${step}: Private Use Area glyphs ${codes.join(", ")}\n${dumpFrame(frame)}`);
    }
}

function lineWith(text: string, needle: string): string | undefined {
    return text.split("\n").find((line) => line.includes(needle));
}

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "nerd-font-off",
    title: "diode.icons.nerdFont: off — plain Unicode icons, no file icons, back to Nerd Font live",
    open: [repoDir, join(repoDir, "src", "app.ts")],
    settings: { "diode.icons.nerdFont": "off" },
    cols: 110,
    rows: 28,
    // The TypeScript server and git run in the extension host: the CI safety net runs this on Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        // The section chevron, folder chevrons (`src` is revealed, `docs` is collapsed), the branch in the status
        // bar and file names straight after the indent.
        await editor.waitForText(
            (t) =>
                t.includes("▾") &&
                lineWith(t, " src")?.includes("▾ src") === true &&
                lineWith(t, " docs")?.includes("▸ docs") === true &&
                t.includes("⎇ main") &&
                lineWith(t, "README.md")?.includes("  README.md") === true &&
                t.includes("Makefile"),
            { timeoutMs: 20_000 },
        );
        expectNoPua(await editor.captureFrame(), "explorer");

        await runCommand(editor, "Fold All");
        await editor.waitForText((t) => lineWith(t, "function main()")?.includes("▸") === true);
        expectNoPua(await editor.captureFrame(), "folded");

        await editor.sendKey("Ctrl+Shift+M");
        const problems = await editor.waitForText((t) => lineWith(t, "is not assignable")?.includes("✗") === true, {
            timeoutMs: 30_000,
        });
        expectNoPua(problems, "problems");

        // Completion kinds from the TypeScript server (it has answered with the diagnostics): `ƒ` for `Math.abs`.
        await runCommand(editor, "View: Focus Active Editor Group");
        await editor.sendKey("Ctrl+End");
        // Key by key: `sendText` is a bracketed paste, which opens no completion list.
        for (const key of "Math.") await editor.sendKey(key);
        const completion = await editor.waitForText((t) => lineWith(t, "abs")?.includes("ƒ  abs") === true, {
            timeoutMs: 30_000,
        });
        expectNoPua(completion, "completion");
        await editor.capture("completion");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("ƒ  abs"));
        for (let i = 0; i < 5; i++) await editor.sendKey("Backspace");

        await runCommand(editor, "File: Toggle Active Editor Read-only in Session");
        expectNoPua(await editor.waitForText((t) => t.includes("• app.ts")), "read-only");
        await editor.capture("off");

        // Back to Nerd Font through the user settings file: `"off"` → `"on"`, saved, no restart.
        await runCommand(editor, "Preferences: Open User Settings (JSON)");
        await editor.waitForText((t) => t.includes('"diode.icons.nerdFont": "off"'));
        await editor.sendKey("Ctrl+Home");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        for (let i = 0; i < 4; i++) await editor.sendKey("Backspace");
        await editor.sendText('on"');
        await editor.sendKey("Ctrl+S");
        const on = await editor.waitForText((t) => t.includes('"diode.icons.nerdFont": "on"') && !t.includes("⎇"), {
            timeoutMs: 10_000,
        });
        if (puaGlyphs(on).length === 0) {
            throw new Error(`nerd-font-off/on: no Nerd Font glyph came back\n${frameToText(on)}`);
        }
        await editor.capture("on");
    },
});
