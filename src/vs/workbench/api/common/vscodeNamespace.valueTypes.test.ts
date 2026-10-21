import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

describe("vscode — value types found by the surface check", () => {
    it("ConfigurationTarget is a real runtime enum with upstream values", () => {
        const { namespace } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk());
        expect(namespace.ConfigurationTarget.Global).toBe(1);
        expect(namespace.ConfigurationTarget.Workspace).toBe(2);
        expect(namespace.ConfigurationTarget.WorkspaceFolder).toBe(3);
    });

    it("TextDocumentChangeReason is a real runtime enum with upstream values", () => {
        const { namespace } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk());
        expect(namespace.TextDocumentChangeReason.Undo).toBe(1);
        expect(namespace.TextDocumentChangeReason.Redo).toBe(2);
    });

    it("TelemetryTrustedValue is a constructible class with the upstream marker", () => {
        const { namespace } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk());
        const trusted = new namespace.TelemetryTrustedValue("v1");
        expect(trusted.value).toBe("v1");
        expect(trusted).toMatchObject({ isTrustedTelemetryValue: true });
    });
});
