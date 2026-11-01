import { writeFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    provideDefinitions,
    provideImplementations,
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

describe("ExtensionHost — implementation providers (subprocess)", () => {
    it("a real provider: Location[] and LocationLink[] arrive as core targets, the definition registry stays empty", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "interface Shape {\n    area(): number;\n}\n" },
            extensions: [extensionFixture("test.providesImplementation", "providesImplementation.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            const mainUri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
            const implUri = Uri.file(`${harness.tmpDir}/impl.ts`).toString();
            const version = documentVersion(harness, mainUri);

            expect(await provideImplementations(harness, requestFor(mainUri, 0, version))).toEqual([
                { uri: implUri, range: createRange(1, 4, 1, 8) },
                { uri: implUri, range: createRange(4, 4, 4, 8) },
            ]);
            expect(await provideImplementations(harness, requestFor(mainUri, 1, version))).toEqual([
                { uri: implUri, range: createRange(4, 4, 4, 8) },
            ]);
            expect(await provideDefinitions(harness, requestFor(mainUri, 0, version))).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("through the command's service: two targets go to the panel, one target is a jump", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "interface Shape {\n    area(): number;\n}\n" },
            extensions: [extensionFixture("test.providesImplementation", "providesImplementation.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            const implPath = `${harness.tmpDir}/impl.ts`;
            writeFileSync(implPath, "class A {\n    area() {}\n}\nclass B {\n    area() {}\n}\n");
            const implUri = Uri.file(implPath).toString();
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

            // Line 0: two targets.
            await service.goToImplementation();
            expect(showLocations).toHaveBeenCalledTimes(1);
            expect(showLocations.mock.calls[0]).toEqual([
                "Implementations",
                [
                    { uri: implUri, range: createRange(1, 4, 1, 8) },
                    { uri: implUri, range: createRange(4, 4, 4, 8) },
                ],
                { uri: implUri, range: createRange(1, 4, 1, 8) },
            ]);
            expect(harness.group.getActiveEditor()?.uri.toString()).toBe(editor.uri.toString());

            // Line 1: one target.
            editor.goToPosition(1, 4);
            await service.goToImplementation();
            expect(showLocations).toHaveBeenCalledTimes(1);
            expect(harness.group.getActiveEditor()?.uri.toString()).toBe(implUri);
            expect(harness.group.getActiveEditor()?.viewState.selections[0].active).toMatchObject({
                line: 4,
                character: 4,
            });
        } finally {
            await harness.dispose();
        }
    });
});
