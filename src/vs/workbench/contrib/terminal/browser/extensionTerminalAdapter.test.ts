import { describe, expect, it, vi } from "vitest";

import { FakeExtensionPtySession } from "../../../../../TestUtils/FakeExtensionPtySession.ts";
import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import type { IExtensionTerminalEvents } from "../../../api/common/iExtensionWindowSinks.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import type { ITerminalSessionOptions } from "../common/terminalSessionFactory.ts";

import { ExtensionTerminalAdapter } from "./extensionTerminalAdapter.ts";
import { TERMINAL_VIEW_ID, TerminalService } from "./terminalService.ts";

// Адаптер стока терминалов в одиночку: что он делает с адресами, которых нет,
// и как пересказывает инстансы. Сквозной контракт с проводом —
// services/extensions/node/customers/terminalCustomer.test.ts.

function setup() {
    const views = makeViewsHarness();
    const sessions: FakeTerminalSurface[] = [];
    const factoryCalls: ITerminalSessionOptions[] = [];
    const service = new TerminalService(views.panelService, views.service, createTestConfigurationService({}), (o) => {
        factoryCalls.push(o);
        const surface = new FakeTerminalSurface(o.shell ?? "/bin/bash");
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
    const events = {
        opened: vi.fn<IExtensionTerminalEvents["opened"]>(),
        closed: vi.fn<IExtensionTerminalEvents["closed"]>(),
        activeChanged: vi.fn<IExtensionTerminalEvents["activeChanged"]>(),
        ptyStart: vi.fn<IExtensionTerminalEvents["ptyStart"]>(),
        ptyInput: vi.fn<IExtensionTerminalEvents["ptyInput"]>(),
        ptyResize: vi.fn<IExtensionTerminalEvents["ptyResize"]>(),
    };
    const subscription = adapter.subscribe(events);
    return { views, service, sessions, ptySessions, factoryCalls, adapter, events, subscription };
}

describe("ExtensionTerminalAdapter", () => {
    it("адрес, которого нет, — молча: ни инстансов, ни панели, ни записи", () => {
        const h = setup();
        h.service.createInstance();
        const ghost = { extHostId: 42 };
        h.adapter.show(ghost, false);
        h.adapter.hide(ghost);
        h.adapter.sendText(ghost, "x", true);
        h.adapter.dispose(ghost);
        expect(h.views.panelService.visible).toBe(false);
        expect(h.sessions[0].writes).toStrictEqual([]);
        expect(h.service.getInstances()).toHaveLength(1);
        h.service.dispose();
    });

    it("hide без активного терминала панель не трогает", () => {
        const h = setup();
        h.views.panelService.setActiveView(TERMINAL_VIEW_ID);
        h.views.panelService.setVisible(true);
        h.adapter.hide({ extHostId: 42 });
        h.adapter.hide({ id: 1 });
        expect(h.views.panelService.visible).toBe(true);
        h.service.dispose();
    });

    it("повтор метки не заводит второй инстанс", () => {
        const h = setup();
        h.adapter.create({ extHostId: 1, name: "a" });
        h.adapter.create({ extHostId: 1, name: "b" });
        expect(h.service.getInstances().map((i) => i.title)).toStrictEqual(["a"]);
        h.service.dispose();
    });

    it("hide: показан не этот терминал или активна чужая вкладка — панель остаётся", () => {
        const h = setup();
        h.views.panelService.addView({ id: "output", title: "OUTPUT", content: null });
        h.adapter.create({ extHostId: 1, name: "a" });
        h.adapter.create({ extHostId: 2, name: "b" });
        h.adapter.show({ extHostId: 2 }, true);
        h.adapter.hide({ extHostId: 1 });
        expect(h.views.panelService.visible).toBe(true);
        h.views.panelService.setActiveView("output");
        h.adapter.hide({ extHostId: 2 });
        expect(h.views.panelService.visible).toBe(true);
        h.views.panelService.setActiveView(TERMINAL_VIEW_ID);
        h.adapter.hide({ id: h.service.getActiveInstance()?.id ?? -1 });
        expect(h.views.panelService.visible).toBe(false);
        h.service.dispose();
    });

    it("opened: своя метка и launch терминала расширения; у шелла человека — без метки", () => {
        const h = setup();
        h.service.setWorkingDirectory("/ws");
        h.adapter.create({
            extHostId: 7,
            name: "run",
            shellPath: "/bin/zsh",
            shellArgs: ["-l"],
            env: { A: null },
            strictEnv: true,
            message: "hi",
            hideFromUser: true,
        });
        h.service.newTerminal();
        expect(h.factoryCalls[0]).toStrictEqual({
            cols: 80,
            rows: 24,
            cwd: "/ws",
            shell: "/bin/zsh",
            args: ["-l"],
            env: { A: null },
            strictEnv: true,
            message: "hi",
        });
        expect(h.events.opened.mock.calls.map(([o]) => o)).toStrictEqual([
            {
                id: 1,
                extHostId: 7,
                name: "run",
                launch: {
                    name: "run",
                    shellPath: "/bin/zsh",
                    shellArgs: ["-l"],
                    cwd: "/ws",
                    env: { A: null },
                    hideFromUser: true,
                },
            },
            { id: 2, name: "bash", launch: { name: "bash", shellPath: "/bin/bash", cwd: "/ws" } },
        ]);
        h.service.dispose();
    });

    it("snapshot: все инстансы по порядку создания (фоновый — на своём месте) и активный", () => {
        const h = setup();
        h.service.newTerminal();
        h.adapter.create({ extHostId: 1, name: "bg", hideFromUser: true });
        h.service.newTerminal();
        const { terminals, activeId } = h.adapter.snapshot();
        expect(terminals.map((t) => [t.id, t.name, t.extHostId])).toStrictEqual([
            [1, "bash", undefined],
            [2, "bg", 1],
            [3, "bash", undefined],
        ]);
        expect(activeId).toBe(3);
        h.adapter.reset();
        expect(h.adapter.snapshot().terminals[1].extHostId).toBeUndefined();
        // После уборки старая метка ничего не адресует.
        h.adapter.sendText({ extHostId: 1 }, "x", true);
        expect(h.sessions[1].writes).toStrictEqual([]);
        h.service.dispose();
        expect(h.adapter.snapshot()).toStrictEqual({ terminals: [], activeId: null });
    });

    it("closed: код выхода только у вышедшего шелла; после отписки событий нет", () => {
        const h = setup();
        h.adapter.create({ extHostId: 1 });
        h.adapter.create({ extHostId: 2 });
        h.sessions[0].emitExit(9);
        h.adapter.dispose({ extHostId: 2 });
        expect(h.events.closed.mock.calls.map(([c]) => c)).toStrictEqual([
            { id: 1, code: 9, reason: "process" },
            { id: 2, reason: "extension" },
        ]);
        // Метка закрытого больше ничего не адресует — и её можно завести заново.
        h.adapter.create({ extHostId: 3 });
        h.adapter.sendText({ extHostId: 1 }, "x", true);
        expect(h.sessions[2].writes).toStrictEqual([]);
        h.adapter.create({ extHostId: 1, name: "again" });
        expect(h.service.getInstances().map((i) => i.title)).toStrictEqual(["bash", "again"]);

        h.subscription.dispose();
        h.events.opened.mockClear();
        h.service.newTerminal();
        expect(h.events.opened).not.toHaveBeenCalled();
        h.service.dispose();
    });

    it("pty: имя или пустое, ptyStart сразу с начальным размером, вывод и выход по адресу", () => {
        const h = setup();
        h.adapter.create({ extHostId: 1, pty: true, name: "log" });
        h.adapter.create({ extHostId: 2, pty: true });
        const [log, unnamed] = h.service.getInstances();
        expect([log.title, unnamed.title]).toStrictEqual(["log", ""]);
        expect(log.processId).toBeUndefined();
        expect(h.events.ptyStart.mock.calls).toStrictEqual([
            [log.id, 80, 24],
            [unnamed.id, 80, 24],
        ]);
        expect(h.sessions).toStrictEqual([]);

        h.adapter.ptyData({ extHostId: 1 }, "hello");
        h.adapter.ptyData({ extHostId: 9 }, "lost");
        h.adapter.ptyData({ id: 12345 }, "lost");
        expect(h.ptySessions[0].fed).toStrictEqual(["hello"]);

        h.ptySessions[0].write("k");
        h.ptySessions[0].resize(90, 20);
        expect(h.events.ptyInput).toHaveBeenCalledWith(log.id, "k");
        expect(h.events.ptyResize).toHaveBeenCalledWith(log.id, 90, 20);

        h.adapter.ptyExit({ extHostId: 9 }, 1);
        h.adapter.ptyExit({ extHostId: 1 }, 3);
        h.adapter.ptyExit({ extHostId: 2 }, undefined);
        expect(h.events.closed.mock.calls.map(([c]) => c)).toStrictEqual([
            { id: log.id, code: 3, reason: "process" },
            { id: unnamed.id, reason: "process" },
        ]);
        // Шелл не pty: ptyData/ptyExit мимо.
        h.adapter.create({ extHostId: 3 });
        h.adapter.ptyExit({ extHostId: 3 }, 0);
        h.adapter.ptyData({ extHostId: 3 }, "x");
        expect(h.service.getInstances()).toHaveLength(1);
        h.service.dispose();
    });

    it("подписчик — последний: отписка прежнего не глушит нового; вывод в закрытый pty не идёт", () => {
        const h = setup();
        const second = { ...h.events, ptyStart: vi.fn<IExtensionTerminalEvents["ptyStart"]>() };
        h.adapter.subscribe(second);
        h.subscription.dispose();
        h.adapter.create({ extHostId: 1, pty: true, name: "p" });
        expect(second.ptyStart).toHaveBeenCalledTimes(1);
        h.adapter.ptyExit({ extHostId: 1 }, 0);
        h.adapter.ptyData({ id: 1 }, "late");
        expect(h.ptySessions[0].fed).toStrictEqual([]);
        h.service.dispose();
    });

    it("reset закрывает pty-терминалы с причиной process", () => {
        const h = setup();
        h.adapter.create({ extHostId: 1, pty: true, name: "p" });
        h.adapter.reset();
        expect(h.events.closed.mock.calls.map(([c]) => c)).toStrictEqual([{ id: 1, reason: "process" }]);
        h.service.dispose();
    });

    it("без подписчика pty заводится молча; reset закрывает pty, шеллы живут", () => {
        const h = setup();
        h.subscription.dispose();
        h.adapter.create({ extHostId: 1, pty: true, name: "p" });
        h.adapter.create({ extHostId: 2, name: "s" });
        h.ptySessions[0].write("k");
        h.ptySessions[0].resize(90, 20);
        expect(h.events.ptyStart).not.toHaveBeenCalled();
        h.adapter.reset();
        expect(h.service.getInstances().map((i) => i.title)).toStrictEqual(["s"]);
        expect(h.ptySessions[0].disposed).toBe(true);
        h.service.dispose();
    });
});
