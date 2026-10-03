import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    manifestWithDefaults,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/** Регистрация фикстуры, объявляющей в манифесте настройки с дефолтами. */
function reg(id: string, file: string, defaults: Record<string, unknown>): IExtensionRegistration {
    const fixture = extensionFixture(id, file);
    return { ...fixture, manifest: manifestWithDefaults(fixture.manifest, defaults) };
}

describe("ExtensionHost — workspace.getConfiguration (subprocess)", () => {
    it("расширение читает user-снапшот и contributed default через getConfiguration", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.ts", content: "x\n" },
            // user-слой: editor.tabSize = 3
            configuration: { editor: { tabSize: 3 } },
            // contributed default: editorconfig.spaces = false
            extensions: [reg("test.readConfiguration", "readConfiguration.cjs", { "editorconfig.spaces": false })],
        });
        try {
            // editor.options выставляется внутри activate() и уходит на host по RPC.
            await settle();
            const editor = harness.group.getActiveEditor();
            expect(editor).not.toBeNull();
            // tabSize из user-снапшота
            expect(editor?.viewState.tabSize).toBe(3);
            // insertSpaces из contributed default (иначе остался бы дефолт true)
            expect(editor?.viewState.insertSpaces).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("без user-снапшота contributed default всё равно виден", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.ts", content: "x\n" },
            configuration: {},
            // tabSize приходит только из contributed default editor.tabSize = 7
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
