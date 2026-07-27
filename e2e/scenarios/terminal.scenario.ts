import { basename } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Integrated terminal: the TERMINAL tab in the bottom panel hosting a live shell.
// Opened through the command palette (Show All Commands → "Toggle Terminal"). The
// Ctrl+` keybinding is gated to the csi-u/kitty tiers, and legacy-tier terminals
// can't even encode Ctrl+Shift+P — so the palette is reached tier-independently via
// the View menu (Alt+V → "Command Palette..."), the entry point that always works.
//
// Prompt determinism: we pass SHELL=/bin/bash + PS1 + empty PROMPT_COMMAND, but the
// shell's own rc files may still re-install a fancy prompt (e.g. starship's `❯`), so
// assertions stay lenient about the prompt glyph and lean on the echoed command
// output as the proof the shell is live.

export default defineScenario({
    name: "terminal",
    title: "Integrated terminal: live shell in the TERMINAL panel",
    open: [repoRoot],
    cols: 120,
    rows: 32,
    env: {
        SHELL: "/bin/bash",
        PS1: "vexx$ ",
        PROMPT_COMMAND: "",
    },
    // node-pty spawns a real PTY — Unix-only in the current packaging. On CI we only
    // run this safety net on Linux (macOS/Windows packaging is a follow-up).
    skipOn: ["win32", "darwin"],
    async run(editor) {
        // Open the command palette via the View menu (Alt+V → "Command Palette..."
        // is the first, pre-selected item) and run Toggle Terminal.
        await editor.sendKey("Alt+V");
        await editor.waitForText((t) => t.includes("Command Palette"));
        await editor.sendKey("Enter");
        // The palette renders its prompt (`>`) and the command list; wait on a stable
        // command entry rather than the placeholder (which isn't blitted to the grid).
        await editor.waitForText((t) => t.includes("File: Save"));
        await editor.sendText("Toggle Terminal");
        await editor.waitForText((t) => t.includes("Toggle Terminal"));
        await editor.sendKey("Enter");

        // The TERMINAL tab is active and the shell has rendered its prompt: either our
        // PS1 (clean CI bash) or a fancy rc-installed one (starship's `❯` locally).
        await editor.waitForText((t) => t.includes("TERMINAL"));
        // Имя каталога, а не литерал "vexx": в git-worktree cwd оканчивается иначе.
        await editor.waitForText((t) => t.includes(`${basename(repoRoot)}$`) || t.includes("❯"));
        await editor.capture("terminal-open");

        // The shell is live: type a command and wait for its output line. The typed
        // command echoes once, its output prints once — so the marker appears twice
        // (robust against the exact prompt glyph).
        await editor.sendText("echo vexx-term-ok");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.split("vexx-term-ok").length - 1 >= 2);
        await editor.capture("terminal-echo");
    },
});
