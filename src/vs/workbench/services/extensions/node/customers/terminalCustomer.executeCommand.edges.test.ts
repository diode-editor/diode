import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { FakeEditorTerminals } from "../../../../../../TestUtils/FakeEditorTerminals.ts";
import { findShell } from "../../../../../../TestUtils/findShell.ts";
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

// `executeCommand` at the awkward moments, against live shells injected with the shell integration script: what an
// extension sees in its start/end events and what the shell really runs.

const WAIT = { timeout: 15_000, interval: 50 };

let home: string;
const disposables: { dispose(): void }[] = [];
beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "diode-exec-edges-"));
});
afterEach(() => {
    for (const d of disposables.splice(0)) d.dispose();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

function createShell(service: TerminalService, shellPath = "/bin/bash"): number {
    return service.createInstance({
        name: path.basename(shellPath),
        shellPath,
        cwd: home,
        // Debian's `/etc/zsh/zshrc` runs `compinit` unless this is set; on a CI runner it finds "insecure directories"
        // and waits for an answer instead of drawing the prompt.
        env: {
            HOME: home,
            ZDOTDIR: home,
            XDG_CONFIG_HOME: home,
            HISTFILE: "/dev/null",
            PS1: "$ ",
            skip_global_compinit: "1",
        },
    }).id;
}

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

/** The log without the empty execution a shell reports for Ctrl+C on its prompt (upstream reports it too). */
function executions(log: readonly string[]): string[] {
    return log.filter((l) => l !== "start " && l !== "end  exit=undefined");
}

async function readAll(execution: vscode.TerminalShellExecution): Promise<string> {
    let out = "";
    for await (const data of execution.read()) out += data;
    return out;
}

describe.skipIf(process.platform === "win32")("executeCommand edges — a live bash", () => {
    // Upstream `splitAndSanitizeCommandLine` drops blank lines, and the empty command the shell reports for one is a
    // sub-execution of the pending multi-line request: one execution, ended after its last line.
    it("a blank line inside a multi-line command does not split the execution", async () => {
        const h = setup();
        const integration = integrationOf(h.ns);
        const id = createShell(h.service);
        const si = await integration;
        const line = "echo a-$((1 + 1))\n\necho b-$((1 + 2))";
        si.executeCommand(line);
        await vi.waitFor(() => {
            expect(screen(h.service, id)).toMatch(/^b-3$/mu);
        }, WAIT);
        await pause(500);
        expect(h.log).toStrictEqual([`start ${line}`, `end ${line} exit=0`]);
    }, 30_000);

    it("CRLF line endings: one execution, ended after the last line", async () => {
        const h = setup();
        const integration = integrationOf(h.ns);
        const id = createShell(h.service);
        const si = await integration;
        const line = "echo a-$((1 + 1))\r\necho b-$((1 + 2))";
        si.executeCommand(line);
        await vi.waitFor(() => {
            expect(screen(h.service, id)).toMatch(/^b-3$/mu);
        }, WAIT);
        await pause(500);
        expect(h.log).toStrictEqual([`start ${line}`, `end ${line} exit=0`]);
    }, 30_000);

    it("three lines: one execution ending after the third with its exit code", async () => {
        const h = setup();
        const integration = integrationOf(h.ns);
        createShell(h.service);
        const si = await integration;
        si.executeCommand("echo one\nfalse\necho three");
        await vi.waitFor(() => {
            expect(h.log).toStrictEqual([
                "start echo one\nfalse\necho three",
                "end echo one\nfalse\necho three exit=0",
            ]);
        }, WAIT);
    }, 30_000);

    it("while another command runs: waits for the prompt, runs once after it", async () => {
        const h = setup();
        const integration = integrationOf(h.ns);
        const id = createShell(h.service);
        const si = await integration;
        await vi.waitFor(() => {
            expect(screen(h.service, id)).toMatch(/\$ $/mu);
        }, WAIT);
        h.service.sendText(id, "sleep 1", true);
        await vi.waitFor(() => {
            expect(h.log).toStrictEqual(["start sleep 1"]);
        }, WAIT);
        si.executeCommand("echo after-$((2 + 2))");
        await vi.waitFor(() => {
            expect(h.log).toStrictEqual([
                "start sleep 1",
                "end sleep 1 exit=0",
                "start echo after-$((2 + 2))",
                "end echo after-$((2 + 2)) exit=0",
            ]);
        }, WAIT);
        expect(screen(h.service, id).match(/^after-4$/gmu)).toHaveLength(1);
    }, 30_000);

    it("two calls back to back at an idle prompt: two executions in order", async () => {
        const h = setup();
        const integration = integrationOf(h.ns);
        const id = createShell(h.service);
        const si = await integration;
        await vi.waitFor(() => {
            expect(screen(h.service, id)).toMatch(/\$ $/mu);
        }, WAIT);
        si.executeCommand("echo first");
        si.executeCommand("echo second");
        await vi.waitFor(() => {
            expect(h.log).toStrictEqual([
                "start echo first",
                "end echo first exit=0",
                "start echo second",
                "end echo second exit=0",
            ]);
        }, WAIT);
    }, 30_000);

    it("two calls as the integration comes alive: both run once, in order", async () => {
        const h = setup();
        const integration = integrationOf(h.ns);
        const id = createShell(h.service);
        const si = await integration;
        si.executeCommand("echo first");
        si.executeCommand("echo second");
        await vi.waitFor(() => {
            expect(h.log).toStrictEqual([
                "start echo first",
                "end echo first exit=0",
                "start echo second",
                "end echo second exit=0",
            ]);
        }, WAIT);
        expect(screen(h.service, id).match(/^second$/gmu)).toHaveLength(1);
    }, 30_000);

    it("a unicode command line: start and end carry it exactly", async () => {
        const h = setup();
        const integration = integrationOf(h.ns);
        createShell(h.service);
        const si = await integration;
        const out = readAll(si.executeCommand("echo 'héllo 🎉 世界'"));
        await vi.waitFor(() => {
            expect(h.log).toStrictEqual(["start echo 'héllo 🎉 世界'", "end echo 'héllo 🎉 世界' exit=0"]);
        }, WAIT);
        expect(await out).toContain("héllo 🎉 世界");
    }, 30_000);

    it("typed text with the cursor moved back to its start is cleared", async () => {
        const h = setup();
        const integration = integrationOf(h.ns);
        const id = createShell(h.service);
        const si = await integration;
        await vi.waitFor(() => {
            expect(screen(h.service, id)).toMatch(/\$ $/mu);
        }, WAIT);
        h.service.sendText(id, "xyz\x1b[D\x1b[D\x1b[D", false);
        await pause(300);
        si.executeCommand("echo ok-$((1 + 1))");
        await vi.waitFor(() => {
            expect(h.log.at(-1)).toBe("end echo ok-$((1 + 1)) exit=0");
        }, WAIT);
        expect(executions(h.log)).toStrictEqual(["start echo ok-$((1 + 1))", "end echo ok-$((1 + 1)) exit=0"]);
        expect(screen(h.service, id)).toMatch(/^ok-2$/mu);
    }, 30_000);

    it("typed text wrapping on a narrow terminal is cleared", async () => {
        const h = setup();
        const integration = integrationOf(h.ns);
        const id = createShell(h.service);
        (h.service.getInstance(id)?.session as unknown as { resize(c: number, r: number): void }).resize(20, 24);
        const si = await integration;
        await vi.waitFor(() => {
            expect(screen(h.service, id)).toMatch(/\$ $/mu);
        }, WAIT);
        h.service.sendText(id, "x".repeat(40), false);
        await pause(300);
        si.executeCommand("echo ok");
        await vi.waitFor(() => {
            expect(h.log.at(-1)).toBe("end echo ok exit=0");
        }, WAIT);
        expect(executions(h.log)).toStrictEqual(["start echo ok", "end echo ok exit=0"]);
    }, 30_000);

    it("a multi-line execution cut short by Ctrl+C ends when the next command starts", async () => {
        const h = setup();
        const integration = integrationOf(h.ns);
        const id = createShell(h.service);
        const si = await integration;
        si.executeCommand("sleep 3\necho never");
        await vi.waitFor(() => {
            expect(h.log).toStrictEqual(["start sleep 3\necho never"]);
        }, WAIT);
        await pause(300);
        h.service.sendText(id, "\x03", false);
        await pause(500);
        si.executeCommand("echo next");
        await vi.waitFor(() => {
            expect(h.log.at(-1)).toBe("end echo next exit=0");
        }, WAIT);
        expect(h.log).toStrictEqual([
            "start sleep 3\necho never",
            "end sleep 3\necho never exit=undefined",
            "start echo next",
            "end echo next exit=0",
        ]);
    }, 30_000);
});

describe.skipIf(process.platform === "win32")("executeCommand — zsh and fish", () => {
    for (const shell of [findShell("zsh"), findShell("fish")].filter((s) => s !== undefined)) {
        it(`${shell}: called as the integration comes alive runs once`, async () => {
            const h = setup();
            const integration = integrationOf(h.ns);
            const id = createShell(h.service, shell);
            const si = await integration;
            si.executeCommand("echo hi-zz");
            await vi.waitFor(() => {
                expect(h.log).toStrictEqual(["start echo hi-zz", "end echo hi-zz exit=0"]);
            }, WAIT);
            expect(screen(h.service, id).match(/^hi-zz$/gmu)).toHaveLength(1);
        }, 30_000);

        it(`${shell}: typed text is cleared`, async () => {
            const h = setup();
            const integration = integrationOf(h.ns);
            const id = createShell(h.service, shell);
            const si = await integration;
            await pause(1500);
            h.service.sendText(id, "abc", false);
            await pause(500);
            si.executeCommand("echo ok-zz");
            await vi.waitFor(() => {
                expect(screen(h.service, id)).toMatch(/^ok-zz$/mu);
            }, WAIT);
            await pause(300);
            expect(screen(h.service, id).match(/^ok-zz$/gmu)).toHaveLength(1);
            expect(screen(h.service, id)).not.toContain("abcecho");
        }, 30_000);
    }
});
