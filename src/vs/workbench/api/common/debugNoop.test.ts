import { describe, expect, it, vi } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

function makeVscode() {
    const stub = makeStubRpc();
    const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
    return { stub, vscode: namespace };
}

/** warn-строки Output, которые ушли человеку. */
function warnings(stub: ReturnType<typeof makeStubRpc>): string[] {
    return stub.notifies
        .filter((n) => n.method === "output.append")
        .map((n) => n.params as { value: string; level: string; channel: string; label: string })
        .map((p) => `${p.channel}/${p.label}/${p.level}: ${p.value}`);
}

const session = { id: "s 1/2" } as never;

describe("vscode.debug — null-объект: сессий нет и не будет", () => {
    it("состояние пустое: ни сессии, ни точек, ни фрейма; консоль принимает вывод", () => {
        const { vscode } = makeVscode();
        expect(vscode.debug.activeDebugSession).toBeUndefined();
        expect(vscode.debug.activeStackItem).toBeUndefined();
        expect(vscode.debug.breakpoints).toEqual([]);
        expect(() => {
            vscode.debug.activeDebugConsole.append("a");
            vscode.debug.activeDebugConsole.appendLine("b");
        }).not.toThrow();
    });

    it("события — валидные подписки, которые не стреляют", () => {
        const { vscode } = makeVscode();
        const listener = vi.fn();
        const events = [
            vscode.debug.onDidChangeActiveDebugSession,
            vscode.debug.onDidStartDebugSession,
            vscode.debug.onDidReceiveDebugSessionCustomEvent,
            vscode.debug.onDidTerminateDebugSession,
            vscode.debug.onDidChangeBreakpoints,
            vscode.debug.onDidChangeActiveStackItem,
        ];
        for (const event of events) event(listener).dispose();
        expect(listener).not.toHaveBeenCalled();
    });

    it("register* отдают Disposable; провайдеры никто не зовёт", () => {
        const { vscode } = makeVscode();
        const provider = { provideDebugConfigurations: vi.fn(), resolveDebugConfiguration: vi.fn() };
        const factory = { createDebugAdapterDescriptor: vi.fn() };
        const tracker = { createDebugAdapterTracker: vi.fn() };
        const disposables = [
            vscode.debug.registerDebugConfigurationProvider("go", provider),
            vscode.debug.registerDebugAdapterDescriptorFactory("go", factory),
            vscode.debug.registerDebugAdapterTrackerFactory("*", tracker),
        ];
        for (const disposable of disposables) {
            expect(() => {
                disposable.dispose();
            }).not.toThrow();
        }
        expect(provider.provideDebugConfigurations).not.toHaveBeenCalled();
        expect(factory.createDebugAdapterDescriptor).not.toHaveBeenCalled();
        expect(tracker.createDebugAdapterTracker).not.toHaveBeenCalled();
    });

    it("startDebugging — false, stopDebugging выполняется, точки останова — no-op", async () => {
        const { vscode } = makeVscode();
        await expect(vscode.debug.startDebugging(undefined, "Launch")).resolves.toBe(false);
        await expect(vscode.debug.stopDebugging()).resolves.toBeUndefined();
        const breakpoint = new vscode.FunctionBreakpoint("main");
        vscode.debug.addBreakpoints([breakpoint]);
        vscode.debug.removeBreakpoints([breakpoint]);
        expect(vscode.debug.breakpoints).toEqual([]);
    });

    it("человеку — одна строка на тип отладчика и одна на попытку запуска; трекеры молчат", async () => {
        const { stub, vscode } = makeVscode();
        vscode.debug.registerDebugConfigurationProvider("go", {});
        vscode.debug.registerDebugAdapterDescriptorFactory("go", { createDebugAdapterDescriptor: () => undefined });
        vscode.debug.registerDebugConfigurationProvider("delve", {});
        vscode.debug.registerDebugAdapterTrackerFactory("*", { createDebugAdapterTracker: () => undefined });
        await vscode.debug.startDebugging(undefined, "a");
        await vscode.debug.startDebugging(undefined, "b");
        expect(warnings(stub)).toEqual([
            'extensions/Extensions/warn: отладка "go" в TUI пока не поддержана — сессий не будет, остальное расширение работает',
            'extensions/Extensions/warn: отладка "delve" в TUI пока не поддержана — сессий не будет, остальное расширение работает',
            "extensions/Extensions/warn: запуск отладки в TUI пока не поддержан — сессия не начата",
        ]);
    });

    describe("asDebugSourceUri — по эталону", () => {
        it("ссылка на источник — debug:-uri с путём, сессией и ref", () => {
            const { vscode } = makeVscode();
            const uri = vscode.debug.asDebugSourceUri({ path: "/a b.go", sourceReference: 7 } as never, session);
            expect(uri.toString(true)).toBe("debug:/a b.go?session=s 1/2&ref=7");
            expect(uri.scheme).toBe("debug");
            expect(uri.query).toBe("session=s 1/2&ref=7");
        });

        it("без сессии — только ref; без пути — пустой путь", () => {
            const { vscode } = makeVscode();
            expect(vscode.debug.asDebugSourceUri({ path: "x", sourceReference: 3 } as never).query).toBe("ref=3");
            const noPath = vscode.debug.asDebugSourceUri({ sourceReference: 3 } as never);
            expect(noPath.scheme).toBe("debug");
            expect(noPath.path).toBe("");
        });

        it("путь без ссылки (ref 0 или не число) — file:-uri", () => {
            const { vscode } = makeVscode();
            expect(vscode.debug.asDebugSourceUri({ path: "/w/main.go", sourceReference: 0 } as never).toString()).toBe(
                "file:///w/main.go",
            );
            expect(vscode.debug.asDebugSourceUri({ path: "/w/main.go", sourceReference: "1" } as never).scheme).toBe(
                "file",
            );
        });

        it("ни пути, ни ссылки — эталонная ошибка", () => {
            const { vscode } = makeVscode();
            expect(() => vscode.debug.asDebugSourceUri({ path: 5 } as never)).toThrow(
                "cannot create uri from DAP 'source' object; properties 'path' and 'sourceReference' are both missing.",
            );
        });
    });
});
