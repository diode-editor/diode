import { writeFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    type IExtensionHarness,
    provideDeclarations,
    provideDefinitions,
    provideImplementations,
    provideTypeDefinitions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IDefinitionRequest } from "../../../../editor/common/languages/iDefinitionSource.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { DefinitionService } from "../../../contrib/gotoDefinition/browser/definitionService.ts";
import type { ReferencesService } from "../../../contrib/references/browser/referencesService.ts";
import type { IJumpRecorder } from "../../history/browser/historyService.ts";
import type { NotificationService } from "../../notification/browser/notificationService.ts";

const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

function requestFor(uri: string, line: number, versionId: number): IDefinitionRequest {
    return { uri, languageId: "typescript", versionId, line, character: 6 };
}

function startHarness(): Promise<IExtensionHarness> {
    return createExtensionTestHarness({
        initialFile: { name: "main.ts", content: "const s: Shape = make();\nconst t: Shape = make();\n" },
        extensions: [extensionFixture("test.providesTypeDefinition", "providesTypeDefinition.cjs")],
        languageService: TS_LANGUAGE_SERVICE,
    });
}

describe("ExtensionHost — type definition and declaration providers (subprocess)", () => {
    it("real providers: targets arrive in their own registries, the other go-to registries stay empty", async () => {
        const harness = await startHarness();
        try {
            const mainUri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
            const typesUri = Uri.file(`${harness.tmpDir}/types.ts`).toString();
            const version = documentVersion(harness, mainUri);

            expect(await provideTypeDefinitions(harness, requestFor(mainUri, 0, version))).toEqual([
                { uri: typesUri, range: createRange(1, 4, 1, 8) },
                { uri: typesUri, range: createRange(4, 4, 4, 8) },
            ]);
            expect(await provideTypeDefinitions(harness, requestFor(mainUri, 1, version))).toEqual([
                { uri: typesUri, range: createRange(4, 4, 4, 8) },
            ]);
            expect(await provideDeclarations(harness, requestFor(mainUri, 0, version))).toEqual([
                { uri: typesUri, range: createRange(7, 0, 7, 5) },
            ]);
            expect(await provideDefinitions(harness, requestFor(mainUri, 0, version))).toEqual([]);
            expect(await provideImplementations(harness, requestFor(mainUri, 0, version))).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("through the command's service: two type definitions go to the panel, a declaration is a jump", async () => {
        const harness = await startHarness();
        try {
            const typesPath = `${harness.tmpDir}/types.ts`;
            writeFileSync(typesPath, "class A {\n    area() {}\n}\nclass B {\n    area() {}\n}\n\ndeclare\n");
            const typesUri = Uri.file(typesPath).toString();
            const showLocations = vi.fn(() => Promise.resolve());
            const service = new DefinitionService(
                harness.group,
                { jumpAsync: (run: () => Promise<void>) => run() } as unknown as IJumpRecorder,
                harness.languageFeatures,
                new InMemoryConfigurationService(),
                { show: () => undefined } as unknown as NotificationService,
                { showLocations } as unknown as ReferencesService,
                { has: () => false } as unknown as CommandRegistry,
            );
            const editor = harness.group.getActiveEditor();
            if (editor === null) throw new Error("no active editor");

            await service.goToTypeDefinition();
            expect(showLocations).toHaveBeenCalledTimes(1);
            expect(showLocations.mock.calls[0]).toEqual([
                "Type Definitions",
                [
                    { uri: typesUri, range: createRange(1, 4, 1, 8) },
                    { uri: typesUri, range: createRange(4, 4, 4, 8) },
                ],
                { uri: typesUri, range: createRange(1, 4, 1, 8) },
            ]);
            expect(harness.group.getActiveEditor()?.uri.toString()).toBe(editor.uri.toString());

            await service.revealDeclaration();
            expect(showLocations).toHaveBeenCalledTimes(1);
            expect(harness.group.getActiveEditor()?.uri.toString()).toBe(typesUri);
            expect(harness.group.getActiveEditor()?.viewState.selections[0].active).toMatchObject({
                line: 7,
                character: 0,
            });
        } finally {
            await harness.dispose();
        }
    });
});
