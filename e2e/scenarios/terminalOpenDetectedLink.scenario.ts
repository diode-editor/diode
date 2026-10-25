import { basename } from "node:path";

import { StyleFlags } from "@tuidom/core/common/styleFlags";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

const LINK = "src/vs/base/common/platform.ts:3:2";
const PLACEHOLDER = "Select the link to open, type to filter all links";

export default defineScenario({
    name: "terminal-open-detected-link",
    title: "Integrated terminal: Open Detected Link lists the printed paths, the active one is underlined, Enter opens it",
    open: [repoRoot],
    cols: 120,
    rows: 32,
    env: {
        SHELL: "/bin/bash",
        PS1: "diode$ ",
        PROMPT_COMMAND: "",
    },
    // node-pty spawns a real PTY — like terminal.scenario.ts, Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.sendKey("Alt+V");
        await editor.waitForText((t) => t.includes("Command Palette"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("File: Save"));
        await editor.sendText("Toggle Terminal");
        await editor.waitForText((t) => t.includes("Toggle Terminal"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("TERMINAL"));
        await editor.waitForText((t) => t.includes(`${basename(repoRoot)}$`) || t.includes("❯"));

        // The empty quotes split the paths in the command echo: whole links exist only in the output lines.
        await editor.sendText(
            `printf '%s\\n' "package"".json:2" "src/vs/base/common/platform"".ts:3:2" "src/vs/base/common/uri"".ts"`,
        );
        await editor.sendKey("Enter");
        const printed = await editor.waitForText((t) => t.includes(LINK) && t.includes("uri.ts\n"));
        const at = findTextCell(printed, LINK);
        if (at === null) throw new Error("the link is not on screen");

        // The scenario runs on tier legacy: Ctrl+Shift+O is Ctrl+O there, so the command comes from the palette
        // (F1 skips the shell).
        await editor.sendKey("F1");
        await editor.waitForText((t) => t.includes("File: Save"));
        await editor.sendText("Open Detected Link");
        await editor.waitForText((t) => t.includes("Terminal: Open Detected Link..."));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes(PLACEHOLDER) && t.includes("platform.ts:3:2"));
        await editor.capture("picker");

        // Bottom-up: uri.ts, platform.ts:3:2, package.json:2. The second one is underlined in the terminal.
        await editor.sendKey("ArrowDown");
        const deadline = Date.now() + 10_000;
        for (;;) {
            const frame = await editor.captureFrame();
            const style = (x: number): number => frame.cells[at.y * frame.cols + x].style;
            const underlined = Array.from({ length: LINK.length }, (_, i) => style(at.x + i)).every(
                (s) => (s & StyleFlags.Underline) !== 0,
            );
            if (underlined) break;
            if (Date.now() > deadline) throw new Error("the active link is not underlined in the terminal");
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await editor.capture("second-underlined");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("platform.ts") && t.includes("Ln 3, Col 2"));
        await editor.capture("opened");
    },
});
