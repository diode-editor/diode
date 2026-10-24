import { defineScenario, repoRoot } from "./framework.ts";

// #820: with the terminal focused, workbench shortcuts reach the shell; only the skip set
// (Quick Open, the palette…), chords and unencodable keys stay with the workbench, like VS Code.
// `cat -v` shows what the shell got: ^B, ^S and ESC f (^[f).

export default defineScenario({
    name: "terminal-keybindings-passthrough",
    title: "Terminal: Ctrl+B, Ctrl+S, Alt+F reach the shell; Ctrl+P still opens Quick Open",
    open: [repoRoot],
    cols: 120,
    rows: 32,
    env: {
        SHELL: "/bin/bash",
        PS1: "diode$ ",
        PROMPT_COMMAND: "",
    },
    // node-pty spawns a real PTY — Linux only on CI for now.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("EXPLORER"));
        // Ctrl+K T: a chord, reachable on every tier.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("t");
        await editor.waitForText((t) => t.includes("TERMINAL"));
        await editor.waitForText((t) => t.includes("$") || t.includes("❯"));

        // `stty -ixon`: otherwise the tty takes ^S as XOFF (flow control) and `cat` never sees it. Keys go
        // only after the marker (split by an empty substitution, whole only in the output): typed ahead,
        // ^S would hit the tty before `stty` ran.
        await editor.sendText('stty -ixon; echo stty""-done; cat -v');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("stty-done"));
        await editor.sendKey("Ctrl+B");
        await editor.sendKey("Ctrl+S");
        await editor.sendKey("Alt+f");
        await editor.sendKey("Enter");
        // `cat -v` prints the line back once Enter arrives: echo plus output, the marker shows twice.
        // The sidebar is still there (Ctrl+B didn't hide it), the File menu is closed (Alt+F didn't open it).
        await editor.waitForText(
            (t) => t.split("^B^S^[f").length > 2 && t.includes("EXPLORER") && !t.includes("Open Folder..."),
        );
        await editor.capture("keys-in-shell");

        await editor.sendKey("Ctrl+C");
        await editor.sendKey("Ctrl+P");
        await editor.sendText(">Toggle Primary Side Bar");
        await editor.waitForText((t) => t.includes("View: Toggle Primary Side Bar Visibility"));
        await editor.capture("quick-open-from-terminal");
    },
});
