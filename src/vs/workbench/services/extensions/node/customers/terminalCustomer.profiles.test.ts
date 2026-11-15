import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { FakeEditorTerminals } from "../../../../../../TestUtils/FakeEditorTerminals.ts";
import { FakeExtensionPtySession } from "../../../../../../TestUtils/FakeExtensionPtySession.ts";
import { FakeTerminalSurface } from "../../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTestConfigurationService } from "../../../../../../TestUtils/testConfigurationService.ts";
import type { HostRpc, SubprocessRpc } from "../../../../api/common/extHostProtocol.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { createTerminalNamespace } from "../../../../api/common/terminalNamespace.ts";
import { EventEmitter, TerminalProfile } from "../../../../api/common/vscodeTypes.ts";
import { makeViewsHarness } from "../../../../browser/parts/views/viewsService.testUtils.ts";
import { ExtensionTerminalAdapter } from "../../../../contrib/terminal/browser/extensionTerminalAdapter.ts";
import { TerminalProfileService } from "../../../../contrib/terminal/browser/terminalProfileService.ts";
import { TerminalService } from "../../../../contrib/terminal/browser/terminalService.ts";
import type { IExtensionTerminalProfile } from "../../../../contrib/terminal/common/terminalExtensionPoints.ts";

import { TerminalCustomer } from "./terminalCustomer.ts";

/** The in-process pair sends via a microtask. */
async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

const PROFILE: IExtensionTerminalProfile = { extensionIdentifier: "test.profiles", id: "demo", title: "Demo" };

function setup() {
    const views = makeViewsHarness();
    const service = new TerminalService(
        views.service,
        createTestConfigurationService({}),
        (o) => new FakeTerminalSurface(o.shell ?? "/bin/bash", 500),
    );
    views.service.attachRegisteredContainers();
    const ptySessions: FakeExtensionPtySession[] = [];
    const editorTerminals = new FakeEditorTerminals(service);
    const adapter = new ExtensionTerminalAdapter(
        service,
        views.service,
        (o) => {
            const session = new FakeExtensionPtySession(o);
            ptySessions.push(session);
            return session;
        },
        editorTerminals,
        createTestConfigurationService({}),
    );
    const profiles = new TerminalProfileService();
    const customer = new TerminalCustomer(adapter, profiles);
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a) as unknown as HostRpc;
    const subRpc = new RpcEndpoint(b) as unknown as SubprocessRpc;
    const ns = createTerminalNamespace(subRpc);
    const attached = customer.attach({ rpc: hostRpc, logger: undefined });
    customer.pushInitialState();
    return { service, ptySessions, profiles, ns, attached, subRpc, editorTerminals };
}

function ptyProfile(name: string, opened: string[]): vscode.TerminalProfileProvider {
    return {
        provideTerminalProfile: () =>
            new TerminalProfile({
                name,
                pty: {
                    onDidWrite: new EventEmitter<string>().event,
                    open: () => {
                        opened.push(name);
                    },
                    close: () => undefined,
                },
            }),
    };
}

describe("contributed terminal profiles — over the wire", () => {
    it("a provider registered by the extension creates its pty terminal in the panel, and the pty opens", async () => {
        const h = setup();
        const opened: string[] = [];
        h.ns.registerProfileProvider("demo", ptyProfile("Demo Pty", opened));
        await flush();

        await h.profiles.createContributedTerminalProfile(PROFILE, "panel");
        await flush();

        expect(h.service.getInstances().map((instance) => instance.title)).toStrictEqual(["Demo Pty"]);
        expect(h.service.getActiveInstance()?.title).toBe("Demo Pty");
        expect(h.ptySessions).toHaveLength(1);
        expect(opened).toStrictEqual(["Demo Pty"]);
        h.service.dispose();
    });

    it("the editor target puts the profile's terminal into the editor area", async () => {
        const h = setup();
        h.ns.registerProfileProvider("demo", {
            provideTerminalProfile: () => new TerminalProfile({ name: "In Editor", shellPath: "/bin/zsh" }),
        });
        await flush();
        await h.profiles.createContributedTerminalProfile(PROFILE, "editor");
        await flush();
        expect(h.service.getInstances()).toStrictEqual([]);
        expect(h.service.getEditorInstances().map((instance) => instance.title)).toStrictEqual(["In Editor"]);
        h.service.dispose();
    });

    it("the subprocess's rejection reaches the caller with its message", async () => {
        const h = setup();
        h.ns.registerProfileProvider("demo", { provideTerminalProfile: () => undefined });
        await flush();
        await expect(h.profiles.createContributedTerminalProfile(PROFILE, "panel")).rejects.toThrow(
            'No terminal profile options provided for id "demo"',
        );
        h.service.dispose();
    });

    it("unregistering, a junk notification, and the subprocess's death all leave no provider behind", async () => {
        const h = setup();
        const registration = h.ns.registerProfileProvider("demo", ptyProfile("A", []));
        h.subRpc.notify("terminal.registerProfileProvider", { id: 7 } as never);
        h.subRpc.notify("terminal.unregisterProfileProvider", null as never);
        await flush();
        registration.dispose();
        await flush();
        await expect(h.profiles.createContributedTerminalProfile(PROFILE, "panel")).rejects.toThrow(
            'No terminal profile provider registered for id "demo"',
        );

        h.ns.registerProfileProvider("demo", ptyProfile("B", []));
        await flush();
        h.attached.dispose();
        await expect(h.profiles.createContributedTerminalProfile(PROFILE, "panel")).rejects.toThrow(
            'No terminal profile provider registered for id "demo"',
        );
        h.service.dispose();
    });

    // The RPC endpoint swallows a handler's throw, and the subprocess itself refuses an unregistered id with the
    // same message, so the host's own bookkeeping is pinned with the handlers called directly.
    function directHandlers(): { rpc: HostRpc; call: (method: string, params: unknown) => void } {
        const handlers = new Map<string, (params: unknown) => void>();
        const rpc = {
            handleNotification: (method: string, handler: (params: unknown) => void) => {
                handlers.set(method, handler);
                return { dispose: () => undefined };
            },
            handleRequest: () => ({ dispose: () => undefined }),
        } as unknown as HostRpc;
        return {
            rpc,
            call: (method, params) => {
                const handler = handlers.get(method);
                if (handler === undefined) throw new Error(`no handler for ${method}`);
                handler(params);
            },
        };
    }

    it("the host registers and unregisters by id; junk neither throws nor reaches the profile service", () => {
        const { rpc, call } = directHandlers();
        const log: string[] = [];
        const customer = new TerminalCustomer(undefined, {
            registerProvider: (id) => {
                log.push(`register ${id}`);
                return { dispose: () => log.push(`dispose ${id}`) };
            },
        });
        customer.attach({ rpc, logger: undefined });
        for (const junk of [null, 7, { id: 7 }, {}]) {
            expect(() => {
                call("terminal.registerProfileProvider", junk);
            }).not.toThrow();
            expect(() => {
                call("terminal.unregisterProfileProvider", junk);
            }).not.toThrow();
        }
        call("terminal.registerProfileProvider", { id: "ok" });
        call("terminal.unregisterProfileProvider", { id: "ok" });
        expect(log).toStrictEqual(["register ok", "dispose ok"]);
    });

    it("without a profile sink the registrations are not listened to", () => {
        const { rpc, call } = directHandlers();
        new TerminalCustomer(undefined).attach({ rpc, logger: undefined });
        expect(() => {
            call("terminal.registerProfileProvider", { id: "ok" });
        }).toThrow("no handler for terminal.registerProfileProvider");
    });

    it("a repeated registration of the same id replaces the host's entry", async () => {
        const h = setup();
        h.subRpc.notify("terminal.registerProfileProvider", { id: "demo" });
        h.ns.registerProfileProvider("demo", ptyProfile("Live", []));
        await flush();
        await h.profiles.createContributedTerminalProfile(PROFILE, "panel");
        await flush();
        expect(h.service.getInstances().map((instance) => instance.title)).toStrictEqual(["Live"]);
        h.service.dispose();
    });
});
