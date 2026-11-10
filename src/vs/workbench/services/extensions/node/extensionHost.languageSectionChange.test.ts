import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";

describe("ExtensionHost — a change of the `[lang]` section reaches onDidChangeConfiguration (subprocess)", () => {
    it("[api:WorkspaceConfiguration.get] writing the user's [plaintext] section: the event affects '[plaintext]', as upstream", async () => {
        // Upstream keeps `[plaintext]` among the user model's keys (`Object.keys(raw)`), so
        // `compareConfigurationContents` lists it as updated and `affectsConfiguration('[plaintext]')` is true.
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.languageSectionChange", "languageSectionChange.cjs")],
            workspaceFolders: [],
        });
        try {
            const result = (await harness.commandRegistry.execute("test.langSection.write", {
                "editor.tabSize": 5,
            })) as { section: unknown; seen: { section: boolean; setting: boolean; forLanguage: boolean }[] };

            expect(result.section).toEqual({ "editor.tabSize": 5 });
            expect(result.seen).toEqual([{ section: true, setting: true, forLanguage: true }]);
        } finally {
            await harness.dispose();
        }
    });
});
