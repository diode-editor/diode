import { describe, expect, it, vi } from "vitest";

import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import type { ITerminalSessionOptions } from "../common/terminalSessionFactory.ts";

import { TERMINAL_VIEW_ID, TerminalService } from "./terminalService.ts";

// Инстансы для терминалов расширений (`window.createTerminal`): опции шелла,
// фоновые терминалы `hideFromUser`, `sendText` и причины закрытия.

function buildHarness() {
    const views = makeViewsHarness();
    const sessions: FakeTerminalSurface[] = [];
    const factoryCalls: ITerminalSessionOptions[] = [];
    let nextPid = 100;
    const service = new TerminalService(
        views.panelService,
        views.service,
        createTestConfigurationService({}),
        (options) => {
            factoryCalls.push(options);
            const surface = new FakeTerminalSurface(options.shell ?? "/bin/bash", nextPid++);
            sessions.push(surface);
            return surface;
        },
    );
    views.service.attachRegisteredContainers();
    views.panelService.setActiveView(TERMINAL_VIEW_ID);
    views.panelService.setVisible(true);
    const events: string[] = [];
    service.onDidCreateInstance((i) => events.push(`create:${String(i.id)}`));
    service.onDidOpenInstance((i) => events.push(`open:${String(i.id)}`));
    service.onDidCloseInstance((i) => events.push(`close:${String(i.id)}`));
    service.onDidDisposeInstance((i) => events.push(`dispose:${String(i.id)}`));
    service.onDidChangeActiveInstance((i) => events.push(`active:${i === null ? "null" : String(i.id)}`));
    return { views, service, sessions, factoryCalls, events };
}

describe("TerminalService — инстансы с опциями", () => {
    it("опции уходят фабрике поверх cwd сервиса; заголовок — имя; launch и pid на инстансе", () => {
        const h = buildHarness();
        h.service.setWorkingDirectory("/ws");
        const instance = h.service.createInstance({
            name: "Bazel Java: cleanup",
            shellPath: "/bin/zsh",
            shellArgs: ["-l"],
            env: { A: "1", B: null },
            strictEnv: true,
            message: "hi",
        });
        expect(h.factoryCalls).toEqual([
            {
                cols: 80,
                rows: 24,
                cwd: "/ws",
                shell: "/bin/zsh",
                args: ["-l"],
                env: { A: "1", B: null },
                strictEnv: true,
                message: "hi",
            },
        ]);
        expect(instance.title).toBe("Bazel Java: cleanup");
        expect(instance.processId).toBe(100);
        expect(instance.launch).toEqual({
            shellPath: "/bin/zsh",
            shellArgs: ["-l"],
            cwd: "/ws",
            env: { A: "1", B: null },
            hideFromUser: false,
        });
        expect(instance.exitCode).toBeUndefined();
        expect(instance.exitReason).toBeUndefined();
        expect(h.events).toEqual(["create:1", "open:1", "active:1"]);
        h.service.dispose();
    });

    it("без опций — как шелл человека: имя процесса, cwd процесса, фабрике только размер", () => {
        const h = buildHarness();
        const instance = h.service.createInstance({ name: "", cwd: "/explicit" });
        expect(h.factoryCalls).toEqual([{ cols: 80, rows: 24, cwd: "/explicit" }]);
        // Пустое имя у эталона — «не задано».
        expect(instance.title).toBe("bash");
        h.service.createInstance({ strictEnv: false });
        expect(h.factoryCalls[1]).toEqual({ cols: 80, rows: 24, cwd: process.cwd() });
        h.service.dispose();
    });

    it("sendText: переводы строк → Enter, shouldExecute добавляет Enter, если его нет; чужой id — мимо", () => {
        const h = buildHarness();
        const { id } = h.service.createInstance();
        h.service.sendText(id, "echo a\necho b\r\n", true);
        h.service.sendText(id, "ls\n", true);
        h.service.sendText(id, "partial", false);
        h.service.sendText(id, "run", true);
        h.service.sendText(999, "lost", true);
        expect(h.sessions[0].writes).toEqual(["echo a\recho b\r", "ls\r", "partial", "run\r"]);
        h.service.dispose();
    });
});

describe("TerminalService — фоновые инстансы (hideFromUser)", () => {
    it("фоновый: только create, в список вкладок не попадает, активный не меняется", () => {
        const h = buildHarness();
        const visible = h.service.createInstance();
        h.events.length = 0;
        const hidden = h.service.createInstance({ hideFromUser: true });
        expect(h.events).toEqual([`create:${String(hidden.id)}`]);
        expect(h.service.getInstances()).toEqual([visible]);
        expect(h.service.getBackgroundInstances()).toEqual([hidden]);
        expect(h.service.getActiveInstance()).toBe(visible);
        expect(h.service.getInstance(hidden.id)).toBe(hidden);
        expect(hidden.launch.hideFromUser).toBe(true);
        // Ввод в фоновый шелл доходит: процесс живой.
        h.service.sendText(hidden.id, "x", false);
        expect(h.sessions[1].writes).toEqual(["x"]);
        h.service.dispose();
    });

    it("showInstance фонового: переезжает в конец списка, open, становится активным", () => {
        const h = buildHarness();
        h.service.createInstance();
        const hidden = h.service.createInstance({ hideFromUser: true });
        h.events.length = 0;
        h.service.showInstance(hidden.id);
        expect(h.events).toEqual([`open:${String(hidden.id)}`, `active:${String(hidden.id)}`]);
        expect(h.service.getInstances().at(-1)).toBe(hidden);
        expect(h.service.getBackgroundInstances()).toEqual([]);
        // Повторный показ уже видимого — только активация (здесь no-op).
        h.service.showInstance(hidden.id);
        h.service.showInstance(999);
        expect(h.events).toHaveLength(2);
        h.service.dispose();
    });

    it("выход фонового шелла: dispose с кодом и причиной process, без close и смены активного", () => {
        const h = buildHarness();
        const visible = h.service.createInstance();
        const hidden = h.service.createInstance({ hideFromUser: true });
        h.events.length = 0;
        h.sessions[1].emitExit(2);
        expect(h.events).toEqual([`dispose:${String(hidden.id)}`]);
        expect(hidden.exitCode).toBe(2);
        expect(hidden.exitReason).toBe("process");
        expect(h.sessions[1].disposed).toBe(true);
        expect(h.service.getBackgroundInstances()).toEqual([]);
        expect(h.service.getInstance(hidden.id)).toBeNull();
        expect(h.service.getActiveInstance()).toBe(visible);
        h.service.dispose();
    });

    it("dispose сервиса убивает и фоновые сессии", () => {
        const h = buildHarness();
        h.service.createInstance({ hideFromUser: true });
        h.service.dispose();
        expect(h.sessions[0].disposed).toBe(true);
    });
});

describe("TerminalService — причины закрытия", () => {
    it("выход шелла: код и причина process уже на инстансе в close и dispose", () => {
        const h = buildHarness();
        const instance = h.service.createInstance();
        const seen = vi.fn();
        h.service.onDidDisposeInstance((i) => seen(i.exitCode, i.exitReason));
        h.service.onDidCloseInstance((i) => seen(i.exitCode, i.exitReason));
        h.sessions[0].emitExit(7);
        expect(seen.mock.calls).toEqual([
            [7, "process"],
            [7, "process"],
        ]);
        expect(instance.exitCode).toBe(7);
        expect(h.events).toEqual(["create:1", "open:1", "active:1", "close:1", "dispose:1", "active:null"]);
        h.service.dispose();
    });

    it("closeInstance без причины — user (команды Kill); с причиной extension — она; фоновый тоже закрывается", () => {
        const h = buildHarness();
        const killed = h.service.createInstance();
        const disposed = h.service.createInstance();
        const hidden = h.service.createInstance({ hideFromUser: true });
        h.service.closeInstance(killed.id);
        h.service.closeInstance(disposed.id, "extension");
        h.service.closeInstance(hidden.id, "extension");
        expect([killed.exitReason, disposed.exitReason, hidden.exitReason]).toEqual(["user", "extension", "extension"]);
        expect([killed.exitCode, disposed.exitCode]).toEqual([undefined, undefined]);
        expect(h.sessions.map((s) => s.disposed)).toEqual([true, true, true]);
        expect(h.service.getInstances()).toEqual([]);
        h.service.closeInstance(undefined);
        h.service.closeInstance(12345);
        h.service.dispose();
    });
});
