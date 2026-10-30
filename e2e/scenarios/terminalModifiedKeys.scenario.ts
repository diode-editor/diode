import { explorerTitle } from "../helpers/explorerTitle.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// #856: keys with modifiers reach the program in the terminal encoded like xterm.js (VS Code): Shift+Tab is
// CSI Z, Ctrl+Left CSI 1;5D, F5 CSI 15~; with application cursor keys on, a bare ArrowUp is SS3 A.
// `od -c` prints the bytes it got once Ctrl+D ends the line.

export default defineScenario({
    name: "terminal-modified-keys",
    title: "Terminal: Shift+Tab, Ctrl+Left and F5 reach the program as xterm.js sends them",
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
        await editor.waitForText((t) => t.includes(explorerTitle(repoRoot)));
        // Ctrl+K T: a chord, reachable on every tier.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("t");
        await editor.waitForText((t) => t.includes("TERMINAL"));
        await editor.waitForText((t) => t.includes("$") || t.includes("❯"));

        // Keys go only after the marker (split by an empty substitution, whole only in the output).
        await editor.sendText('echo od""-ready; od -c');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("od-ready"));
        await editor.sendKey("Shift+Tab");
        await editor.sendKey("Ctrl+ArrowLeft");
        await editor.sendKey("F5");
        await editor.sendKey("Enter");
        await editor.sendKey("Ctrl+D");
        await editor.waitForText((t) => t.includes("033   [   Z 033   [   1   ;   5   D 033   [   1   5   ~  \\n"));
        await editor.capture("modified-keys");

        await editor.sendText(`printf '\\e[?1h'; echo app""-cursor; od -c`);
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("app-cursor"));
        await editor.sendKey("ArrowUp");
        await editor.sendKey("Enter");
        await editor.sendKey("Ctrl+D");
        await editor.waitForText((t) => t.includes("033   O   A  \\n"));
        await editor.capture("application-cursor-keys");
    },
});
