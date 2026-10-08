import { describe, expect, it, vi } from "vitest";

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
    const adapter = new ExtensionTerminalAdapter(service, views.panelService);
    const events = {
        opened: vi.fn<IExtensionTerminalEvents["opened"]>(),
        closed: vi.fn<IExtensionTerminalEvents["closed"]>(),
        activeChanged: vi.fn<IExtensionTerminalEvents["activeChanged"]>(),
    };
    const subscription = adapter.subscribe(events);
    return { views, service, sessions, factoryCalls, adapter, events, subscription };
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
        // Метка закрытого больше ничего не адресует.
        h.adapter.create({ extHostId: 3 });
        h.adapter.sendText({ extHostId: 1 }, "x", true);
        expect(h.sessions[2].writes).toStrictEqual([]);

        h.subscription.dispose();
        h.events.opened.mockClear();
        h.service.newTerminal();
        expect(h.events.opened).not.toHaveBeenCalled();
        h.service.dispose();
    });
});
