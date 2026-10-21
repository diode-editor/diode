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

const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

const TEXT = "greet(\nfirst(\n";

/** Version for requests on a document without an open editor: the answer is empty for any version. */
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
    it("two real providers: the first non-empty one in the registry wins, the context arrives", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: TEXT },
            extensions: [extensionFixture("test.providesSignatureHelp", "providesSignatureHelp.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            const mainUri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
            // Order follows the registry: the newest registration first.
            expect(signatureHelpCharacters(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)))).toEqual(
                {
                    triggerCharacters: [",", "<", "("],
                    retriggerCharacters: [")"],
                },
            );
            expect(signatureHelpCharacters(harness, { uri: mainUri, languageId: "markdown" })).toEqual({
                triggerCharacters: [],
                retriggerCharacters: [],
            });

            // Line 0: the first provider is silent, the second answers.
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
                        // Context echo: the provider received a real SignatureHelpContext.
                        documentation: "kind=2 char=, retrigger=true active=0",
                        parameters: [
                            { label: "name: string", documentation: "who to greet" },
                            { label: [20, 31] },
                        ],
                    },
                ],
                activeSignature: 0,
                activeParameter: 1,
            });

            // Line 1: the second is silent, so the turn passes to the first.
            const first = await provideSignatureHelp(
                harness,
                requestFor(mainUri, 1, documentVersion(harness, mainUri)),
            );
            expect(first?.signatures[0].label).toBe("first(): void");

            // Line 2: both are silent: no hint rather than garbage.
            expect(
                await provideSignatureHelp(harness, requestFor(mainUri, 2, documentVersion(harness, mainUri))),
            ).toBeNull();
        } finally {
            await harness.dispose();
        }
    });

    it("without a subprocess and providers there is no help and no triggers", async () => {
        // The extension is registered but not activated, so the subprocess is not started.
        const lazy = await createExtensionTestHarness({
            extensions: [extensionFixture("test.providesSignatureHelp", "providesSignatureHelp.cjs")],
            activateEvents: [],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await provideSignatureHelp(lazy, requestFor("file:///a.ts", 0, UNOPENED_VERSION))).toBeNull();
            // While there are no providers, the core must not treat "(" as a trigger.
            expect(signatureHelpCharacters(lazy, requestFor("file:///a.ts", 0, UNOPENED_VERSION))).toEqual({
                triggerCharacters: [],
                retriggerCharacters: [],
            });
        } finally {
            await lazy.dispose();
        }

        // The subprocess is up (noop is active), but no one registered providers.
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
