import { describe, expect, it, vi } from "vitest";

import { FakeEditorTerminals } from "../../../../../TestUtils/FakeEditorTerminals.ts";
import { FakeExtensionPtySession } from "../../../../../TestUtils/FakeExtensionPtySession.ts";
import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { type ITaskFixtureOptions, makeTask, taskVariables } from "../../../../../TestUtils/taskFixtures.ts";
import {
    buildTerminalTaskSystemHarness,
    describeTaskEvent,
} from "../../../../../TestUtils/terminalTaskSystemHarness.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { formatMessageForTerminal } from "../../../../platform/terminal/common/terminalStrings.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { TERMINAL_VIEW_ID, TerminalService } from "../../terminal/browser/terminalService.ts";
import type { IExtensionPtyTerminalOptions } from "../../terminal/common/extensionPtyTerminals.ts";
import { TaskVariableError } from "../common/taskVariables.ts";

import { type ITaskEvent, TerminalTaskSystem, waitOnExitOf } from "./terminalTaskSystem.ts";

const REUSE_MESSAGE = "Terminal will be reused by tasks, press any key to close it.";
const executing = (text: string): string =>
    formatMessageForTerminal(`Executing task: ${text}`, { excludeLeadingNewLine: true });

describe("TerminalTaskSystem — running a shell task", () => {
    it("terminal: task name, system shell with -c and the command line, folder, message, wait; events in order", async () => {
        const h = buildTerminalTaskSystemHarness();
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
        expect(h.terminals.getInstance(instance.id)).toBe(instance);
        expect(h.sessions[0].printed).toStrictEqual([
            formatMessageForTerminal(REUSE_MESSAGE, { excludeLeadingNewLine: true }),
        ]);
        h.dispose();
    });

    it("definition in the start event — without _key, with resolved variables", () => {
        const h = buildTerminalTaskSystemHarness();
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

    it("variables in command, args, cwd, env and shell; a relative cwd is resolved against the folder", () => {
        const h = buildTerminalTaskSystemHarness();
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

    it("absolute cwd as is; without a folder and cwd — the terminal cwd", () => {
        const h = buildTerminalTaskSystemHarness();
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

    it("echo: false — no message; a configured shell without args — no -c", () => {
        const h = buildTerminalTaskSystemHarness();
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

    it("process: executable and args as values, the message is the space-joined command", () => {
        const h = buildTerminalTaskSystemHarness();
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

    it("process without a command — empty string; echo: false — no message", () => {
        const h = buildTerminalTaskSystemHarness();
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

    it("unresolvable variable — throws before the terminal is created, no events", () => {
        const h = buildTerminalTaskSystemHarness();
        expect(() => h.system.run(makeTask({ command: { name: "${input:x}" } }), h.context())).toThrow(
            TaskVariableError,
        );
        // The default variables of the harness know no settings.
        expect(() =>
            h.system.run(makeTask({ command: { name: "echo ${config:editor.tabSize}" } }), h.context()),
        ).toThrow("setting 'editor.tabSize' not found");
        expect(h.factoryCalls).toStrictEqual([]);
        expect(h.events).toStrictEqual([]);
        h.dispose();
    });

    it("the same task is already running — `active` with its promise, no second terminal", () => {
        const h = buildTerminalTaskSystemHarness();
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

describe("TerminalTaskSystem — revealing the terminal", () => {
    it("reveal always — the panel on the TERMINAL tab, without focus", () => {
        const h = buildTerminalTaskSystemHarness();
        h.system.run(makeTask(), h.context());
        expect(h.views.panelService.visible).toBe(true);
        expect(h.views.panelService.getActiveViewId()).toBe(TERMINAL_VIEW_ID);
        expect(h.focus).not.toHaveBeenCalled();
        h.dispose();
    });

    it("focus — the panel and focus in the terminal even with reveal never", () => {
        const h = buildTerminalTaskSystemHarness();
        h.system.run(makeTask({ presentation: { reveal: "never", focus: true } }), h.context());
        expect(h.views.panelService.visible).toBe(true);
        expect(h.focus).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    it("silent — not revealed on start or on code 0, revealed on non-zero", () => {
        const h = buildTerminalTaskSystemHarness();
        h.system.run(makeTask({ label: "a", presentation: { reveal: "silent" } }), h.context());
        expect(h.views.panelService.visible).toBe(false);
        h.sessions[0].emitExit(0);
        expect(h.views.panelService.visible).toBe(false);
        h.system.run(makeTask({ label: "b", presentation: { reveal: "silent", panel: "new" } }), h.context());
        h.sessions[1].emitExit(2);
        expect(h.views.panelService.visible).toBe(true);
        expect(h.terminals.getActiveInstance()?.id).toBe(2);
        expect(h.focus).not.toHaveBeenCalled();
        h.dispose();
    });

    it("silent: task stopped — the terminal is not revealed (reveal only on process exit)", async () => {
        const h = buildTerminalTaskSystemHarness();
        // Another terminal is open, so the panel does not hide with the last one.
        h.terminals.createInstance({});
        const task = makeTask({ presentation: { reveal: "silent" } });
        h.system.run(task, h.context());
        await h.system.terminate(task);
        expect(h.views.panelService.visible).toBe(false);
        h.dispose();
    });

    it("never — not revealed on start or on error", () => {
        const h = buildTerminalTaskSystemHarness();
        h.system.run(makeTask({ presentation: { reveal: "never" } }), h.context());
        h.sessions[0].emitExit(1);
        expect(h.views.panelService.visible).toBe(false);
        h.dispose();
    });

    it("revealTask/isTaskVisible: of a running and a finished task; without a terminal — false", () => {
        const h = buildTerminalTaskSystemHarness();
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
        // A finished task: the terminal where it ran last.
        h.views.panelService.setVisible(false);
        expect(h.system.revealTask(a)).toBe(true);
        expect(h.views.panelService.visible).toBe(true);
        expect(h.system.isTaskVisible(a)).toBe(true);
        h.views.panelService.setActiveView("other");
        expect(h.system.isTaskVisible(a)).toBe(false);
        h.views.panelService.setActiveView(TERMINAL_VIEW_ID);
        h.views.panelService.setVisible(false);
        expect(h.system.isTaskVisible(a)).toBe(false);
        expect(h.focus).not.toHaveBeenCalled();
        // A task that never ran anywhere does not claim someone else's terminal.
        const c = makeTask({ label: "c" });
        expect(h.system.revealTask(c)).toBe(false);
        h.views.panelService.setVisible(true);
        expect(h.system.isTaskVisible(c)).toBe(false);
        h.dispose();
    });

    it("isTaskVisible: no terminals at all — false, even on an open TERMINAL tab", () => {
        const h = buildTerminalTaskSystemHarness();
        h.views.panelService.setActiveView(TERMINAL_VIEW_ID);
        h.views.panelService.setVisible(true);
        expect(h.system.isTaskVisible(makeTask())).toBe(false);
        h.dispose();
    });

    it("revealTask of a running task — its current terminal, not the previous one where it finished", () => {
        const h = buildTerminalTaskSystemHarness();
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

describe("TerminalTaskSystem — revealing a task terminal moved into the editor area", () => {
    /** The task ran once, its idle terminal was moved into a tab and the panel was closed. */
    function movedToEditor(presentation: ITaskFixtureOptions["presentation"] = {}) {
        const h = buildTerminalTaskSystemHarness();
        const task = makeTask({ presentation });
        h.system.run(task, h.context());
        h.sessions[0].emitExit(0);
        h.terminals.moveToEditor(1);
        h.views.panelService.setVisible(false);
        h.focus.mockClear();
        return { h, task };
    }

    it("reveal always: the rerun reuses the tab — it comes forward without focus, the panel stays closed", () => {
        const { h, task } = movedToEditor();
        h.system.run(task, h.context());
        expect(h.sessions).toHaveLength(1);
        expect(h.editorTerminals.revealed).toStrictEqual([{ id: 1, preserveFocus: true }]);
        expect(h.terminals.getActiveInstanceAcrossHosts()?.id).toBe(1);
        expect(h.views.panelService.visible).toBe(false);
        expect(h.focus).not.toHaveBeenCalled();
        h.dispose();
    });

    it("focus: the tab takes focus; the panel's terminal does not", () => {
        const { h, task } = movedToEditor({ reveal: "never", focus: true });
        h.system.run(task, h.context());
        expect(h.editorTerminals.revealed).toStrictEqual([{ id: 1, preserveFocus: false }]);
        expect(h.views.panelService.visible).toBe(false);
        expect(h.focus).not.toHaveBeenCalled();
        h.dispose();
    });

    it("an open panel stays open on its own active terminal", () => {
        const { h, task } = movedToEditor();
        const other = h.terminals.createInstance({});
        h.views.panelService.setActiveView("other");
        h.views.panelService.setVisible(true);
        h.system.run(task, h.context());
        expect(h.views.panelService.visible).toBe(true);
        expect(h.views.panelService.getActiveViewId()).toBe("other");
        expect(h.terminals.getActiveInstance()?.id).toBe(other.id);
        expect(h.editorTerminals.revealed).toStrictEqual([{ id: 1, preserveFocus: true }]);
        h.dispose();
    });

    it("silent: a non-zero exit reveals the tab, code 0 does not; never — nothing", () => {
        const { h, task } = movedToEditor({ reveal: "silent" });
        h.system.run(task, h.context());
        h.sessions[0].emitExit(0);
        expect(h.editorTerminals.revealed).toStrictEqual([]);
        h.system.run(task, h.context());
        h.sessions[0].emitExit(2);
        expect(h.editorTerminals.revealed).toStrictEqual([{ id: 1, preserveFocus: true }]);
        expect(h.views.panelService.visible).toBe(false);

        const never = movedToEditor({ reveal: "never" });
        never.h.system.run(never.task, never.h.context());
        never.h.sessions[0].emitExit(1);
        expect(never.h.editorTerminals.revealed).toStrictEqual([]);
        h.dispose();
        never.h.dispose();
    });

    it("revealTask (Show Running Task) reveals the tab, not the panel", () => {
        const { h, task } = movedToEditor({ reveal: "never" });
        expect(h.system.revealTask(task)).toBe(true);
        expect(h.editorTerminals.revealed).toStrictEqual([{ id: 1, preserveFocus: true }]);
        expect(h.views.panelService.visible).toBe(false);
        h.dispose();
    });

    it("moved back into the panel — the rerun opens the panel again", () => {
        const { h, task } = movedToEditor();
        h.terminals.moveToPanel(1);
        h.views.panelService.setVisible(false);
        h.system.run(task, h.context());
        expect(h.views.panelService.visible).toBe(true);
        expect(h.editorTerminals.revealed).toStrictEqual([]);
        h.dispose();
    });
});

describe("TerminalTaskSystem — task terminal by presentation.panel", () => {
    it("shared: an own waiting task restarts its terminal in place (clear gets through)", () => {
        const h = buildTerminalTaskSystemHarness();
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

    it("shared: a waiting terminal of another task without a group is reused, with the new name", () => {
        const h = buildTerminalTaskSystemHarness();
        h.system.run(makeTask({ label: "a" }), h.context());
        h.sessions[0].emitExit(0);
        h.system.run(makeTask({ label: "b" }), h.context());
        expect(h.factoryCalls).toHaveLength(1);
        expect(h.terminals.getInstances()[0].title).toBe("b");
        expect(h.sessions[0].relaunches[0]).not.toHaveProperty("clear");
        h.dispose();
    });

    it("shared: the group must match; the last freed goes first", () => {
        const h = buildTerminalTaskSystemHarness();
        h.system.run(makeTask({ label: "a", presentation: { group: "g" } }), h.context());
        h.system.run(makeTask({ label: "b", presentation: { group: "g", panel: "shared" } }), h.context());
        h.system.run(makeTask({ label: "c" }), h.context());
        h.sessions[0].emitExit(0);
        h.sessions[1].emitExit(0);
        h.sessions[2].emitExit(0);
        // No group: only the terminal of the task without a group (c, id 3).
        h.system.run(makeTask({ label: "d" }), h.context());
        expect(h.sessions[2].relaunches).toHaveLength(1);
        // Group g: the last released one from g (b, id 2).
        h.system.run(makeTask({ label: "e", presentation: { group: "g" } }), h.context());
        expect(h.sessions[1].relaunches).toHaveLength(1);
        expect(h.sessions[0].relaunches).toHaveLength(0);
        // Nobody has the other group, so a new terminal.
        h.system.run(makeTask({ label: "f", presentation: { group: "other" } }), h.context());
        expect(h.factoryCalls).toHaveLength(4);
        h.dispose();
    });

    it("shared: a repeated exit of the same task adds no entries; a restart takes its own", () => {
        const h = buildTerminalTaskSystemHarness();
        const a = makeTask({ label: "a" });
        h.system.run(a, h.context());
        h.sessions[0].emitExit(0);
        h.system.run(a, h.context());
        h.sessions[0].emitExit(0);
        h.system.run(makeTask({ label: "b" }), h.context());
        h.system.run(makeTask({ label: "c" }), h.context());
        // There was a single idle terminal: b took it, c got a new one.
        expect(h.factoryCalls).toHaveLength(2);
        h.dispose();
    });

    it("dedicated: only its own terminal; does not take another task's waiting one; does not give its own to shared", () => {
        const h = buildTerminalTaskSystemHarness();
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

    it("new: always a new terminal, after exit — 'Press any key to close the terminal.'", () => {
        const h = buildTerminalTaskSystemHarness();
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

    it("a waiting terminal closed by the user is forgotten — the next run creates a new one", () => {
        const h = buildTerminalTaskSystemHarness();
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
        expect(h.events.filter((e) => e.startsWith("end"))).toStrictEqual(["end:a:1", "end:b:2"]);
        h.dispose();
    });

    it("shared: an own waiting terminal comes before any last freed one", () => {
        const h = buildTerminalTaskSystemHarness();
        h.system.run(makeTask({ label: "a" }), h.context());
        h.system.run(makeTask({ label: "b" }), h.context());
        h.sessions[0].emitExit(0);
        h.sessions[1].emitExit(0);
        h.system.run(makeTask({ label: "a" }), h.context());
        expect(h.sessions[0].relaunches).toHaveLength(1);
        expect(h.sessions[1].relaunches).toHaveLength(0);
        h.dispose();
    });

    it("shared: a waiting terminal closed by the user leaves the queue — the next one takes a live one", () => {
        const h = buildTerminalTaskSystemHarness();
        h.system.run(makeTask({ label: "a" }), h.context());
        h.system.run(makeTask({ label: "b" }), h.context());
        h.sessions[0].emitExit(0);
        h.sessions[1].emitExit(0);
        // b was released last, so it was the one closed.
        h.sessions[1].write("x");
        h.system.run(makeTask({ label: "c" }), h.context());
        expect(h.sessions[0].relaunches).toHaveLength(1);
        expect(h.factoryCalls).toHaveLength(2);
        h.dispose();
    });

    it("a closed task terminal is forgotten: revealTask does not show it; a non-task one — no errors", () => {
        const h = buildTerminalTaskSystemHarness();
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

    it("a shared task does not hold its terminal as dedicated: once dedicated, it creates a new one", () => {
        const h = buildTerminalTaskSystemHarness();
        h.system.run(makeTask({ label: "a" }), h.context());
        h.sessions[0].emitExit(0);
        // b took a's idle terminal and finished too.
        h.system.run(makeTask({ label: "b" }), h.context());
        h.sessions[0].emitExit(0);
        h.system.run(makeTask({ label: "a", presentation: { panel: "dedicated" } }), h.context());
        expect(h.factoryCalls).toHaveLength(2);
        expect(h.sessions[0].relaunches).toHaveLength(1);
        h.dispose();
    });

    it("a reused terminal gets the new task's env", () => {
        const h = buildTerminalTaskSystemHarness();
        h.system.run(makeTask({ label: "a" }), h.context());
        h.sessions[0].emitExit(0);
        h.system.run(makeTask({ label: "b", command: { options: { env: { X: "1" } } } }), h.context());
        expect(h.sessions[0].relaunches[0].env).toStrictEqual({ X: "1" });
        h.dispose();
    });

    it("a waiting terminal failed to restart — the task gets a new one", () => {
        const h = buildTerminalTaskSystemHarness();
        const task = makeTask({ label: "a" });
        h.system.run(task, h.context());
        h.sessions[0].emitExit(0);
        vi.spyOn(h.terminals, "relaunchInstance").mockReturnValue(undefined);
        h.system.run(task, h.context());
        expect(h.factoryCalls).toHaveLength(2);
        expect(h.events).toContain("start:a:2");
        h.dispose();
    });

    it("close: true — the terminal closes itself, nothing to reuse", () => {
        const h = buildTerminalTaskSystemHarness();
        const task = makeTask({ presentation: { close: true } });
        h.system.run(task, h.context());
        h.sessions[0].emitExit(0);
        expect(h.terminals.getInstances()).toStrictEqual([]);
        h.system.run(task, h.context());
        expect(h.factoryCalls).toHaveLength(2);
        h.dispose();
    });
});

describe("TerminalTaskSystem — stopping", () => {
    it("terminate: the terminal is closed, the task ends with Terminated(user), the promise has no code", async () => {
        const h = buildTerminalTaskSystemHarness();
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
        h.system.run(task, h.context());
        expect(h.factoryCalls).toHaveLength(2);
        h.dispose();
    });

    it("terminate of a non-running task — false; terminateAll — all running ones", async () => {
        const h = buildTerminalTaskSystemHarness();
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

    it("Kill of a running task's terminal from outside is also Terminated with the close reason", () => {
        const h = buildTerminalTaskSystemHarness();
        h.system.run(makeTask(), h.context());
        h.terminals.closeInstance(1, "extension");
        expect(h.events.at(-1)).toBe("terminated:build:extension");
        h.dispose();
    });
});

describe("TerminalTaskSystem — rerunning the last task", () => {
    it("nothing to rerun — undefined", () => {
        const h = buildTerminalTaskSystemHarness();
        expect(h.system.rerun(h.context())).toBeUndefined();
        h.dispose();
    });

    it("reevaluateOnRerun — variables resolved anew; without it — the same as last time", () => {
        const h = buildTerminalTaskSystemHarness();
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

    it("rerunning a running task without reevaluation — `active`, no new terminal", () => {
        const h = buildTerminalTaskSystemHarness();
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

    function withPty(h: ReturnType<typeof buildTerminalTaskSystemHarness>) {
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

    it("without a pty bridge — refusal with an explanation", () => {
        const h = buildTerminalTaskSystemHarness();
        expect(() => h.system.run(customTask(), h.context())).toThrow(
            "Tasks with a custom execution need the extension host, which is not running.",
        );
        h.system.setCustomExecutionTerminals(undefined);
        expect(() => h.system.run(customTask(), h.context())).toThrow(/custom execution/u);
        h.dispose();
    });

    it("pty instance: name, 'Executing task: <label>', wait; processStarted with pid -1", () => {
        const h = buildTerminalTaskSystemHarness();
        const { created } = withPty(h);
        h.system.run(customTask(), h.context());
        expect(created).toHaveLength(1);
        expect(created[0].name).toBe("pty");
        expect(created[0].message).toBe(executing("Ext: pty"));
        expect(typeof created[0].waitOnExit).toBe("function");
        expect(h.events).toContain("processStarted:pty:-1");
        h.dispose();
    });

    it("echo: false — no message; a rerun reuses its pty terminal but not a shell one", () => {
        const h = buildTerminalTaskSystemHarness();
        const { created, sessions } = withPty(h);
        h.system.run(customTask({ presentation: { echo: false } }), h.context());
        expect(created[0]).not.toHaveProperty("message");
        sessions[0].exit(0);
        // A shell task does not take a pty terminal, and a pty task does not take a shell one.
        h.system.run(makeTask({ label: "sh" }), h.context());
        expect(h.factoryCalls).toHaveLength(1);
        h.sessions[0].emitExit(0);
        h.system.run(customTask({ presentation: { echo: false } }), h.context());
        expect(created).toHaveLength(1);
        expect(sessions[0].relaunches).toHaveLength(1);
        h.dispose();
    });

    it("dedicated: its own terminal of another kind is not taken; closing the previous one does not take away the new one", () => {
        const h = buildTerminalTaskSystemHarness();
        const { created, sessions } = withPty(h);
        const shell = customTask({
            command: { runtime: "shell", name: "echo pty" },
            presentation: { panel: "dedicated" },
        });
        const pty = customTask({ presentation: { panel: "dedicated" } });
        h.system.run(shell, h.context());
        h.sessions[0].emitExit(0);
        // The task's own terminal is a shell one, so the pty task creates its own.
        h.system.run(pty, h.context());
        expect(created).toHaveLength(1);
        expect(h.sessions[0].relaunches).toHaveLength(0);
        sessions[0].exit(0);
        // The user closed the task's old shell terminal; the pty terminal stays with the task.
        h.sessions[0].write("x");
        h.system.run(pty, h.context());
        expect(created).toHaveLength(1);
        expect(sessions[0].relaunches).toHaveLength(1);
        h.dispose();
    });

    it("shared: its own terminal of another kind is not taken; the new kind evicts the previous one from the queue", () => {
        const h = buildTerminalTaskSystemHarness();
        const { created, sessions } = withPty(h);
        const shell = customTask({ command: { runtime: "shell", name: "echo pty" } });
        const pty = customTask();
        h.system.run(shell, h.context());
        h.sessions[0].emitExit(0);
        h.system.run(pty, h.context());
        expect(created).toHaveLength(1);
        expect(h.sessions[0].relaunches).toHaveLength(0);
        // The pty terminal finished: it is now the task's queued one, the shell one is forgotten.
        sessions[0].exit(0);
        h.system.run(shell, h.context());
        expect(h.factoryCalls).toHaveLength(2);
        h.dispose();
    });

    it("the bridge did not find the instance — refusal", () => {
        const h = buildTerminalTaskSystemHarness();
        h.system.setCustomExecutionTerminals({ createPtyInstance: () => 42 });
        expect(() => h.system.run(customTask(), h.context())).toThrow("Failed to create terminal for task pty");
        h.dispose();
    });
});

describe("waitOnExitOf (upstream `getWaitOnExitValue`)", () => {
    const presentation = (overrides: Partial<Parameters<typeof waitOnExitOf>[0]> = {}) => ({
        echo: true,
        reveal: "always" as const,
        revealProblems: "never" as const,
        focus: false,
        panel: "shared" as const,
        showReuseMessage: true,
        clear: false,
        ...overrides,
    });
    const text = (value: ReturnType<typeof waitOnExitOf>): unknown => (typeof value === "function" ? value(0) : value);

    it("shared with a message, without a message — silent, new — its own message", () => {
        expect(text(waitOnExitOf(presentation(), false))).toBe(REUSE_MESSAGE);
        expect(text(waitOnExitOf(presentation({ showReuseMessage: false }), false))).toBe(true);
        expect(text(waitOnExitOf(presentation({ panel: "new" }), false))).toBe("Press any key to close the terminal.");
    });

    it("close: true — no wait; background with reveal never — no wait; close: false — always wait", () => {
        expect(waitOnExitOf(presentation({ close: true }), false)).toBe(false);
        expect(waitOnExitOf(presentation({ reveal: "never" }), true)).toBe(true);
        expect(text(waitOnExitOf(presentation({ reveal: "never", close: false }), true))).toBe(REUSE_MESSAGE);
        expect(text(waitOnExitOf(presentation({ reveal: "never" }), false))).toBe(REUSE_MESSAGE);
        expect(text(waitOnExitOf(presentation({ reveal: "silent" }), true))).toBe(REUSE_MESSAGE);
    });
});
