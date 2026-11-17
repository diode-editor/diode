import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The kinds of breakpoints with the Debug Demo extension, whose pretend program logs its logpoints and passes the
// breakpoints whose condition does not hold: "Debug: Add Logpoint..." on `printf` opens the breakpoint widget — the
// input line with the kinds under it — and the message is typed; "Debug: Add Conditional Breakpoint..." on `return`
// takes `argc > 5`, and the arrows switch the same breakpoint to a hit count and back; BREAKPOINTS tells the log
// message and the condition; F5 logs the message with `argc` interpolated and does not stop at the breakpoint whose
// condition is false; Edit Breakpoint changes the condition to `argc > 1`, and the next run stops there.

const folder = resolve(repoRoot, "e2e", "fixtures", "debug-provider");
const helloC = resolve(folder, "hello.c");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");

export default defineScenario({
    name: "debug-breakpoint-kinds",
    title: "Logpoints and conditional breakpoints: the breakpoint widget, the BREAKPOINTS rows, a run that logs and passes",
    seedUserData: userData,
    open: [folder, helloC],
    cols: 120,
    rows: 32,
    // The glyphs as plain characters the frame text shows.
    settings: { "diode.icons.nerdFont": "off" },
    async run(editor) {
        await editor.waitForText((t) => t.includes("printf"));
        await editor.waitForReady();

        const palette = async (title: string): Promise<void> => {
            await editor.sendKey("F1");
            await editor.waitForNode("#quickInput");
            await editor.sendText(title);
            await editor.waitForText((t) => t.includes(title));
            await editor.sendKey("Enter");
        };

        // The cursor on `printf` (line 4): a logpoint.
        for (let i = 0; i < 3; i++) await editor.sendKey("ArrowDown");
        await palette("Debug: Add Logpoint...");
        await editor.waitForText((t) => t.includes("Wait for Breakpoint"));
        await editor.sendText("argc is {argc}");
        await editor.capture("logpoint-widget");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("Wait for Breakpoint"));

        // On `return` (line 5): a conditional breakpoint; the arrows show the hit count, empty, and come back.
        await editor.sendKey("ArrowDown");
        await palette("Debug: Add Conditional Breakpoint...");
        await editor.waitForText((t) => t.includes("Wait for Breakpoint"));
        await editor.sendText("argc > 5");
        await editor.sendKey("ArrowDown");
        await editor.waitForText((t) => t.includes("Break when hit count condition is met"));
        await editor.capture("kind-switched");
        await editor.sendKey("ArrowUp");
        await editor.waitForText((t) => t.includes("argc > 5") && !t.includes("Break when hit count"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("Wait for Breakpoint"));

        // Ctrl+K B shows Run and Debug.
        await editor.sendKey("Ctrl+k");
        await editor.sendKey("b");
        await editor.waitForText((t) => t.includes('log "') && t.includes("if argc"));
        await editor.capture("breakpoints-view");

        // F5: the logpoint logs, the false condition is passed: the program stops on entry.
        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("Pick the program to debug"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("dap:stopped") && t.includes("argc is 2"));
        await editor.capture("logged-and-passed");
        await editor.sendKey("Shift+F5");
        await editor.waitForText((t) => t.includes("dap:terminated"));

        // Edit Breakpoint on `return`: the condition comes in the line; `argc > 1` holds, the next run stops there.
        // The stop on entry put the cursor on `main` (line 3).
        await editor.sendKey("Ctrl+1");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await palette("Debug: Edit Breakpoint");
        await editor.waitForText((t) => t.includes("Wait for Breakpoint") && t.includes("argc > 5"));
        await editor.sendKey("Backspace");
        await editor.sendText("1");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("Wait for Breakpoint"));
        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("Pick the program to debug"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("dap:stopped") && t.includes("◉ 5"));
        await editor.capture("stopped-on-condition");
        await editor.sendKey("Shift+F5");
        await editor.waitForText((t) => t.includes("dap:terminated"));
    },
});
