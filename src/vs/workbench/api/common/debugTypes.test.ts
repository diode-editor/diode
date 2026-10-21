import { describe, expect, it } from "vitest";

import {
    DebugAdapterExecutable,
    DebugAdapterInlineImplementation,
    DebugAdapterNamedPipeServer,
    DebugAdapterServer,
    DebugConfigurationProviderTriggerKind,
    DebugConsoleMode,
    DebugStackFrame,
    DebugThread,
    FunctionBreakpoint,
    SourceBreakpoint,
} from "./debugTypes.ts";
import { Location, Position, Uri } from "./vscodeTypes.ts";

const location = new Location(Uri.file("/w/main.go"), new Position(3, 0));
const session = { id: "s" } as never;

describe("значения-типы vscode.debug — по эталону", () => {
    it("enum'ы", () => {
        expect([DebugConsoleMode.Separate, DebugConsoleMode.MergeWithParent]).toEqual([0, 1]);
        expect([DebugConfigurationProviderTriggerKind.Initial, DebugConfigurationProviderTriggerKind.Dynamic]).toEqual([
            1, 2,
        ]);
    });

    it("точка останова: включена по умолчанию, необязательные поля — только строками", () => {
        const plain = new SourceBreakpoint(location);
        expect(plain.location).toBe(location);
        expect(plain.enabled).toBe(true);
        expect(plain.condition).toBeUndefined();
        expect(plain.hitCondition).toBeUndefined();
        expect(plain.logMessage).toBeUndefined();
        expect(plain.mode).toBeUndefined();

        const full = new FunctionBreakpoint("main", false, "x > 1", "3", "hit {x}", "hw");
        expect(full).toMatchObject({
            functionName: "main",
            enabled: false,
            condition: "x > 1",
            hitCondition: "3",
            logMessage: "hit {x}",
            mode: "hw",
        });
        const loose = new FunctionBreakpoint("f", "yes" as never, 1 as never, 2 as never, 3 as never, 4 as never);
        expect(loose.enabled).toBe(true);
        expect(loose.condition).toBeUndefined();
        expect(loose.hitCondition).toBeUndefined();
        expect(loose.logMessage).toBeUndefined();
        expect(loose.mode).toBeUndefined();
    });

    it("id точки — ленивый uuid, стабильный и разный у разных точек", () => {
        const a = new SourceBreakpoint(location);
        const b = new SourceBreakpoint(location);
        expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(a.id).toBe(a.id);
        expect(a.id).not.toBe(b.id);
    });

    it("SourceBreakpoint без location (null из JS) — эталонная ошибка", () => {
        expect(() => new SourceBreakpoint(null as never)).toThrow("Illegal argument: location");
    });

    it("дескрипторы адаптера несут переданное", () => {
        expect(new DebugAdapterExecutable("dlv", ["dap"], { cwd: "/w" })).toEqual({
            command: "dlv",
            args: ["dap"],
            options: { cwd: "/w" },
        });
        expect(new DebugAdapterExecutable("dlv").args).toEqual([]);
        expect(new DebugAdapterServer(4711, "127.0.0.1")).toEqual({ port: 4711, host: "127.0.0.1" });
        expect(new DebugAdapterServer(1).host).toBeUndefined();
        expect(new DebugAdapterNamedPipeServer("/tmp/p").path).toBe("/tmp/p");
        const adapter = { onDidSendMessage: () => ({ dispose: () => undefined }) } as never;
        expect(new DebugAdapterInlineImplementation(adapter).implementation).toBe(adapter);
    });

    it("поток и фрейм несут сессию и номера", () => {
        expect(new DebugThread(session, 2)).toEqual({ session, threadId: 2 });
        expect(new DebugStackFrame(session, 2, 9)).toEqual({ session, threadId: 2, frameId: 9 });
    });
});
