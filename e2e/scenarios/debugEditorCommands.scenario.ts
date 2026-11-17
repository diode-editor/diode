import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The editor's commands while debugging with the Debug Demo extension's `./crash` program, which stops on entry in
// `main` of `hello.c`: the editor's context menu has the debug group, Run to Cursor stops on `printf` (the cursor's
// line) and takes its breakpoint away, F10 there throws `SIGSEGV` — a badge after the line, the whole text in the
// Debug Console — and Escape closes the badge.

const folder = resolve(repoRoot, "e2e", "fixtures", "debug-provider");
const helloC = resolve(folder, "hello.c");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");

export default defineScenario({
    name: "debug-editor-commands",
    title: "Run to Cursor from the editor's context menu, the exception's badge after the line, Escape closes it",
    seedUserData: userData,
    open: [folder, helloC],
    cols: 120,
    rows: 30,
    // The glyphs as plain characters the frame text shows.
    settings: { "diode.icons.nerdFont": "off" },
    async run(editor) {
        await editor.waitForText((t) => t.includes("printf"));
        await editor.waitForReady();

        // F5 with `./crash`: the stop on entry in `main` (line 3).
        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("Pick the program to debug"));
        await editor.sendText("crash");
        await editor.waitForText((t) => t.includes("./crash"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("dap:stopped") && t.includes("➜ 3"));

        // The stop put the cursor on its line: one down is `printf` (line 4). The context menu's debug group, Run to
        // Cursor.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Shift+F10");
        await editor.waitForText((t) => t.includes("Run to Cursor") && t.includes("Evaluate in Debug Console"));
        await editor.capture("context-menu");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("Evaluate in Debug Console"));
        await editor.sendKey("F1");
        await editor.sendText("Run to Cursor");
        await editor.waitForText((t) => t.includes("Run to Cursor"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("➜ 4") && !t.includes("● 4"));
        await editor.capture("run-to-cursor");

        // F10 on `printf` throws: the badge after the line.
        await editor.sendKey("F10");
        await editor.waitForText((t) => t.includes("Exception has occurred: SIGSEGV — Invalid"));
        await editor.capture("exception");

        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("Exception has occurred: SIGSEGV —"));
        await editor.capture("closed");

        await editor.sendKey("Shift+F5");
        await editor.waitForText((t) => t.includes("dap:terminated"));
    },
});
