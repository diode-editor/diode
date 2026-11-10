import { explorerTitle } from "../helpers/explorerTitle.ts";
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
        await editor.waitForText((t) => t.includes(explorerTitle(repoRoot)));

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

        // The divider left of the list is a sash: hover lights it, a drag resizes the list, a double-click fits it.
        const list = await editor.waitForNode("#terminalTabsList");
        const waitForListWidth = async (width: number): Promise<void> => {
            const deadline = Date.now() + 5000;
            for (;;) {
                const current = (await editor.waitForNode("#terminalTabsList")).box.width;
                if (current === width) return;
                if (Date.now() > deadline) throw new Error(`the tabs list is ${current} wide, expected ${width}`);
            }
        };
        const dividerX = list.box.x - 1;
        const midY = list.box.y + 2;
        // `workbench.sash.hoverDelay` defaults to 0: the line is lit at once.
        await editor.sendMouse({ action: "move", x: dividerX, y: midY });
        await editor.capture("sash-hover");

        await editor.sendMouse({ action: "press", button: "left", x: dividerX, y: midY });
        await editor.sendMouse({ action: "move", button: "left", x: dividerX - 10, y: midY });
        await editor.sendMouse({ action: "release", button: "left", x: dividerX - 10, y: midY });
        await waitForListWidth(list.box.width + 10);
        await editor.capture("sash-dragged");

        // Short names ("bash"): the fitted list is the 10-column minimum.
        await editor.click(dividerX - 10, midY);
        await editor.click(dividerX - 10, midY);
        await waitForListWidth(10);
        await editor.capture("sash-fitted");

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
