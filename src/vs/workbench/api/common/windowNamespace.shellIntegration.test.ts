import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

/** Claude Code subscribes to `onDidChangeTerminalShellIntegration`: without it, launching the CLI in a terminal failed. */
describe("window — shell integration events", () => {
    it("subscribing to all three events works and is disposed; a new terminal has no shellIntegration", () => {
        const stub = makeStubRpc();
        const { window } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace;
        const subs = [
            window.onDidChangeTerminalShellIntegration(() => undefined),
            window.onDidStartTerminalShellExecution(() => undefined),
            window.onDidEndTerminalShellExecution(() => undefined),
        ];
        const terminal = window.createTerminal({ name: "t" });
        expect(terminal.shellIntegration).toBeUndefined();
        for (const sub of subs) {
            expect(() => {
                sub.dispose();
            }).not.toThrow();
        }
    });

    it("TerminalShellExecutionCommandLineConfidence has upstream values", () => {
        const { TerminalShellExecutionCommandLineConfidence } = buildVscodeNamespace(
            makeStubRpc().rpc,
            createNodeExtHostDisk(),
        ).namespace;
        expect([
            TerminalShellExecutionCommandLineConfidence.Low,
            TerminalShellExecutionCommandLineConfidence.Medium,
            TerminalShellExecutionCommandLineConfidence.High,
        ]).toEqual([0, 1, 2]);
    });
});
