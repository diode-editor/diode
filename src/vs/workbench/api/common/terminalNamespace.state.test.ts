import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createTerminalNamespace } from "./terminalNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { EventEmitter } from "./vscodeTypes.ts";

function setup() {
    const stub = makeStubRpc();
    const ns = createTerminalNamespace(stub.rpc);
    const sent = (method: string): unknown[] => stub.notifies.filter((n) => n.method === method).map((n) => n.params);
    const changes: [vscode.Terminal, vscode.TerminalState][] = [];
    ns.onDidChangeTerminalState((t) => changes.push([t, t.state]));
    return { stub, ns, sent, changes };
}

describe("[api:Terminal.state] [api:window.onDidChangeTerminalState] terminal state", () => {
    it("starts not interacted, shell unknown; the first interaction replaces the state object and fires once", () => {
        const { ns, stub, changes } = setup();
        const terminal = ns.createTerminal();
        const initial = terminal.state;
        expect(initial).toStrictEqual({ isInteractedWith: false, shell: undefined });
        stub.fire("terminal.opened", { id: 3, extHostId: 1, name: "bash", launch: {} });
        expect(changes).toStrictEqual([]);
        stub.fire("terminal.interaction", { id: 3 });
        stub.fire("terminal.interaction", { id: 3 });
        expect(changes).toStrictEqual([[terminal, { isInteractedWith: true, shell: undefined }]]);
        expect(terminal.state).toStrictEqual({ isInteractedWith: true, shell: undefined });
        expect(initial.isInteractedWith).toBe(false);
    });

    it("interaction with an unknown id or a malformed envelope is ignored", () => {
        const { ns, stub, changes } = setup();
        const terminal = ns.createTerminal();
        stub.fire("terminal.opened", { id: 3, extHostId: 1, name: "bash", launch: {} });
        stub.fire("terminal.interaction", { id: 4 });
        stub.fire("terminal.interaction", { id: "3" });
        stub.fire("terminal.interaction", null);
        expect(changes).toStrictEqual([]);
        expect(terminal.state.isInteractedWith).toBe(false);
    });

    it("the shell type arrives with opened: onDidOpenTerminal first, then a state change with the shell", () => {
        const { ns, stub, changes } = setup();
        const order: string[] = [];
        ns.onDidOpenTerminal((t) => order.push(`open ${String(t.state.shell)}`));
        ns.onDidChangeTerminalState((t) => order.push(`state ${String(t.state.shell)}`));
        const terminal = ns.createTerminal();
        stub.fire("terminal.opened", { id: 3, extHostId: 1, name: "zsh", shellType: "zsh", launch: {} });
        expect(order).toStrictEqual(["open undefined", "state zsh"]);
        expect(changes).toStrictEqual([[terminal, { isInteractedWith: false, shell: "zsh" }]]);
    });

    it("a foreign terminal (snapshot or the user's shell) gets its type too; a non-string type is unknown", () => {
        const { ns, stub, changes } = setup();
        stub.fire("terminal.opened", { id: 1, name: "fish", shellType: "fish", launch: {} });
        stub.fire("terminal.opened", { id: 2, name: "weird", shellType: 7, launch: {} });
        expect(ns.terminals.map((t) => t.state.shell)).toStrictEqual(["fish", undefined]);
        expect(changes.map(([t]) => t.name)).toStrictEqual(["fish"]);
    });
});

describe("[api:Pseudoterminal.onDidChangeName] renaming a pty terminal", () => {
    it("the name goes to the host before exit; the host's title change renames the terminal", () => {
        const { ns, stub, sent } = setup();
        const name = new EventEmitter<string>();
        const close = new EventEmitter<number | undefined>();
        const pty: vscode.Pseudoterminal = {
            onDidWrite: new EventEmitter<string>().event,
            onDidChangeName: name.event,
            onDidClose: close.event,
            open: () => {
                name.fire("bar");
                close.fire(undefined);
            },
            close: () => undefined,
        };
        const terminal = ns.createTerminal({ name: "foo", pty });
        stub.fire("terminal.opened", { id: 1, extHostId: 1, name: "foo", launch: {} });
        stub.fire("terminal.pty.start", { id: 1, cols: 10, rows: 5 });
        expect(stub.notifies.map((n) => n.method).filter((m) => m.startsWith("terminal.pty."))).toStrictEqual([
            "terminal.pty.name",
            "terminal.pty.exit",
        ]);
        expect(sent("terminal.pty.name")).toStrictEqual([{ terminal: { extHostId: 1 }, name: "bar" }]);
        expect(terminal.name).toBe("foo");
        stub.fire("terminal.titleChanged", { id: 1, name: "bar" });
        expect(terminal.name).toBe("bar");
    });

    it("a name before start or after close is not sent; a pty without onDidChangeName is fine", () => {
        const { ns, stub, sent } = setup();
        const name = new EventEmitter<string>();
        const pty: vscode.Pseudoterminal = {
            onDidWrite: new EventEmitter<string>().event,
            onDidChangeName: name.event,
            open: () => undefined,
            close: () => undefined,
        };
        ns.createTerminal({ name: "foo", pty });
        ns.createTerminal({
            name: "plain",
            pty: { onDidWrite: new EventEmitter<string>().event, open: () => undefined, close: () => undefined },
        });
        stub.fire("terminal.opened", { id: 1, extHostId: 1, name: "foo", launch: {} });
        stub.fire("terminal.opened", { id: 2, extHostId: 2, name: "plain", launch: {} });
        name.fire("early");
        stub.fire("terminal.pty.start", { id: 1, cols: 10, rows: 5 });
        stub.fire("terminal.pty.start", { id: 2, cols: 10, rows: 5 });
        stub.fire("terminal.closed", { id: 1, reason: "process" });
        name.fire("late");
        expect(sent("terminal.pty.name")).toStrictEqual([]);
    });

    it("titleChanged renames a foreign terminal too; unknown id and malformed envelopes are ignored", () => {
        const { ns, stub } = setup();
        stub.fire("terminal.opened", { id: 1, name: "bash", launch: {} });
        const [terminal] = ns.terminals;
        stub.fire("terminal.titleChanged", { id: 2, name: "x" });
        stub.fire("terminal.titleChanged", { id: 1 });
        stub.fire("terminal.titleChanged", { id: "1", name: "x" });
        expect(terminal.name).toBe("bash");
        stub.fire("terminal.titleChanged", { id: 1, name: "build" });
        expect(terminal.name).toBe("build");
    });
});
