import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
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

function requestFor(uri: string, line: number, patch: Partial<ISignatureHelpRequest> = {}): ISignatureHelpRequest {
    return {
        uri,
        languageId: "typescript",
        text: TEXT,
        line,
        character: 6,
        triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
        triggerCharacter: "(",
        isRetrigger: false,
        ...patch,
    };
}

describe("ExtensionHost — signature help providers (subprocess)", () => {
    it("два настоящих провайдера: выигрывает первый непустой, контекст доезжает", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: TEXT },
            extensions: [extensionFixture("test.providesSignatureHelp", "providesSignatureHelp.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            const mainUri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
            const source = harness.group.signatureHelpSource;
            expect(source).toBeDefined();

            // Символы обоих регистраций объединились и доехали до ядра.
            expect(harness.group.signatureHelpTriggerCharacters).toEqual(["(", ",", "<"]);
            expect(harness.group.signatureHelpRetriggerCharacters).toEqual([")"]);

            // Строка 0: первый провайдер молчит, отвечает второй.
            const help = await source!(
                requestFor(mainUri, 0, {
                    triggerCharacter: ",",
                    isRetrigger: true,
                    activeSignatureHelp: { signatures: [{ label: "greet()", parameters: [] }], activeSignature: 0, activeParameter: 0 },
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

            // Строка 1: отвечает уже первый — порядок регистрации соблюдён.
            const first = await source!(requestFor(mainUri, 1));
            expect(first?.signatures[0].label).toBe("first(): void");

            // Строка 2: молчат оба — подсказки нет, а не мусор.
            expect(await source!(requestFor(mainUri, 2))).toBeNull();

            // Слишком большой документ не гоняется через RPC.
            expect(await source!(requestFor(mainUri, 0, { text: "x".repeat(8 * 1024 * 1024 + 1) }))).toBeNull();
        } finally {
            await harness.dispose();
        }
    });

    it("без subprocess'а и без провайдеров источник отдаёт null", async () => {
        // Расширение зарегистрировано, но не активировано — subprocess не поднят.
        const lazy = await createExtensionTestHarness({
            extensions: [extensionFixture("test.providesSignatureHelp", "providesSignatureHelp.cjs")],
            activateEvents: [],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await lazy.group.signatureHelpSource!(requestFor("file:///a.ts", 0))).toBeNull();
            expect(lazy.group.signatureHelpTriggerCharacters).toEqual([]);
        } finally {
            await lazy.dispose();
        }

        // Subprocess поднят (noop активен), но провайдеров никто не регистрировал.
        const noProviders = await createExtensionTestHarness({
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await noProviders.group.signatureHelpSource!(requestFor("file:///a.ts", 0))).toBeNull();
        } finally {
            await noProviders.dispose();
        }
    });
});
