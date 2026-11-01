import { join } from "node:path";

import {
    ensureGopls,
    GO_ID,
    GO_SAMPLE_DIR,
    GO_SESSION_ENV,
    GO_TOOLS_BIN,
    goToolchainMissing,
} from "../../src/TestUtils/goFixture.ts";

import { frameToText } from "../helpers/frame.ts";

import { defineScenario, type ScenarioDriver } from "./framework.ts";

// Nothing is saved: the fixture is committed. `main.go` opens after the extension is up, so its hints also cover
// the file that was not yet synced when its editor was built.

async function clickText(editor: ScenarioDriver, text: string): Promise<void> {
    const rows = frameToText(await editor.captureFrame()).split("\n");
    const y = rows.findIndex((row) => row.includes(text));
    if (y < 0) throw new Error(`"${text}" is not on the frame`);
    await editor.click(rows[y].indexOf(text), y);
}

export default defineScenario({
    name: "go-lens-hints",
    title: "Go (golang.go + gopls): run test lens, its click, debug test toast, inlay hints",
    open: [GO_SAMPLE_DIR, join(GO_SAMPLE_DIR, "greet", "greet_test.go")],
    installVsix: [GO_ID],
    network: true,
    requires: goToolchainMissing,
    // Pre-install gopls into the cached GOBIN; otherwise the extension would build it itself.
    async prepare() {
        ensureGopls();
    },
    env: { ...GO_SESSION_ENV, GOBIN: GO_TOOLS_BIN },
    settings: { "go.inlayHints.parameterNames": true, "go.inlayHints.assignVariableTypes": true },
    cols: 110,
    rows: 28,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("run test | debug test"), { timeoutMs: 180_000 });
        await editor.waitForText((t) => t.includes('Hello(name: "x")'), { timeoutMs: 60_000 });
        await editor.capture("lenses and hints");

        await clickText(editor, "run test");
        await editor.waitForText((t) => t.includes("example.com/hello/greet"), { timeoutMs: 120_000 });
        await editor.capture("go test in the Go Tests channel");

        await clickText(editor, "debug test");
        // A short piece: the toast wraps its message.
        await editor.waitForText((t) => t.includes("starting a debug"), { timeoutMs: 30_000 });
        await editor.capture("debug test is a toast");

        await clickText(editor, "main.go");
        await editor.waitForText((t) => t.includes('msg string := greet.Hello(name: "world")'), { timeoutMs: 60_000 });
        await editor.capture("hints in a file opened later");
    },
});
