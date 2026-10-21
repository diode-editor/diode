import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";
import type { IOutputSink } from "../../../api/common/iExtensionWindowSinks.ts";
import { LanguageConfigurationService } from "../../language/common/languageConfigurationService.ts";

// The `golang.go` shape: without `vscode.debug` the user lost ~60 `go.*` commands.
describe("ExtensionHost — an extension with a debugger and the Test API activates fully", () => {
    it("activate() reaches the command; no sessions, profiles and collections work, the language layer is in the core", async () => {
        const output: { channel: string; level: string; value: string }[] = [];
        const outputSink: IOutputSink = {
            append: (channel, _label, level, value) => {
                output.push({ channel, level, value });
            },
            show: () => undefined,
        };
        // A language without language-configuration.json: everything the core sees comes from the extension layer.
        const languageConfigurations = new LanguageConfigurationService(
            { readText: () => Promise.reject(new Error("no assets")) } as never,
            { getLanguage: () => ({ configurationPath: undefined }) },
            NULL_LOGGER,
        );
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.goActivationShape", "goActivationShape.cjs")],
            outputSink,
            languageConfigurations,
        });
        try {
            await settle();
            expect(await harness.commandRegistry.execute("test.goActivationShape")).toEqual({
                activeDebugSession: "none",
                started: false,
                profileKinds: [1, 2, 3],
                found: true,
                childParent: true,
                adapter: true,
                symbol: 0,
            });

            expect(await languageConfigurations.ensureLoaded("gofixture")).toMatchObject({
                comments: { lineComment: "//", blockComment: ["/*", "*/"] },
                brackets: [["{", "}"]],
                autoClosingPairs: [{ open: "{", close: "}", notIn: [] }],
            });

            expect(output.map((line) => `${line.channel}/${line.level}: ${line.value}`)).toEqual([
                expect.stringMatching(/^extensions\/warn: отладка "go" в TUI пока не поддержана/),
                expect.stringMatching(/^extensions\/warn: тесты "go" в TUI пока не показываются/),
                expect.stringMatching(/^extensions\/warn: запуск отладки в TUI пока не поддержан/),
            ]);
        } finally {
            await harness.dispose();
        }

        expect(languageConfigurations.get("gofixture")?.comments).toBeUndefined();
    });
});
