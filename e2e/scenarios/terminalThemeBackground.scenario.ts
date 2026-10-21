import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// A theme without `terminal.background` gets the panel background, as in vscode (`panel.background`); Catppuccin Mocha
// sets only `panel.background`, and the terminal with the registry default `#181818` showed up black in the middle of
// the panel.

const MOCHA_BASE = 0x1e1e2e;

const sampleDir = mkdtempSync(join(tmpdir(), "diode-terminal-theme-bg-"));
const textFile = join(sampleDir, "notes.txt");

export default defineScenario({
    name: "terminal-theme-background",
    title: "Integrated terminal: theme background is the panel background (Catppuccin Mocha)",
    open: [sampleDir, textFile],
    installVsix: ["Catppuccin.catppuccin-vsc"],
    network: true,
    settings: { "workbench.colorTheme": "Catppuccin Mocha" },
    cols: 100,
    rows: 24,
    env: { SHELL: "/bin/bash" },
    userKeybindings: [{ key: "f9", command: "workbench.action.terminal.toggleTerminal" }],
    // node-pty spawns a real PTY — like terminal.scenario.ts, Linux only.
    skipOn: ["win32", "darwin"],
    async prepare() {
        writeFileSync(textFile, "hello\n");
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("hello"));
        await editor.sendKey("F9");
        await editor.waitForText((t) => t.includes("TERMINAL"));
        // Don't look for the prompt by text: the tmpdir path on the runner is long and wraps.
        await editor.waitForText((t) => /TERMINAL[\s\S]*\$/.test(t));

        // A cell on the right side of the panel above the status bar — the empty terminal area, not the surrounding
        // panel.
        const frame = await editor.captureFrame();
        const cell = frame.cells[(frame.rows - 2) * frame.cols + Math.floor(frame.cols * 0.75)];
        if (cell?.bg !== MOCHA_BASE) {
            throw new Error(`terminal background ${String(cell?.bg?.toString(16))}, expected Mocha panel 1e1e2e`);
        }
        await editor.capture("mocha");
    },
});
