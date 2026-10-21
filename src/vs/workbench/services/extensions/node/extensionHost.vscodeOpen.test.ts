import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";

interface IOpenOutcome {
    ok: boolean;
    result?: unknown;
    message?: string;
}

describe("ExtensionHost — vscode.open (subprocess)", () => {
    it("Uri файла открывается вкладкой в активной группе, промис резолвится без значения", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "greet.go", content: "package greet\n" },
            extensions: [extensionFixture("test.open", "opensResource.cjs")],
        });
        try {
            await settle();
            const testFile = harness.writeFile("greet_test.go", "package greet\n");

            const outcome = (await harness.commandRegistry.execute("test.open.file", {
                path: testFile,
            })) as IOpenOutcome;

            expect(outcome).toEqual({ ok: true, result: "undefined" });
            expect(harness.group.getActiveEditor()?.uri.fsPath).toBe(path.resolve(testFile));
            expect(harness.group.editorGroups.activeGroup.editorCount).toBe(2);
        } finally {
            await harness.dispose();
        }
    });

    it("колонка вторым аргументом: Beside открывает файл в новой группе", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "greet.go", content: "package greet\n" },
            extensions: [extensionFixture("test.open", "opensResource.cjs")],
        });
        try {
            await settle();
            const testFile = harness.writeFile("greet_test.go", "package greet\n");

            await harness.commandRegistry.execute("test.open.file", { path: testFile, viewColumn: -2 });

            expect(harness.group.editorGroups.groups.length).toBe(2);
            expect(harness.group.editorGroups.viewColumnOf(harness.group.editorGroups.activeGroup)).toBe(2);
            expect(harness.group.getActiveEditor()?.uri.fsPath).toBe(path.resolve(testFile));
        } finally {
            await harness.dispose();
        }
    });

    it("невалидный ресурс — отказ промиса с текстом эталона, вкладок не прибавилось", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "greet.go", content: "package greet\n" },
            extensions: [extensionFixture("test.open", "opensResource.cjs")],
        });
        try {
            await settle();

            const outcome = (await harness.commandRegistry.execute("test.open.raw", {
                arg: "/not/an/uri.go",
            })) as IOpenOutcome;

            expect(outcome).toEqual({
                ok: false,
                message: "Invalid argument 'uriOrString' when running 'vscode.open', received: /not/an/uri.go ",
            });
            expect(harness.group.editorGroups.activeGroup.editorCount).toBe(1);
        } finally {
            await harness.dispose();
        }
    });
});
