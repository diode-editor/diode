import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { FakeTerminalSurface } from "../../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTestConfigurationService } from "../../../../../../TestUtils/testConfigurationService.ts";
import type { HostRpc, SubprocessRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IExtensionTerminalSink } from "../../../../api/common/iExtensionWindowSinks.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { createTerminalNamespace } from "../../../../api/common/terminalNamespace.ts";
import { TerminalExitReason } from "../../../../api/common/vscodeTypes.ts";
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
    const adapter = new ExtensionTerminalAdapter(service, views.panelService);
    const customer = new TerminalCustomer(adapter);
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a) as unknown as HostRpc;
    const subRpc = new RpcEndpoint(b) as unknown as SubprocessRpc;
    const ns = createTerminalNamespace(subRpc);
    const attached = customer.attach({ rpc: hostRpc, logger: undefined });
    if (options.pushInitialState !== false) customer.pushInitialState();
    return { views, service, sessions, customer, ns, attached, hostRpc, subRpc };
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
            reset: () => calls.push("reset"),
        };
        const customer = new TerminalCustomer(sink);
        const [a, b] = createInProcessChannelPair();
        const attached = customer.attach({ rpc: new RpcEndpoint(a) as unknown as HostRpc, logger: undefined });
        const peer = new RpcEndpoint(b) as unknown as SubprocessRpc;
        const send = peer.notify.bind(peer) as (method: string, params: unknown) => void;
        send("terminal.create", { name: "no id" });
        send("terminal.show", { terminal: {} });
        send("terminal.hide", null);
        send("terminal.sendText", { terminal: { id: 1 } });
        send("terminal.dispose", { terminal: "x" });
        await flush();
        expect(calls).toStrictEqual([]);
        send("terminal.create", { extHostId: 1 });
        send("terminal.show", { terminal: { id: 1 } });
        send("terminal.hide", { terminal: { extHostId: 1 } });
        send("terminal.sendText", { terminal: { id: 1 }, text: "t" });
        send("terminal.dispose", { terminal: { id: 1 } });
        await flush();
        expect(calls).toStrictEqual(["create", "show", "hide", "sendText", "dispose"]);
        attached.dispose();
        expect(calls.at(-1)).toBe("reset");
    });
});
