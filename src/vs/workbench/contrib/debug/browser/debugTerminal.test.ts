import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { mockSession } from "../../../../../TestUtils/mockDebug.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Emitter } from "../../../../base/common/event.ts";
import type { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { TERMINAL_VIEW_ID, TerminalService } from "../../terminal/browser/terminalService.ts";
import type { AdapterEndEvent, IDebugSession, INewReplElementData } from "../common/debug.ts";

import { DebugTerminalLauncher, EXTERNAL_TERMINAL_UNAVAILABLE } from "./debugTerminal.ts";

const ARGS: DebugProtocol.RunInTerminalRequestArguments = {
    kind: "integrated",
    title: "Launch hello",
    cwd: "/home/user/hello",
    args: ["./build/hello", "a b"],
};

interface ITestSession {
    readonly session: IDebugSession;
    readonly repl: INewReplElementData[];
    end(): void;
}

function testSession(): ITestSession {
    const ended = new Emitter<AdapterEndEvent | undefined>();
    const repl: INewReplElementData[] = [];
    const session = mockSession({
        appendToRepl: (data) => {
            repl.push(data);
        },
        onDidEndAdapter: ended.event,
    });
    return {
        session,
        repl,
        end: () => {
            ended.fire(undefined);
        },
    };
}

describe("DebugTerminalLauncher", () => {
    let surfaces: FakeTerminalSurface[];
    let terminals: TerminalService;
    let openView: ReturnType<typeof vi.fn<(viewId: string, focus?: boolean, activate?: boolean) => void>>;
    let busy: Set<number>;
    let configuration: InMemoryConfigurationService;
    let shell: string;
    let launcher: DebugTerminalLauncher;
    let nextPid: number;

    beforeEach(() => {
        vi.useFakeTimers();
        surfaces = [];
        busy = new Set();
        configuration = createTestConfigurationService();
        shell = "/bin/bash";
        nextPid = 100;
        const views = makeViewsHarness();
        terminals = new TerminalService(views.service, createTestConfigurationService(), () => {
            const surface = new FakeTerminalSurface(shell, nextPid++);
            surfaces.push(surface);
            return surface;
        });
        views.service.attachRegisteredContainers();
        openView = vi.fn();
        launcher = new DebugTerminalLauncher(
            terminals,
            { openView },
            () => shell,
            configuration,
            (pid) => Promise.resolve(pid === undefined || busy.has(pid)),
        );
    });

    afterEach(() => {
        launcher.dispose();
        terminals.dispose();
        vi.useRealTimers();
    });

    /** Runs a request to its answer: the shell's start-up and the delays of a reused terminal pass. */
    async function run(
        args: DebugProtocol.RunInTerminalRequestArguments,
        session: IDebugSession,
    ): Promise<number | undefined> {
        const answer = launcher.runInTerminal(args, session);
        await vi.advanceTimersByTimeAsync(5000);
        return answer;
    }

    it("a new terminal: the default shell in cwd, named by the title, shown without focus; answers its process id", async () => {
        const { session } = testSession();

        const pid = await run(ARGS, session);

        expect(pid).toBe(100);
        const [instance] = terminals.getInstances();
        expect(instance.title).toBe("Launch hello");
        expect(instance.launch.shellPath).toBe("/bin/bash");
        expect(instance.launch.cwd).toBe("/home/user/hello");
        expect(terminals.getActiveInstance()?.id).toBe(instance.id);
        expect(openView).toHaveBeenCalledWith(TERMINAL_VIEW_ID, false, false);
        // cwd is the shell's own: the command has no `cd`.
        expect(surfaces[0].writes).toEqual([" ./build/hello a\\ b \r"]);
    });

    it("without a title the terminal is 'Debug Process'; env goes to the command; no kind is integrated", async () => {
        const { session, repl } = testSession();

        await run({ ...ARGS, title: "", env: { A: "1", B: null } }, session);
        await run({ cwd: "/w", args: ["x"] }, session);

        expect(terminals.getInstances().map((i) => i.title)).toEqual(["Debug Process", "Debug Process"]);
        expect(surfaces[0].writes).toEqual([" /usr/bin/env A=1 -u B ./build/hello a\\ b \r"]);
        expect(surfaces[1].writes).toEqual([" x \r"]);
        expect(repl).toEqual([]);
    });

    it("args that the shell may interpret go as they are", async () => {
        const { session } = testSession();

        await run({ ...ARGS, args: ["echo $HOME > out"], argsCanBeInterpretedByShell: true }, session);

        expect(surfaces[0].writes).toEqual([" echo $HOME > out \r"]);
    });

    it("waits for the new shell's output to be quiet for 500 ms before typing the command", async () => {
        const { session } = testSession();
        let answered = false;
        void launcher.runInTerminal(ARGS, session).then(() => {
            answered = true;
        });
        await vi.advanceTimersByTimeAsync(0);
        const surface = surfaces[0];

        await vi.advanceTimersByTimeAsync(300);
        surface.emitUpdate();
        await vi.advanceTimersByTimeAsync(400);
        expect(surface.writes).toEqual([]);
        expect(answered).toBe(false);

        await vi.advanceTimersByTimeAsync(100);
        expect(surface.writes).toHaveLength(1);
        expect(answered).toBe(true);
        // The 5 s limit is cancelled and later output no longer matters.
        surface.emitUpdate();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("a shell that never goes quiet gets the command after 5 s", async () => {
        const { session } = testSession();
        void launcher.runInTerminal(ARGS, session);
        await vi.advanceTimersByTimeAsync(0);
        const surface = surfaces[0];

        for (let t = 0; t < 4900; t += 100) {
            surface.emitUpdate();
            await vi.advanceTimersByTimeAsync(100);
        }
        expect(surface.writes).toEqual([]);
        surface.emitUpdate();
        await vi.advanceTimersByTimeAsync(100);
        expect(surface.writes).toHaveLength(1);
    });

    it("kind external: a line in the Debug Console, then the integrated terminal", async () => {
        const { session, repl } = testSession();

        expect(await run({ ...ARGS, kind: "external" }, session)).toBe(100);

        expect(repl).toEqual([{ output: `${EXTERNAL_TERMINAL_UNAVAILABLE}\n`, sev: "warning" }]);
        expect(EXTERNAL_TERMINAL_UNAVAILABLE).toBe("external terminal is not available, using the integrated one");
        expect(terminals.getInstances()).toHaveLength(1);
    });

    describe("reuse", () => {
        it("the session's terminal is free once it ends: the next run reuses it, Ctrl+C first, cd to cwd", async () => {
            const first = testSession();
            await run(ARGS, first.session);
            first.end();
            busy.add(100);

            const pid = await run(ARGS, testSession().session);

            expect(pid).toBe(100);
            expect(terminals.getInstances()).toHaveLength(1);
            expect(surfaces[0].writes).toEqual([
                " ./build/hello a\\ b \r",
                "\u0003",
                " cd /home/user/hello ; ./build/hello a\\ b \r",
            ]);
        });

        it("Ctrl+C and the command are 200 ms apart", async () => {
            const first = testSession();
            await run(ARGS, first.session);
            first.end();

            void launcher.runInTerminal(ARGS, testSession().session);
            await vi.advanceTimersByTimeAsync(199);
            expect(surfaces[0].writes.at(-1)).toBe("\u0003");
            await vi.advanceTimersByTimeAsync(1);
            expect(surfaces[0].writes.at(-1)).toMatch(/^ cd /u);
        });

        it("debug.terminal.clearBeforeReusing clears it, 200 ms before the command", async () => {
            await configuration.updateValue("debug.terminal.clearBeforeReusing", true);
            const first = testSession();
            await run(ARGS, first.session);
            first.end();

            void launcher.runInTerminal(ARGS, testSession().session);
            await vi.advanceTimersByTimeAsync(399);
            expect(surfaces[0].writes.slice(1)).toEqual(["\u0003", "clear\r"]);
            await vi.advanceTimersByTimeAsync(1);
            expect(surfaces[0].writes).toHaveLength(4);
        });

        it("a terminal nobody typed in gets no Ctrl+C", async () => {
            const first = testSession();
            await run(ARGS, first.session);
            first.end();
            // A fresh emulator: the command we typed is what made it "interacted with".
            const record = terminals.getInstances()[0] as { isInteractedWith: boolean };
            record.isInteractedWith = false;

            await run(ARGS, testSession().session);

            expect(surfaces[0].writes.slice(1)).toEqual([" cd /home/user/hello ; ./build/hello a\\ b \r"]);
        });

        it("a running session's terminal is reused once its shell is idle and a second has passed", async () => {
            const first = testSession();
            busy.add(100);
            await run(ARGS, first.session);

            await run(ARGS, testSession().session);
            expect(terminals.getInstances()).toHaveLength(2);

            busy.delete(100);
            await vi.advanceTimersByTimeAsync(1000);
            await run(ARGS, testSession().session);
            expect(terminals.getInstances()).toHaveLength(2);
            expect(surfaces[0].writes).toHaveLength(3);
        });

        it("a new terminal is a candidate a second after it was made, not before", async () => {
            const made = Date.now();
            await run(ARGS, testSession().session);

            vi.setSystemTime(made + 999);
            await run(ARGS, testSession().session);
            expect(terminals.getInstances()).toHaveLength(2);

            vi.setSystemTime(made + 1000);
            await run(ARGS, testSession().session);
            expect(terminals.getInstances()).toHaveLength(2);
            expect(surfaces[0].writes).toHaveLength(3);
        });

        it("a reused terminal becomes the active one again", async () => {
            const first = testSession();
            await run(ARGS, first.session);
            first.end();
            terminals.newTerminal();
            expect(terminals.getActiveInstance()?.processId).toBe(101);

            await run(ARGS, testSession().session);

            expect(terminals.getActiveInstance()?.processId).toBe(100);
        });

        it("a session frees its terminal once: a later end of it doesn't free the terminal of the next session", async () => {
            const first = testSession();
            await run(ARGS, first.session);
            first.end();
            await run(ARGS, testSession().session);
            busy.add(100);

            first.end();
            await vi.advanceTimersByTimeAsync(1000);
            await run(ARGS, testSession().session);

            expect(terminals.getInstances()).toHaveLength(2);
        });

        it("a terminal closed before its session ends: the end changes nothing", async () => {
            const errors: unknown[] = [];
            setUnexpectedErrorHandler((e) => errors.push(e));
            try {
                const first = testSession();
                await run(ARGS, first.session);
                terminals.closeInstance(terminals.getInstances()[0].id);

                first.end();

                expect(errors).toEqual([]);
            } finally {
                setUnexpectedErrorHandler((e) => {
                    console.error(e);
                });
            }
        });

        it("only a terminal with the same title, shell and cwd", async () => {
            const first = testSession();
            await run(ARGS, first.session);
            first.end();

            await run({ ...ARGS, title: "Other" }, testSession().session);
            await run({ ...ARGS, cwd: "/elsewhere" }, testSession().session);
            shell = "/bin/zsh";
            await run(ARGS, testSession().session);

            expect(terminals.getInstances()).toHaveLength(4);
            expect(surfaces[0].writes).toHaveLength(1);
        });

        it("a closed terminal is forgotten", async () => {
            const first = testSession();
            await run(ARGS, first.session);
            first.end();
            terminals.closeInstance(terminals.getInstances()[0].id);

            await run(ARGS, testSession().session);

            expect(terminals.getInstances().map((i) => i.processId)).toEqual([101]);
        });
    });

    describe("the clear command of the shell", () => {
        async function clearWith(shellPath: string): Promise<string | undefined> {
            await configuration.updateValue("debug.terminal.clearBeforeReusing", true);
            shell = shellPath;
            const index = surfaces.length;
            const first = testSession();
            await run({ ...ARGS, args: [] }, first.session);
            first.end();
            await run({ ...ARGS, args: [] }, testSession().session);
            return surfaces[index].writes.at(-2);
        }

        it.each([
            ["powershell.exe", "cls"],
            ["/usr/bin/pwsh", "cls"],
            ["C:\\Windows\\cmd.exe", "cls"],
            ["/bin/bash", "clear"],
        ])("%s: %s", async (shellPath, command) => {
            expect(await clearWith(shellPath)).toBe(`${command}\r`);
        });

        it("another shell: cls on Windows, clear elsewhere", async () => {
            const platform = vi.spyOn(process, "platform", "get");
            platform.mockReturnValue("win32");
            expect(await clearWith("/bin/zsh")).toBe("cls\r");
            platform.mockReturnValue("linux");
            expect(await clearWith("/bin/fish")).toBe("clear\r");
            platform.mockRestore();
        });
    });
});
