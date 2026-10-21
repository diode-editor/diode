import { resolve } from "node:path";

import { frameLine } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The Claude Code layout: `claude` runs in a terminal tab beside the file and keeps focus while the agent
// works. The terminal's group locks itself (`workbench.editor.autoLockGroups`), so a file opened now lands in
// the file's group, not next to the terminal. Commands go through user keybindings: the terminal would take
// Ctrl+P and F1 for the shell.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const TAB_ROW = 1;
/** nf-cod-lock: the Unlock Group button. */
const LOCK = "";

const tabRow = (text: string): string => text.split("\n")[TAB_ROW] ?? "";

export default defineScenario({
    name: "editor-group-lock",
    title: "Locked editor group: a terminal beside the file keeps files out of its group",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 24,
    env: {
        SHELL: "/bin/bash",
        PS1: "diode$ ",
        PROMPT_COMMAND: "",
    },
    // A real PTY is Linux-only on CI, as in terminal.scenario.ts.
    skipOn: ["win32", "darwin"],
    userKeybindings: [
        { key: "ctrl+alt+t", command: "workbench.action.createTerminalEditorSide" },
        { key: "ctrl+alt+o", command: "workbench.action.quickOpen" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Ctrl+Alt+T");
        const locked = await editor.waitForText((t) => tabRow(t).includes(LOCK));
        const lockedRow = frameLine(locked, TAB_ROW);
        if (lockedRow.indexOf(LOCK) < lockedRow.indexOf("sample.ts")) {
            throw new Error("the unlock button is not in the terminal's group");
        }
        await editor.capture("terminal-locked");

        await editor.sendKey("Ctrl+Alt+O");
        await editor.waitForText((t) => t.includes("Go to File"));
        await editor.sendText("GOAL.md");
        await editor.waitForText((t) => t.includes("GOAL.md"));
        await editor.sendKey("Enter");
        const opened = await editor.waitForText((t) => tabRow(t).includes("GOAL.md"));
        const row = frameLine(opened, TAB_ROW);
        // Both files share the left group; the lock and the terminal stay to the right of them.
        if (!(row.indexOf("sample.ts") < row.indexOf("GOAL.md") && row.indexOf("GOAL.md") < row.indexOf(LOCK))) {
            throw new Error(`GOAL.md did not open in the file's group: ${row}`);
        }
        await editor.capture("file-in-file-group");
    },
});
