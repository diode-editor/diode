import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { FakeEditorTerminals } from "../../../../../../TestUtils/FakeEditorTerminals.ts";
import { createTestConfigurationService } from "../../../../../../TestUtils/testConfigurationService.ts";
import type { HostRpc, SubprocessRpc } from "../../../../api/common/extHostProtocol.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { createTerminalNamespace, type ITerminalNamespace } from "../../../../api/common/terminalNamespace.ts";
import { makeViewsHarness } from "../../../../browser/parts/views/viewsService.testUtils.ts";
import { ExtensionTerminalAdapter } from "../../../../contrib/terminal/browser/extensionTerminalAdapter.ts";
import { TerminalService } from "../../../../contrib/terminal/browser/terminalService.ts";
import { EmbeddedTerminalSession } from "../../../../contrib/terminal/node/embeddedTerminalSession.ts";
import { ExtensionPtySession } from "../../../../contrib/terminal/node/extensionPtySession.ts";

import { TerminalCustomer } from "./terminalCustomer.ts";

// `executeCommand` against a live bash injected with the shell integration script, through the host and the wire: what
// an extension (python-envs activating a venv, an agent running a command) sees and what the shell really runs.

const WAIT = { timeout: 15_000, interval: 50 };

let home: string;
const disposables: { dispose(): void }[] = [];
beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "diode-exec-home-"));
});
afterEach(() => {
    for (const d of disposables.splice(0)) d.dispose();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function setup(): { service: TerminalService; ns: ITerminalNamespace; log: string[] } {
    const views = makeViewsHarness();
    const service = new TerminalService(views.service, createTestConfigurationService({}), (o) => {
        const session = new EmbeddedTerminalSession(o);
        disposables.push(session);
        return session;
    });
    disposables.push(service);
    views.service.attachRegisteredContainers();
    const adapter = new ExtensionTerminalAdapter(
        service,
        views.service,
        (o) => new ExtensionPtySession(o),
        new FakeEditorTerminals(service),
        createTestConfigurationService({}),
    );
    const customer = new TerminalCustomer(adapter);
    const [a, b] = createInProcessChannelPair();
    disposables.push(customer.attach({ rpc: new RpcEndpoint(a) as unknown as HostRpc, logger: undefined }));
    customer.pushInitialState();
    const ns = createTerminalNamespace(new RpcEndpoint(b) as unknown as SubprocessRpc);
    const log: string[] = [];
    ns.onDidStartTerminalShellExecution(({ execution }) => {
        log.push(`start ${execution.commandLine.value}`);
    });
    ns.onDidEndTerminalShellExecution(({ execution, exitCode }) => {
        log.push(`end ${execution.commandLine.value} exit=${String(exitCode)}`);
    });
    return { service, ns, log };
}

function createBash(service: TerminalService): number {
    return service.createInstance({
        name: "bash",
        shellPath: "/bin/bash",
        cwd: home,
        env: { HOME: home, HISTFILE: "/dev/null", PS1: "$ " },
    }).id;
}

/** The integration as an extension gets it: the first `onDidChangeTerminalShellIntegration` of the terminal. */
function integrationOf(ns: ITerminalNamespace): Promise<vscode.TerminalShellIntegration> {
    return new Promise((resolve) => {
        const listener = ns.onDidChangeTerminalShellIntegration(({ shellIntegration }) => {
            listener.dispose();
            resolve(shellIntegration);
        });
    });
}

function screen(service: TerminalService, id: number): string {
    const buffer = service.getInstance(id)?.session.buffer;
    if (buffer === undefined) return "";
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
    return lines.join("\n");
}

describe.skipIf(process.platform === "win32")("executeCommand — a live bash", () => {
    it("called as the integration comes alive, while bash still starts: runs once at the prompt", async () => {
        const h = setup();
        const integration = integrationOf(h.ns);
        createBash(h.service);
        const execution = (await integration).executeCommand("echo hi-$((40 + 2))");
        await vi.waitFor(() => {
            expect(h.log).toStrictEqual(["start echo hi-$((40 + 2))", "end echo hi-$((40 + 2)) exit=0"]);
        }, WAIT);
        expect(h.log).toHaveLength(2);
        expect(execution.commandLine.value).toBe("echo hi-$((40 + 2))");
    }, 30_000);

    it("text typed on the prompt is cleared with Ctrl+C: only the command runs", async () => {
        const h = setup();
        const integration = integrationOf(h.ns);
        const id = createBash(h.service);
        const shellIntegration = await integration;
        await vi.waitFor(() => {
            expect(screen(h.service, id)).toMatch(/\$ $/mu);
        }, WAIT);
        h.service.sendText(id, "abc", false);
        await vi.waitFor(() => {
            expect(screen(h.service, id)).toMatch(/\$ abc$/mu);
        }, WAIT);
        shellIntegration.executeCommand("echo ok-$((1 + 1))");
        await vi.waitFor(() => {
            expect(h.log.at(-1)).toBe("end echo ok-$((1 + 1)) exit=0");
        }, WAIT);
        expect(h.log.filter((line) => line.startsWith("start "))).toContain("start echo ok-$((1 + 1))");
        expect(screen(h.service, id)).toMatch(/^ok-2$/mu);
        expect(screen(h.service, id)).not.toContain("abcecho");
    }, 30_000);

    it("a multi-line command is one execution: it ends after its second line", async () => {
        const h = setup();
        const integration = integrationOf(h.ns);
        const id = createBash(h.service);
        const shellIntegration = await integration;
        const execution = shellIntegration.executeCommand("echo a-$((1 + 1))\necho b-$((1 + 2)); false");
        let output = "";
        const read = (async () => {
            for await (const data of execution.read()) output += data;
        })();
        await vi.waitFor(() => {
            expect(h.log).toStrictEqual([
                "start echo a-$((1 + 1))\necho b-$((1 + 2)); false",
                "end echo a-$((1 + 1))\necho b-$((1 + 2)); false exit=1",
            ]);
        }, WAIT);
        await read;
        expect(output).toContain("a-2");
        expect(output).toContain("b-3");
        expect(screen(h.service, id)).toMatch(/^b-3$/mu);
    }, 30_000);
});
