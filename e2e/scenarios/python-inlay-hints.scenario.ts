import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// The bundled basedpyright fills in what the buffer does not have: a return type, a variable type and argument
// names. The toggle command hides them all and brings them back without restarting the server.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-python-inlay-hints-"));
const mainFile = join(sampleDir, "main.py");

const SOURCE = `def add(a: int, b: int):
    return a + b


total = add(1, 2)
`;

export default defineScenario({
    name: "python-inlay-hints",
    title: "Inlay hints from the stock basedpyright: a return type, a variable type and argument names",
    open: [sampleDir, mainFile],
    installVsix: ["detachhead.basedpyright"],
    network: true,
    cols: 80,
    rows: 16,
    // Extension host scenarios run a subprocess + a forked server — Linux only.
    skipOn: ["win32", "darwin"],
    // J: F/E/S/V/G/H are menu bar mnemonics and O is the SS3 prefix.
    userKeybindings: [{ key: "alt+j", command: "diode.editor.inlayHints.toggle" }],
    async prepare() {
        writeFileSync(mainFile, SOURCE);
    },
    async run(editor) {
        await editor.waitForText(
            (t) => t.includes("def add(a: int, b: int) -> int:") && t.includes("total: int = add(a=1, b=2)"),
            { timeoutMs: 180_000 },
        );
        await editor.capture("hints");

        await editor.waitForReady();
        await editor.sendKey("Alt+j");
        await editor.waitForText((t) => t.includes("def add(a: int, b: int):") && t.includes("total = add(1, 2)"));
        await editor.capture("toggled off");

        await editor.sendKey("Alt+j");
        await editor.waitForText((t) => t.includes("total: int = add(a=1, b=2)"));
        await editor.capture("toggled on");
    },
});
