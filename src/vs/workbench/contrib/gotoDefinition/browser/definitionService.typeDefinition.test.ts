import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type {
    DefinitionProvider,
    ICoreDefinitionLocation,
} from "../../../../editor/common/languages/iDefinitionSource.ts";
import {
    type ILanguageFeaturesService,
    LanguageFeaturesServiceDIToken,
} from "../../../../editor/common/services/languageFeatures.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";

import { DefinitionServiceDIToken } from "./definitionService.ts";

type Provide = DefinitionProvider["provideDefinition"];

interface ICase {
    readonly label: string;
    readonly commandId: string;
    readonly title: string;
    readonly noResults: string;
    readonly multipleSetting: string;
    readonly alternativeSetting: string;
    readonly register: (features: ILanguageFeaturesService, provide: Provide) => void;
}

const CASES: readonly ICase[] = [
    {
        label: "Go to Type Definition",
        commandId: "editor.action.goToTypeDefinition",
        title: "Type Definitions",
        noResults: "No type definition found",
        multipleSetting: "editor.gotoLocation.multipleTypeDefinitions",
        alternativeSetting: "editor.gotoLocation.alternativeTypeDefinitionCommand",
        register: (features, provide) =>
            features.typeDefinitionProvider.register("*", { provideTypeDefinition: provide }),
    },
    {
        label: "Go to Declaration",
        commandId: "editor.action.revealDeclaration",
        title: "Declarations",
        noResults: "No declaration found",
        multipleSetting: "editor.gotoLocation.multipleDeclarations",
        alternativeSetting: "editor.gotoLocation.alternativeDeclarationCommand",
        register: (features, provide) => features.declarationProvider.register("*", { provideDeclaration: provide }),
    },
];

describe.each(CASES)("DefinitionService — $label", (c) => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-gototype-",
            files: {
                "main.ts": "const shape: Shape = make();\nconst other = 1;\n",
                "types.ts": "interface Shape {\n    area(): number;\n}\ninterface Solid {\n    volume(): number;\n}\n",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(100, 30) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const group = () => h.container.get(EditorServiceDIToken);
    const features = () => h.container.get(LanguageFeaturesServiceDIToken);
    const caret = () => group().getActiveEditor()?.viewState.selections[0].active;
    const uriOf = (name: string) => Uri.file(ws.path(name)).toString();
    const useLocations = (locations: readonly ICoreDefinitionLocation[]) => {
        c.register(features(), () => Promise.resolve(locations));
    };
    const useSetting = (key: string, value: unknown) =>
        h.container.get(IConfigurationServiceDIToken).updateValue(key, value);
    const useKeysUpToDate = () => {
        h.container.get(WorkbenchContextKeysDIToken).update();
    };
    const run = () => h.container.get(CommandRegistryDIToken).execute(c.commandId);
    const screen = () => {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    };
    const toasts = () =>
        h.container
            .get(NotificationServiceDIToken)
            .passive()
            .map((n) => n.message);
    const twoTargets = () => [
        { uri: uriOf("types.ts"), range: createRange(0, 10, 0, 15) },
        { uri: uriOf("types.ts"), range: createRange(3, 10, 3, 15) },
    ];

    it("one target: the command jumps to it in the active group, a definition provider isn't asked", async () => {
        const provideDefinition = vi.fn(() => Promise.resolve([]));
        features().definitionProvider.register("*", { provideDefinition });
        useLocations([{ uri: uriOf("types.ts"), range: createRange(3, 10, 3, 15) }]);
        useKeysUpToDate();

        await run();
        await flushMicrotasks(10);

        expect(group().getActiveEditor()?.uri.toString()).toBe(uriOf("types.ts"));
        expect(caret()).toMatchObject({ line: 3, character: 10 });
        expect(provideDefinition).not.toHaveBeenCalled();
        expect(group().editorGroups.groups.length).toBe(1);
    });

    it("the provider gets the position of the caret in the active document", async () => {
        const provide = vi.fn<Provide>(() => Promise.resolve([]));
        c.register(features(), provide);
        useKeysUpToDate();
        group().getActiveEditor()?.goToPosition(0, 7);

        await run();
        await flushMicrotasks(10);

        expect(provide.mock.calls[0]?.[0]).toMatchObject({ uri: uriOf("main.ts"), line: 0, character: 7 });
    });

    it("several targets: the panel carries the command's title, the editor stays", async () => {
        useLocations(twoTargets());
        useKeysUpToDate();

        await run();
        await flushMicrotasks(10);

        expect(group().getActiveEditor()?.uri.toString()).toBe(uriOf("main.ts"));
        const shown = screen();
        // The narrow sidebar header clips a long title, the buttons keep their columns (ViewTitleRowElement);
        // the whole title is asserted in extensionHost.typeDefinition.test.ts.
        expect(shown).toContain(c.title.slice(0, 15));
        expect(shown).toContain("2 results in 1 file");
    });

    it("its own multiple setting decides, not multipleDefinitions", async () => {
        useLocations(twoTargets());
        useKeysUpToDate();
        await useSetting("editor.gotoLocation.multipleDefinitions", "peek");
        await useSetting(c.multipleSetting, "goto");

        await run();
        await flushMicrotasks(10);

        expect(group().getActiveEditor()?.uri.toString()).toBe(uriOf("types.ts"));
        expect(caret()).toMatchObject({ line: 0, character: 10 });
    });

    it("zero targets: the toast names the word under the caret", async () => {
        useLocations([]);
        useKeysUpToDate();

        await run();
        await flushMicrotasks(10);

        expect(toasts()).toEqual([`${c.noResults} for 'const'`]);
        expect(screen()).toContain(`${c.noResults} for 'const'`);
    });

    it("zero targets off a word: the generic toast", async () => {
        useLocations([]);
        useKeysUpToDate();
        // The last line of the file is empty.
        group().getActiveEditor()?.goToPosition(2, 0);

        await run();
        await flushMicrotasks(10);

        expect(toasts()).toEqual([c.noResults]);
    });

    describe("the only target is under the caret", () => {
        const useTargetAtCaret = () => {
            useLocations([{ uri: uriOf("main.ts"), range: createRange(1, 6, 1, 11) }]);
            useKeysUpToDate();
            group().getActiveEditor()?.goToPosition(1, 8);
        };

        it("the default alternative is Go to References", async () => {
            const provideReferences = vi.fn(() => Promise.resolve([]));
            features().referenceProvider.register("*", { provideReferences });
            useTargetAtCaret();
            useKeysUpToDate();

            await run();
            await flushMicrotasks(10);

            expect(provideReferences).toHaveBeenCalledTimes(1);
            expect(caret()).toMatchObject({ line: 1, character: 8 });
        });

        it("its own alternative setting runs, alternativeDefinitionCommand doesn't", async () => {
            const calls: string[] = [];
            // The settings' enum admits only upstream's ids: these two aren't registered otherwise.
            h.commands.register("editor.action.peekImplementation", () => {
                calls.push("own");
            });
            h.commands.register("editor.action.peekDefinition", () => {
                calls.push("definition");
            });
            await useSetting(c.alternativeSetting, "editor.action.peekImplementation");
            await useSetting("editor.gotoLocation.alternativeDefinitionCommand", "editor.action.peekDefinition");
            useTargetAtCaret();

            await run();
            await flushMicrotasks(10);

            expect(calls).toEqual(["own"]);
            expect(caret()).toMatchObject({ line: 1, character: 8 });
        });

        it("an alternative pointing back at the command doesn't loop", async () => {
            await useSetting(c.alternativeSetting, c.commandId);
            useTargetAtCaret();

            await run();
            await flushMicrotasks(10);

            expect(caret()).toMatchObject({ line: 1, character: 6 });
        });
    });

    it("a late answer after a caret move doesn't jump", async () => {
        let answer: (locations: readonly ICoreDefinitionLocation[]) => void = () => undefined;
        c.register(
            features(),
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        );
        useKeysUpToDate();

        const pending = run();
        await flushMicrotasks(10);
        group().getActiveEditor()?.goToPosition(1, 2);
        answer([{ uri: uriOf("types.ts"), range: createRange(3, 10, 3, 15) }]);
        await pending;
        await flushMicrotasks(10);

        expect(group().getActiveEditor()?.uri.toString()).toBe(uriOf("main.ts"));
    });

    it("without its provider the command is disabled: a definition provider doesn't help", async () => {
        const provideDefinition = vi.fn(() => Promise.resolve([]));
        features().definitionProvider.register("*", { provideDefinition });
        useKeysUpToDate();

        h.testApp.sendKey("Ctrl+Shift+P");
        h.testApp.render();
        for (const char of c.label) h.testApp.sendKey(char);
        const palette = screen();
        h.testApp.sendKey("Escape");

        // The only occurrence is the typed query itself: no row offers the command.
        expect(palette.split(c.label).length - 1).toBe(1);
        expect(provideDefinition).not.toHaveBeenCalled();
    });
});
