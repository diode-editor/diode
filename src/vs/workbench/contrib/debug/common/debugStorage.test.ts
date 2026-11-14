import { describe, expect, it, vi } from "vitest";

import { createMockDebugModel, mockStateService, NO_DIRTY_FILES } from "../../../../../TestUtils/mockDebug.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../base/test/common/utils.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";

import { DataBreakpointSetType } from "./debug.ts";
import { DebugStorage } from "./debugStorage.ts";

describe("DebugStorage", () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();

    function storageOver(state = mockStateService(), logger = NULL_LOGGER): DebugStorage {
        return disposables.add(new DebugStorage(state, NO_DIRTY_FILES, logger));
    }

    it("stores every kind of breakpoint under the upstream keys, as JSON values, and loads them back", () => {
        const state = mockStateService();
        const model = createMockDebugModel(disposables, state);
        const file = Uri.file("/src/main.cpp");
        model.addBreakpoints(file, [{ lineNumber: 7, column: 3, condition: "i > 2", enabled: false }]);
        model.addFunctionBreakpoint({ name: "main" }, "f1");
        model.addDataBreakpoint(
            {
                description: "x",
                src: { type: DataBreakpointSetType.Variable, dataId: "d1" },
                canPersist: true,
                accessTypes: undefined,
                accessType: "write",
            },
            "d1",
        );
        model.addDataBreakpoint(
            {
                description: "y",
                src: { type: DataBreakpointSetType.Variable, dataId: "d2" },
                canPersist: false,
                accessTypes: undefined,
                accessType: "write",
            },
            "d2",
        );
        model.setExceptionBreakpointsForSession("s", [{ filter: "cpp_throw", label: "C++: on throw", default: true }]);
        const storage = storageOver(state);
        storage.storeBreakpoints(model);

        expect([...state.values.keys()].sort()).toEqual([
            "debug.breakpoint",
            "debug.databreakpoint",
            "debug.exceptionbreakpoint",
            "debug.functionbreakpoint",
        ]);
        const stored = state.values.get("debug.breakpoint") as { uri: unknown }[];
        expect(stored[0].uri).toEqual(JSON.parse(JSON.stringify(file)));

        const [bp] = storage.loadBreakpoints();
        expect(bp.uri.toString()).toBe(file.toString());
        expect([bp.lineNumber, bp.column, bp.condition, bp.enabled]).toEqual([7, 3, "i > 2", false]);
        expect(bp.getId()).toBe(model.getBreakpoints()[0].getId());
        expect(storage.loadFunctionBreakpoints().map((f) => [f.getId(), f.name])).toEqual([["f1", "main"]]);
        expect(storage.loadDataBreakpoints().map((d) => d.getId())).toEqual(["d1"]);
        const [ebp] = storage.loadExceptionBreakpoints();
        expect([ebp.filter, ebp.label, ebp.enabled]).toEqual(["cpp_throw", "C++: on throw", true]);
    });

    it("removes a key whose list became empty", () => {
        const state = mockStateService();
        const model = createMockDebugModel(disposables, state);
        const storage = storageOver(state);
        model.addFunctionBreakpoint({ name: "main" });
        model.addWatchExpression("x");
        storage.storeBreakpoints(model);
        storage.storeWatchExpressions(model.getWatchExpressions());
        expect(state.values.has("debug.functionbreakpoint")).toBe(true);
        expect(state.values.has("debug.watchexpressions")).toBe(true);

        model.removeFunctionBreakpoints();
        model.removeWatchExpressions();
        storage.storeBreakpoints(model);
        storage.storeWatchExpressions(model.getWatchExpressions());
        expect(state.values.size).toBe(0);
    });

    it("keeps watch expressions by name and id", () => {
        const state = mockStateService();
        const model = createMockDebugModel(disposables, state);
        const storage = storageOver(state);
        const we = model.addWatchExpression("nums.size()");
        storage.storeWatchExpressions(model.getWatchExpressions());
        expect(state.values.get("debug.watchexpressions")).toEqual([{ name: "nums.size()", id: we.getId() }]);
        expect(storage.loadWatchExpressions().map((e) => [e.name, e.getId()])).toEqual([["nums.size()", we.getId()]]);
    });

    it("an empty store loads nothing, a broken entry logs and loads nothing", () => {
        const state = mockStateService();
        const logger = { ...NULL_LOGGER, error: vi.fn() };
        const storage = storageOver(state, logger);
        expect(storage.loadBreakpoints()).toEqual([]);
        expect(storage.loadWatchExpressions()).toEqual([]);
        expect(logger.error).not.toHaveBeenCalled();

        state.values.set("debug.functionbreakpoint", "not a list");
        expect(storage.loadFunctionBreakpoints()).toEqual([]);
        expect(logger.error).toHaveBeenCalledWith(
            "Failed to load function breakpoints from storage",
            expect.any(TypeError),
        );
    });

    it("the debug UX state defaults to default", () => {
        const state = mockStateService();
        const storage = storageOver(state);
        expect(storage.loadDebugUxState()).toBe("default");
        storage.storeDebugUxState("simple");
        expect(state.values.get("debug.uxstate")).toBe("simple");
        expect(storage.loadDebugUxState()).toBe("simple");
    });

    it("chosen environments round-trip and read the old string map", () => {
        const state = mockStateService();
        const storage = storageOver(state);
        expect(storage.loadChosenEnvironments()).toEqual({});
        storage.storeChosenEnvironments({ cpp: { type: "lldb", dynamicLabel: "LLDB" } });
        expect(state.values.get("debug.chosenenvironment")).toEqual({ cpp: { type: "lldb", dynamicLabel: "LLDB" } });
        expect(storage.loadChosenEnvironments()).toEqual({ cpp: { type: "lldb", dynamicLabel: "LLDB" } });

        state.values.set("debug.chosenenvironment", { python: "debugpy", cpp: { type: "lldb" } });
        expect(storage.loadChosenEnvironments()).toEqual({ python: { type: "debugpy" }, cpp: { type: "lldb" } });
    });

    it("reloads when another workspace store opens", () => {
        const state = mockStateService();
        const storage = storageOver(state);
        const reload = vi.fn();
        disposables.add(storage.onDidReload(reload));
        state.openWorkspace(new Map([["debug.watchexpressions", [{ name: "y", id: "w1" }]]]));
        expect(reload).toHaveBeenCalledOnce();
        expect(storage.loadWatchExpressions().map((e) => e.name)).toEqual(["y"]);
    });
});
