import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { FakeExtensionPtySession } from "../../../../../../TestUtils/FakeExtensionPtySession.ts";
import { FakeTerminalSurface } from "../../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTestConfigurationService } from "../../../../../../TestUtils/testConfigurationService.ts";
import type { HostRpc, SubprocessRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IExtensionTerminalSink } from "../../../../api/common/iExtensionWindowSinks.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { createTerminalNamespace } from "../../../../api/common/terminalNamespace.ts";
import { EventEmitter, TerminalExitReason } from "../../../../api/common/vscodeTypes.ts";
import { makeViewsHarness } from "../../../../browser/parts/views/viewsService.testUtils.ts";
import { ExtensionTerminalAdapter } from "../../../../contrib/terminal/browser/extensionTerminalAdapter.ts";
import { TERMINAL_VIEW_ID, TerminalService } from "../../../../contrib/terminal/browser/terminalService.ts";

import { TerminalCustomer } from "./terminalCustomer.ts";

// Сквозняк контракта терминалов на одном процессе: `vscode.window`-часть
// субпроцесса (`createTerminalNamespace`) ↔ настоящий RPC ↔ `TerminalCustomer`
// ↔ `ExtensionTerminalAdapter` ↔ `TerminalService` с фейковыми сессиями. Что
// видит расширение и что видит встроенный терминал — с обеих сторон провода.

/** Дождаться доставки всех сообщений in-process пары (она шлёт через microtask). */
async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

function setup(options: { pushInitialState?: boolean } = {}) {
    const views = makeViewsHarness();
    const sessions: FakeTerminalSurface[] = [];
    let nextPid = 500;
    const service = new TerminalService(views.panelService, views.service, createTestConfigurationService({}), (o) => {
        const surface = new FakeTerminalSurface(o.shell ?? "/bin/bash", nextPid++);
        sessions.push(surface);
        return surface;
    });
    views.service.attachRegisteredContainers();
    const ptySessions: FakeExtensionPtySession[] = [];
    const adapter = new ExtensionTerminalAdapter(service, views.panelService, (o) => {
        const session = new FakeExtensionPtySession(o);
        ptySessions.push(session);
        return session;
    });
    const customer = new TerminalCustomer(adapter);
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a) as unknown as HostRpc;
    const subRpc = new RpcEndpoint(b) as unknown as SubprocessRpc;
    const ns = createTerminalNamespace(subRpc);
    const attached = customer.attach({ rpc: hostRpc, logger: undefined });
    if (options.pushInitialState !== false) customer.pushInitialState();
    return { views, service, sessions, ptySessions, customer, ns, attached, hostRpc, subRpc };
}

describe("терминалы расширений — сквозь провод", () => {
    it("createTerminal → шелл во встроенном терминале; onDidOpenTerminal с тем же объектом, pid, активный", async () => {
        const h = setup();
        const onOpen = vi.fn();
        h.ns.onDidOpenTerminal(onOpen);
        const terminal = h.ns.createTerminal({ name: "Bazel Java: cleanup", shellPath: "/bin/sh", cwd: "/tmp" });
        await flush();

        const [instance] = h.service.getInstances();
        expect(instance.title).toBe("Bazel Java: cleanup");
        expect(instance.launch.shellPath).toBe("/bin/sh");
        expect(instance.launch.cwd).toBe("/tmp");
        expect(onOpen).toHaveBeenCalledWith(terminal);
        await expect(terminal.processId).resolves.toBe(500);
        expect(h.ns.activeTerminal).toBe(terminal);
        h.service.dispose();
    });

    it("sendText сразу после createTerminal (до opened) доходит до шелла с Enter", async () => {
        // Так пишет cleanup форка: createTerminal + серия sendText в одном тике.
        const h = setup();
        const terminal = h.ns.createTerminal("cleanup");
        terminal.sendText('echo "==> step"');
        terminal.sendText("rm -rf '/tmp/x' && echo removed");
        await flush();
        expect(h.sessions[0].writes).toStrictEqual(['echo "==> step"\r', "rm -rf '/tmp/x' && echo removed\r"]);
        h.service.dispose();
    });

    it("show открывает панель на вкладке TERMINAL и фокусирует; hide прячет только показанный", async () => {
        const h = setup();
        const focus = vi.fn();
        h.service.onDidRequestFocus(focus);
        const first = h.ns.createTerminal("first");
        const second = h.ns.createTerminal("second");
        await flush();
        first.show();
        await flush();
        expect(h.views.panelService.visible).toBe(true);
        expect(h.views.panelService.getActiveViewId()).toBe(TERMINAL_VIEW_ID);
        expect(h.service.getActiveInstance()?.title).toBe("first");
        expect(h.ns.activeTerminal).toBe(first);
        expect(focus).toHaveBeenCalledTimes(1);

        second.hide(); // показан не он — панель остаётся
        await flush();
        expect(h.views.panelService.visible).toBe(true);
        first.hide();
        await flush();
        expect(h.views.panelService.visible).toBe(false);

        second.show(true);
        await flush();
        expect(h.views.panelService.visible).toBe(true);
        expect(h.ns.activeTerminal).toBe(second);
        expect(focus).toHaveBeenCalledTimes(1);
        h.service.dispose();
    });

    it("hide при чужой активной вкладке панели панель не трогает", async () => {
        const h = setup();
        h.views.panelService.addView({ id: "output", title: "OUTPUT", content: null });
        const terminal = h.ns.createTerminal("t");
        await flush();
        h.views.panelService.setActiveView("output");
        h.views.panelService.setVisible(true);
        terminal.hide();
        await flush();
        expect(h.views.panelService.visible).toBe(true);
        h.service.dispose();
    });

    it("dispose расширения → инстанс закрыт, exitStatus Extension; выход шелла → Process с кодом", async () => {
        const h = setup();
        const onClose = vi.fn();
        h.ns.onDidCloseTerminal(onClose);
        const disposed = h.ns.createTerminal("a");
        const exited = h.ns.createTerminal("b");
        await flush();
        disposed.dispose();
        await flush();
        h.sessions[1].emitExit(3);
        await flush();
        expect(h.service.getInstances()).toStrictEqual([]);
        expect(h.sessions[0].disposed).toBe(true);
        expect(disposed.exitStatus).toStrictEqual({ code: undefined, reason: TerminalExitReason.Extension });
        expect(exited.exitStatus).toStrictEqual({ code: 3, reason: TerminalExitReason.Process });
        expect(onClose.mock.calls.map(([t]) => (t as vscode.Terminal).name)).toStrictEqual(["a", "b"]);
        expect(h.ns.terminals).toStrictEqual([]);
        h.service.dispose();
    });

    it("Kill человеком → exitStatus User", async () => {
        const h = setup();
        const terminal = h.ns.createTerminal("t");
        await flush();
        h.service.closeInstance(h.service.getActiveInstance()?.id);
        await flush();
        expect(terminal.exitStatus?.reason).toBe(TerminalExitReason.User);
        h.service.dispose();
    });

    it("шелл человека виден в terminals; sendText расширения доходит до него", async () => {
        const h = setup();
        h.service.newTerminal();
        await flush();
        expect(h.ns.terminals.map((t) => t.name)).toStrictEqual(["bash"]);
        const [human] = h.ns.terminals;
        expect(h.ns.activeTerminal).toBe(human);
        expect((human.creationOptions as vscode.TerminalOptions).shellPath).toBe("/bin/bash");
        human.sendText("pwd");
        await flush();
        expect(h.sessions[0].writes).toStrictEqual(["pwd\r"]);
        h.service.dispose();
    });

    it("hideFromUser: в terminals есть, во вкладках нет; show выносит во вкладки и делает активным", async () => {
        const h = setup();
        h.service.newTerminal();
        const hidden = h.ns.createTerminal({ name: "bg", hideFromUser: true });
        await flush();
        expect(h.ns.terminals).toContain(hidden);
        expect(h.service.getInstances().map((i) => i.title)).toStrictEqual(["bash"]);
        expect(h.ns.activeTerminal?.name).toBe("bash");
        hidden.show();
        await flush();
        expect(h.service.getInstances().map((i) => i.title)).toStrictEqual(["bash", "bg"]);
        expect(h.ns.activeTerminal).toBe(hidden);
        h.service.dispose();
    });

    it("снимок нового субпроцесса: инстансы по порядку создания (и фоновые) и активный", async () => {
        const h = setup({ pushInitialState: false });
        h.service.newTerminal();
        h.service.createInstance({ name: "bg", hideFromUser: true });
        h.service.newTerminal();
        h.service.setActiveInstance(1);
        // До семени события не уходят: у субпроцесса ещё нет обработчиков.
        await flush();
        expect(h.ns.terminals).toStrictEqual([]);

        h.customer.pushInitialState();
        await flush();
        expect(h.ns.terminals.map((t) => t.name)).toStrictEqual(["bash", "bg", "bash"]);
        expect((h.ns.terminals[1].creationOptions as vscode.TerminalOptions).hideFromUser).toBe(true);
        expect(h.ns.activeTerminal).toBe(h.ns.terminals[0]);
        h.service.dispose();
    });

    it("до семени не уходят ни opened, ни closed, ни activeChanged", async () => {
        const h = setup({ pushInitialState: false });
        const sent: string[] = [];
        vi.spyOn(h.hostRpc, "notify").mockImplementation((method) => {
            sent.push(method);
        });
        h.service.newTerminal();
        h.service.closeInstance(h.service.getActiveInstance()?.id);
        expect(sent).toStrictEqual([]);
        h.customer.pushInitialState();
        expect(sent).toStrictEqual(["terminal.activeChanged"]);
        h.service.dispose();
    });

    it("после уборки спавна семени нет — RPC умершего не трогается", () => {
        const h = setup({ pushInitialState: false });
        const sent: string[] = [];
        vi.spyOn(h.hostRpc, "notify").mockImplementation((method) => {
            sent.push(method);
        });
        h.attached.dispose();
        h.customer.pushInitialState();
        expect(sent).toStrictEqual([]);
        h.service.dispose();
    });

    it("поздняя уборка прежнего спавна не трогает нового", async () => {
        const h = setup();
        const [a, b] = createInProcessChannelPair();
        const ns2 = createTerminalNamespace(new RpcEndpoint(b) as unknown as SubprocessRpc);
        h.customer.attach({ rpc: new RpcEndpoint(a) as unknown as HostRpc, logger: undefined });
        h.attached.dispose();
        // Семя уходит новому спавну — его не обнулила уборка старого.
        h.customer.pushInitialState();
        h.service.newTerminal();
        await flush();
        expect(ns2.terminals.map((t) => t.name)).toStrictEqual(["bash"]);
        h.service.dispose();
    });

    it("смерть субпроцесса: шеллы расширения живут, метки забыты; события больше не уходят", async () => {
        const h = setup();
        const terminal = h.ns.createTerminal("t");
        await flush();
        const sentBefore: string[] = [];
        const spy = vi.spyOn(h.hostRpc, "notify").mockImplementation((method) => {
            sentBefore.push(method);
        });
        h.attached.dispose();
        h.service.newTerminal();
        expect(sentBefore).toStrictEqual([]);
        expect(h.service.getInstances().map((i) => i.title)).toStrictEqual(["t", "bash"]);
        spy.mockRestore();

        // Новый спавн: старая метка ничего не адресует, снимок отдаёт оба как чужие.
        const [a, b] = createInProcessChannelPair();
        const ns2 = createTerminalNamespace(new RpcEndpoint(b) as unknown as SubprocessRpc);
        h.customer.attach({ rpc: new RpcEndpoint(a) as unknown as HostRpc, logger: undefined });
        h.customer.pushInitialState();
        await flush();
        expect(ns2.terminals.map((t) => t.name)).toStrictEqual(["t", "bash"]);
        expect(ns2.terminals[0]).not.toBe(terminal);
        h.service.dispose();
    });

    it("без стока: нотификации принимаются молча, снимка нет", async () => {
        const customer = new TerminalCustomer(undefined);
        const [a, b] = createInProcessChannelPair();
        const hostRpc = new RpcEndpoint(a) as unknown as HostRpc;
        const ns = createTerminalNamespace(new RpcEndpoint(b) as unknown as SubprocessRpc);
        const attached = customer.attach({ rpc: hostRpc, logger: undefined });
        customer.pushInitialState();
        const terminal = ns.createTerminal("void");
        terminal.sendText("x");
        await flush();
        expect(ns.terminals).toStrictEqual([terminal]);
        attached.dispose();
    });

    it("битые конверты субпроцесса не доходят до стока", async () => {
        const calls: string[] = [];
        const sink: IExtensionTerminalSink = {
            snapshot: () => ({ terminals: [], activeId: null }),
            subscribe: () => ({ dispose: () => undefined }),
            create: () => calls.push("create"),
            show: () => calls.push("show"),
            hide: () => calls.push("hide"),
            sendText: () => calls.push("sendText"),
            dispose: () => calls.push("dispose"),
            ptyData: () => calls.push("ptyData"),
            ptyExit: () => calls.push("ptyExit"),
            reset: () => calls.push("reset"),
        };
        const customer = new TerminalCustomer(sink);
        const [a, b] = createInProcessChannelPair();
        // Обработчик, упавший на битом конверте, RPC глотает с предупреждением —
        // ноль предупреждений значит, что разбор отсёк конверт до стока.
        const warnings: string[] = [];
        const logger = {
            trace: () => undefined,
            debug: () => undefined,
            info: () => undefined,
            warn: (message: string) => warnings.push(message),
            error: () => undefined,
            isEnabled: () => true,
        };
        const attached = customer.attach({ rpc: new RpcEndpoint(a, logger) as unknown as HostRpc, logger: undefined });
        const peer = new RpcEndpoint(b) as unknown as SubprocessRpc;
        const send = peer.notify.bind(peer) as (method: string, params: unknown) => void;
        send("terminal.create", { name: "no id" });
        send("terminal.show", { terminal: {} });
        send("terminal.hide", null);
        send("terminal.sendText", { terminal: { id: 1 } });
        send("terminal.dispose", { terminal: "x" });
        send("terminal.pty.data", { terminal: { id: 1 }, data: 5 });
        send("terminal.pty.exit", { terminal: {} });
        await flush();
        expect(calls).toStrictEqual([]);
        expect(warnings).toStrictEqual([]);
        send("terminal.create", { extHostId: 1 });
        send("terminal.show", { terminal: { id: 1 } });
        send("terminal.hide", { terminal: { extHostId: 1 } });
        send("terminal.sendText", { terminal: { id: 1 }, text: "t" });
        send("terminal.dispose", { terminal: { id: 1 } });
        send("terminal.pty.data", { terminal: { id: 1 }, data: "x" });
        send("terminal.pty.exit", { terminal: { id: 1 } });
        await flush();
        expect(calls).toStrictEqual(["create", "show", "hide", "sendText", "dispose", "ptyData", "ptyExit"]);
        attached.dispose();
        expect(calls.at(-1)).toBe("reset");
    });
});

/** Pty расширения в духе `BazelTerminal` форка: эхо ввода с перекраской, журнал вызовов. */
function makePty() {
    const write = new EventEmitter<string>();
    const close = new EventEmitter<number | undefined>();
    const log: string[] = [];
    const pty: vscode.Pseudoterminal = {
        onDidWrite: write.event,
        onDidClose: close.event,
        open: (dims) => log.push(`open ${dims === undefined ? "-" : `${String(dims.columns)}x${String(dims.rows)}`}`),
        close: () => log.push("close"),
        handleInput: (data) => {
            log.push(`input ${JSON.stringify(data)}`);
            write.fire(data.replace(/(\r|\n)+/gu, "\r\n"));
        },
        setDimensions: (dims) => log.push(`dims ${String(dims.columns)}x${String(dims.rows)}`),
    };
    return { pty, write, close, log };
}

describe("pty расширения — сквозь провод", () => {
    it("createTerminal({ pty }): эмулятор без процесса, open с размером, onDidOpenTerminal, pid нет", async () => {
        const h = setup();
        const p = makePty();
        const onOpen = vi.fn();
        h.ns.onDidOpenTerminal(onOpen);
        const terminal = h.ns.createTerminal({ name: "Bazel Build Status", pty: p.pty });
        await flush();
        expect(h.service.getInstances().map((i) => i.title)).toStrictEqual(["Bazel Build Status"]);
        expect(h.ptySessions).toHaveLength(1);
        expect(h.sessions).toStrictEqual([]);
        expect(p.log).toStrictEqual(["open 80x24", "dims 80x24"]);
        expect(onOpen).toHaveBeenCalledWith(terminal);
        await expect(terminal.processId).resolves.toBeUndefined();
        expect(h.ns.terminals.find((t) => t.name === "Bazel Build Status")).toBe(terminal);
        h.service.dispose();
    });

    it("sendText сразу после создания доходит до handleInput ПОСЛЕ open, эхо — в эмулятор одной склейкой", async () => {
        // Ровно так пишет лог BJLS: getBazelTerminal() и тут же sendText.
        const h = setup();
        const p = makePty();
        const terminal = h.ns.createTerminal({ name: "Bazel Build Status", pty: p.pty });
        terminal.sendText("\u001b[32mline one\u001b[0m");
        terminal.sendText("line two");
        await flush();
        expect(p.log).toStrictEqual([
            "open 80x24",
            "dims 80x24",
            `input ${JSON.stringify("\u001b[32mline one\u001b[0m\r")}`,
            `input ${JSON.stringify("line two\r")}`,
        ]);
        await new Promise((r) => setTimeout(r, 20));
        await flush();
        expect(h.ptySessions[0].fed).toStrictEqual(["\u001b[32mline one\u001b[0m\r\nline two\r\n"]);
        h.service.dispose();
    });

    it("набор человека в виджете и ресайз виджета доходят до pty", async () => {
        const h = setup();
        const p = makePty();
        h.ns.createTerminal({ name: "t", pty: p.pty });
        await flush();
        h.ptySessions[0].write("q");
        h.ptySessions[0].resize(100, 30);
        await flush();
        expect(p.log.slice(2)).toStrictEqual([`input ${JSON.stringify("q")}`, "dims 100x30"]);
        h.service.dispose();
    });

    it("onDidClose pty: досланный вывод, затем закрытие с кодом; без кода — code undefined", async () => {
        const h = setup();
        const a = makePty();
        const b = makePty();
        const withCode = h.ns.createTerminal({ name: "a", pty: a.pty });
        const noCode = h.ns.createTerminal({ name: "b", pty: b.pty });
        await flush();
        a.write.fire("bye");
        a.close.fire(2);
        b.close.fire(undefined);
        await flush();
        expect(h.ptySessions[0].fed).toStrictEqual(["bye"]);
        expect(withCode.exitStatus).toStrictEqual({ code: 2, reason: TerminalExitReason.Process });
        expect(noCode.exitStatus).toStrictEqual({ code: undefined, reason: TerminalExitReason.Process });
        expect(h.service.getInstances()).toStrictEqual([]);
        // Закрытие инстанса закрывает и pty — как `shutdown` эталона.
        expect(a.log.at(-1)).toBe("close");
        h.service.dispose();
    });

    it("dispose() расширения и Kill человека закрывают pty; поздний вывод не уходит", async () => {
        const h = setup();
        const a = makePty();
        const b = makePty();
        const disposed = h.ns.createTerminal({ name: "a", pty: a.pty });
        h.ns.createTerminal({ name: "b", pty: b.pty });
        await flush();
        a.write.fire("late");
        disposed.dispose();
        await flush();
        expect(a.log.at(-1)).toBe("close");
        expect(disposed.exitStatus?.reason).toBe(TerminalExitReason.Extension);
        await new Promise((r) => setTimeout(r, 20));
        expect(h.ptySessions[0].fed).toStrictEqual([]);

        h.service.closeInstance(h.service.getInstances()[0].id);
        await flush();
        expect(b.log.at(-1)).toBe("close");
        h.service.dispose();
    });

    it("close() расширения бросает — терминал всё равно закрыт и событие ушло", async () => {
        const h = setup();
        const p = makePty();
        p.pty.close = () => {
            throw new Error("boom");
        };
        const onClose = vi.fn();
        h.ns.onDidCloseTerminal(onClose);
        const terminal = h.ns.createTerminal({ name: "t", pty: p.pty });
        await flush();
        terminal.dispose();
        await flush();
        expect(onClose).toHaveBeenCalledWith(terminal);
        h.service.dispose();
    });

    it("pty без onDidClose/handleInput/setDimensions: open без размеров-эха, ввод и ресайз молча", async () => {
        const h = setup();
        const write = new EventEmitter<string>();
        const opened: unknown[] = [];
        const pty: vscode.Pseudoterminal = {
            onDidWrite: write.event,
            open: (dims) => opened.push(dims),
            close: () => undefined,
        };
        h.ns.createTerminal({ name: "min", pty });
        await flush();
        expect(opened).toStrictEqual([{ columns: 80, rows: 24 }]);
        h.ptySessions[0].write("x");
        h.ptySessions[0].resize(90, 20);
        await flush();
        write.fire("ok");
        await new Promise((r) => setTimeout(r, 20));
        await flush();
        expect(h.ptySessions[0].fed).toStrictEqual(["ok"]);
        h.service.dispose();
    });

    it("смерть субпроцесса закрывает его pty-терминалы, шеллы живут", async () => {
        const h = setup();
        h.ns.createTerminal({ name: "log", pty: makePty().pty });
        h.ns.createTerminal("shell");
        await flush();
        const sent: string[] = [];
        vi.spyOn(h.hostRpc, "notify").mockImplementation((method) => {
            sent.push(method);
        });
        h.attached.dispose();
        // Закрытие pty умершего субпроцесса ему же не пересказывается.
        expect(sent).toStrictEqual([]);
        expect(h.service.getInstances().map((i) => i.title)).toStrictEqual(["shell"]);
        expect(h.ptySessions[0].disposed).toBe(true);
        h.service.dispose();
    });
});
