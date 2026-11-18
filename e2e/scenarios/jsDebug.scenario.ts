import { cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Stock js-debug from the marketplace debugs Node.js: F9 on a line of app.js, F5 without launch.json picks Node.js and
// stops there with VARIABLES and CALL STACK filled, Continue runs to the end; `node app.js` in the JavaScript Debug
// Terminal stops at the same breakpoint; Debug: Toggle Auto Attach turns on Smart, its status bar item shows up, and
// `node app.js` in a plain new terminal stops there too.

const projectRoot = join(tmpdir(), "diode-scenario-js-debug");
/** `const sum = a + b;` in add(): the gutter shows the line number after the breakpoint glyph. */
const stoppedInAdd = (t: string): boolean => /◉\s+4 /u.test(t) && t.includes("a: 2") && t.includes("global.add");
/** A fresh terminal in front: its prompt, and no output of the previous run. */
const shellPrompt = (t: string): boolean => /\$\s/u.test(t) && !t.includes("total 5");

export default defineScenario({
    name: "js-debug",
    title: "JavaScript Debugger from the marketplace: F5 on app.js, the JavaScript Debug Terminal, auto attach",
    open: [projectRoot, join(projectRoot, "app.js")],
    installVsix: ["ms-vscode.js-debug"],
    network: true,
    cols: 140,
    rows: 50,
    // Extension host scenarios run a subprocess and a shell in the terminal: Linux only, as codelldb.
    skipOn: ["win32", "darwin"],
    // The glyphs as plain characters the frame text shows.
    settings: { "diode.icons.nerdFont": "off" },
    timeoutMs: 300_000,
    prepare() {
        rmSync(projectRoot, { recursive: true, force: true });
        cpSync(join(repoRoot, "e2e", "fixtures", "jsDebugSample"), projectRoot, { recursive: true });
        return Promise.resolve();
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("const sum = a + b;"));
        await editor.waitForReady();

        for (let i = 0; i < 3; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("F9");
        await editor.waitForText((t) => /●\s+4 /u.test(t));

        // No launch.json: F5 asks which debugger, Node.js first.
        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("Select debugger") && t.includes("Node.js"), { timeoutMs: 60_000 });
        await editor.sendKey("Enter");
        await editor.waitForText(stoppedInAdd, { timeoutMs: 60_000 });
        await editor.capture("launch-stopped");

        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("total 5") && !t.includes("◉"), { timeoutMs: 30_000 });

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Debug: JavaScript Debug Terminal");
        await editor.waitForText((t) => t.includes("JavaScript Debug Terminal"));
        await editor.sendKey("Enter");
        await editor.waitForText(shellPrompt, { timeoutMs: 30_000 });
        await editor.sendText("node app.js");
        await editor.sendKey("Enter");
        await editor.waitForText(stoppedInAdd, { timeoutMs: 60_000 });
        await editor.capture("debug-terminal");
        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("total 5") && !t.includes("◉"), { timeoutMs: 30_000 });

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Debug: Toggle Auto Attach");
        await editor.waitForText((t) => t.includes("Toggle Auto Attach"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Auto attach when running scripts that aren't in a node_modules"));
        await editor.sendText("Smart");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Auto Attach: Smart"), { timeoutMs: 30_000 });

        // The variables reach new terminals only.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Terminal: Create New Terminal");
        await editor.waitForText((t) => t.includes("Create New Terminal"));
        await editor.sendKey("Enter");
        await editor.waitForText(shellPrompt, { timeoutMs: 30_000 });
        await editor.sendText("node app.js");
        await editor.sendKey("Enter");
        await editor.waitForText(stoppedInAdd, { timeoutMs: 60_000 });
        await editor.capture("auto-attach");
        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("total 5") && !t.includes("◉"), { timeoutMs: 30_000 });
    },
});
