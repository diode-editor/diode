import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    manifestWithDefaults,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

function reg(id: string, file: string, defaults: Record<string, unknown>): IExtensionRegistration {
    const fixture = extensionFixture(id, file);
    return { ...fixture, manifest: manifestWithDefaults(fixture.manifest, defaults) };
}

describe("ExtensionHost — workspace.getConfiguration (subprocess)", () => {
    it("расширение читает user-снапшот и contributed default через getConfiguration", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.ts", content: "x\n" },
            configuration: { editor: { tabSize: 3 } },
            extensions: [reg("test.readConfiguration", "readConfiguration.cjs", { "editorconfig.spaces": false })],
        });
        try {
            await settle();
            const editor = harness.group.getActiveEditor();
            expect(editor).not.toBeNull();
            expect(editor?.viewState.tabSize).toBe(3);
            expect(editor?.viewState.insertSpaces).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("без user-снапшота contributed default всё равно виден", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.ts", content: "x\n" },
            configuration: {},
            extensions: [
                reg("test.readConfiguration", "readConfiguration.cjs", {
                    "editor.tabSize": 7,
                    "editorconfig.spaces": false,
                }),
            ],
        });
        try {
            await settle();
            const editor = harness.group.getActiveEditor();
            expect(editor?.viewState.tabSize).toBe(7);
        } finally {
            await harness.dispose();
        }
    });
});
