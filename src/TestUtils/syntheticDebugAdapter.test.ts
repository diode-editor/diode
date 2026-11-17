// The synthetic adapter at the protocol level: what each request answers and which events follow.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdapterManager } from "../vs/workbench/contrib/debug/browser/debugAdapterManager.ts";

import { adapterManagerPorts, idleDebugService } from "./mockDebug.ts";
import {
    NO_DELAY_TIMING,
    numAt,
    registerSyntheticDebugger,
    SYNTHETIC_ANSI_LINE,
    SYNTHETIC_CAPABILITIES,
    SYNTHETIC_DEBUG_TYPE,
    SYNTHETIC_LAUNCH_CONFIG,
    SYNTHETIC_PROGRAM_ROOT,
    SyntheticDebugAdapter,
    SyntheticDebugAdapterFactory,
} from "./syntheticDebugAdapter.ts";

type Body = Record<string, unknown>;

describe("SyntheticDebugAdapter", () => {
    let adapter: SyntheticDebugAdapter;
    let events: DebugProtocol.Event[];

    beforeEach(() => {
        adapter = new SyntheticDebugAdapter(NO_DELAY_TIMING);
        events = [];
        adapter.onEvent((e) => events.push(e));
    });

    afterEach(() => {
        adapter.dispose();
    });

    function request(command: string, args: unknown = {}): Promise<DebugProtocol.Response> {
        return new Promise((resolve) => adapter.sendRequest(command, args, resolve));
    }

    async function body(command: string, args: unknown = {}): Promise<Body> {
        const response = await request(command, args);
        expect(response.success).toBe(true);
        return (response.body ?? {}) as Body;
    }

    function eventsOf(name: string): Body[] {
        return events.filter((e) => e.event === name).map((e) => (e.body ?? {}) as Body);
    }

    async function stopped(count = 1): Promise<void> {
        await vi.waitFor(() => {
            expect(eventsOf("stopped").length).toBeGreaterThanOrEqual(count);
        });
    }

    async function launchStopped(command = "launch"): Promise<void> {
        await body("initialize");
        await body(command, SYNTHETIC_LAUNCH_CONFIG);
        await body("configurationDone");
        await stopped();
    }

    async function variablesOf(reference: unknown, extra: Body = {}): Promise<DebugProtocol.Variable[]> {
        return (await body("variables", { variablesReference: reference, ...extra }))
            .variables as DebugProtocol.Variable[];
    }

    async function scopes(frameId: number): Promise<DebugProtocol.Scope[]> {
        return (await body("scopes", { frameId })).scopes as DebugProtocol.Scope[];
    }

    async function locals(): Promise<Map<string, DebugProtocol.Variable>> {
        const [scope] = await scopes(1000);
        return new Map((await variablesOf(scope.variablesReference)).map((v) => [v.name, v]));
    }

    describe("terminal: CodeLLDB's launch in the client's terminal", () => {
        let reverse: DebugProtocol.Request[];

        beforeEach(() => {
            reverse = [];
            adapter.onRequest((r) => reverse.push(r));
        });

        function answer(r: DebugProtocol.Request, success = true): void {
            adapter.sendResponse({
                type: "response",
                seq: 0,
                request_seq: r.seq,
                command: r.command,
                success,
                body: { shellProcessId: 7 },
            });
        }

        it("asks runInTerminal for the program, its args, cwd and env, and answers launch after the client", async () => {
            await body("initialize");
            let launched = false;
            const launch = request("launch", {
                ...SYNTHETIC_LAUNCH_CONFIG,
                terminal: "external",
                program: "/bin/prog",
                args: ["a", "b"],
                cwd: "/w",
                env: { A: "1" },
            }).then((r) => {
                launched = true;
                return r;
            });

            await vi.waitFor(() => {
                expect(reverse).toHaveLength(1);
            });
            expect(reverse[0].command).toBe("runInTerminal");
            expect(reverse[0].arguments).toEqual({
                kind: "external",
                title: SYNTHETIC_LAUNCH_CONFIG.name,
                cwd: "/w",
                args: ["/bin/prog", "a", "b"],
                env: { A: "1" },
            });
            await Promise.resolve();
            expect(launched).toBe(false);

            answer(reverse[0]);
            expect((await launch).success).toBe(true);
            expect(adapter.responses).toMatchObject([{ command: "runInTerminal", body: { shellProcessId: 7 } }]);
        });

        it("integrated: the program root is the default cwd, no args; a failed runInTerminal still launches", async () => {
            await body("initialize");
            const launch = request("launch", { ...SYNTHETIC_LAUNCH_CONFIG, terminal: "integrated", program: "p" });

            await vi.waitFor(() => {
                expect(reverse).toHaveLength(1);
            });
            expect(reverse[0].arguments).toMatchObject({ kind: "integrated", cwd: "/home/user/hello", args: ["p"] });
            answer(reverse[0], false);
            expect((await launch).success).toBe(true);
        });

        it("without terminal, or with another value, nothing is asked", async () => {
            await launchStopped();
            await body("launch", { ...SYNTHETIC_LAUNCH_CONFIG, terminal: "console" });

            expect(reverse).toEqual([]);
        });

        it("an answer to nothing asked is only recorded", () => {
            adapter.sendResponse({ type: "response", seq: 0, request_seq: 999, command: "x", success: true });

            expect(adapter.responses).toHaveLength(1);
        });
    });

    it("initialize answers the capabilities, then `initialized`", async () => {
        expect(await body("initialize")).toEqual(SYNTHETIC_CAPABILITIES);
        await vi.waitFor(() => {
            expect(eventsOf("initialized")).toHaveLength(1);
        });
    });

    it.each(["launch", "attach"])(
        "%s runs after configurationDone, in either order, and stops on the breakpoint",
        async (command) => {
            await launchStopped(command);

            expect(eventsOf("stopped")).toEqual([{ reason: "breakpoint", threadId: 1, allThreadsStopped: true }]);
            expect(eventsOf("output").map((o) => [o.category, (o.output as string).trimEnd().slice(0, 20)])).toEqual([
                ["console", "Launching: /home/use"],
                ["console", "Launched process 482"],
                ["stdout", "Hello from hello 1.2"],
                ["stdout", "Reading input.txt: 1"],
                ["stdout", SYNTHETIC_ANSI_LINE.slice(0, 20)],
                ["console", "warning: (x86_64) /l"],
            ]);
        },
    );

    it("configurationDone first waits for the launch", async () => {
        await body("configurationDone");
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(eventsOf("stopped")).toEqual([]);

        await body("launch");
        await stopped();
    });

    it("verifies the breakpoints in the program's files, not elsewhere", async () => {
        const main = { path: `${SYNTHETIC_PROGRAM_ROOT}/src/main.cpp` };
        expect(await body("setBreakpoints", { source: main, breakpoints: [{ line: 3 }, { line: 9 }] })).toEqual({
            breakpoints: [
                { id: 1, verified: true, line: 3 },
                { id: 2, verified: true, line: 9 },
            ],
        });
        expect(
            await body("setBreakpoints", { source: { path: "/elsewhere/a.cpp" }, breakpoints: [{ line: 1 }] }),
        ).toEqual({ breakpoints: [{ id: 3, verified: false, line: 1 }] });
        expect(await body("setBreakpoints", { source: {} })).toEqual({ breakpoints: [] });
        expect(await body("setExceptionBreakpoints", { filters: [] })).toEqual({});
    });

    it("verifies every function, data and instruction breakpoint", async () => {
        for (const command of ["setFunctionBreakpoints", "setDataBreakpoints", "setInstructionBreakpoints"]) {
            expect(await body(command, { breakpoints: [{}] })).toMatchObject({ breakpoints: [{ verified: true }] });
            expect(await body(command, {})).toEqual({ breakpoints: [] });
        }
    });

    it("a stop on a breakpoint names the breakpoints at its line; a new set for the file replaces them", async () => {
        const main = { path: `${SYNTHETIC_PROGRAM_ROOT}/src/main.cpp` };
        await body("setBreakpoints", { source: main, breakpoints: [{ line: 27 }, { line: 27 }, { line: 40 }] });
        await body("setBreakpoints", { source: main, breakpoints: [{ line: 27 }, { line: 31 }] });

        await launchStopped();

        expect(eventsOf("stopped")[0].hitBreakpointIds).toEqual([4]);
    });

    it("has three threads and their stacks: 26 frames on the main one, frames without a source subtle", async () => {
        await launchStopped();

        expect(await body("threads")).toEqual({
            threads: [
                { id: 1, name: "hello" },
                { id: 2, name: "worker-1" },
                { id: 3, name: "worker-2" },
            ],
        });
        const main = await body("stackTrace", { threadId: 1, startFrame: 20, levels: 20 });
        expect(main.totalFrames).toBe(26);
        expect((main.stackFrames as DebugProtocol.StackFrame[]).map((f) => [f.name, f.presentationHint])).toEqual([
            ["recurse<17>(Node*)", undefined],
            ["recurse<18>(Node*)", undefined],
            ["recurse<19>(Node*)", undefined],
            ["__libc_start_call_main", "subtle"],
            ["__libc_start_main_impl", "subtle"],
            ["_start", "subtle"],
        ]);
        expect(((await body("stackTrace", { threadId: 2 })).stackFrames as unknown[]).length).toBe(4);
        const worker2 = (await body("stackTrace", { threadId: 3 })).stackFrames as DebugProtocol.StackFrame[];
        expect(worker2[1].source).toEqual({ name: "queue.cpp", path: "/home/user/hello/src/queue.cpp" });
    });

    it("the scopes of a frame: four with a source, only Registers without, none for an unknown frame", async () => {
        await launchStopped();

        expect((await scopes(1000)).map((s) => s.name)).toEqual(["Locals", "Static", "Global", "Registers"]);
        expect((await scopes(1023)).map((s) => s.name)).toEqual(["Registers"]);
        expect(await scopes(1099)).toEqual([]);
        const [, staticScope, global, registers] = await scopes(1000);
        expect((await variablesOf(staticScope.variablesReference)).map((v) => v.name)).toEqual(["Counter::instances"]);
        expect((await variablesOf(global.variablesReference)).map((v) => v.value)).toEqual(["false", '"hello"']);
        const regs = await variablesOf(registers.variablesReference);
        expect(regs).toHaveLength(18);
        expect(regs.find((r) => r.name === "rip")?.value).toBe(
            `0x${(0x555555555189 + 27 * 4).toString(16).padStart(16, "0")}`,
        );
        expect(regs.find((r) => r.name === "rax")?.value).toBe(`0x${(0x7fffffffe000).toString(16).padStart(16, "0")}`);
    });

    it("the locals of the spike, nested values down to the end of the list", async () => {
        await launchStopped();
        const vars = await locals();

        expect([...vars.keys()]).toEqual([
            "nums",
            "i",
            "sum",
            "total",
            "count",
            "name",
            "ok",
            "p",
            "head",
            "flags",
            "cfg",
            "bad",
        ]);
        expect(vars.get("nums")).toMatchObject({ value: "size=1000", indexedVariables: 1000 });
        expect((await variablesOf(vars.get("p")?.variablesReference)).map((v) => [v.name, v.value])).toEqual([
            ["x", "1.5"],
            ["y", "-2"],
        ]);
        expect((await variablesOf(vars.get("flags")?.variablesReference)).map((v) => v.evaluateName)).toEqual([
            'flags["debug"]',
            'flags["trace"]',
            "",
        ]);
        const cfg = await variablesOf(vars.get("cfg")?.variablesReference);
        expect((await variablesOf(cfg[1].variablesReference)).map((v) => v.value)).toEqual(["-1000", "1000"]);
        let node = vars.get("head");
        const values: string[] = [];
        while (node && node.variablesReference > 0) {
            const [value, next] = await variablesOf(node.variablesReference);
            values.push(value.value);
            node = next;
        }
        expect(values).toEqual(["1", "2", "3", "4", "5", "6"]);
        expect(node).toMatchObject({ value: "nullptr", evaluateName: "head->next->next->next->next->next->next" });
    });

    it("the locals of the other frames are main's", async () => {
        await launchStopped();
        const [scope] = await scopes(1002);
        const vars = await variablesOf(scope.variablesReference);

        expect(vars.map((v) => v.name)).toEqual(["argc", "argv", "rc"]);
        expect((await variablesOf(vars[1].variablesReference)).map((v) => v.evaluateName)).toEqual([
            "argv[0]",
            "argv[1]",
            "argv[2]",
        ]);
    });

    it("pages `nums` by index, has no named children, all of them unfiltered", async () => {
        await launchStopped();
        const nums = (await locals()).get("nums");

        const page = await variablesOf(nums?.variablesReference, { filter: "indexed", start: 100, count: 3 });
        expect(page.map((v) => [v.name, v.value])).toEqual([
            ["[100]", String(numAt(100))],
            ["[101]", String(numAt(101))],
            ["[102]", String(numAt(102))],
        ]);
        expect(await variablesOf(nums?.variablesReference, { filter: "indexed" })).toHaveLength(1000);
        expect(await variablesOf(nums?.variablesReference, { filter: "named" })).toEqual([]);
        expect(await variablesOf(nums?.variablesReference)).toHaveLength(1000);
    });

    it("an unknown or stale variable reference fails", async () => {
        await launchStopped();
        const response = await request("variables", { variablesReference: 999 });

        expect(response).toMatchObject({ success: false, message: "Invalid variable reference 999" });
    });

    describe("evaluate", () => {
        beforeEach(async () => {
            await launchStopped();
        });

        it.each([
            ["sum", "0"],
            ["nums[i]", String(numAt(0))],
            ["nums[5]", "67"],
            ["1 + 2 * 3", "7"],
            ["(1 + 2) * 3", "9"],
            ["-3 - 4", "-7"],
            ["10 / 3", "3"],
            ["total - count", "0"],
            ["7 % 3", "1"],
            ["sum == 0", "1"],
            ["3 > 5", "0"],
            ["6 > 1 + 2", "1"],
        ])("%s = %s", async (expression, result) => {
            expect(await body("evaluate", { expression })).toMatchObject({ result });
        });

        it("a local with children comes with its reference", async () => {
            expect(await body("evaluate", { expression: "nums" })).toMatchObject({
                result: "size=1000",
                indexedVariables: 1000,
            });
        });

        it.each([
            ["total / count", "error: division by zero"],
            ["nope + 1", "error: use of undeclared identifier 'nope'"],
            ["nums[2000]", "error: use of undeclared identifier 'nums'"],
            ["1 +", "error: expected expression"],
            ["1 ==", "error: expected expression"],
            ["7 % 0", "error: expected expression"],
            ["(1 + 2", "error: expected expression"],
            ["1 2", "error: expected expression"],
            ["1 $ 2", "error: expected expression"],
            ["-(", "error: expected expression"],
            ["", "error: expected expression"],
        ])("%s fails with %s", async (expression, message) => {
            expect(await request("evaluate", { expression })).toMatchObject({ success: false, message });
        });

        it("nothing is available while running", async () => {
            const slow = new SyntheticDebugAdapter({ ...NO_DELAY_TIMING, continueMs: 60_000 });
            adapter.dispose();
            adapter = slow;
            await launchStopped();
            await body("continue", { threadId: 1 });

            expect(await request("evaluate", { expression: "sum" })).toMatchObject({
                success: false,
                message: "<not available>",
            });
        });
    });

    it("sets a variable and keeps the value across stops; an unknown one fails", async () => {
        await launchStopped();
        const [scope] = await scopes(1000);

        expect(
            await body("setVariable", { variablesReference: scope.variablesReference, name: "count", value: "4" }),
        ).toEqual({
            value: "4",
            type: "int",
        });
        expect(
            await request("setVariable", { variablesReference: scope.variablesReference, name: "nope", value: "1" }),
        ).toMatchObject({
            success: false,
            message: "Cannot set 'nope'",
        });
        expect(await request("setVariable", { variablesReference: 999, name: "count", value: "1" })).toMatchObject({
            success: false,
        });
        // A number takes only a number; an expression is set the same way, an unknown one fails.
        expect(
            await request("setVariable", { variablesReference: scope.variablesReference, name: "count", value: "x" }),
        ).toMatchObject({ success: false, message: "error: 'x' is not a number" });
        expect(await body("setExpression", { expression: "sum", value: "7", frameId: 1000 })).toMatchObject({
            value: "7",
        });
        expect(await body("setExpression", { expression: "total", value: "5" })).toMatchObject({ value: "5" });
        expect(await request("setExpression", { expression: "sum", value: "1", frameId: 999 })).toMatchObject({
            success: false,
        });
        expect(await request("setExpression", { expression: "nope", value: "1", frameId: 1000 })).toMatchObject({
            success: false,
            message: "Cannot set 'nope'",
        });
        await body("next", { threadId: 1 });
        await stopped(2);
        expect((await locals()).get("count")?.value).toBe("4");
    });

    it("steps: over moves a line, the third step over throws; into, out and restart frame", async () => {
        await launchStopped();
        const line = async (): Promise<number> =>
            ((await body("stackTrace", { threadId: 1, levels: 1 })).stackFrames as DebugProtocol.StackFrame[])[0].line;

        await body("next", { threadId: 1 });
        await stopped(2);
        expect(await line()).toBe(28);
        await body("stepIn", { threadId: 1 });
        await stopped(3);
        expect(await line()).toBe(28);
        await body("stepOut", { threadId: 1 });
        await stopped(4);
        expect(await line()).toBe(27);
        expect((await locals()).get("i")?.value).toBe("1");
        await body("next", { threadId: 1 });
        await stopped(5);
        await body("next", { threadId: 1 });
        await stopped(6);

        expect(eventsOf("stopped").at(-1)).toEqual({
            reason: "exception",
            threadId: 1,
            allThreadsStopped: true,
            text: "std::out_of_range",
            description: "Exception has occurred.",
        });
        expect(eventsOf("output").at(-1)).toMatchObject({ category: "stderr" });
        expect(await body("exceptionInfo", { threadId: 1 })).toMatchObject({
            exceptionId: "std::out_of_range",
            breakMode: "always",
        });

        await body("restartFrame", { frameId: 1000 });
        await stopped(7);
        expect(eventsOf("stopped").at(-1)?.reason).toBe("restart");
    });

    it("step over wraps from line 31 back to 27 and counts the loop", async () => {
        await launchStopped();
        await body("continue", { threadId: 1 });
        await stopped(2);
        expect((await locals()).get("i")?.value).toBe("100");

        await body("next", { threadId: 1 });
        await stopped(3);

        expect((await locals()).get("i")?.value).toBe("101");
        expect((await locals()).get("ok")?.value).toBe("false");
    });

    it("continue: all threads, the logpoint at main.cpp:35, the breakpoint at line 31", async () => {
        await launchStopped();

        expect(await body("continue", { threadId: 1 })).toEqual({ allThreadsContinued: true });
        await stopped(2);

        expect(eventsOf("output").at(-1)).toMatchObject({
            category: "console",
            line: 35,
            source: { name: "main.cpp", path: "/home/user/hello/src/main.cpp" },
        });
    });

    describe("the loop with conditions, hit counts and logpoints", () => {
        const main = { path: `${SYNTHETIC_PROGRAM_ROOT}/src/main.cpp` };

        async function continueToStop(count: number): Promise<void> {
            await body("continue", { threadId: 1 });
            await stopped(count);
        }

        it("a condition stops only where it holds; a stop names only the breakpoints that hold", async () => {
            await body("setBreakpoints", {
                source: main,
                breakpoints: [
                    { line: 27, condition: "i % 100 == 0" },
                    { line: 27, condition: "i == 1" },
                ],
            });
            await launchStopped();

            await continueToStop(2);
            expect(await body("evaluate", { expression: "i" })).toMatchObject({ result: "1" });
            expect(eventsOf("stopped")[1]).toMatchObject({ reason: "breakpoint", hitBreakpointIds: [2] });
            await continueToStop(3);
            expect(await body("evaluate", { expression: "i" })).toMatchObject({ result: "100" });
            expect(eventsOf("stopped")[2].hitBreakpointIds).toEqual([1]);
        });

        it("a logpoint logs every pass with its values, a hit count stops from its pass on", async () => {
            await body("setBreakpoints", {
                source: main,
                breakpoints: [
                    { line: 29, logMessage: "sum={sum} i={i} {nope} {1 + 1}" },
                    { line: 31, hitCondition: "never" },
                    { line: 30, hitCondition: ">= 3" },
                ],
            });
            await launchStopped();

            await continueToStop(2);
            expect(await body("evaluate", { expression: "i" })).toMatchObject({ result: "2" });
            const logged = eventsOf("output").filter((o) => o.line === 29);
            expect(logged.map((o) => o.output)).toEqual([
                "sum=0 i=0 <error: nope> 2\n",
                `sum=${String(numAt(0))} i=1 <error: nope> 2\n`,
                `sum=${String(numAt(0) + numAt(1))} i=2 <error: nope> 2\n`,
            ]);
            expect(logged[0]).toMatchObject({ category: "console", source: { name: "main.cpp" } });
            await continueToStop(3);
            expect(await body("evaluate", { expression: "i" })).toMatchObject({ result: "3" });
        });

        it("a condition that fails to evaluate stops; one that never holds runs to the end and exits", async () => {
            await body("setBreakpoints", { source: main, breakpoints: [{ line: 28, condition: "nope > 1" }] });
            await launchStopped();
            await continueToStop(2);
            expect(eventsOf("stopped")[1]).toMatchObject({ hitBreakpointIds: [1] });

            await body("setBreakpoints", { source: main, breakpoints: [{ line: 28, condition: "i > 5000" }] });
            await body("continue", { threadId: 1 });
            await vi.waitFor(() => {
                expect(eventsOf("terminated")).toHaveLength(1);
            });
            expect(eventsOf("exited")).toEqual([{ exitCode: 0 }]);
            expect(eventsOf("output").at(-1)).toMatchObject({ output: "Process exited with code 0.\n" });
        });

        it("a plain breakpoint in the loop stops on its line, not the jump; an empty condition is none", async () => {
            await body("setBreakpoints", { source: main, breakpoints: [{ line: 28, condition: "" }] });
            await launchStopped();
            await continueToStop(2);
            expect(await body("evaluate", { expression: "i" })).toMatchObject({ result: "0" });
            expect(eventsOf("stopped")[1]).toMatchObject({ reason: "breakpoint", hitBreakpointIds: [1] });
        });
    });

    describe("dataBreakpointInfo on an address", () => {
        it("watches any range for reads, writes or both", async () => {
            expect(await body("dataBreakpointInfo", { name: "0x10", asAddress: true, bytes: 4 })).toEqual({
                dataId: "0x10+4",
                description: "0x10 (4 bytes)",
                accessTypes: ["read", "write", "readWrite"],
                canPersist: true,
            });
            expect(await body("dataBreakpointInfo", { name: "0x10", asAddress: true })).toMatchObject({
                dataId: "0x10+1",
            });
        });
    });

    it("pause stops a running program, and does nothing to a stopped one", async () => {
        const slow = new SyntheticDebugAdapter({ ...NO_DELAY_TIMING, continueMs: 60_000 });
        adapter.dispose();
        adapter = slow;
        adapter.onEvent((e) => events.push(e));
        await launchStopped();

        await body("pause", { threadId: 1 });
        expect(eventsOf("stopped")).toHaveLength(1);
        await body("continue", { threadId: 1 });
        await body("pause", { threadId: 1 });
        await stopped(2);

        expect(eventsOf("stopped").at(-1)?.reason).toBe("pause");
    });

    it("terminating threads ends them", async () => {
        await launchStopped();

        await body("terminateThreads", { threadIds: [2, 3] });
        await body("terminateThreads");

        expect(eventsOf("thread")).toEqual([
            { reason: "exited", threadId: 2 },
            { reason: "exited", threadId: 3 },
        ]);
        expect(await body("threads")).toEqual({ threads: [{ id: 1, name: "hello" }] });
    });

    it("lists the loaded sources", async () => {
        expect(((await body("loadedSources")).sources as DebugProtocol.Source[]).map((s) => s.name)).toEqual([
            "main.cpp",
            "list.cpp",
            "queue.cpp",
        ]);
    });

    it("terminate exits the program", async () => {
        await launchStopped();

        await body("terminate");
        await vi.waitFor(() => {
            expect(eventsOf("terminated")).toHaveLength(1);
        });

        expect(eventsOf("exited")).toEqual([{ exitCode: 0 }]);
        expect((eventsOf("output").at(-1)?.output as string).trimEnd()).toBe("Process exited with code 0.");
    });

    it("disconnect and stopping drop the running program's timers", async () => {
        const slow = new SyntheticDebugAdapter({ ...NO_DELAY_TIMING, launchMs: 60_000 });
        adapter.dispose();
        adapter = slow;
        await body("launch");
        await body("configurationDone");

        await body("disconnect");
        await adapter.startSession();
        await adapter.stopSession();

        expect(eventsOf("stopped")).toEqual([]);
    });

    it("completes the locals by the word before the cursor of the first line", async () => {
        await launchStopped();

        expect(await body("completions", { text: "cf", column: 3 })).toEqual({
            targets: [{ label: "cfg", type: "variable", detail: "Config const&", length: 2 }],
        });
        expect(await body("completions", { text: "x + co\nsum", column: 7 })).toEqual({
            targets: [{ label: "count", type: "variable", detail: "int", length: 2 }],
        });
        const all = (await body("completions", { text: "", column: 1 })).targets as { length: number }[];
        expect(all.length).toBeGreaterThan(10);
        expect(all.every((t) => t.length === 0)).toBe(true);
    });

    it("an unknown request fails; a response to the adapter is ignored", async () => {
        expect(await request("readMemory")).toMatchObject({
            success: false,
            message: "Unrecognized request 'readMemory'",
        });

        adapter.sendMessage({ type: "response", seq: 1 });
        expect(adapter.requests.map((r) => r.command)).toEqual(["readMemory"]);
    });

    it("waits its latency before the variables and evaluate answers", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const late = new SyntheticDebugAdapter({ ...NO_DELAY_TIMING, latencyMs: 250 });
        try {
            let answered = false;
            late.sendRequest("evaluate", { expression: "1" }, () => {
                answered = true;
            });
            await vi.advanceTimersByTimeAsync(249);
            expect(answered).toBe(false);
            await vi.advanceTimersByTimeAsync(2);
            expect(answered).toBe(true);
        } finally {
            late.dispose();
            vi.useRealTimers();
        }
    });
});

describe("registerSyntheticDebugger", () => {
    it("registers the debug type and a factory of fresh adapters, until disposed", async () => {
        const manager = new AdapterManager(idleDebugService, adapterManagerPorts());
        const registration = registerSyntheticDebugger(manager);

        const session = { configuration: SYNTHETIC_LAUNCH_CONFIG } as never;
        const first = manager.createDebugAdapter(session);
        expect(first).toBeInstanceOf(SyntheticDebugAdapter);
        expect(manager.createDebugAdapter(session)).not.toBe(first);
        expect(registration.factory.adapters).toHaveLength(2);
        expect(manager.getDebugger(SYNTHETIC_DEBUG_TYPE)?.label).toBe("Synthetic (C++ under CodeLLDB)");
        expect(await manager.substituteVariables(SYNTHETIC_DEBUG_TYPE, undefined, SYNTHETIC_LAUNCH_CONFIG)).toBe(
            SYNTHETIC_LAUNCH_CONFIG,
        );

        registration.dispose();
        expect(manager.getDebugger(SYNTHETIC_DEBUG_TYPE)).toBeUndefined();
        expect(manager.createDebugAdapter(session)).toBeUndefined();
        registration.factory.adapters.forEach((a) => {
            a.dispose();
        });
        manager.dispose();
    });

    it("a factory without timing uses the spike's", () => {
        const adapter = new SyntheticDebugAdapterFactory().createDebugAdapter();
        expect(adapter).toBeInstanceOf(SyntheticDebugAdapter);
        adapter.dispose();
        new SyntheticDebugAdapter().dispose();
    });
});
