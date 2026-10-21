import { basename } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The inspector protocol does not inject the mouse wheel yet (docs/TODO/IntegratedTerminal.md) — scroll the viewport
// with Shift+PageUp/PageDown: they go through the same `surface.scrollLines`.

export default defineScenario({
    name: "terminal-scrollback",
    title: "Integrated terminal: scrollback (Shift+PageUp)",
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
        // The directory name, not the literal "diode": in a git worktree the cwd ends differently.
        await editor.waitForText((t) => t.includes(`${basename(repoRoot)}$`) || t.includes("❯"));

        // Print far more lines than fit in the panel: the start of the output goes into scrollback and the tail stays
        // on screen. The first output line is the top marker: in the command text it is split by an empty substitution,
        // so it exists whole only in the output (the command echo may wrap past the panel edge due to the long
        // git-worktree cwd — don't rely on it).
        await editor.sendText('echo scrollback""-top; seq 1 100');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("100"));
        await editor.capture("bottom");

        // Shift+PageUp pages back through history. Press far more pages than the scrollback holds: the offset clamps to
        // the very top — a deterministic frame independent of the panel height. The first output line (the marker) is
        // visible there.
        for (let i = 0; i < 20; i++) await editor.sendKey("Shift+PageUp");
        await editor.waitForText((t) => t.includes("scrollback-top"));
        await editor.capture("scrolled");

        // Back to the bottom by paging down all the way.
        for (let i = 0; i < 20; i++) await editor.sendKey("Shift+PageDown");
        await editor.waitForText((t) => t.includes("100"));
        await editor.capture("back-to-bottom");
    },
});
