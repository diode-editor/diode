import { resolve } from "node:path";

import { explorerTitle } from "../helpers/explorerTitle.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Keybinding reachability without extended keys (ssh + tmux, #376): the Explorer chord and F1 work, the palette shows
// the labels a legacy terminal can type. A CSI-u key that slips through (tmux `extended-keys always`) no longer
// promotes the tier (#1049).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "keybinding-reachability",
    title: "Keybindings work on any terminal: Explorer chord, honest labels, the tier stays legacy",
    open: [repoRoot, sampleFile],
    settings: {
        // On the Windows runner the builtin TS server fails to start, and its error toast covered the palette.
        "diode.lsp.typescript.enabled": false,
    },
    cols: 110,
    rows: 26,
    async run(editor) {
        // The e2e environment is pinned to legacy, like tmux without extended keys.
        await editor.waitForText((t) => t.includes("greeting") && t.includes("legacy"));

        // Hide the sidebar so the frame shows the chord opening it.
        await editor.sendKey("Ctrl+B");
        await editor.waitForText((t) => !t.includes(explorerTitle(repoRoot)));
        await editor.capture("sidebar-hidden");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("e");
        await editor.waitForText((t) => t.includes(explorerTitle(repoRoot)) && t.includes("sample.ts"));
        await editor.capture("chord-opens-explorer");

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.waitForText((t) => t.includes("File: Save As...") && t.includes("Ctrl+K Alt+S"));
        await editor.capture("f1-on-legacy");

        await editor.sendText("format");
        await editor.waitForText((t) => t.includes("Format Document") && t.includes("Ctrl+K Ctrl+E"));
        await editor.capture("format-labels-on-legacy");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("Format Document"));

        // Ctrl+Shift+E arrives in CSI-u form; the tier stays legacy and F1 keeps the legacy labels.
        await editor.sendKey("Ctrl+Shift+E");
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.waitForText((t) => t.includes("File: Save As...") && t.includes("Ctrl+K Alt+S") && t.includes("legacy"));
        await editor.capture("f1-after-csi-u-key");
    },
});
