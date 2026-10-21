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
    it("a file Uri opens as a tab in the active group, the promise resolves without a value", async () => {
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

    it("column as the second argument: Beside opens the file in a new group", async () => {
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

    it("an invalid resource rejects the promise with the upstream text, no tabs added", async () => {
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
