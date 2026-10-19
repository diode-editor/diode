import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";
import type { IOutputSink } from "../../../api/common/iExtensionWindowSinks.ts";
import { LanguageConfigurationService } from "../../language/common/languageConfigurationService.ts";

/**
 * Расширение с дебаггером и Test API обязано активироваться ЦЕЛИКОМ — форма
 * `golang.go`: провайдер конфигураций отладки, фабрики адаптера, контроллер
 * тестов с тремя профилями и в самом конце `languages.setLanguageConfiguration`.
 * Без `vscode.debug` пользователь терял ~60 команд `go.*` (gopls при этом
 * жил). Проверка — на настоящем субпроцессе расширений, слой конфигурации —
 * в настоящем сервисе конфигураций ядра.
 */
describe("ExtensionHost — расширение с дебаггером и Test API активируется целиком", () => {
    it("activate() доходит до команды; сессий нет, профили и коллекции рабочие, слой языка — в ядре", async () => {
        const output: { channel: string; level: string; value: string }[] = [];
        const outputSink: IOutputSink = {
            append: (channel, _label, level, value) => {
                output.push({ channel, level, value });
            },
            show: () => undefined,
        };
        // Язык без language-configuration.json: всё, что увидит ядро, — слой расширения.
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

            // Комментарии и скобки слоя применяет ядро (комментирование, авто-закрытие).
            expect(await languageConfigurations.ensureLoaded("gofixture")).toMatchObject({
                comments: { lineComment: "//", blockComment: ["/*", "*/"] },
                brackets: [["{", "}"]],
                autoClosingPairs: [{ open: "{", close: "}", notIn: [] }],
            });

            // Человеку — по строке на тип отладчика, контроллер тестов и попытку запуска.
            expect(output.map((line) => `${line.channel}/${line.level}: ${line.value}`)).toEqual([
                expect.stringMatching(/^extensions\/warn: отладка "go" в TUI пока не поддержана/),
                expect.stringMatching(/^extensions\/warn: тесты "go" в TUI пока не показываются/),
                expect.stringMatching(/^extensions\/warn: запуск отладки в TUI пока не поддержан/),
            ]);
        } finally {
            await harness.dispose();
        }

        // Субпроцесс ушёл — слои его расширений сняты вместе с ним.
        expect(languageConfigurations.get("gofixture")?.comments).toBeUndefined();
    });
});
