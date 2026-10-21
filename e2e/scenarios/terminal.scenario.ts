import { basename } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Ctrl+` is gated to csi-u/kitty and legacy can't encode Ctrl+Shift+P, so the palette is reached via the View menu.
// The shell's rc files may re-install a fancy prompt (starship's `❯`), so assertions lean on echoed output.

export default defineScenario({
    name: "terminal",
    title: "Integrated terminal: live shell in the TERMINAL panel",
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
        // "Command Palette..." is the first, pre-selected item.
        await editor.sendKey("Alt+V");
        await editor.waitForText((t) => t.includes("Command Palette"));
        await editor.sendKey("Enter");
        // Wait on a command entry, not the placeholder: it isn't blitted to the grid.
        await editor.waitForText((t) => t.includes("File: Save"));
        await editor.sendText("Toggle Terminal");
        await editor.waitForText((t) => t.includes("Toggle Terminal"));
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("TERMINAL"));
        // The directory name, not the literal "diode": in a git worktree the cwd ends differently.
        await editor.waitForText((t) => t.includes(`${basename(repoRoot)}$`) || t.includes("❯"));
        await editor.capture("terminal-open");

        // The shell is live: type a command and wait for its output line. In the command text the marker is split by an
        // empty substitution (diode-term""-ok), so it can appear whole ONLY in the shell output — the wait depends
        // neither on the prompt glyph nor on the command echo wrapping past the panel edge (the long git-worktree cwd
        // wrapped it and the marker never formed).
        await editor.sendText('echo diode-term""-ok');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("diode-term-ok"));
        await editor.capture("terminal-echo");
    },
});
