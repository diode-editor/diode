import { describe, expect, it } from "vitest";

import { createExtensionTestHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// Скомпилированный builtin приезжает в subprocess строкой-исходником (не mainPath):
// один CJS-файл, где `require("vscode")` подменяет стаб, node:builtins резолвятся
// штатно, относительных require нет. Здесь эмулируем такой бандл вручную.
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
            // Полная цепочка: команда исполнилась в субпроцессе → значит модуль
            // скомпилирован в памяти и его require("vscode") резолвнулся в стаб.
            const result = await harness.commandRegistry.execute("test.inmem.echo", 7);
            expect(result).toBe("inmem:7");
        } finally {
            await harness.dispose();
        }
    });

    it("отвергает регистрацию, где заданы и source, и mainPath (ровно один способ)", async () => {
        const harness = await createExtensionTestHarness();
        try {
            // Инвариант source XOR mainPath проверяется синхронно на регистрации.
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
