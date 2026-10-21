import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Keybinding reachability without extended keys (ssh + tmux, #376). The key frame is F1 after tier promotion: F1 was
// bound under `when: "tier == 'legacy'"`, a promoted tier dropped it, and Ctrl+Shift+P never made it through tmux.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "keybinding-reachability",
    title: "Keybindings work on any terminal: Explorer chord, honest labels, F1 after a tier upgrade",
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
        await editor.waitForText((t) => !t.includes("EXPLORER"));
        await editor.capture("sidebar-hidden");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("e");
        await editor.waitForText((t) => t.includes("EXPLORER") && t.includes("sample.ts"));
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

        // Ctrl+Shift+E arrives in CSI-u form, which promotes the tier to csi-u.
        await editor.sendKey("Ctrl+Shift+E");
        await editor.waitForText((t) => t.includes("csi-u"));
        await editor.capture("tier-promoted");

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.waitForText((t) => t.includes("File: Save As...") && t.includes("Ctrl+Shift+S"));
        await editor.capture("f1-after-tier-promotion");
    },
});
