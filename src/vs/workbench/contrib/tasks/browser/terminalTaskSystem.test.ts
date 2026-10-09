import { describe, expect, it, vi } from "vitest";

import { FakeExtensionPtySession } from "../../../../../TestUtils/FakeExtensionPtySession.ts";
import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { makeTask, taskVariables } from "../../../../../TestUtils/taskFixtures.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { formatMessageForTerminal } from "../../../../platform/terminal/common/terminalStrings.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { TERMINAL_VIEW_ID, TerminalService } from "../../terminal/browser/terminalService.ts";
import type { IExtensionPtyTerminalOptions } from "../../terminal/common/extensionPtyTerminals.ts";
import type { ITerminalSessionOptions } from "../../terminal/common/terminalSessionFactory.ts";
import type { ITaskVariableContext } from "../common/taskVariables.ts";
import { TaskVariableError } from "../common/taskVariables.ts";

import { type ITaskEvent, TerminalTaskSystem, waitOnExitOf } from "./terminalTaskSystem.ts";

// Исполнение задач во встроенном терминале: настоящий TerminalService с
// фейковыми сессиями — видно, с чем создан и перезапущен терминал, что
// напечатано, в каком порядке шли события.

const REUSE_MESSAGE = "Terminal will be reused by tasks, press any key to close it.";
const executing = (text: string): string =>
    formatMessageForTerminal(`Executing task: ${text}`, { excludeLeadingNewLine: true });

function buildHarness() {
    const views = makeViewsHarness();
    const sessions: FakeTerminalSurface[] = [];
    const factoryCalls: ITerminalSessionOptions[] = [];
    let nextPid = 100;
    const terminals = new TerminalService(
        views.panelService,
        views.service,
        createTestConfigurationService({}),
        (options) => {
            factoryCalls.push(options);
            const session = new FakeTerminalSurface(options.shell ?? "/bin/sh", nextPid++);
            sessions.push(session);
            return session;
        },
    );
    // Соседняя вкладка панели — чтобы «панель видна, но не на терминале».
    views.service.registerContainer({ id: "other", title: "OTHER", location: "panel", order: 1 });
    views.service.registerView({
        id: "other",
        containerId: "other",
        title: "OTHER",
        order: 1,
        body: null,
        placeholder: "",
        focus: () => undefined,
    });
    views.service.attachRegisteredContainers();
    const system = new TerminalTaskSystem(terminals, views.panelService, () => "/bin/bash");
    const events: string[] = [];
    const raw: ITaskEvent[] = [];
    system.onDidStateChange((event) => {
        raw.push(event);
        events.push(describeEvent(event));
    });
    const focus = vi.fn();
    terminals.onDidRequestFocus(focus);
    let variables = taskVariables();
    const context = () => ({ variables, platform: "linux" as const });
    const setVariables = (overrides: Partial<ITaskVariableContext>): void => {
        variables = taskVariables(overrides);
    };
    const dispose = (): void => {
        system.dispose();
        terminals.dispose();
    };
    return { views, terminals, sessions, factoryCalls, system, events, raw, focus, context, setVariables, dispose };
}

function describeEvent(event: ITaskEvent): string {
    switch (event.kind) {
        case "changed":
            return "changed";
        case "processStarted":
            return `processStarted:${event.task.name}:${String(event.processId)}`;
        case "processEnded":
            return `processEnded:${event.task.name}:${String(event.exitCode)}`;
        case "terminated":
            return `terminated:${event.task.name}:${event.exitReason}`;
        default:
            return `${event.kind}:${event.task.name}:${String(event.terminalId)}`;
    }
}

describe("TerminalTaskSystem — запуск шелл-задачи", () => {
    it("терминал: имя задачи, системный шелл с -c и командной строкой, папка, сообщение, ожидание; события по порядку", async () => {
        const h = buildHarness();
        const task = makeTask({ label: "build", command: { name: "make", args: ["all"] } });
        const result = h.system.run(task, h.context());
        expect(result.kind).toBe("started");
        expect(h.factoryCalls).toStrictEqual([
            {
                cols: 80,
                rows: 24,
                cwd: "/ws",
                shell: "/bin/bash",
                args: ["-c", "make all"],
                message: executing("make all"),
            },
        ]);
        const [instance] = h.terminals.getInstances();
        expect(instance.title).toBe("build");
        expect(h.events).toStrictEqual(["start:build:1", "active:build:1", "processStarted:build:100", "changed"]);
        expect(h.system.getActiveTasks()).toStrictEqual([task]);

        h.sessions[0].emitExit(0);
        await expect(result.promise).resolves.toStrictEqual({ exitCode: 0 });
        expect(h.events.slice(4)).toStrictEqual(["changed", "processEnded:build:0", "inactive:build:1", "end:build:1"]);
        expect(h.system.getActiveTasks()).toStrictEqual([]);
        // Терминал остался ждать и напечатал сообщение о переиспользовании.
        expect(h.terminals.getInstance(instance.id)).toBe(instance);
        expect(h.sessions[0].printed).toStrictEqual([
            formatMessageForTerminal(REUSE_MESSAGE, { excludeLeadingNewLine: true }),
        ]);
        h.dispose();
    });

    it("определение в событии старта — без _key, с подставленными переменными", () => {
        const h = buildHarness();
        h.system.run(
            makeTask({
                definition: {
                    target: "${workspaceFolder}/x",
                    list: ["${env:A}", 1],
                    nested: { v: "${foo}" },
                    none: null,
                },
            }),
            {
                variables: taskVariables({ env: { A: "a" } }),
                platform: "linux",
            },
        );
        const start = h.raw.find((e) => e.kind === "start");
        expect(start?.kind === "start" ? start.resolvedDefinition : undefined).toStrictEqual({
            type: "shell",
            target: "/ws/x",
            list: ["a", 1],
            nested: { v: "${foo}" },
            none: null,
        });
        h.dispose();
    });

    it("переменные в команде, аргументах, cwd, env и шелле; относительный cwd — от папки", () => {
        const h = buildHarness();
        h.system.run(
            makeTask({
                command: {
                    name: "${env:TOOL}",
                    args: ["${workspaceFolderBasename}", { value: "${env:Q} q", quoting: "strong" }],
                    options: {
                        cwd: "sub/${env:DIR}",
                        env: { OUT: "${workspaceFolder}/out" },
                        shell: { executable: "/usr/bin/${env:SH}", args: ["-lc"] },
                    },
                },
            }),
            { variables: taskVariables({ env: { TOOL: "make", DIR: "d", Q: "x", SH: "zsh" } }), platform: "linux" },
        );
        expect(h.factoryCalls[0]).toStrictEqual({
            cols: 80,
            rows: 24,
            cwd: "/ws/sub/d",
            shell: "/usr/bin/zsh",
            args: ["-lc", "make ws 'x q'"],
            env: { OUT: "/ws/out" },
            message: executing("make ws 'x q'"),
        });
        h.dispose();
    });

    it("абсолютный cwd — как есть; без папки и без cwd — cwd терминала", () => {
        const h = buildHarness();
        h.system.run(makeTask({ label: "a", command: { options: { cwd: "/abs" } } }), h.context());
        h.system.run(
            makeTask({ label: "b", folder: null, extension: { type: "t", extensionId: "e", source: "S" } }),
            h.context(),
        );
        h.system.run(
            makeTask({
                label: "c",
                folder: null,
                extension: { type: "t2", extensionId: "e", source: "S" },
                command: { options: { cwd: "rel" } },
            }),
            h.context(),
        );
        expect(h.factoryCalls.map((c) => c.cwd)).toStrictEqual(["/abs", process.cwd(), "rel"]);
        h.dispose();
    });

    it("echo: false — без сообщения; заданный шелл без args — без -c", () => {
        const h = buildHarness();
        h.system.run(
            makeTask({ presentation: { echo: false }, command: { options: { shell: { executable: "/bin/fish" } } } }),
            h.context(),
        );
        expect(h.factoryCalls[0]).toStrictEqual({
            cols: 80,
            rows: 24,
            cwd: "/ws",
            shell: "/bin/fish",
            args: ["echo build"],
        });
        h.dispose();
    });

    it("процесс: исполняемый файл и аргументы значениями, сообщение — команда через пробел", () => {
        const h = buildHarness();
        h.system.run(
            makeTask({
                command: {
                    runtime: "process",
                    name: { value: "node", quoting: "weak" },
                    args: ["a b", { value: "c", quoting: "escape" }],
                },
            }),
            h.context(),
        );
        expect(h.factoryCalls[0]).toStrictEqual({
            cols: 80,
            rows: 24,
            cwd: "/ws",
            shell: "node",
            args: ["a b", "c"],
            message: executing("node a b c"),
        });
        h.dispose();
    });

    it("процесс без команды — пустая строка; echo: false — без сообщения", () => {
        const h = buildHarness();
        h.system.run(
            makeTask({
                command: { runtime: "process", name: undefined, args: undefined },
                presentation: { echo: false },
            }),
            h.context(),
        );
        expect(h.factoryCalls[0]).toStrictEqual({ cols: 80, rows: 24, cwd: "/ws", shell: "", args: [] });
        h.dispose();
    });

    it("неподставимая переменная — исключение до создания терминала, событий нет", () => {
        const h = buildHarness();
        expect(() => h.system.run(makeTask({ command: { name: "${input:x}" } }), h.context())).toThrow(
            TaskVariableError,
        );
        expect(h.factoryCalls).toStrictEqual([]);
        expect(h.events).toStrictEqual([]);
        h.dispose();
    });

    it("та же задача уже бежит — `active` с её обещанием, второго терминала нет", () => {
        const h = buildHarness();
        const task = makeTask();
        const first = h.system.run(task, h.context());
        const second = h.system.run(makeTask(), h.context());
        expect(second.kind).toBe("active");
        expect(second.task).toBe(task);
        expect(second.promise).toBe(first.promise);
        expect(h.factoryCalls).toHaveLength(1);
        h.dispose();
    });
});

describe("TerminalTaskSystem — показ терминала", () => {
    it("reveal always — панель на вкладке TERMINAL, без фокуса", () => {
        const h = buildHarness();
        h.system.run(makeTask(), h.context());
        expect(h.views.panelService.visible).toBe(true);
        expect(h.views.panelService.getActiveViewId()).toBe(TERMINAL_VIEW_ID);
        expect(h.focus).not.toHaveBeenCalled();
        h.dispose();
    });

    it("focus — панель и фокус в терминал даже при reveal never", () => {
        const h = buildHarness();
        h.system.run(makeTask({ presentation: { reveal: "never", focus: true } }), h.context());
        expect(h.views.panelService.visible).toBe(true);
        expect(h.focus).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    it("silent — не показывать при старте и при коде 0, показать при ненулевом", () => {
        const h = buildHarness();
        h.system.run(makeTask({ label: "a", presentation: { reveal: "silent" } }), h.context());
        expect(h.views.panelService.visible).toBe(false);
        h.sessions[0].emitExit(0);
        expect(h.views.panelService.visible).toBe(false);
        h.system.run(makeTask({ label: "b", presentation: { reveal: "silent", panel: "new" } }), h.context());
        h.sessions[1].emitExit(2);
        expect(h.views.panelService.visible).toBe(true);
        expect(h.terminals.getActiveInstance()?.id).toBe(2);
        // Показ после падения — без фокуса.
        expect(h.focus).not.toHaveBeenCalled();
        h.dispose();
    });

    it("silent: задачу остановили — терминал не показывается (показ — только при выходе процесса)", async () => {
        const h = buildHarness();
        // Ещё один терминал открыт — панель не прячется вместе с последним.
        h.terminals.createInstance({});
        const task = makeTask({ presentation: { reveal: "silent" } });
        h.system.run(task, h.context());
        await h.system.terminate(task);
        expect(h.views.panelService.visible).toBe(false);
        h.dispose();
    });

    it("never — не показывать ни при старте, ни при ошибке", () => {
        const h = buildHarness();
        h.system.run(makeTask({ presentation: { reveal: "never" } }), h.context());
        h.sessions[0].emitExit(1);
        expect(h.views.panelService.visible).toBe(false);
        h.dispose();
    });

    it("revealTask/isTaskVisible: бегущей и отработавшей задачи; без терминала — false", () => {
        const h = buildHarness();
        const a = makeTask({ label: "a", presentation: { reveal: "never" } });
        const b = makeTask({ label: "b", presentation: { reveal: "never", panel: "new" } });
        expect(h.system.revealTask(a)).toBe(false);
        expect(h.system.isTaskVisible(a)).toBe(false);
        h.system.run(a, h.context());
        h.system.run(b, h.context());
        expect(h.system.isTaskVisible(a)).toBe(false);
        expect(h.system.revealTask(a)).toBe(true);
        expect(h.system.isTaskVisible(a)).toBe(true);
        expect(h.system.isTaskVisible(b)).toBe(false);
        h.sessions[0].emitExit(0);
        // Отработавшая — терминал, где она бежала последней.
        h.views.panelService.setVisible(false);
        expect(h.system.revealTask(a)).toBe(true);
        expect(h.views.panelService.visible).toBe(true);
        expect(h.system.isTaskVisible(a)).toBe(true);
        h.views.panelService.setActiveView("other");
        expect(h.system.isTaskVisible(a)).toBe(false);
        h.views.panelService.setActiveView(TERMINAL_VIEW_ID);
        h.views.panelService.setVisible(false);
        expect(h.system.isTaskVisible(a)).toBe(false);
        // revealTask показывает без фокуса.
        expect(h.focus).not.toHaveBeenCalled();
        // Задача, которая нигде не бежала, чужой терминал своим не считает.
        const c = makeTask({ label: "c" });
        expect(h.system.revealTask(c)).toBe(false);
        h.views.panelService.setVisible(true);
        expect(h.system.isTaskVisible(c)).toBe(false);
        h.dispose();
    });

    it("isTaskVisible: без терминалов вовсе — false, даже на открытой вкладке TERMINAL", () => {
        const h = buildHarness();
        h.views.panelService.setActiveView(TERMINAL_VIEW_ID);
        h.views.panelService.setVisible(true);
        expect(h.system.isTaskVisible(makeTask())).toBe(false);
        h.dispose();
    });

    it("revealTask бегущей — её нынешний терминал, а не прежний, где она отработала", () => {
        const h = buildHarness();
        const task = makeTask({ presentation: { reveal: "never", panel: "new" } });
        h.system.run(task, h.context());
        h.sessions[0].emitExit(0);
        h.system.run(task, h.context());
        h.terminals.showInstance(1);
        expect(h.system.revealTask(task)).toBe(true);
        expect(h.terminals.getActiveInstance()?.id).toBe(2);
        h.dispose();
    });
});

describe("TerminalTaskSystem — терминал задачи по presentation.panel", () => {
    it("shared: своя ждущая задача перезапускает свой терминал на месте (clear доезжает)", () => {
        const h = buildHarness();
        const task = makeTask({ presentation: { clear: true } });
        h.system.run(task, h.context());
        h.sessions[0].emitExit(0);
        h.system.run(task, h.context());
        expect(h.factoryCalls).toHaveLength(1);
        expect(h.sessions[0].relaunches).toStrictEqual([
            {
                cwd: "/ws",
                shell: "/bin/bash",
                args: ["-c", "echo build"],
                message: executing("echo build"),
                clear: true,
            },
        ]);
        expect(h.events.filter((e) => e.startsWith("start"))).toStrictEqual(["start:build:1", "start:build:1"]);
        h.dispose();
    });

    it("shared: ждущий терминал другой задачи без группы переиспользуется, имя — новое", () => {
        const h = buildHarness();
        h.system.run(makeTask({ label: "a" }), h.context());
        h.sessions[0].emitExit(0);
        h.system.run(makeTask({ label: "b" }), h.context());
        expect(h.factoryCalls).toHaveLength(1);
        expect(h.terminals.getInstances()[0].title).toBe("b");
        expect(h.sessions[0].relaunches[0]).not.toHaveProperty("clear");
        h.dispose();
    });

    it("shared: группа должна совпасть; последним освободившийся — первым", () => {
        const h = buildHarness();
        h.system.run(makeTask({ label: "a", presentation: { group: "g" } }), h.context());
        h.system.run(makeTask({ label: "b", presentation: { group: "g", panel: "shared" } }), h.context());
        h.system.run(makeTask({ label: "c" }), h.context());
        h.sessions[0].emitExit(0);
        h.sessions[1].emitExit(0);
        h.sessions[2].emitExit(0);
        // Без группы — только терминал задачи без группы (c, id 3).
        h.system.run(makeTask({ label: "d" }), h.context());
        expect(h.sessions[2].relaunches).toHaveLength(1);
        // Группа g — последний освободившийся из g (b, id 2).
        h.system.run(makeTask({ label: "e", presentation: { group: "g" } }), h.context());
        expect(h.sessions[1].relaunches).toHaveLength(1);
        expect(h.sessions[0].relaunches).toHaveLength(0);
        // Чужой группы нет ни у кого — новый терминал.
        h.system.run(makeTask({ label: "f", presentation: { group: "other" } }), h.context());
        expect(h.factoryCalls).toHaveLength(4);
        h.dispose();
    });

    it("shared: повторный выход той же задачи не плодит записей; перезапуск забирает свою", () => {
        const h = buildHarness();
        const a = makeTask({ label: "a" });
        h.system.run(a, h.context());
        h.sessions[0].emitExit(0);
        h.system.run(a, h.context());
        h.sessions[0].emitExit(0);
        h.system.run(makeTask({ label: "b" }), h.context());
        h.system.run(makeTask({ label: "c" }), h.context());
        // Ждущий терминал был один: b его забрал, c получил новый.
        expect(h.factoryCalls).toHaveLength(2);
        h.dispose();
    });

    it("dedicated: только свой терминал; чужой ждущий не берёт; свой — не отдаёт shared", () => {
        const h = buildHarness();
        const a = makeTask({ label: "a", presentation: { panel: "dedicated" } });
        h.system.run(a, h.context());
        h.sessions[0].emitExit(0);
        h.system.run(makeTask({ label: "b" }), h.context());
        expect(h.factoryCalls).toHaveLength(2);
        h.system.run(a, h.context());
        expect(h.sessions[0].relaunches).toHaveLength(1);
        h.sessions[0].emitExit(0);
        h.system.run(makeTask({ label: "c", presentation: { panel: "dedicated" } }), h.context());
        expect(h.factoryCalls).toHaveLength(3);
        h.dispose();
    });

    it("new: терминал всегда новый, после выхода — «Press any key to close the terminal.»", () => {
        const h = buildHarness();
        const task = makeTask({ presentation: { panel: "new" } });
        h.system.run(task, h.context());
        h.sessions[0].emitExit(0);
        expect(h.sessions[0].printed).toStrictEqual([
            formatMessageForTerminal("Press any key to close the terminal.", { excludeLeadingNewLine: true }),
        ]);
        h.system.run(task, h.context());
        expect(h.factoryCalls).toHaveLength(2);
        h.dispose();
    });

    it("закрытый человеком ждущий терминал забывается — следующий запуск заводит новый", () => {
        const h = buildHarness();
        const shared = makeTask({ label: "a" });
        const dedicated = makeTask({ label: "b", presentation: { panel: "dedicated" } });
        h.system.run(shared, h.context());
        h.system.run(dedicated, h.context());
        h.sessions[0].emitExit(0);
        h.sessions[1].emitExit(0);
        h.sessions[0].write("x");
        h.sessions[1].write("x");
        h.system.run(shared, h.context());
        h.system.run(dedicated, h.context());
        expect(h.factoryCalls).toHaveLength(4);
        // Событий конца второй раз нет: задачи уже кончились.
        expect(h.events.filter((e) => e.startsWith("end"))).toStrictEqual(["end:a:1", "end:b:2"]);
        h.dispose();
    });

    it("shared: свой ждущий терминал — раньше любого последним освободившегося", () => {
        const h = buildHarness();
        h.system.run(makeTask({ label: "a" }), h.context());
        h.system.run(makeTask({ label: "b" }), h.context());
        h.sessions[0].emitExit(0);
        h.sessions[1].emitExit(0);
        h.system.run(makeTask({ label: "a" }), h.context());
        expect(h.sessions[0].relaunches).toHaveLength(1);
        expect(h.sessions[1].relaunches).toHaveLength(0);
        h.dispose();
    });

    it("shared: закрытый человеком ждущий терминал уходит из очереди — следующий берёт живой", () => {
        const h = buildHarness();
        h.system.run(makeTask({ label: "a" }), h.context());
        h.system.run(makeTask({ label: "b" }), h.context());
        h.sessions[0].emitExit(0);
        h.sessions[1].emitExit(0);
        // Последним освободился b — его и закрыли.
        h.sessions[1].write("x");
        h.system.run(makeTask({ label: "c" }), h.context());
        expect(h.sessions[0].relaunches).toHaveLength(1);
        expect(h.factoryCalls).toHaveLength(2);
        h.dispose();
    });

    it("закрытый терминал задачи забывается: revealTask ему не показывает; не-задачный — без ошибок", () => {
        const h = buildHarness();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const task = makeTask();
        h.system.run(task, h.context());
        h.sessions[0].emitExit(0);
        h.sessions[0].write("x");
        expect(h.system.revealTask(task)).toBe(false);
        const plain = h.terminals.createInstance({});
        h.terminals.closeInstance(plain.id, "user");
        expect(errors).not.toHaveBeenCalled();
        errors.mockRestore();
        h.dispose();
    });

    it("shared-задача свой терминал как dedicated не держит: став dedicated, заводит новый", () => {
        const h = buildHarness();
        h.system.run(makeTask({ label: "a" }), h.context());
        h.sessions[0].emitExit(0);
        // b забрал ждущий терминал a и тоже отработал.
        h.system.run(makeTask({ label: "b" }), h.context());
        h.sessions[0].emitExit(0);
        h.system.run(makeTask({ label: "a", presentation: { panel: "dedicated" } }), h.context());
        expect(h.factoryCalls).toHaveLength(2);
        expect(h.sessions[0].relaunches).toHaveLength(1);
        h.dispose();
    });

    it("переиспользованный терминал получает env новой задачи", () => {
        const h = buildHarness();
        h.system.run(makeTask({ label: "a" }), h.context());
        h.sessions[0].emitExit(0);
        h.system.run(makeTask({ label: "b", command: { options: { env: { X: "1" } } } }), h.context());
        expect(h.sessions[0].relaunches[0].env).toStrictEqual({ X: "1" });
        h.dispose();
    });

    it("ждущий терминал не перезапустился — задача получает новый", () => {
        const h = buildHarness();
        const task = makeTask({ label: "a" });
        h.system.run(task, h.context());
        h.sessions[0].emitExit(0);
        vi.spyOn(h.terminals, "relaunchInstance").mockReturnValue(undefined);
        h.system.run(task, h.context());
        expect(h.factoryCalls).toHaveLength(2);
        expect(h.events).toContain("start:a:2");
        h.dispose();
    });

    it("close: true — терминал закрывается сам, переиспользовать нечего", () => {
        const h = buildHarness();
        const task = makeTask({ presentation: { close: true } });
        h.system.run(task, h.context());
        h.sessions[0].emitExit(0);
        expect(h.terminals.getInstances()).toStrictEqual([]);
        h.system.run(task, h.context());
        expect(h.factoryCalls).toHaveLength(2);
        h.dispose();
    });
});

describe("TerminalTaskSystem — остановка", () => {
    it("terminate: терминал закрыт, задача кончается Terminated(user), обещание — без кода", async () => {
        const h = buildHarness();
        const task = makeTask();
        const result = h.system.run(task, h.context());
        h.events.length = 0;
        await expect(h.system.terminate(task)).resolves.toBe(true);
        await expect(result.promise).resolves.toStrictEqual({ exitCode: undefined });
        expect(h.events).toStrictEqual([
            "changed",
            "processEnded:build:undefined",
            "inactive:build:1",
            "end:build:1",
            "terminated:build:user",
        ]);
        expect(h.terminals.getInstances()).toStrictEqual([]);
        // Закрытый терминал не переиспользуется.
        h.system.run(task, h.context());
        expect(h.factoryCalls).toHaveLength(2);
        h.dispose();
    });

    it("terminate не бегущей — false; terminateAll — все бегущие", async () => {
        const h = buildHarness();
        await expect(h.system.terminate(makeTask())).resolves.toBe(false);
        h.system.run(makeTask({ label: "a" }), h.context());
        h.system.run(makeTask({ label: "b" }), h.context());
        await h.system.terminateAll();
        expect(h.system.getActiveTasks()).toStrictEqual([]);
        expect(h.events.filter((e) => e.startsWith("terminated"))).toStrictEqual([
            "terminated:a:user",
            "terminated:b:user",
        ]);
        h.dispose();
    });

    it("Kill терминала бегущей задачи снаружи — тоже Terminated с причиной закрытия", () => {
        const h = buildHarness();
        h.system.run(makeTask(), h.context());
        h.terminals.closeInstance(1, "extension");
        expect(h.events.at(-1)).toBe("terminated:build:extension");
        h.dispose();
    });
});

describe("TerminalTaskSystem — повтор последней", () => {
    it("нечего повторять — undefined", () => {
        const h = buildHarness();
        expect(h.system.rerun(h.context())).toBeUndefined();
        h.dispose();
    });

    it("reevaluateOnRerun — переменные заново; без него — то же, что в прошлый раз", () => {
        const h = buildHarness();
        h.setVariables({ env: { V: "1" } });
        h.system.run(makeTask({ label: "a", command: { name: "echo ${env:V}" } }), h.context());
        h.sessions[0].emitExit(0);
        h.setVariables({ env: { V: "2" } });
        h.system.rerun(h.context());
        expect(h.sessions[0].relaunches[0].args).toStrictEqual(["-c", "echo 2"]);
        h.sessions[0].emitExit(0);

        h.setVariables({ env: { V: "1" } });
        h.system.run(
            makeTask({ label: "b", command: { name: "echo ${env:V}" }, runOptions: { reevaluateOnRerun: false } }),
            h.context(),
        );
        h.sessions[0].emitExit(0);
        h.setVariables({ env: { V: "2" } });
        const result = h.system.rerun(h.context());
        expect(result?.kind).toBe("started");
        expect(h.sessions[0].relaunches.at(-1)?.args).toStrictEqual(["-c", "echo 1"]);
        h.dispose();
    });

    it("повтор бегущей без переоценки — `active`, нового терминала нет", () => {
        const h = buildHarness();
        const run = h.system.run(makeTask({ runOptions: { reevaluateOnRerun: false } }), h.context());
        const again = h.system.rerun(h.context());
        expect(again?.kind).toBe("active");
        expect(again?.promise).toBe(run.promise);
        expect(h.factoryCalls).toHaveLength(1);
        h.dispose();
    });
});

describe("TerminalTaskSystem — CustomExecution", () => {
    const customTask = (overrides: Parameters<typeof makeTask>[0] = {}) =>
        makeTask({
            label: "pty",
            command: { runtime: "custom" },
            extension: { type: "custom", extensionId: "pub.ext", source: "Ext" },
            ...overrides,
        });

    function withPty(h: ReturnType<typeof buildHarness>) {
        const created: IExtensionPtyTerminalOptions[] = [];
        const sessions: FakeExtensionPtySession[] = [];
        h.system.setCustomExecutionTerminals({
            createPtyInstance: (options) => {
                created.push(options);
                const session = new FakeExtensionPtySession({
                    cols: 80,
                    rows: 24,
                    name: options.name,
                    onInput: () => undefined,
                    onResize: () => undefined,
                });
                sessions.push(session);
                return h.terminals.createInstance({ ...options, session }).id;
            },
        });
        return { created, sessions };
    }

    it("без моста pty — отказ с объяснением", () => {
        const h = buildHarness();
        expect(() => h.system.run(customTask(), h.context())).toThrow(
            "Tasks with a custom execution need the extension host, which is not running.",
        );
        h.system.setCustomExecutionTerminals(undefined);
        expect(() => h.system.run(customTask(), h.context())).toThrow(/custom execution/u);
        h.dispose();
    });

    it("инстанс на pty: имя, «Executing task: <подпись>», ожидание; processStarted с pid -1", () => {
        const h = buildHarness();
        const { created } = withPty(h);
        h.system.run(customTask(), h.context());
        expect(created).toHaveLength(1);
        expect(created[0].name).toBe("pty");
        expect(created[0].message).toBe(executing("Ext: pty"));
        expect(typeof created[0].waitOnExit).toBe("function");
        expect(h.events).toContain("processStarted:pty:-1");
        h.dispose();
    });

    it("echo: false — без сообщения; повторный запуск переиспользует свой pty-терминал, но не шелловый", () => {
        const h = buildHarness();
        const { created, sessions } = withPty(h);
        h.system.run(customTask({ presentation: { echo: false } }), h.context());
        expect(created[0]).not.toHaveProperty("message");
        sessions[0].exit(0);
        // Шелловая задача не берёт pty-терминал, а pty-задача — шелловый.
        h.system.run(makeTask({ label: "sh" }), h.context());
        expect(h.factoryCalls).toHaveLength(1);
        h.sessions[0].emitExit(0);
        h.system.run(customTask({ presentation: { echo: false } }), h.context());
        expect(created).toHaveLength(1);
        expect(sessions[0].relaunches).toHaveLength(1);
        h.dispose();
    });

    it("dedicated: свой терминал другого вида не берётся; закрытие прежнего не отнимает новый", () => {
        const h = buildHarness();
        const { created, sessions } = withPty(h);
        const shell = customTask({
            command: { runtime: "shell", name: "echo pty" },
            presentation: { panel: "dedicated" },
        });
        const pty = customTask({ presentation: { panel: "dedicated" } });
        h.system.run(shell, h.context());
        h.sessions[0].emitExit(0);
        // Свой терминал шелловый — pty-задача заводит свой.
        h.system.run(pty, h.context());
        expect(created).toHaveLength(1);
        expect(h.sessions[0].relaunches).toHaveLength(0);
        sessions[0].exit(0);
        // Человек закрыл прежний шелловый терминал задачи — pty-терминал за ней остаётся.
        h.sessions[0].write("x");
        h.system.run(pty, h.context());
        expect(created).toHaveLength(1);
        expect(sessions[0].relaunches).toHaveLength(1);
        h.dispose();
    });

    it("shared: свой терминал другого вида не берётся; новый вид вытесняет прежний из очереди", () => {
        const h = buildHarness();
        const { created, sessions } = withPty(h);
        const shell = customTask({ command: { runtime: "shell", name: "echo pty" } });
        const pty = customTask();
        h.system.run(shell, h.context());
        h.sessions[0].emitExit(0);
        h.system.run(pty, h.context());
        expect(created).toHaveLength(1);
        expect(h.sessions[0].relaunches).toHaveLength(0);
        // pty-терминал отработал — в очереди у задачи теперь он, шелловый забыт.
        sessions[0].exit(0);
        h.system.run(shell, h.context());
        expect(h.factoryCalls).toHaveLength(2);
        h.dispose();
    });

    it("мост не нашёл инстанс — отказ", () => {
        const h = buildHarness();
        h.system.setCustomExecutionTerminals({ createPtyInstance: () => 42 });
        expect(() => h.system.run(customTask(), h.context())).toThrow("Failed to create terminal for task pty");
        h.dispose();
    });
});

describe("waitOnExitOf (`getWaitOnExitValue` эталона)", () => {
    const presentation = (overrides: Partial<Parameters<typeof waitOnExitOf>[0]> = {}) => ({
        echo: true,
        reveal: "always" as const,
        focus: false,
        panel: "shared" as const,
        showReuseMessage: true,
        clear: false,
        ...overrides,
    });
    const text = (value: ReturnType<typeof waitOnExitOf>): unknown => (typeof value === "function" ? value(0) : value);

    it("shared с сообщением, без сообщения — молча, new — своё сообщение", () => {
        expect(text(waitOnExitOf(presentation(), false))).toBe(REUSE_MESSAGE);
        expect(text(waitOnExitOf(presentation({ showReuseMessage: false }), false))).toBe(true);
        expect(text(waitOnExitOf(presentation({ panel: "new" }), false))).toBe("Press any key to close the terminal.");
    });

    it("close: true — не ждать; фоновая с reveal never — не ждать; close: false — ждать всегда", () => {
        expect(waitOnExitOf(presentation({ close: true }), false)).toBe(false);
        expect(waitOnExitOf(presentation({ reveal: "never" }), true)).toBe(true);
        expect(text(waitOnExitOf(presentation({ reveal: "never", close: false }), true))).toBe(REUSE_MESSAGE);
        expect(text(waitOnExitOf(presentation({ reveal: "never" }), false))).toBe(REUSE_MESSAGE);
        expect(text(waitOnExitOf(presentation({ reveal: "silent" }), true))).toBe(REUSE_MESSAGE);
    });
});
