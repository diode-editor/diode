import { basename } from "node:path";

import { StyleFlags } from "@tuidom/core/common/styleFlags";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

const LINK = "src/vs/base/common/platform.ts:3:2";

export default defineScenario({
    name: "terminal-file-links",
    title: "Integrated terminal: Ctrl+hover underlines a file path, Ctrl+click opens it at line:col",
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

        // The empty quotes split the path in the command echo: the whole link exists only in the output line.
        await editor.sendText(`printf '%s\\n' "src/vs/base/common/platform"".ts:3:2"`);
        await editor.sendKey("Enter");
        const printed = await editor.waitForText((t) => t.includes(LINK));
        const at = findTextCell(printed, LINK);
        if (at === null) throw new Error("the link is not on screen");

        // Ctrl+hover: exactly the link's cells get underlined.
        await editor.sendMouse({ action: "move", x: at.x + 4, y: at.y, ctrlKey: true });
        const deadline = Date.now() + 10_000;
        for (;;) {
            const frame = await editor.captureFrame();
            const style = (x: number): number => frame.cells[at.y * frame.cols + x].style;
            const underlined = Array.from({ length: LINK.length }, (_, i) => style(at.x + i)).every(
                (s) => (s & StyleFlags.Underline) !== 0,
            );
            const after = (style(at.x + LINK.length) & StyleFlags.Underline) !== 0;
            if (underlined && !after) break;
            if (Date.now() > deadline) throw new Error("the link under the pointer is not underlined");
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await editor.capture("ctrl-hover");

        // Ctrl+click: the file opens in a tab with the cursor on 3:2.
        await editor.click(at.x + 4, at.y, { ctrlKey: true });
        await editor.waitForText((t) => t.includes("platform.ts") && t.includes("Ln 3, Col 2"));
        await editor.capture("opened");
    },
});
