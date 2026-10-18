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

describe("vscode.tests — инертный контроллер с рабочими коллекциями", () => {
    it("контроллер несёт id и label; обработчики не заданы, dispose и invalidate безвредны", () => {
        const { vscode } = makeVscode();
        const controller = vscode.tests.createTestController("go", "Go");
        expect(controller.id).toBe("go");
        expect(controller.label).toBe("Go");
        expect(controller.resolveHandler).toBeUndefined();
        expect(controller.refreshHandler).toBeUndefined();
        expect(controller.items.size).toBe(0);
        expect(() => {
            controller.invalidateTestResults();
            controller.dispose();
        }).not.toThrow();
    });

    it("профиль — с переданными полями и эталонными дефолтами; runHandler никто не зовёт", () => {
        const { vscode } = makeVscode();
        const controller = vscode.tests.createTestController("go", "Go");
        const run = vi.fn();
        const plain = controller.createRunProfile("Go", vscode.TestRunProfileKind.Run, run);
        expect(plain).toMatchObject({
            label: "Go",
            kind: 1,
            isDefault: false,
            supportsContinuousRun: false,
            tag: undefined,
            configureHandler: undefined,
            runHandler: run,
        });
        const tag = new vscode.TestTag("unit");
        const full = controller.createRunProfile("Cover", vscode.TestRunProfileKind.Coverage, run, true, tag, true);
        expect(full).toMatchObject({ kind: 3, isDefault: true, tag, supportsContinuousRun: true });
        const listener = vi.fn();
        full.onDidChangeDefault(listener);
        full.isDefault = false;
        full.dispose();
        expect(listener).not.toHaveBeenCalled();
        expect(run).not.toHaveBeenCalled();
    });

    it("элемент — с эталонными дефолтами; поля записываемые", () => {
        const { vscode } = makeVscode();
        const controller = vscode.tests.createTestController("go", "Go");
        const uri = vscode.Uri.file("/w/a_test.go");
        const item = controller.createTestItem("id", "a_test.go", uri);
        expect(item).toMatchObject({
            id: "id",
            label: "a_test.go",
            uri,
            parent: undefined,
            tags: [],
            canResolveChildren: false,
            busy: false,
            range: undefined,
            error: undefined,
        });
        expect(item.description).toBeUndefined();
        expect(item.sortText).toBeUndefined();
        expect(controller.createTestItem("n", "no uri").uri).toBeUndefined();
        item.label = "renamed";
        item.busy = true;
        item.range = new vscode.Range(1, 0, 3, 1);
        expect(item).toMatchObject({ label: "renamed", busy: true });
    });

    it("коллекции: add/get/delete/replace/forEach/итерация; parent у корня — undefined, у ребёнка — элемент", () => {
        const { vscode } = makeVscode();
        const controller = vscode.tests.createTestController("go", "Go");
        const file = controller.createTestItem("file", "a_test.go");
        const testA = controller.createTestItem("A", "TestA");
        const testB = controller.createTestItem("B", "TestB");
        controller.items.add(file);
        file.children.add(testA);
        file.children.add(testB);
        expect(controller.items.get("file")).toBe(file);
        expect(file.parent).toBeUndefined();
        expect(testA.parent).toBe(file);
        expect(file.children.size).toBe(2);

        const seen: string[] = [];
        const thisArg = { tag: "this" };
        file.children.forEach(function (this: unknown, item, collection) {
            expect(this).toBe(thisArg);
            expect(collection).toBe(file.children);
            seen.push(item.id);
        }, thisArg);
        expect(seen).toEqual(["A", "B"]);
        expect([...file.children].map(([id, item]) => [id, item.label])).toEqual([
            ["A", "TestA"],
            ["B", "TestB"],
        ]);

        // Тот же id заменяет прежний элемент.
        const testA2 = controller.createTestItem("A", "TestA v2");
        file.children.add(testA2);
        expect(file.children.size).toBe(2);
        expect(file.children.get("A")).toBe(testA2);

        file.children.delete("B");
        expect(file.children.get("B")).toBeUndefined();
        file.children.replace([testB]);
        expect([...file.children].map(([id]) => id)).toEqual(["B"]);
        expect(testB.parent).toBe(file);
    });

    it("прогон принимает отчёты и завершается один раз", () => {
        const { vscode } = makeVscode();
        const controller = vscode.tests.createTestController("go", "Go");
        const item = controller.createTestItem("A", "TestA");
        const run = controller.createTestRun(new vscode.TestRunRequest([item]), "go test");
        expect(run.name).toBe("go test");
        expect(run.isPersisted).toBe(true);
        expect(run.token.isCancellationRequested).toBe(false);
        expect(controller.createTestRun(new vscode.TestRunRequest(), undefined, false).isPersisted).toBe(false);

        const message = new vscode.TestMessage("bad");
        run.enqueued(item);
        run.started(item);
        run.skipped(item);
        run.failed(item, message, 3);
        run.errored(item, [message]);
        run.passed(item, 1);
        run.appendOutput("ok\r\n");
        run.addCoverage(new vscode.FileCoverage(vscode.Uri.file("/a.go"), new vscode.TestCoverageCount(1, 2)));

        const ended = vi.fn();
        run.onDidDispose(ended);
        run.end();
        run.end();
        expect(ended).toHaveBeenCalledTimes(1);
    });

    it("человеку — одна warn-строка на id контроллера за жизнь субпроцесса", () => {
        const { stub, vscode } = makeVscode();
        vscode.tests.createTestController("go", "Go");
        vscode.tests.createTestController("go", "Go again");
        vscode.tests.createTestController("py", "Python");
        expect(warnings(stub)).toEqual([
            'extensions/Extensions/warn: тесты "go" в TUI пока не показываются — view Testing не будет, остальное расширение работает',
            'extensions/Extensions/warn: тесты "py" в TUI пока не показываются — view Testing не будет, остальное расширение работает',
        ]);
    });
});
