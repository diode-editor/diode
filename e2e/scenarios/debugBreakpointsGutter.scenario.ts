import { resolve } from "node:path";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Breakpoints in the editor's glyph lane with the Debug Demo extension, whose `contributes.breakpoints` allows them
// in C: F9 sets one on the cursor's line, a line typed above moves it, a click on the empty lane adds another and a
// click on its glyph removes it; F5 stops on the breakpoint, the editor shows the line highlighted with the frame's
// glyph combined with the breakpoint's.

const folder = resolve(repoRoot, "e2e", "fixtures", "debug-provider");
const helloC = resolve(folder, "hello.c");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");

export default defineScenario({
    name: "debug-breakpoints-gutter",
    title: "Breakpoints in the gutter: F9, a line typed above moves it, a click adds and removes, F5 stops on it",
    seedUserData: userData,
    open: [folder, helloC],
    cols: 120,
    rows: 30,
    // The glyphs as plain characters the frame text shows.
    settings: { "diode.icons.nerdFont": "off" },
    async run(editor) {
        await editor.waitForText((t) => t.includes("printf"));
        await editor.waitForReady();

        // The cursor on `printf` (line 4), then F9.
        for (let i = 0; i < 3; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("F9");
        await editor.waitForText((t) => t.includes("● 4"));
        await editor.capture("f9");

        // A line typed at the top: the breakpoint rides `printf` to line 5; undo brings it back.
        await editor.sendKey("Ctrl+Home");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("● 5") && !t.includes("● 4"));
        await editor.capture("moved-with-its-line");
        await editor.sendKey("Ctrl+z");
        await editor.waitForText((t) => t.includes("● 4"));

        // A click on the empty lane of `int main` (line 3) adds a breakpoint there, a click on its glyph removes it.
        // The lane's column is the one of the glyph on line 4.
        const frame = await editor.captureFrame();
        const glyph = findTextCell(frame, "● 4");
        const main = findTextCell(frame, "int main");
        if (glyph === null || main === null) throw new Error("line 3 or the glyph of line 4 is not on screen");
        await editor.click(glyph.x, main.y);
        await editor.waitForText((t) => t.includes("● 3"));
        await editor.capture("clicked");
        await editor.click(glyph.x, main.y);
        await editor.waitForText((t) => !t.includes("● 3") && t.includes("● 4"));

        // F5: the extension's quick pick, then the stop on the breakpoint at `printf`.
        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("Pick the program to debug"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("dap:stopped") && t.includes("◉ 4"));
        await editor.capture("stopped-on-breakpoint");

        await editor.sendKey("Shift+F5");
        await editor.waitForText((t) => t.includes("dap:terminated") && t.includes("● 4"));
    },
});
