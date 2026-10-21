import { describe, expect, it, vi } from "vitest";

import { FakeEditorTerminals } from "../../../../../TestUtils/FakeEditorTerminals.ts";
import { FakeExtensionPtySession } from "../../../../../TestUtils/FakeExtensionPtySession.ts";
import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import type { IExtensionTerminalEvents } from "../../../api/common/iExtensionWindowSinks.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import type { ITerminalSessionOptions } from "../common/terminalSessionFactory.ts";

import { ExtensionTerminalAdapter } from "./extensionTerminalAdapter.ts";
import { TERMINAL_VIEW_ID, TerminalService } from "./terminalService.ts";

function setup(settings: Record<string, unknown> = {}) {
    const views = makeViewsHarness();
    const sessions: FakeTerminalSurface[] = [];
    const factoryCalls: ITerminalSessionOptions[] = [];
    const configuration = createTestConfigurationService(settings);
    const service = new TerminalService(views.service, configuration, (o) => {
        factoryCalls.push(o);
        const surface = new FakeTerminalSurface(o.shell ?? "/bin/bash");
        sessions.push(surface);
        return surface;
    });
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
        configuration,
    );
    const events = {
        opened: vi.fn<IExtensionTerminalEvents["opened"]>(),
        closed: vi.fn<IExtensionTerminalEvents["closed"]>(),
        activeChanged: vi.fn<IExtensionTerminalEvents["activeChanged"]>(),
        ptyStart: vi.fn<IExtensionTerminalEvents["ptyStart"]>(),
        ptyInput: vi.fn<IExtensionTerminalEvents["ptyInput"]>(),
        ptyResize: vi.fn<IExtensionTerminalEvents["ptyResize"]>(),
    };
    const subscription = adapter.subscribe(events);
    return { views, service, sessions, ptySessions, factoryCalls, adapter, events, subscription, editorTerminals };
}

describe("ExtensionTerminalAdapter", () => {
    it("an unknown address is ignored silently: no instances, no panel, no write", () => {
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

    it("hide without an active terminal leaves the panel alone", () => {
        const h = setup();
        h.views.panelService.setActiveView(TERMINAL_VIEW_ID);
        h.views.panelService.setVisible(true);
        h.adapter.hide({ extHostId: 42 });
        h.adapter.hide({ id: 1 });
        expect(h.views.panelService.visible).toBe(true);
        h.service.dispose();
    });

    it("a repeated tag doesn't create a second instance", () => {
        const h = setup();
        h.adapter.create({ extHostId: 1, name: "a" });
        h.adapter.create({ extHostId: 1, name: "b" });
        expect(h.service.getInstances().map((i) => i.title)).toStrictEqual(["a"]);
        h.service.dispose();
    });

    it("hide: another terminal is shown or another tab is active — the panel stays", () => {
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

    it("opened: own tag and launch for an extension terminal; the user's shell has no tag", () => {
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

    it("snapshot: all instances in creation order (a background one in its place) and the active one", () => {
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
        h.adapter.sendText({ extHostId: 1 }, "x", true);
        expect(h.sessions[1].writes).toStrictEqual([]);
        h.service.dispose();
        expect(h.adapter.snapshot()).toStrictEqual({ terminals: [], activeId: null });
    });

    it("closed: exit code only for an exited shell; no events after unsubscribing", () => {
        const h = setup();
        h.adapter.create({ extHostId: 1 });
        h.adapter.create({ extHostId: 2 });
        h.sessions[0].emitExit(9);
        h.adapter.dispose({ extHostId: 2 });
        expect(h.events.closed.mock.calls.map(([c]) => c)).toStrictEqual([
            { id: 1, code: 9, reason: "process" },
            { id: 2, reason: "extension" },
        ]);
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

    it("pty: name or empty, ptyStart right away with the initial size, output and exit by address", () => {
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
        // A shell is not a pty: ptyData/ptyExit don't apply.
        h.adapter.create({ extHostId: 3 });
        h.adapter.ptyExit({ extHostId: 3 }, 0);
        h.adapter.ptyData({ extHostId: 3 }, "x");
        expect(h.service.getInstances()).toHaveLength(1);
        h.service.dispose();
    });

    it("the latest subscriber wins: unsubscribing the previous one doesn't silence the new one; output to a closed pty is dropped", () => {
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

    it("reset closes pty terminals with reason process", () => {
        const h = setup();
        h.adapter.create({ extHostId: 1, pty: true, name: "p" });
        h.adapter.reset();
        expect(h.events.closed.mock.calls.map(([c]) => c)).toStrictEqual([{ id: 1, reason: "process" }]);
        h.service.dispose();
    });

    it("without a subscriber a pty is created silently; reset closes the pty, shells survive", () => {
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

describe("ExtensionTerminalAdapter — task pty terminal (CustomExecution)", () => {
    it("pty instance: name, message, wait after exit; ptyStart right away; foreign to the subprocess (no tag)", () => {
        const h = setup();
        const id = h.adapter.createPtyInstance({ name: "pty task", message: "Executing", waitOnExit: "bye" });
        const instance = h.service.getInstance(id);
        expect(instance?.title).toBe("pty task");
        // A task terminal goes to the TERMINAL view, even with defaultLocation.
        expect(h.service.getInstances()).toStrictEqual([instance]);
        expect(h.ptySessions[0].printed).toStrictEqual(["Executing\r\n"]);
        expect(h.events.ptyStart).toHaveBeenCalledWith(id, 80, 24);
        expect(h.events.opened.mock.calls[0][0]).not.toHaveProperty("extHostId");
        // On pty exit the instance waits (waitOnExit) instead of closing.
        h.adapter.ptyExit({ id }, 1);
        expect(h.service.getInstance(id)).toBe(instance);
        h.service.dispose();
    });

    it("the exit code reflects the last pty exit: a code-less exit after a restart forgets the earlier code", () => {
        const h = setup();
        const id = h.adapter.createPtyInstance({ name: "t", waitOnExit: true });
        h.adapter.ptyExit({ id }, undefined);
        h.service.relaunchInstance(id, { name: "t", waitOnExit: true });
        h.adapter.ptyExit({ id }, 5);
        h.service.closeInstance(id);
        expect(h.events.closed).toHaveBeenCalledWith({ id, code: 5, reason: "user" });
        h.service.dispose();
    });

    it("no code on the last exit — closed without a code", () => {
        const h = setup();
        const id = h.adapter.createPtyInstance({ name: "t", waitOnExit: true });
        h.adapter.ptyExit({ id }, 3);
        h.service.relaunchInstance(id, { name: "t", waitOnExit: true });
        h.adapter.ptyExit({ id }, undefined);
        h.service.closeInstance(id);
        expect(h.events.closed).toHaveBeenCalledWith({ id, reason: "user" });
        h.service.dispose();
    });
});

describe("ExtensionTerminalAdapter — terminal location", () => {
    it("without location — terminal.integrated.defaultLocation: view goes to the view, editor to a tab", () => {
        const view = setup();
        view.adapter.create({ extHostId: 1 });
        expect(view.service.getInstances()).toHaveLength(1);
        expect(view.editorTerminals.created).toStrictEqual([]);
        view.service.dispose();

        const editor = setup({ "terminal.integrated.defaultLocation": "editor" });
        editor.adapter.create({ extHostId: 1 });
        editor.adapter.create({ extHostId: 2, location: 1 });
        expect(editor.editorTerminals.created).toStrictEqual([{ id: 1, location: {} }]);
        expect(editor.service.getInstances().map((i) => i.id)).toStrictEqual([2]);
        editor.service.dispose();
    });

    it("parent in the view — the new one goes to the view too; unknown parent — as without location", () => {
        const h = setup({ "terminal.integrated.defaultLocation": "editor" });
        h.adapter.create({ extHostId: 1, location: 1 });
        h.adapter.create({ extHostId: 2, location: { parentTerminal: { extHostId: 1 } } });
        h.adapter.create({ extHostId: 3, location: { parentTerminal: { id: 99 } } });
        expect(h.service.getInstances().map((i) => i.id)).toStrictEqual([1, 2]);
        expect(h.editorTerminals.created).toStrictEqual([{ id: 3, location: {} }]);
        h.service.dispose();
    });

    it("a new subprocess snapshot includes terminal tabs too; hiding an editor terminal leaves the view alone", () => {
        const h = setup();
        h.adapter.create({ extHostId: 1 });
        h.adapter.create({ extHostId: 2, location: 2 });
        expect(h.adapter.snapshot().terminals.map((t) => t.id)).toStrictEqual([1, 2]);

        h.adapter.show({ extHostId: 1 }, true);
        h.adapter.hide({ extHostId: 2 });
        expect(h.views.panelService.visible).toBe(true);
        h.adapter.show({ extHostId: 2 }, false);
        expect(h.editorTerminals.revealed).toStrictEqual([{ id: 2, preserveFocus: false }]);
        expect(() => {
            h.adapter.show({ id: 999 }, false);
        }).not.toThrow();
        h.service.dispose();
    });
});
