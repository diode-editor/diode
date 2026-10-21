import { defineScenario, repoRoot } from "./framework.ts";

// Commands are on F keys: the legacy tier cannot encode Ctrl+` and Ctrl+Shift+\, and the menu bar keeps focus in the
// menu. Markers in the output are split by an empty substitution (`""`) so they appear whole only in the shell output.

const rowOf = (n: number): string => `#terminalTab-${n}`;

export default defineScenario({
    name: "terminal-tabs",
    title: "Integrated terminal: several shells, tabs list, switch and kill",
    open: [repoRoot],
    cols: 120,
    rows: 32,
    env: {
        SHELL: "/bin/bash",
        PS1: "diode$ ",
        PROMPT_COMMAND: "",
    },
    userKeybindings: [
        { key: "f6", command: "workbench.action.terminal.toggleTerminal" },
        { key: "f7", command: "workbench.action.terminal.new" },
        { key: "f8", command: "workbench.action.terminal.focusTabs" },
    ],
    // node-pty is Unix-only in the current packaging (as in terminal.scenario.ts).
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("EXPLORER"));

        // First shell: no list; the active terminal's name is in the tab title.
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("TERMINAL"));
        await editor.sendText('echo shell""-one');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("shell-one"));
        await editor.capture("single");

        // Two more — a list of three tabs appears on the right.
        await editor.sendKey("F7");
        await editor.sendKey("F7");
        await editor.waitForNode(rowOf(3));
        await editor.sendText('echo shell""-three');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("shell-three"));
        await editor.capture("three-tabs");

        // Click the first row — the first shell is back on screen.
        await editor.clickNode(rowOf(1));
        await editor.waitForText((t) => t.includes("shell-one") && !t.includes("shell-three"));
        await editor.capture("switched");

        // Focus the list and press Delete — the first shell is killed, two remain in the list. Keys arrive in order:
        // Delete is already handled in the list.
        await editor.sendKey("F8");
        await editor.sendKey("Delete");
        // The second shell became active — the first one's output is gone from the screen.
        await editor.waitForText((t) => !t.includes("shell-one"));
        await editor.capture("killed");

        // One more Delete — a single shell remains: the list hides and the name moves to the title.
        await editor.sendKey("Delete");
        await editor.waitForNode("#terminalActiveTab");
        await editor.capture("back-to-single");
    },
});
