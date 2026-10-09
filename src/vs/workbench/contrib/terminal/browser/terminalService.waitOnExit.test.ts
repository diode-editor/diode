import { describe, expect, it } from "vitest";

import { FakeExtensionPtySession } from "../../../../../TestUtils/FakeExtensionPtySession.ts";
import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import type { ITerminalSessionOptions } from "../common/terminalSessionFactory.ts";

import { TERMINAL_VIEW_ID, TerminalService } from "./terminalService.ts";

// Терминалы задач: инстанс, который ждёт после выхода процесса (`waitOnExit`
// эталона), сообщение о коде выхода, «press any key to close» и перезапуск
// процесса на месте (`reuseTerminal`).

const INVERSE = "\x1b[0m\x1b[7m * \x1b[0m";

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
    service.onDidExitInstance((i) => events.push(`exit:${String(i.id)}:${String(i.exitCode)}`));
    service.onDidDisposeInstance((i) => events.push(`dispose:${String(i.id)}:${i.exitReason}`));
    service.onDidChangeInstanceTitle((i) => events.push(`title:${String(i.id)}:${i.title}`));
    return { views, service, sessions, factoryCalls, events };
}

describe("TerminalService — waitOnExit", () => {
    it("без waitOnExit выход снимает инстанс; onDidExitInstance — раньше снятия, с кодом", () => {
        const h = buildHarness();
        const instance = h.service.createInstance({ name: "t" });
        h.sessions[0].emitExit(3);
        expect(h.events).toStrictEqual(["exit:1:3", "dispose:1:process"]);
        expect(h.service.getInstance(instance.id)).toBeNull();
        h.service.dispose();
    });

    it("waitOnExit: false — как без него", () => {
        const h = buildHarness();
        h.service.createInstance({ waitOnExit: false });
        h.sessions[0].emitExit(0);
        expect(h.events).toStrictEqual(["exit:1:0", "dispose:1:process"]);
        h.service.dispose();
    });

    it("строка: инстанс остаётся, печатаются код выхода с командной строкой и сообщение", () => {
        const h = buildHarness();
        const instance = h.service.createInstance({
            shellPath: "/bin/bash",
            shellArgs: ["-c", "exit 3"],
            waitOnExit: "Terminal will be reused by tasks, press any key to close it.",
        });
        h.sessions[0].emitExit(3);
        expect(h.events).toStrictEqual(["exit:1:3"]);
        expect(h.service.getInstance(instance.id)).toBe(instance);
        expect(instance.exitCode).toBe(3);
        expect(h.sessions[0].printed).toStrictEqual([
            `\r\n${INVERSE} The terminal process "/bin/bash '-c', 'exit 3'" terminated with exit code: 3. \x1b[0m\n\r`,
            `${INVERSE} Terminal will be reused by tasks, press any key to close it. \x1b[0m\n\r`,
        ]);
        h.service.dispose();
    });

    it("код 0 — без сообщения о коде; функция получает код выхода", () => {
        const h = buildHarness();
        h.service.createInstance({ waitOnExit: (code) => `exited ${String(code)}` });
        h.sessions[0].emitExit(0);
        expect(h.sessions[0].printed).toStrictEqual([`${INVERSE} exited 0 \x1b[0m\n\r`]);
        h.service.dispose();
    });

    it("true — ждёт молча; без аргументов командная строка — один исполняемый файл", () => {
        const h = buildHarness();
        h.service.createInstance({ waitOnExit: true });
        h.sessions[0].emitExit(1);
        expect(h.sessions[0].printed).toStrictEqual([
            `\r\n${INVERSE} The terminal process "/bin/bash" terminated with exit code: 1. \x1b[0m\n\r`,
        ]);
        expect(h.service.getInstances()).toHaveLength(1);
        h.service.dispose();
    });

    it("pty расширения — код выхода без командной строки", () => {
        const h = buildHarness();
        const session = new FakeExtensionPtySession({
            cols: 80,
            rows: 24,
            name: "pty",
            onInput: () => undefined,
            onResize: () => undefined,
        });
        h.service.createInstance({ name: "pty", session, waitOnExit: true, message: "Executing" });
        session.exit(2);
        expect(session.printed).toStrictEqual([
            "Executing\r\n",
            `\r\n${INVERSE} The terminal process terminated with exit code: 2. \x1b[0m\n\r`,
        ]);
        h.service.dispose();
    });

    it("готовая сессия без message — редактор ничего не печатает", () => {
        const h = buildHarness();
        const session = new FakeExtensionPtySession({
            cols: 80,
            rows: 24,
            name: "pty",
            onInput: () => undefined,
            onResize: () => undefined,
        });
        h.service.createInstance({ name: "pty", session, waitOnExit: true });
        session.exit(0);
        expect(session.printed).toStrictEqual([]);
        h.service.dispose();
    });

    it("любая клавиша после выхода закрывает ждущий инстанс (причина user); до выхода ввод идёт в процесс", () => {
        const h = buildHarness();
        h.service.createInstance({ waitOnExit: "bye" });
        h.sessions[0].write("a");
        expect(h.sessions[0].writes).toStrictEqual(["a"]);
        h.sessions[0].emitExit(0);
        h.sessions[0].write("x");
        expect(h.events).toStrictEqual(["exit:1:0", "dispose:1:user"]);
        expect(h.sessions[0].disposed).toBe(true);
        h.service.dispose();
    });

    it("Kill ждущего — снят с причиной user, повторной печати нет", () => {
        const h = buildHarness();
        const instance = h.service.createInstance({ waitOnExit: "bye" });
        h.sessions[0].emitExit(0);
        h.service.closeInstance(instance.id);
        expect(h.events).toStrictEqual(["exit:1:0", "dispose:1:user"]);
        h.service.dispose();
    });
});

describe("TerminalService — relaunchInstance", () => {
    it("ждущий инстанс перезапускается на месте: опции сессии, новый pid, снова ждёт по новому waitOnExit", () => {
        const h = buildHarness();
        h.service.setWorkingDirectory("/ws");
        const instance = h.service.createInstance({ name: "build", waitOnExit: "first" });
        h.sessions[0].emitExit(0);
        h.sessions[0].pid = 555;
        const relaunched = h.service.relaunchInstance(instance.id, {
            name: "build",
            shellPath: "/bin/sh",
            shellArgs: ["-c", "make"],
            env: { A: "1" },
            message: "Executing task: make",
            waitOnExit: "second",
            clear: true,
        });
        expect(relaunched).toBe(instance);
        expect(h.sessions[0].relaunches).toStrictEqual([
            {
                cwd: "/ws",
                shell: "/bin/sh",
                args: ["-c", "make"],
                env: { A: "1" },
                message: "Executing task: make",
                clear: true,
            },
        ]);
        expect(h.sessions).toHaveLength(1);
        expect(instance.processId).toBe(555);
        expect(instance.exitCode).toBeUndefined();
        expect(instance.launch).toStrictEqual({
            shellPath: "/bin/bash",
            shellArgs: ["-c", "make"],
            cwd: "/ws",
            env: { A: "1" },
            hideFromUser: false,
        });
        // Имя то же — события заголовка нет.
        expect(h.events).toStrictEqual(["exit:1:0"]);
        // Перезапущенный процесс жив: клавиша идёт в него, а не закрывает терминал.
        h.sessions[0].write("y");
        expect(h.sessions[0].writes).toStrictEqual(["y"]);
        h.sessions[0].emitExit(0);
        expect(h.sessions[0].printed.at(-1)).toBe(`${INVERSE} second \x1b[0m\n\r`);
        expect(h.service.getInstance(instance.id)).toBe(instance);
        h.service.dispose();
    });

    it("без clear — поля clear у сессии нет; другое имя — новый заголовок и событие", () => {
        const h = buildHarness();
        const instance = h.service.createInstance({ name: "a", waitOnExit: true });
        h.sessions[0].emitExit(0);
        h.service.relaunchInstance(instance.id, { name: "b" });
        expect(h.sessions[0].relaunches).toStrictEqual([{ cwd: process.cwd() }]);
        expect(instance.title).toBe("b");
        expect(h.events).toStrictEqual(["exit:1:0", "title:1:b"]);
        // Без waitOnExit на этот раз — выход снимает инстанс.
        h.sessions[0].emitExit(0);
        expect(h.service.getInstance(instance.id)).toBeNull();
        h.service.dispose();
    });

    it("перезапущенный инстанс снова не ждёт: второй перезапуск до выхода — undefined", () => {
        const h = buildHarness();
        const instance = h.service.createInstance({ waitOnExit: true });
        h.sessions[0].emitExit(0);
        expect(h.service.relaunchInstance(instance.id)).toBe(instance);
        expect(h.service.relaunchInstance(instance.id)).toBeUndefined();
        expect(h.sessions[0].relaunches).toHaveLength(1);
        h.service.dispose();
    });

    it("живой, снятый и неизвестный инстансы не перезапускаются — undefined", () => {
        const h = buildHarness();
        const live = h.service.createInstance({ waitOnExit: true });
        expect(h.service.relaunchInstance(live.id)).toBeUndefined();
        const gone = h.service.createInstance();
        h.sessions[1].emitExit(0);
        expect(h.service.relaunchInstance(gone.id)).toBeUndefined();
        expect(h.service.relaunchInstance(99)).toBeUndefined();
        expect(h.sessions[0].relaunches).toStrictEqual([]);
        h.service.dispose();
    });

    it("фоновый ждущий инстанс перезапускается фоновым", () => {
        const h = buildHarness();
        const instance = h.service.createInstance({ hideFromUser: true, waitOnExit: true });
        h.sessions[0].emitExit(0);
        expect(h.service.relaunchInstance(instance.id)).toBe(instance);
        expect(instance.launch.hideFromUser).toBe(true);
        h.service.dispose();
    });
});
