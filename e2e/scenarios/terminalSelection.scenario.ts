import { basename } from "node:path";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

type Frame = Awaited<ReturnType<ScenarioDriver["captureFrame"]>>;

async function waitForFrame(
    editor: ScenarioDriver,
    predicate: (frame: Frame) => boolean,
    what: string,
): Promise<Frame> {
    const deadline = Date.now() + 10_000;
    for (;;) {
        const frame = await editor.captureFrame();
        if (predicate(frame)) return frame;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

const FIRST = "selection-alpha";
const SECOND = "selection-beta";

export default defineScenario({
    name: "terminal-selection",
    title: "Integrated terminal: a mouse drag selects text, Ctrl+C copies it instead of SIGINT, Ctrl+V pastes it",
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

        // The empty quotes split the words in the command echo: whole, they exist only in the output lines.
        await editor.sendText(`printf '%s\\n' "selection-""alpha" "selection-""beta"`);
        await editor.sendKey("Enter");
        const printed = await editor.waitForText((t) => t.includes(FIRST) && t.includes(SECOND));
        const first = findTextCell(printed, FIRST);
        const second = findTextCell(printed, SECOND);
        if (first === null || second === null) throw new Error("the output is not on screen");
        const plainBg = printed.cells[first.y * printed.cols + first.x].bg;

        // Press on the first line's start, drag to the end of the second one.
        await editor.sendMouse({ action: "press", button: "left", x: first.x, y: first.y });
        await editor.sendMouse({ action: "move", button: "left", x: second.x + 4, y: second.y });
        await editor.sendMouse({ action: "move", button: "left", x: second.x + SECOND.length - 1, y: second.y });
        await editor.sendMouse({ action: "release", button: "left", x: second.x + SECOND.length - 1, y: second.y });
        const selected = await waitForFrame(
            editor,
            (frame) => {
                const bg = (x: number, y: number): number => frame.cells[y * frame.cols + x].bg;
                return bg(first.x, first.y) !== plainBg && bg(second.x + SECOND.length - 1, second.y) !== plainBg;
            },
            "the selection",
        );
        if (selected.cells[second.y * selected.cols + second.x + SECOND.length].bg !== plainBg) {
            throw new Error("the selection runs past the pointer");
        }
        await editor.capture("selected");

        // Ctrl+C with a selection copies and clears it; the shell gets no SIGINT (no `^C` on its line).
        await editor.sendKey("Ctrl+C");
        const cleared = await waitForFrame(
            editor,
            (frame) => frame.cells[first.y * frame.cols + first.x].bg === plainBg,
            "the selection to clear",
        );
        if (
            cleared.cells
                .map((cell) => cell.char)
                .join("")
                .includes("^C")
        ) {
            throw new Error("Ctrl+C with a selection reached the shell");
        }
        await editor.capture("copied");

        // Paste into a new untitled file: both lines are there. Alt+V would go to the shell: F1 opens the palette.
        await editor.sendKey("F1");
        await editor.waitForText((t) => t.includes("File: Save"));
        await editor.sendText("File: New Untitled File");
        await editor.waitForText((t) => t.includes("New Untitled File"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Untitled-1"));
        await editor.sendKey("Ctrl+V");
        const pasted = await editor.waitForText((t) => /1\s+selection-alpha/u.test(t) && /2\s+selection-beta/u.test(t));
        if (
            pasted.cells
                .map((cell) => cell.char)
                .join("")
                .includes("^C")
        ) {
            throw new Error("Ctrl+C with a selection reached the shell");
        }
        await editor.capture("pasted");
    },
});
