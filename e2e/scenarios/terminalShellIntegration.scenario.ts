import { explorerTitle } from "../helpers/explorerTitle.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// #1218: the shell starts with VS Code's shell integration script (injected, no user setup). The script wraps the
// prompt in OSC 633 marks — `cat -v` shows them in the frame — and defines its `__vsc_*` functions.

export default defineScenario({
    name: "terminal-shell-integration",
    title: "Terminal: bash starts with VS Code's shell integration script",
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

        await editor.sendText('echo "$PS1" | cat -v');
        await editor.sendKey("Enter");
        // `^[]633;A^G` opens the prompt, `^[]633;B^G` ends it: the marks exist only in the injected PS1.
        await editor.waitForText((t) => t.includes("633;A^G") && t.includes("633;B^G"));
        await editor.capture("prompt-marks");

        // The marker is split in the command text, so it appears whole only in the output.
        await editor.sendText('declare -F __vsc_precmd && echo vsc""-functions');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("vsc-functions"));
        await editor.capture("script-functions");
    },
});
