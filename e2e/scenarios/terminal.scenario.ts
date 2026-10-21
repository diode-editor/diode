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
        // Имя каталога, а не литерал "diode": в git-worktree cwd оканчивается иначе.
        await editor.waitForText((t) => t.includes(`${basename(repoRoot)}$`) || t.includes("❯"));
        await editor.capture("terminal-open");

        // The shell is live: type a command and wait for its output line. В тексте
        // команды маркер разорван пустой подстановкой (diode-term""-ok), поэтому
        // целиком он может появиться ТОЛЬКО в выводе шелла — ожидание не зависит
        // ни от глифа промпта, ни от переноса эхо-команды через край панели
        // (длинный cwd git-worktree переносил её и маркер не собирался).
        await editor.sendText('echo diode-term""-ok');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("diode-term-ok"));
        await editor.capture("terminal-echo");
    },
});
