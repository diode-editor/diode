import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    provideSignatureHelp,
    signatureHelpCharacters,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { ISignatureHelpRequest } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";

/** Мини-сервис языков: `.ts` → typescript, иначе — undefined. */
const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

const TEXT = "greet(\nfirst(\n";

/** Версия для запросов по документу без открытого редактора: ответ пустой при любой. */
const UNOPENED_VERSION = 1;

function requestFor(
    uri: string,
    line: number,
    versionId: number,
    patch: Partial<ISignatureHelpRequest> = {},
): ISignatureHelpRequest {
    return {
        uri,
        languageId: "typescript",
        versionId,
        line,
        character: 6,
        triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
        triggerCharacter: "(",
        isRetrigger: false,
        ...patch,
    };
}

describe("ExtensionHost — signature help providers (subprocess)", () => {
    it("два настоящих провайдера: выигрывает первый непустой по реестру, контекст доезжает", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: TEXT },
            extensions: [extensionFixture("test.providesSignatureHelp", "providesSignatureHelp.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            const mainUri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
            // Символы обеих регистраций доехали метаданными и видны ядру для
            // документа (порядок — по реестру: новая регистрация первой).
            expect(signatureHelpCharacters(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)))).toEqual(
                {
                    triggerCharacters: [",", "<", "("],
                    retriggerCharacters: [")"],
                },
            );
            // Документу на другом языке символы typescript-провайдеров не видны.
            expect(signatureHelpCharacters(harness, { uri: mainUri, languageId: "markdown" })).toEqual({
                triggerCharacters: [],
                retriggerCharacters: [],
            });

            // Строка 0: первый провайдер молчит, отвечает второй.
            const help = await provideSignatureHelp(
                harness,
                requestFor(mainUri, 0, documentVersion(harness, mainUri), {
                    triggerCharacter: ",",
                    isRetrigger: true,
                    activeSignatureHelp: {
                        signatures: [{ label: "greet()", parameters: [] }],
                        activeSignature: 0,
                        activeParameter: 0,
                    },
                }),
            );

            expect(help).toEqual({
                signatures: [
                    {
                        label: "greet(name: string, age: number): void",
                        // Эхо контекста: провайдер получил настоящий SignatureHelpContext.
                        documentation: "kind=2 char=, retrigger=true active=0",
                        parameters: [
                            { label: "name: string", documentation: "кого приветствуем" },
                            { label: [20, 31] },
                        ],
                    },
                ],
                activeSignature: 0,
                activeParameter: 1,
            });

            // Строка 1: второй молчит — очередь доходит до первого.
            const first = await provideSignatureHelp(
                harness,
                requestFor(mainUri, 1, documentVersion(harness, mainUri)),
            );
            expect(first?.signatures[0].label).toBe("first(): void");

            // Строка 2: молчат оба — подсказки нет, а не мусор.
            expect(
                await provideSignatureHelp(harness, requestFor(mainUri, 2, documentVersion(harness, mainUri))),
            ).toBeNull();
        } finally {
            await harness.dispose();
        }
    });

    it("без subprocess'а и без провайдеров подсказки и триггеров нет", async () => {
        // Расширение зарегистрировано, но не активировано — subprocess не поднят.
        const lazy = await createExtensionTestHarness({
            extensions: [extensionFixture("test.providesSignatureHelp", "providesSignatureHelp.cjs")],
            activateEvents: [],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await provideSignatureHelp(lazy, requestFor("file:///a.ts", 0, UNOPENED_VERSION))).toBeNull();
            // Пока провайдеров нет, ядро не должно считать «(» триггером.
            expect(signatureHelpCharacters(lazy, requestFor("file:///a.ts", 0, UNOPENED_VERSION))).toEqual({
                triggerCharacters: [],
                retriggerCharacters: [],
            });
        } finally {
            await lazy.dispose();
        }

        // Subprocess поднят (noop активен), но провайдеров никто не регистрировал.
        const noProviders = await createExtensionTestHarness({
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await provideSignatureHelp(noProviders, requestFor("file:///a.ts", 0, UNOPENED_VERSION))).toBeNull();
        } finally {
            await noProviders.dispose();
        }
    });
});
