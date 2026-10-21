import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The mac-cmd rung: keyboard OS comes from keyboard.platform, Cmd from the forced super capability.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "mac-keybindings",
    title: "Mac layout: Cmd/Option/Ctrl keybindings on the mac-cmd rung and Keyboard Doctor",
    open: [repoRoot, sampleFile],
    settings: {
        "keyboard.platform": "mac",
        "terminal.capabilities": { "extended-keys": true, super: true },
        // On the Windows runner the builtin TS server fails to start and its toasts cover the palette;
        // the e2e environment disables it only for scenarios without their own settings (appSession.ts).
        "diode.lsp.typescript.enabled": false,
    },
    userKeybindings: [{ key: "f6", command: "diode.keyboardDoctor" }],
    cols: 110,
    rows: 26,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting") && t.includes("mac-cmd"));

        await editor.sendKey("Meta+ArrowDown");
        await editor.waitForText((t) => t.includes("Ln 7, Col 1"));
        await editor.capture("cmd-down");

        await editor.sendKey("Meta+ArrowUp");
        await editor.waitForText((t) => t.includes("Ln 1, Col 1"));
        await editor.sendKey("Meta+ArrowRight");
        await editor.waitForText((t) => t.includes("Ln 1, Col 33"));

        // Not Ctrl+Left: Mission Control takes it on macOS.
        await editor.sendKey("Alt+ArrowLeft");
        await editor.waitForText((t) => t.includes("Ln 1, Col 28"));
        await editor.capture("option-word-left");

        // Not Home/End: macOS terminals scroll the buffer with them.
        await editor.sendKey("Ctrl+A");
        await editor.waitForText((t) => t.includes("Ln 1, Col 1"));
        await editor.sendKey("Ctrl+E");
        await editor.waitForText((t) => t.includes("Ln 1, Col 33"));

        await editor.sendKey("Meta+p");
        await editor.waitForText((t) => t.includes("Go to File"));
        await editor.capture("cmd-quick-open");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("Go to File"));

        await editor.sendKey("Meta+Shift+p");
        await editor.sendText("File: Save");
        await editor.waitForText((t) => t.includes("File: Save") && t.includes("⌘S"));
        await editor.capture("cmd-palette-labels");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("File: Save"));

        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("Keyboard Doctor") && t.includes("рунг: mac-cmd"));
        await editor.capture("keyboard-doctor");
    },
});
