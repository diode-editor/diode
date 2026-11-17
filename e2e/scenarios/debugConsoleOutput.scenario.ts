import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The Debug Console of a live session (the Debug Demo extension's adapter): output in its ANSI colors with a link to
// the source, a group, a long line wrapped to the console's width; the filter in the title; the input completes
// through the adapter (`cf` → `cfg`) and Shift+Enter breaks its line.

const folder = resolve(repoRoot, "e2e", "fixtures", "debug-provider");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");

export default defineScenario({
    name: "debug-console-output",
    title: "Debug Console: ANSI colors, links, groups, wrapping, the filter and completion through the adapter",
    seedUserData: userData,
    open: [folder],
    cols: 120,
    rows: 40,
    async run(editor) {
        await editor.waitForText((t) => t.includes(".diode"));
        await editor.waitForReady();

        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("Pick the program to debug") && t.includes("./tests"));
        await editor.sendText("tests");
        await editor.sendKey("Enter");
        await editor.sendKey("Ctrl+k");
        await editor.sendKey("y");
        // The group is open, its lines in color with the link to hello.c; the long line takes two rows.
        await editor.waitForText(
            (t) => t.includes("PASS self-check 3/3") && t.includes("FAIL none") && t.includes("end of the long line"),
        );
        await editor.capture("ansi-and-wrap");

        // The filter: `!FAIL` hides the line it matches, the rest of the group stays (no "Showing n of m": upstream
        // counts the top-level lines only).
        await editor.clickNode("#replFilter");
        await editor.sendText("!FAIL");
        await editor.waitForText((t) => t.includes("PASS self-check 3/3") && !t.includes("FAIL none"));
        await editor.capture("filter");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => t.includes("FAIL none"));

        // The input completes through the adapter.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Debug: Focus on Debug Console View");
        await editor.waitForText((t) => t.includes("Debug: Focus on Debug Console View"));
        await editor.sendKey("Enter");
        await editor.sendText("cf");
        await editor.waitForNode("#replSuggest");
        await editor.waitForText((t) => t.split("\n").some((line) => line.includes("cfg") && !line.includes("cf ")));
        await editor.capture("completion");
        await editor.sendKey("Tab");
        await editor.sendKey("Shift+Enter");
        await editor.sendText("argc");
        await editor.capture("multi-line-input");
    },
});
