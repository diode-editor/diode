// What a session does for the Run and Debug views: showing them on a stop at a breakpoint (`debug.openDebug`) and
// resolving lazy variables up front (`debug.autoExpandLazyVariables`).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createTestDebugSession,
    type ITestSessionServices,
    type TestDebugService,
    testDebugService,
    testSessionServices,
} from "../../../../../TestUtils/debugSessionFixture.ts";
import { createMockDebugModel } from "../../../../../TestUtils/mockDebug.ts";
import { MockDebugAdapter } from "../../../../../TestUtils/mockDebugAdapter.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IDebugger, IDebugSessionOptions } from "../common/debug.ts";
import type { DebugModel, Variable } from "../common/debugModel.ts";

import type { DebugSession } from "./debugSession.ts";

const FILE = Uri.file("/src/a.c");

function debuggerOf(adapter: MockDebugAdapter): IDebugger {
    return {
        type: "mock",
        createDebugAdapter: () => Promise.resolve(adapter),
        runInTerminal: () => Promise.resolve(undefined),
        startDebugging: () => Promise.resolve(true),
        getInitialConfigurationContent: () => Promise.resolve(""),
    };
}

describe("DebugSession for the views", () => {
    const disposables = new DisposableStore();
    let model: DebugModel;
    let debugService: TestDebugService;
    let services: ITestSessionServices;

    beforeEach(() => {
        model = createMockDebugModel(disposables);
        debugService = testDebugService(model);
        services = testSessionServices();
    });

    afterEach(() => {
        disposables.clear();
        debugService.viewModel.dispose();
    });

    async function launch(
        options?: IDebugSessionOptions,
    ): Promise<{ session: DebugSession; adapter: MockDebugAdapter }> {
        const adapter = disposables.add(new MockDebugAdapter());
        adapter.handlers.set("threads", () => ({ threads: [{ id: 1, name: "main" }] }));
        adapter.handlers.set("stackTrace", () => ({
            stackFrames: [{ id: 10, name: "f", source: { path: FILE.fsPath }, line: 5, column: 1 }],
            totalFrames: 1,
        }));
        adapter.handlers.set("scopes", () => ({
            scopes: [{ name: "Locals", variablesReference: 1, expensive: false }],
        }));
        adapter.handlers.set("variables", (args) =>
            (args as { variablesReference: number }).variablesReference === 1
                ? {
                      variables: [
                          { name: "getter", value: "(...)", variablesReference: 2, presentationHint: { lazy: true } },
                      ],
                  }
                : { variables: [{ name: "", value: "42", variablesReference: 0 }] },
        );
        const session = disposables.add(
            createTestDebugSession(model, "s", options, debugService, services, { type: "mock" }),
        );
        model.addSession(session);
        await session.initialize(debuggerOf(adapter));
        await session.launchOrAttach(session.configuration);
        return { session, adapter };
    }

    async function stop(adapter: MockDebugAdapter, reason: string): Promise<void> {
        adapter.sendEventBody("stopped", { reason, threadId: 1, allThreadsStopped: true });
        await vi.waitFor(() => {
            expect(debugService.focusStackFrame).toHaveBeenCalled();
        });
        // The opening follows the focus in the same task chain.
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    describe("debug.openDebug", () => {
        it("openOnDebugBreak: a stop at a breakpoint shows Run and Debug, a step does not", async () => {
            const { adapter } = await launch();

            await stop(adapter, "step");
            expect(services.viewletOpenings).toBe(0);

            await stop(adapter, "breakpoint");
            await vi.waitFor(() => {
                expect(services.viewletOpenings).toBe(1);
            });
        });

        it("a stop that the program left while it was being focused does not show it", async () => {
            const { adapter } = await launch();
            const pending: (() => void)[] = [];
            const focused = (): void => {
                for (const resolve of pending.splice(0)) resolve();
            };
            vi.mocked(debugService.focusStackFrame).mockImplementation(
                () =>
                    new Promise<void>((resolve) => {
                        pending.push(resolve);
                    }),
            );
            adapter.sendEventBody("stopped", { reason: "breakpoint", threadId: 1, allThreadsStopped: true });
            await vi.waitFor(() => {
                expect(debugService.focusStackFrame).toHaveBeenCalled();
            });

            adapter.sendEventBody("continued", { threadId: 1, allThreadsContinued: true });
            await vi
                .waitFor(() => {
                    expect(debugService.viewModel.focusedThread).toBeUndefined();
                })
                .catch(() => undefined);
            await new Promise((resolve) => setTimeout(resolve, 10));
            focused();
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(services.viewletOpenings).toBe(0);
        });

        it("other values, or a session that suppresses the view, leave it alone", async () => {
            services.configuration.openDebug = "openOnSessionStart";
            const { adapter } = await launch();
            await stop(adapter, "breakpoint");
            expect(services.viewletOpenings).toBe(0);

            services.configuration.openDebug = "openOnDebugBreak";
            const suppressed = await launch({ suppressDebugView: true });
            await stop(suppressed.adapter, "breakpoint");
            expect(services.viewletOpenings).toBe(0);
        });
    });

    describe("debug.autoExpandLazyVariables", () => {
        async function locals(): Promise<Variable[]> {
            const { session, adapter } = await launch();
            await stop(adapter, "step");
            const frame = session.getThread(1)!.getTopStackFrame()!;
            const [scope] = await frame.getScopes();
            return (await scope.getChildren()) as Variable[];
        }

        it("on: a lazy variable comes resolved, with its value and without the lazy hint", async () => {
            services.configuration.autoExpandLazyVariables = "on";

            const [getter] = await locals();

            expect(getter.value).toBe("42");
            expect(getter.presentationHint?.lazy).toBeFalsy();
        });

        it.each(["auto", "off"] as const)("%s: it stays lazy until asked (no screen reader mode)", async (value) => {
            services.configuration.autoExpandLazyVariables = value;

            const [getter] = await locals();

            expect(getter.value).toBe("(...)");
            expect(getter.presentationHint?.lazy).toBe(true);
        });
    });
});
