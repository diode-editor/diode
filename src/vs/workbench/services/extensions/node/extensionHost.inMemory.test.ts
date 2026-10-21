import { describe, expect, it } from "vitest";

import { createExtensionTestHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// A compiled builtin reaches the subprocess as a source string (not mainPath):
// one CJS file where `require("vscode")` is replaced by a stub, node:builtins resolve
// normally, and there are no relative requires. Here such a bundle is emulated by hand.
const SOURCE = `
const vscode = require("vscode");
exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("test.inmem.echo", function (x) {
            return "inmem:" + x;
        }),
    );
};
`;

function inMemoryReg(): IExtensionRegistration {
    return {
        id: "test.inmemory",
        manifest: { name: "inmemory", publisher: "test", version: "0.0.1" },
        source: SOURCE,
        filename: "/diode/builtin/test.inmemory/out/extension.cjs",
    };
}

describe("ExtensionHost — in-memory source loading (builtin code-extensions)", () => {
    it("компилирует расширение из строки (Module._compile) и активирует его; require('vscode') работает", async () => {
        const harness = await createExtensionTestHarness({ extensions: [inMemoryReg()] });
        try {
            expect(harness.commandRegistry.has("test.inmem.echo")).toBe(true);
            const result = await harness.commandRegistry.execute("test.inmem.echo", 7);
            expect(result).toBe("inmem:7");
        } finally {
            await harness.dispose();
        }
    });

    it("отвергает регистрацию, где заданы и source, и mainPath (ровно один способ)", async () => {
        const harness = await createExtensionTestHarness();
        try {
            expect(() =>
                harness.host.registerExtension({
                    id: "test.both",
                    manifest: { name: "both", publisher: "test", version: "0.0.1" },
                    mainPath: "/nope.cjs",
                    source: SOURCE,
                    filename: "/x.cjs",
                }),
            ).toThrow(/exactly one of/);
        } finally {
            await harness.dispose();
        }
    });
});
