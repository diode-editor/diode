import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { buildCommandsNamespace } from "./commandsNamespace.ts";
import type { HostRpc, SubprocessRpc } from "./extHostProtocol.ts";
import { createInProcessChannelPair } from "./inProcessChannelPair.ts";
import { RpcEndpoint } from "./rpcEndpoint.ts";
import { ExtensionOwner } from "./vscodeHostContext.ts";

const microtasks = async (turns = 4): Promise<void> => {
    for (let i = 0; i < turns; i++) await Promise.resolve();
};

function createBridge(
    getActiveTextEditor?: () => vscode.TextEditor | undefined,
    owner?: ExtensionOwner,
    apiCommands?: ReadonlyMap<string, (...args: unknown[]) => unknown>,
    processArgument?: (arg: unknown) => unknown,
): {
    commands: ReturnType<typeof buildCommandsNamespace>;
    host: HostRpc;
    dispose: () => void;
} {
    const [chSub, chHost] = createInProcessChannelPair();
    const sub: SubprocessRpc = new RpcEndpoint(chSub);
    const host: HostRpc = new RpcEndpoint(chHost);
    const commands = buildCommandsNamespace(sub, getActiveTextEditor, owner, apiCommands, processArgument);
    return {
        commands,
        host,
        dispose: (): void => {
            sub.dispose();
            host.dispose();
            chSub.dispose();
            chHost.dispose();
        },
    };
}

describe("CommandsNamespace (subprocess)", () => {
    it("executeCommand of a local command runs it without RPC to the host", async () => {
        const { commands, host, dispose } = createBridge();
        let hostSawExecute = false;
        host.handleRequest("commands.executeCommand", () => {
            hostSawExecute = true;
            return null;
        });
        commands.registerCommand("local.sum", (a, b) => (a as number) + (b as number));

        const result = await commands.executeCommand<number>("local.sum", 2, 3);

        expect(result).toBe(5);
        expect(hostSawExecute).toBe(false);
        dispose();
    });

    it("executeCommand of a command unknown locally goes to the host as a request and resolves with the result", async () => {
        const { commands, host, dispose } = createBridge();
        const received: { id: string; args: unknown[] }[] = [];
        host.handleRequest("commands.executeCommand", (params) => {
            const { id, args } = params as { id: string; args: unknown[] };
            received.push({ id, args });
            return "host-result";
        });

        const result = await commands.executeCommand<string>("core.doThing", 42, "x");

        expect(result).toBe("host-result");
        expect(received).toEqual([{ id: "core.doThing", args: [42, "x"] }]);
        dispose();
    });

    it("API command runs in the subprocess without RPC to the host; a synchronous throw rejects the promise", async () => {
        const api = new Map<string, (...args: unknown[]) => unknown>([
            ["vscode.echo", (value) => value],
            [
                "vscode.fail",
                () => {
                    throw new Error("bad arg");
                },
            ],
        ]);
        const { commands, host, dispose } = createBridge(undefined, undefined, api);
        let hostSawExecute = false;
        host.handleRequest("commands.executeCommand", () => {
            hostSawExecute = true;
            return null;
        });

        await expect(commands.executeCommand("vscode.echo", 7)).resolves.toBe(7);
        const failed = commands.executeCommand("vscode.fail");
        await expect(failed).rejects.toThrow("bad arg");
        expect(hostSawExecute).toBe(false);
        dispose();
    });

    it("registerCommand sends notif commands.registerCommand, dispose sends commands.unregisterCommand", async () => {
        const { commands, host, dispose } = createBridge();
        const registered: string[] = [];
        const unregistered: string[] = [];
        host.handleNotification("commands.registerCommand", (p) => registered.push((p as { id: string }).id));
        host.handleNotification("commands.unregisterCommand", (p) => unregistered.push((p as { id: string }).id));

        const disposable = commands.registerCommand("ext.foo", () => undefined);
        await microtasks();
        expect(registered).toEqual(["ext.foo"]);
        expect(unregistered).toEqual([]);

        disposable.dispose();
        await microtasks();
        expect(unregistered).toEqual(["ext.foo"]);
        dispose();
    });

    it("disposing the first registration leaves an id re-taken by a later register alone", async () => {
        const { commands, host, dispose } = createBridge();
        const unregistered: string[] = [];
        host.handleNotification("commands.unregisterCommand", (p) => unregistered.push((p as { id: string }).id));

        const first = commands.registerCommand("ext.dup", () => "one");
        commands.registerCommand("ext.dup", () => "two");
        first.dispose();

        await microtasks();
        expect(unregistered).toEqual([]);
        await expect(commands.executeCommand<string>("ext.dup")).resolves.toBe("two");
        dispose();
    });

    it("host → subprocess: incoming commands.executeCommand runs the local callback with the passed args", async () => {
        const { commands, host, dispose } = createBridge();
        const seen: unknown[][] = [];
        commands.registerCommand("ext.bar", (...args) => {
            seen.push(args);
            return "ran";
        });

        const result = await host.request("commands.executeCommand", { id: "ext.bar", args: [1, 2] });

        expect(result).toBe("ran");
        expect(seen).toEqual([[1, 2]]);
        dispose();
    });

    it("host → subprocess: each argument goes through the argument processor before the callback", async () => {
        const { commands, host, dispose } = createBridge(undefined, undefined, undefined, (arg) =>
            arg === "row" ? { element: "row" } : arg,
        );
        const seen: unknown[][] = [];
        commands.registerCommand("ext.row", (...args) => seen.push(args));

        await host.request("commands.executeCommand", { id: "ext.row", args: ["row", 2] });

        expect(seen).toEqual([[{ element: "row" }, 2]]);
        dispose();
    });

    it("host → subprocess: command unknown locally → reject", async () => {
        const { host, dispose } = createBridge();
        await expect(host.request("commands.executeCommand", { id: "nope", args: [] })).rejects.toThrow(/not found/);
        dispose();
    });

    it("host → subprocess: without an args array the callback is called with no arguments", async () => {
        const { commands, host, dispose } = createBridge();
        const seen: unknown[][] = [];
        commands.registerCommand("ext.noargs", (...args) => {
            seen.push(args);
            return "ok";
        });

        // Deliberately without `args`: checks the receiver guards against an incomplete wire message.
        const result = await host.request("commands.executeCommand", { id: "ext.noargs" } as never);

        expect(result).toBe("ok");
        expect(seen).toEqual([[]]);
        dispose();
    });

    it("host → subprocess: malformed params (not an object) → reject", async () => {
        const { host, dispose } = createBridge();
        await expect(host.request("commands.executeCommand", 42 as never)).rejects.toThrow(/must be an object/);
        dispose();
    });

    it("host → subprocess: empty id → reject", async () => {
        const { host, dispose } = createBridge();
        await expect(host.request("commands.executeCommand", { id: "" } as never)).rejects.toThrow(/non-empty string/);
        dispose();
    });

    it("executeCommand of a command that exists nowhere rejects (host has no handler)", async () => {
        const { commands, dispose } = createBridge();
        await expect(commands.executeCommand("ghost")).rejects.toThrow();
        dispose();
    });

    it("thisArg is bound to the callback", async () => {
        const { commands, dispose } = createBridge();
        const ctx = { value: 7 };
        commands.registerCommand(
            "ext.this",
            function (this: typeof ctx) {
                return this.value;
            },
            ctx,
        );
        const result = await commands.executeCommand<number>("ext.this");
        expect(result).toBe(7);
        dispose();
    });

    it("registerTextEditorCommand: callback receives the active editor, edit builder and args", async () => {
        const editor = { document: { fileName: "/f.py" } } as unknown as vscode.TextEditor;
        const { commands, dispose } = createBridge(() => editor);
        const seen: unknown[][] = [];
        commands.registerTextEditorCommand("ext.te", (ed, edit, ...args: unknown[]) => {
            seen.push([ed, edit, ...args]);
        });

        await commands.executeCommand("ext.te", "a", 2);

        expect(seen).toHaveLength(1);
        expect(seen[0][0]).toBe(editor);
        const edit = seen[0][1] as vscode.TextEditorEdit;
        const pos = { line: 0, character: 0 } as vscode.Position;
        expect(() => {
            edit.insert(pos, "x");
            edit.replace(pos, "y");
            edit.delete({ start: pos, end: pos } as vscode.Range);
            edit.setEndOfLine(1);
        }).not.toThrow();
        expect(seen[0].slice(2)).toEqual(["a", 2]);
        dispose();
    });

    it("registerTextEditorCommand: without an active editor the callback does NOT run (VS Code semantics)", async () => {
        const { commands, dispose } = createBridge(() => undefined);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            let ran = false;
            commands.registerTextEditorCommand("ext.te.noeditor", () => {
                ran = true;
            });

            const result = await commands.executeCommand("ext.te.noeditor");

            expect(ran).toBe(false);
            expect(result).toBeUndefined();
            expect(warn.mock.calls).toEqual([
                ['Cannot execute text editor command "ext.te.noeditor": no active text editor'],
            ]);
        } finally {
            warn.mockRestore();
        }
        dispose();
    });

    it("registerTextEditorCommand: the warning carries the id of the extension that owned the registration", async () => {
        const owner = new ExtensionOwner();
        const { commands, dispose } = createBridge(() => undefined, owner);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            owner.runAs("pub.editor-ext", () => commands.registerTextEditorCommand("ext.te.owned", () => undefined));
            commands.registerTextEditorCommand("ext.te.shared", () => undefined);

            // Execution happens outside runAs: the owner was remembered at registration.
            await commands.executeCommand("ext.te.owned");
            await commands.executeCommand("ext.te.shared");

            expect(warn.mock.calls).toEqual([
                ['[pub.editor-ext] Cannot execute text editor command "ext.te.owned": no active text editor'],
                ['Cannot execute text editor command "ext.te.shared": no active text editor'],
            ]);
        } finally {
            warn.mockRestore();
        }
        dispose();
    });

    it("registerTextEditorCommand: build without an editor getter (no window) is a no-op, not a TypeError", async () => {
        const { commands, dispose } = createBridge();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            let ran = false;
            commands.registerTextEditorCommand("ext.te.nogetter", () => {
                ran = true;
            });
            await expect(commands.executeCommand("ext.te.nogetter")).resolves.toBeUndefined();
            expect(ran).toBe(false);
        } finally {
            warn.mockRestore();
        }
        dispose();
    });

    it("registerTextEditorCommand: thisArg is bound, dispose removes the command", async () => {
        const editor = {} as vscode.TextEditor;
        const { commands, host, dispose } = createBridge(() => editor);
        const unregistered: string[] = [];
        host.handleNotification("commands.unregisterCommand", (p) => unregistered.push((p as { id: string }).id));
        const ctx = { value: 11 };
        let seenValue = 0;
        const disposable = commands.registerTextEditorCommand(
            "ext.te.this",
            function (this: typeof ctx) {
                seenValue = this.value;
            },
            ctx,
        );

        await commands.executeCommand("ext.te.this");
        expect(seenValue).toBe(11);

        disposable.dispose();
        await microtasks();
        expect(unregistered).toEqual(["ext.te.this"]);
        dispose();
    });
});

describe("commands.getCommands", () => {
    it("[api:commands.getCommands] lists the host's commands, internal ones hidden on request", async () => {
        const { commands, host, dispose } = createBridge();
        host.handleRequest("commands.getCommands", () => ["editor.action.x", "_internal", "ext._notInternal"]);

        await expect(commands.getCommands()).resolves.toEqual(["editor.action.x", "_internal", "ext._notInternal"]);
        await expect(commands.getCommands(false)).resolves.toContain("_internal");
        await expect(commands.getCommands(true)).resolves.toEqual(["editor.action.x", "ext._notInternal"]);
        dispose();
    });

    it("a command the extension just registered is already in the list: the notification goes first", async () => {
        const { commands, host, dispose } = createBridge();
        const known: string[] = [];
        host.handleNotification("commands.registerCommand", (params) => {
            known.push((params as { id: string }).id);
        });
        host.handleRequest("commands.getCommands", () => known);

        commands.registerCommand("ext.fresh", () => undefined);

        await expect(commands.getCommands()).resolves.toEqual(["ext.fresh"]);
        dispose();
    });
});
