import { describe, expect, it } from "vitest";

import { FakeExtensionPtySession } from "../../../../../TestUtils/FakeExtensionPtySession.ts";
import { type ITaskFixtureOptions, makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { buildTerminalTaskSystemHarness } from "../../../../../TestUtils/terminalTaskSystemHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";
import { PROBLEMS_VIEW_ID } from "../../markers/browser/problemsComponent.ts";
import { TERMINAL_VIEW_ID } from "../../terminal/browser/terminalService.ts";
import type { IProblemMatcher } from "../common/problemMatcher.ts";

// The producer: lines of a task's terminal become markers (upstream `terminal.onLineData` →
// `StartStopProblemCollector`), and what the task system does with what was found.

const A = Uri.file("/ws/src/a.ts").toString();
const B = Uri.file("/ws/src/b.ts").toString();

function lint(options: ITaskFixtureOptions = {}) {
    return makeTask({ label: "lint", problemMatchers: ["$msCompile"], ...options });
}

function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function messages(h: ReturnType<typeof buildTerminalTaskSystemHarness>, owner = "msCompile"): string[] {
    return h.markers.read({ owner }).map((m) => `${Uri.parse(m.resource).fsPath}: ${m.message}`);
}

describe("TerminalTaskSystem — problem matchers", () => {
    it("lines of the task terminal become markers as output goes; the task ends once all are delivered", async () => {
        const h = buildTerminalTaskSystemHarness();
        const result = h.system.run(lint(), h.context());
        h.sessions[0].emitLines(
            "> Executing task: lint",
            "/ws/src/a.ts(3,5): error TS1005: ';' expected.",
            "/ws/src/b.ts(1,1): warning TS6133: 'x' is declared but never used.",
        );
        await settle();
        // a.ts is delivered once the output moved on to b.ts.
        expect(messages(h)).toStrictEqual(["/ws/src/a.ts: ';' expected."]);
        h.sessions[0].emitExit(2);
        expect(h.events.at(-1)).toBe("changed");
        await expect(result.promise).resolves.toStrictEqual({ exitCode: 2 });
        expect(messages(h)).toStrictEqual([
            "/ws/src/a.ts: ';' expected.",
            "/ws/src/b.ts: 'x' is declared but never used.",
        ]);
        expect(h.markers.read({ resource: A })[0]).toMatchObject({
            severity: MarkerSeverity.Error,
            range: createRange(2, 4, 2, 4),
            code: "TS1005",
            source: "cpp",
        });
        expect(h.events.slice(-4)).toStrictEqual(["changed", "processEnded:lint:2", "inactive:lint:1", "end:lint:1"]);
        // Lines after the end don't reach the finished task's collector.
        h.sessions[0].emitLines("/ws/src/c.ts(1,1): error X: late");
        await settle();
        expect(messages(h)).toHaveLength(2);
        h.dispose();
    });

    it("a rerun after the fix: what the output no longer mentions is cleared; other owners stay", async () => {
        const h = buildTerminalTaskSystemHarness();
        h.markers.changeOne("typescript", A, [
            { severity: MarkerSeverity.Error, range: createRange(0, 0, 0, 1), message: "lsp" },
        ]);
        const first = h.system.run(lint(), h.context());
        h.sessions[0].emitLines("/ws/src/a.ts(1,1): error E1: one", "/ws/src/b.ts(1,1): error E1: two");
        h.sessions[0].emitExit(1);
        await first.promise;
        const second = h.system.run(lint(), h.context());
        // The idle terminal is relaunched: the same session.
        expect(h.sessions).toHaveLength(1);
        h.sessions[0].emitLines("/ws/src/b.ts(2,1): error E1: still");
        h.sessions[0].emitExit(1);
        await second.promise;
        expect(messages(h)).toStrictEqual(["/ws/src/b.ts: still"]);
        expect(messages(h, "typescript")).toStrictEqual(["/ws/src/a.ts: lsp"]);
        const third = h.system.run(lint(), h.context());
        h.sessions[0].emitExit(0);
        await third.promise;
        expect(messages(h)).toStrictEqual([]);
        h.dispose();
    });

    it("an unknown matcher is reported in the Tasks log and skipped; the task runs with the rest", async () => {
        const h = buildTerminalTaskSystemHarness();
        const result = h.system.run(lint({ problemMatchers: ["$nope", "msCompile"] }), h.context());
        expect(h.warnings).toStrictEqual(["Problem matcher $nope can't be resolved. The matcher will be ignored"]);
        h.sessions[0].emitLines("/ws/src/a.ts(1,1): error E1: found");
        h.sessions[0].emitExit(1);
        await result.promise;
        expect(messages(h)).toStrictEqual(["/ws/src/a.ts: found"]);
        h.dispose();
    });

    it("a background task: the matcher is ignored with a warning, the task ends with its process", async () => {
        const h = buildTerminalTaskSystemHarness();
        const result = h.system.run(lint({ isBackground: true }), h.context());
        expect(h.warnings).toStrictEqual([
            "Problem matchers are not supported for background tasks yet; the matcher is ignored",
        ]);
        h.sessions[0].emitLines("/ws/src/a.ts(1,1): error E1: found");
        h.sessions[0].emitExit(0);
        // No collector: the end is synchronous, as for a task without matchers.
        expect(h.events.at(-1)).toBe("end:lint:1");
        await result.promise;
        expect(messages(h)).toStrictEqual([]);
        h.dispose();
    });

    it("an inline matcher's filePrefix gets task variables; output without matches creates nothing", async () => {
        const h = buildTerminalTaskSystemHarness();
        const relative: IProblemMatcher = {
            owner: "rel",
            applyTo: "allDocuments",
            fileLocation: "relative",
            filePrefix: "${workspaceFolder}/src",
            pattern: { regexp: /^(\S+):(\d+) (.*)$/, file: 1, line: 2, message: 3 },
        };
        const result = h.system.run(lint({ problemMatchers: [relative] }), h.context());
        h.sessions[0].emitLines("a.ts:4 relative to the folder");
        h.sessions[0].emitExit(1);
        await result.promise;
        expect(messages(h, "rel")).toStrictEqual(["/ws/src/a.ts: relative to the folder"]);
        const quiet = h.system.run(lint({ label: "quiet" }), h.context());
        // The shared terminal is reused.
        h.sessions[0].emitExit(0);
        await quiet.promise;
        expect(h.markers.read({ owner: "msCompile" })).toStrictEqual([]);
        h.dispose();
    });

    it("search include/exclude get task variables", async () => {
        const h = buildTerminalTaskSystemHarness();
        const searching: IProblemMatcher = {
            owner: "search",
            applyTo: "allDocuments",
            fileLocation: "search",
            filePrefix: {
                include: ["${workspaceFolder}/src", "${workspaceFolder}/gen"],
                exclude: "${workspaceFolder}/gen",
            },
            pattern: { regexp: /^(\S+):(\d+) (.*)$/, file: 1, line: 2, message: 3 },
        };
        // The harness file system can't list directories: the name falls back to absolute after the search.
        const result = h.system.run(lint({ problemMatchers: [searching] }), h.context());
        h.sessions[0].emitLines("/abs/x.ts:1 m");
        h.sessions[0].emitExit(1);
        await result.promise;
        expect(messages(h, "search")).toStrictEqual(["/abs/x.ts: m"]);
        expect(h.listedDirectories).toStrictEqual(["/ws/src"]);
        h.dispose();
    });

    it("search without include lists nothing; the name is absolute", async () => {
        const h = buildTerminalTaskSystemHarness();
        const searching: IProblemMatcher = {
            owner: "search",
            applyTo: "allDocuments",
            fileLocation: "search",
            filePrefix: { exclude: ["${workspaceFolder}/gen"] },
            pattern: { regexp: /^(\S+):(\d+) (.*)$/, file: 1, line: 2, message: 3 },
        };
        const result = h.system.run(lint({ problemMatchers: [searching] }), h.context());
        h.sessions[0].emitLines("/abs/x.ts:1 m");
        h.sessions[0].emitExit(1);
        await result.promise;
        expect(messages(h, "search")).toStrictEqual(["/abs/x.ts: m"]);
        expect(h.listedDirectories).toStrictEqual([]);
        h.dispose();
    });

    it("lines after the exit belong to no run: they don't count for revealProblems", async () => {
        const h = buildTerminalTaskSystemHarness();
        const result = h.system.run(lint({ presentation: { revealProblems: "onProblem" } }), h.context());
        h.sessions[0].emitExit(0);
        h.sessions[0].emitLines("/ws/src/a.ts(1,1): error E1: from whatever comes next");
        await result.promise;
        expect(h.views.service.isViewShown(PROBLEMS_VIEW_ID)).toBe(false);
        h.dispose();
    });

    it("terminate: problems found before the stop stay", async () => {
        const h = buildTerminalTaskSystemHarness();
        const task = lint();
        const result = h.system.run(task, h.context());
        h.sessions[0].emitLines("/ws/src/a.ts(1,1): error E1: before stop");
        await h.system.terminate(task);
        await result.promise;
        expect(messages(h)).toStrictEqual(["/ws/src/a.ts: before stop"]);
        expect(h.events.at(-1)).toBe("terminated:lint:user");
        h.dispose();
    });

    it("a CustomExecution pty gives lines the same way", async () => {
        const h = buildTerminalTaskSystemHarness();
        const sessions: FakeExtensionPtySession[] = [];
        h.system.setCustomExecutionTerminals({
            createPtyInstance: (options) => {
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
        const task = makeTask({
            label: "pty",
            command: { runtime: "custom" },
            extension: { type: "custom", extensionId: "pub.ext", source: "Ext" },
            problemMatchers: ["$msCompile"],
        });
        const result = h.system.run(task, h.context());
        sessions[0].emitLines("/ws/src/b.ts(2,2): error E2: from pty");
        sessions[0].exit(1);
        await result.promise;
        expect(messages(h)).toStrictEqual(["/ws/src/b.ts: from pty"]);
        h.dispose();
    });
});

describe("TerminalTaskSystem — revealing problems", () => {
    it("revealProblems always: Problems opens at start instead of the terminal", () => {
        const h = buildTerminalTaskSystemHarness();
        h.system.run(lint({ presentation: { revealProblems: "always" } }), h.context());
        expect(h.views.service.isViewShown(PROBLEMS_VIEW_ID)).toBe(true);
        expect(h.views.service.isViewShown(TERMINAL_VIEW_ID)).toBe(false);
        h.dispose();
    });

    it("revealProblems onProblem: Problems opens at the end only if something matched", async () => {
        const h = buildTerminalTaskSystemHarness();
        const quiet = h.system.run(lint({ presentation: { revealProblems: "onProblem" } }), h.context());
        expect(h.views.service.isViewShown(TERMINAL_VIEW_ID)).toBe(true);
        h.sessions[0].emitExit(0);
        await quiet.promise;
        expect(h.views.service.isViewShown(PROBLEMS_VIEW_ID)).toBe(false);
        const noisy = h.system.run(lint({ presentation: { revealProblems: "onProblem" } }), h.context());
        h.sessions[0].emitLines("/ws/src/a.ts(1,1): info I1: just info");
        h.sessions[0].emitExit(0);
        expect(h.views.service.isViewShown(PROBLEMS_VIEW_ID)).toBe(false);
        await noisy.promise;
        expect(h.views.service.isViewShown(PROBLEMS_VIEW_ID)).toBe(true);
        h.dispose();
    });

    it("reveal silent: the terminal shows on exit code 0 when the output has errors, not for warnings", async () => {
        const h = buildTerminalTaskSystemHarness();
        const silent = { presentation: { reveal: "silent" as const } };
        const warnings = h.system.run(lint(silent), h.context());
        h.sessions[0].emitLines("/ws/src/a.ts(1,1): warning W1: only a warning");
        h.sessions[0].emitExit(0);
        await warnings.promise;
        expect(h.views.service.isViewShown(TERMINAL_VIEW_ID)).toBe(false);
        const errors = h.system.run(lint(silent), h.context());
        h.sessions[0].emitLines("/ws/src/b.ts(1,1): error E1: an error");
        h.sessions[0].emitExit(0);
        await errors.promise;
        expect(h.views.service.isViewShown(TERMINAL_VIEW_ID)).toBe(true);
        expect(h.markers.read({ resource: B })).toHaveLength(1);
        h.dispose();
    });

    it("reveal silent with a closed terminal: nothing to show", async () => {
        const h = buildTerminalTaskSystemHarness();
        const task = lint({ presentation: { reveal: "silent" } });
        const result = h.system.run(task, h.context());
        h.sessions[0].emitLines("/ws/src/b.ts(1,1): error E1: an error");
        await h.system.terminate(task);
        await result.promise;
        expect(h.views.service.isViewShown(TERMINAL_VIEW_ID)).toBe(false);
        h.dispose();
    });
});
