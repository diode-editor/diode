import { join } from "node:path";

import { StyleFlags } from "@tuidom/core/common/styleFlags";

import {
    ensureGopls,
    GO_ID,
    GO_SAMPLE_DIR,
    GO_SESSION_ENV,
    GO_TOOLS_BIN,
    goToolchainMissing,
} from "../../src/TestUtils/goFixture.ts";
import { findTextCell } from "../helpers/frame.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// The fixture's interface with two implementations. The run has no graphical session, so the import link ends in the
// toast with the link copied.

const greeterFile = join(GO_SAMPLE_DIR, "greet", "greeter.go");

export default defineScenario({
    name: "go-navigation",
    title: "Go (golang.go + gopls): import link to pkg.go.dev, Go to Symbol in Editor, Implementations of an interface method",
    open: [GO_SAMPLE_DIR, greeterFile],
    installVsix: [GO_ID],
    network: true,
    requires: goToolchainMissing,
    // Pre-install gopls into the cached GOBIN; otherwise the extension would build it itself.
    async prepare() {
        ensureGopls();
    },
    env: { ...GO_SESSION_ENV, GOBIN: GO_TOOLS_BIN, DISPLAY: "", WAYLAND_DISPLAY: "" },
    userKeybindings: [{ key: "ctrl+alt+o", command: "editor.action.openLink" }],
    cols: 110,
    rows: 28,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("type Greeter interface"));

        // The file is clean, so no squiggle: the underlined import says gopls has loaded the package.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => {
                const at = findTextCell(frame, 'fmt"');
                return at !== null && (frame.cells[at.y * frame.cols + at.x].style & StyleFlags.Underline) !== 0;
            },
            { describe: 'the underline of "fmt"', timeoutMs: 180_000, intervalMs: 500 },
        );
        await editor.capture("import-link");

        // `fmt` in `import "fmt"`: line 2, character 8.
        for (let i = 0; i < 2; i++) await editor.sendKey("ArrowDown");
        for (let i = 0; i < 8; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+Alt+O");
        // The toast wraps the url onto its next row.
        await editor.waitForText((t) => t.includes("Link copied to clipboard") && t.includes("pkg.go.dev/fmt"), {
            timeoutMs: 30_000,
        });
        await editor.capture("link-copied");

        await editor.sendKey("Ctrl+Shift+O");
        await editor.waitForNode("#quickInput");
        await editor.waitForText((t) => t.includes("symbols ("), { timeoutMs: 60_000 });
        await editor.capture("go-to-symbol");
        // The list holds ten rows: the function comes into view when filtered.
        await editor.sendText("SpeakP");
        await editor.waitForText((t) => t.includes("SpeakPair"), { timeoutMs: 10_000 });
        await editor.capture("go-to-symbol-filtered");
        await editor.sendKey("Escape");

        // `Greet` in the interface: line 6, Home lands on its first character.
        for (let i = 0; i < 4; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("Home");
        await editor.sendKey("Ctrl+F12");
        await editor.waitForText((t) => t.includes("Implementations") && t.includes("2 results in 1 file"), {
            timeoutMs: 60_000,
        });
        await editor.capture("implementations");

        // gopls also answers with runtime symbols like `heldLockInfo`: Enter takes the first row, the exact name.
        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        await editor.sendText("#Hello");
        await editor.waitForText((t) => t.includes("greet/greet.go"), { timeoutMs: 60_000 });
        await editor.capture("workspace-symbols");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("strings.ToUpper(name)"), { timeoutMs: 30_000 });
        await editor.capture("workspace-symbol-opened");
    },
});
