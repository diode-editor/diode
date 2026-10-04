import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

/**
 * Value-типы, которые активный `vscode.d.ts` объявлял, а шим не отдавал:
 * финальный каст корня прятал пропуск, и расширение получало `undefined` на
 * чтении `vscode.ConfigurationTarget.Global`. Теперь пропуск ловит компилятор
 * (`implementsApi<typeof vscode>`), а тест держит значения enum'ов.
 */
describe("vscode — value-типы, найденные проверкой поверхности", () => {
    it("ConfigurationTarget — настоящий runtime-enum со значениями эталона", () => {
        const { namespace } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk());
        expect(namespace.ConfigurationTarget.Global).toBe(1);
        expect(namespace.ConfigurationTarget.Workspace).toBe(2);
        expect(namespace.ConfigurationTarget.WorkspaceFolder).toBe(3);
    });

    it("TextDocumentChangeReason — настоящий runtime-enum со значениями эталона", () => {
        const { namespace } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk());
        expect(namespace.TextDocumentChangeReason.Undo).toBe(1);
        expect(namespace.TextDocumentChangeReason.Redo).toBe(2);
    });
});
