import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

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

    it("TelemetryTrustedValue — конструируемый класс с меткой эталона", () => {
        const { namespace } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk());
        const trusted = new namespace.TelemetryTrustedValue("v1");
        expect(trusted.value).toBe("v1");
        expect(trusted).toMatchObject({ isTrustedTelemetryValue: true });
    });
});
