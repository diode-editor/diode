import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

/** Claude Code подписывается на `onDidChangeTerminalShellIntegration`: без подписки падал запуск CLI в терминале. */
describe("window — события shell integration", () => {
    it("подписка на все три события проходит и снимается; новый терминал без shellIntegration", () => {
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

    it("TerminalShellExecutionCommandLineConfidence — значения эталона", () => {
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
