import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";

import { createTerminalNamespace } from "./terminalNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { EventEmitter, TerminalProfile } from "./vscodeTypes.ts";

function setup() {
    const stub = makeStubRpc();
    const ns = createTerminalNamespace(stub.rpc);
    const sent = (method: string): unknown[] => stub.notifies.filter((n) => n.method === method).map((n) => n.params);
    const create = (id: string, location: 1 | 2 = 1): Promise<unknown> =>
        stub.callRequest("terminal.createContributedProfile", { id, location });
    return { stub, ns, sent, create };
}

function provider(result: vscode.ProviderResult<vscode.TerminalProfile>): vscode.TerminalProfileProvider {
    return { provideTerminalProfile: () => result };
}

describe("window.registerTerminalProfileProvider", () => {
    it("tells the host the profile id, and takes it back on dispose", () => {
        const { ns, sent } = setup();
        const registration = ns.registerProfileProvider("debugTerminal", provider(undefined));
        expect(sent("terminal.registerProfileProvider")).toStrictEqual([{ id: "debugTerminal" }]);
        registration.dispose();
        expect(sent("terminal.unregisterProfileProvider")).toStrictEqual([{ id: "debugTerminal" }]);
    });

    it("a second provider for the same id throws until the first is disposed", () => {
        const { ns } = setup();
        const first = ns.registerProfileProvider("shared", provider(undefined));
        expect(() => ns.registerProfileProvider("shared", provider(undefined))).toThrow(
            'Terminal profile provider "shared" already registered',
        );
        first.dispose();
        expect(() => ns.registerProfileProvider("shared", provider(undefined))).not.toThrow();
    });
});

describe("terminal.createContributedProfile — the host asks for the profile's terminal", () => {
    it("a TerminalProfile with shell options creates the terminal where the person picked, not where the profile says", async () => {
        const { ns, sent, create } = setup();
        const options: vscode.TerminalOptions = { name: "Debug", shellPath: "/bin/zsh", location: 2 };
        ns.registerProfileProvider("debug", provider(new TerminalProfile(options)));
        await expect(create("debug", 1)).resolves.toBeNull();
        expect(sent("terminal.create")).toStrictEqual([
            { extHostId: 1, name: "Debug", shellPath: "/bin/zsh", location: 1 },
        ]);
        expect(ns.terminals.map((terminal) => terminal.creationOptions)).toStrictEqual([options]);
    });

    it("a pty profile is an extension terminal in the editor area; the pty opens on the host's start", async () => {
        const { ns, sent, create, stub } = setup();
        const write = new EventEmitter<string>();
        const opened: unknown[] = [];
        const pty: vscode.Pseudoterminal = {
            onDidWrite: write.event,
            open: (dimensions) => {
                opened.push(dimensions);
            },
            close: () => undefined,
        };
        ns.registerProfileProvider("pty", provider(Promise.resolve(new TerminalProfile({ name: "Pty", pty }))));
        await create("pty", 2);
        expect(sent("terminal.create")).toStrictEqual([{ extHostId: 1, pty: true, name: "Pty", location: 2 }]);
        stub.fire("terminal.opened", { id: 5, extHostId: 1, name: "Pty", launch: {} });
        stub.fire("terminal.pty.start", { id: 5, cols: 40, rows: 10 });
        expect(opened).toStrictEqual([{ columns: 40, rows: 10 }]);
    });

    it("bare options in place of a TerminalProfile are taken as its options, as upstream", async () => {
        const { ns, sent, create } = setup();
        ns.registerProfileProvider("bare", provider({ name: "Bare" } as unknown as vscode.TerminalProfile));
        await create("bare");
        expect(sent("terminal.create")).toStrictEqual([{ extHostId: 1, name: "Bare", location: 1 }]);
    });

    it("the provider gets a live token: cancelling the host request cancels it", async () => {
        const { ns, stub } = setup();
        let seen: vscode.CancellationToken | undefined;
        ns.registerProfileProvider("slow", {
            provideTerminalProfile: (token) => {
                seen = token;
                return new TerminalProfile({});
            },
        });
        const source = new CancellationTokenSource();
        const done = stub.callRequest("terminal.createContributedProfile", { id: "slow", location: 1 }, source.token);
        source.cancel();
        expect(seen?.isCancellationRequested).toBe(true);
        await done;
    });

    it("rejects with upstream's messages: no provider for the id, no profile from the provider", async () => {
        const { ns, sent, create } = setup();
        await expect(create("nobody")).rejects.toThrow('No terminal profile provider registered for id "nobody"');
        ns.registerProfileProvider("empty", provider(undefined)).dispose();
        await expect(create("empty")).rejects.toThrow('No terminal profile provider registered for id "empty"');
        ns.registerProfileProvider("none", provider(undefined));
        ns.registerProfileProvider("null", provider(null));
        await expect(create("none")).rejects.toThrow('No terminal profile options provided for id "none"');
        await expect(create("null")).rejects.toThrow('No terminal profile options provided for id "null"');
        expect(sent("terminal.create")).toStrictEqual([]);
    });
});

describe("TerminalProfile", () => {
    it("keeps its options and refuses a non-object, as upstream", () => {
        const options = { name: "n" };
        expect(new TerminalProfile(options).options).toBe(options);
        expect(() => new TerminalProfile("bash" as unknown as vscode.TerminalOptions)).toThrow(
            "Illegal argument: options",
        );
    });
});
