import { basename } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { dumpFrame, findTextCell } from "../helpers/frame.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

function waitForFrame(
    editor: ScenarioDriver,
    predicate: (frame: GridSnapshot) => boolean,
    what: string,
): Promise<GridSnapshot> {
    return waitUntil(() => editor.captureFrame(), predicate, {
        describe: what,
        diagnose: (frame) => dumpFrame(frame as GridSnapshot),
    });
}

const LINE = "some/path/file.ts other";
const WORD = "some/path/file.ts";

export default defineScenario({
    name: "terminal-word-selection",
    title: "Integrated terminal: a double click selects a word, a triple click the line, Ctrl+C copies, Ctrl+V pastes",
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

        // The empty quotes split the line in the command echo: whole, it exists only in the output.
        await editor.sendText(`printf '%s\\n' "some/path/""file.ts other"`);
        await editor.sendKey("Enter");
        const printed = await editor.waitForText((t) => t.includes(LINE));
        const line = findTextCell(printed, LINE);
        if (line === null) throw new Error("the output is not on screen");
        const bg = (frame: GridSnapshot, x: number): number => frame.cells[line.y * frame.cols + x].bg;
        const plainBg = bg(printed, line.x);

        // A double click on `file`: the default separators keep the path one word, the space ends it.
        const file = line.x + "some/path/".length;
        for (let i = 0; i < 2; i++) {
            await editor.sendMouse({ action: "press", button: "left", x: file, y: line.y });
            await editor.sendMouse({ action: "release", button: "left", x: file, y: line.y });
        }
        const word = await waitForFrame(
            editor,
            (frame) => bg(frame, line.x) !== plainBg && bg(frame, line.x + WORD.length - 1) !== plainBg,
            "the word selected",
        );
        if (bg(word, line.x + WORD.length) !== plainBg) throw new Error("the word selection runs past the space");
        await editor.capture("word");

        // A third click in a row: the whole line.
        await editor.sendMouse({ action: "press", button: "left", x: file, y: line.y });
        await editor.sendMouse({ action: "release", button: "left", x: file, y: line.y });
        await waitForFrame(editor, (frame) => bg(frame, line.x + LINE.length - 1) !== plainBg, "the line selected");
        await editor.capture("line");

        // A double click on `other`, Ctrl+C: the word, not SIGINT.
        const other = line.x + LINE.length - 2;
        for (let i = 0; i < 2; i++) {
            await editor.sendMouse({ action: "press", button: "left", x: other, y: line.y });
            await editor.sendMouse({ action: "release", button: "left", x: other, y: line.y });
        }
        await waitForFrame(
            editor,
            (frame) => bg(frame, line.x) === plainBg && bg(frame, other) !== plainBg,
            "the other word selected",
        );
        await editor.sendKey("Ctrl+C");
        await waitForFrame(editor, (frame) => bg(frame, other) === plainBg, "the selection to clear");

        // Paste into a new untitled file. Alt+V would go to the shell: F1 opens the palette.
        await editor.sendKey("F1");
        await editor.waitForText((t) => t.includes("File: Save"));
        await editor.sendText("File: New Untitled File");
        await editor.waitForText((t) => t.includes("New Untitled File"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Untitled-1"));
        await editor.sendKey("Ctrl+V");
        await editor.waitForText((t) => /1\s+other\s*(\n|$)/mu.test(t));
        await editor.capture("pasted");
    },
});
