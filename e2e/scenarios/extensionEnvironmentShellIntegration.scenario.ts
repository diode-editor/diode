import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// #1223: an extension prepends to PATH with `applyAtShellIntegration`; the user's `.bashrc` resets PATH, yet the
// shell integration script applies the prefix after it, so the extension's directory stays first.

const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-shell-env-collection");
// The shell's home with an rc file that rebuilds PATH from scratch, as `path_helper` or a dotfiles repo would.
const home = mkdtempSync(join(tmpdir(), "diode-shell-env-home-"));
writeFileSync(join(home, ".bashrc"), "export PATH=/usr/bin:/bin\nPS1='diode$ '\n");

export default defineScenario({
    name: "extension-environment-shell-integration",
    title: "environmentVariableCollection: applyAtShellIntegration survives the PATH set in .bashrc",
    seedUserData: userData,
    open: [home],
    cols: 120,
    rows: 24,
    env: { SHELL: "/bin/bash", HOME: home, HISTFILE: "/dev/null" },
    // node-pty spawns a real PTY — Linux only on CI for now.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Shell env demo ready"), { timeoutMs: 20_000 });
        // Ctrl+K T: a chord, reachable on every tier.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("t");
        await editor.waitForText((t) => t.includes("diode$"), { timeoutMs: 15_000 });
        // `$((1))` keeps the expected text out of the echoed command line.
        await editor.sendText('echo "path$((1))=$PATH"');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("path1=/opt/shell-tools:/usr/bin:/bin"), { timeoutMs: 15_000 });
        await editor.capture("terminal");
    },
});
