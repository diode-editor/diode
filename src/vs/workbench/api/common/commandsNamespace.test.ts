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

/**
 * Поднимает пару endpoint'ов: `sub` — «subprocess» с commands namespace,
 * `host` — «хост», на котором тест регистрирует хендлеры/наблюдает уведомления.
 */
function createBridge(
    getActiveTextEditor?: () => vscode.TextEditor | undefined,
    owner?: ExtensionOwner,
): {
    commands: ReturnType<typeof buildCommandsNamespace>;
    host: HostRpc;
    dispose: () => void;
} {
    const [chSub, chHost] = createInProcessChannelPair();
    const sub: SubprocessRpc = new RpcEndpoint(chSub);
    const host: HostRpc = new RpcEndpoint(chHost);
    const commands = buildCommandsNamespace(sub, getActiveTextEditor, owner);
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
    it("executeCommand локальной команды исполняет её без RPC на хост", async () => {
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

    it("executeCommand неизвестной локально команды уходит request'ом на хост и резолвится результатом", async () => {
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

    it("registerCommand шлёт notif commands.registerCommand, dispose — commands.unregisterCommand", async () => {
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

    it("dispose первой регистрации не трогает id, перезанятый повторным register", async () => {
        const { commands, host, dispose } = createBridge();
        const unregistered: string[] = [];
        host.handleNotification("commands.unregisterCommand", (p) => unregistered.push((p as { id: string }).id));

        const first = commands.registerCommand("ext.dup", () => "one");
        commands.registerCommand("ext.dup", () => "two"); // перезаписывает bound
        first.dispose(); // get(id) !== bound первого → ничего не снимаем

        await microtasks();
        expect(unregistered).toEqual([]);
        // Команда всё ещё исполняется вторым колбэком.
        await expect(commands.executeCommand<string>("ext.dup")).resolves.toBe("two");
        dispose();
    });

    it("host → subprocess: входящий commands.executeCommand гоняет локальный колбэк с прокинутыми args", async () => {
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

    it("host → subprocess: неизвестная локально команда → reject", async () => {
        const { host, dispose } = createBridge();
        await expect(host.request("commands.executeCommand", { id: "nope", args: [] })).rejects.toThrow(/not found/);
        dispose();
    });

    it("host → subprocess: без массива args колбэк зовётся без аргументов", async () => {
        const { commands, host, dispose } = createBridge();
        const seen: unknown[][] = [];
        commands.registerCommand("ext.noargs", (...args) => {
            seen.push(args);
            return "ok";
        });

        // Намеренно без `args`: проверяем защиту получателя от неполного провода.
        const result = await host.request("commands.executeCommand", { id: "ext.noargs" } as never);

        expect(result).toBe("ok");
        expect(seen).toEqual([[]]);
        dispose();
    });

    it("host → subprocess: некорректные params (не объект) → reject", async () => {
        const { host, dispose } = createBridge();
        // Намеренный мусор вместо параметров.
        await expect(host.request("commands.executeCommand", 42 as never)).rejects.toThrow(/must be an object/);
        dispose();
    });

    it("host → subprocess: пустой id → reject", async () => {
        const { host, dispose } = createBridge();
        // Намеренно кривые параметры: пустой id и без `args`.
        await expect(host.request("commands.executeCommand", { id: "" } as never)).rejects.toThrow(/non-empty string/);
        dispose();
    });

    it("executeCommand несуществующей нигде команды reject'ится (хост без хендлера)", async () => {
        const { commands, dispose } = createBridge();
        // host не регистрирует commands.executeCommand → RpcEndpoint вернёт No handler.
        await expect(commands.executeCommand("ghost")).rejects.toThrow();
        dispose();
    });

    it("thisArg привязывается к колбэку", async () => {
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

    it("registerTextEditorCommand: колбэк получает активный редактор, edit-builder и args", async () => {
        const editor = { document: { fileName: "/f.py" } } as unknown as vscode.TextEditor;
        const { commands, dispose } = createBridge(() => editor);
        const seen: unknown[][] = [];
        commands.registerTextEditorCommand("ext.te", (ed, edit, ...args: unknown[]) => {
            seen.push([ed, edit, ...args]);
        });

        await commands.executeCommand("ext.te", "a", 2);

        expect(seen).toHaveLength(1);
        expect(seen[0][0]).toBe(editor);
        // Инертный edit-builder существует и не бросает (все методы — no-op).
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

    it("registerTextEditorCommand: без активного редактора колбэк НЕ исполняется (семантика VS Code)", async () => {
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

    it("registerTextEditorCommand: предупреждение несёт id расширения, владевшего регистрацией", async () => {
        const owner = new ExtensionOwner();
        const { commands, dispose } = createBridge(() => undefined, owner);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            owner.runAs("pub.editor-ext", () => commands.registerTextEditorCommand("ext.te.owned", () => undefined));
            // Регистрация вне оверлея (владельца нет) — строка без id.
            commands.registerTextEditorCommand("ext.te.shared", () => undefined);

            // Исполнение — уже вне runAs: владелец запомнен при регистрации.
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

    it("registerTextEditorCommand: сборка без геттера редактора (нет window) — no-op, не TypeError", async () => {
        const { commands, dispose } = createBridge(); // геттер не передан
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

    it("registerTextEditorCommand: thisArg привязывается, dispose снимает команду", async () => {
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
