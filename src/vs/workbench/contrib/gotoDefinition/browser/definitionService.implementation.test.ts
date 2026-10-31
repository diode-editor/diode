import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ImplementationProvider } from "../../../../editor/common/languages/iDefinitionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";

import { DefinitionServiceDIToken } from "./definitionService.ts";

describe("DefinitionService — Go to Implementations", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-gotoimpl-",
            files: {
                "main.ts": "interface Shape { area(): number }\nconst other = 1;\n",
                "impl.ts": "class Circle {\n    area() { return 3; }\n}\nclass Square {\n    area() { return 4; }\n}\n",
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
    const service = () => h.container.get(DefinitionServiceDIToken);
    const caret = () => group().getActiveEditor()?.viewState.selections[0].active;
    const uriOf = (name: string) => Uri.file(ws.path(name)).toString();
    const useImplementations = (provideImplementation: ImplementationProvider["provideImplementation"]) =>
        features().implementationProvider.register("*", { provideImplementation });
    const useSetting = (key: string, value: unknown) =>
        h.container.get(IConfigurationServiceDIToken).updateValue(key, value);
    const screen = () => {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    };
    const useTwoTargets = () =>
        useImplementations(() =>
            Promise.resolve([
                { uri: uriOf("impl.ts"), range: createRange(1, 4, 1, 8) },
                { uri: uriOf("impl.ts"), range: createRange(4, 4, 4, 8) },
            ]),
        );

    it("Ctrl+F12 with one target jumps to it, and a definition provider isn't asked", async () => {
        const provideDefinition = vi.fn(() => Promise.resolve([]));
        features().definitionProvider.register("*", { provideDefinition });
        useImplementations(() => Promise.resolve([{ uri: uriOf("impl.ts"), range: createRange(4, 4, 4, 8) }]));

        h.testApp.sendKey("Ctrl+F12");
        // The command isn't awaited: pump the registry → providers → file open chain.
        await flushMicrotasks(10);

        expect(group().getActiveEditor()?.uri.toString()).toBe(uriOf("impl.ts"));
        expect(caret()).toMatchObject({ line: 4, character: 4 });
        expect(provideDefinition).not.toHaveBeenCalled();
        // Stays in the active group: there's no "to the side" variant of this command.
        expect(group().editorGroups.groups.length).toBe(1);
    });

    it("the provider gets the position of the caret in the active document", async () => {
        const provide = vi.fn<ImplementationProvider["provideImplementation"]>(() => Promise.resolve([]));
        useImplementations(provide);
        group().getActiveEditor()?.goToPosition(0, 18);

        await service().goToImplementation();

        expect(provide.mock.calls[0]?.[0]).toMatchObject({ uri: uriOf("main.ts"), line: 0, character: 18 });
    });

    it("several targets: the panel is titled Implementations, the editor stays", async () => {
        useTwoTargets();

        await service().goToImplementation();

        expect(group().getActiveEditor()?.uri.toString()).toBe(uriOf("main.ts"));
        const shown = screen();
        expect(shown).toContain("Implementations");
        expect(shown).toContain("2 results in 1 file");
    });

    it("multipleImplementations decides, not multipleDefinitions", async () => {
        useTwoTargets();
        await useSetting("editor.gotoLocation.multipleDefinitions", "peek");
        await useSetting("editor.gotoLocation.multipleImplementations", "goto");

        await service().goToImplementation();

        expect(group().getActiveEditor()?.uri.toString()).toBe(uriOf("impl.ts"));
        expect(caret()).toMatchObject({ line: 1, character: 4 });
    });

    it("zero targets: the toast speaks of an implementation and names the word", async () => {
        useImplementations(() => Promise.resolve([]));

        await service().goToImplementation();

        const messages = h.container
            .get(NotificationServiceDIToken)
            .passive()
            .map((n) => n.message);
        expect(messages).toEqual(["No implementation found for 'interface'"]);
        expect(screen()).toContain("No implementation found for 'interface'");
    });

    it("zero targets off a word: the generic toast", async () => {
        useImplementations(() => Promise.resolve([]));
        // The last line of the file is empty.
        group().getActiveEditor()?.goToPosition(2, 0);

        await service().goToImplementation();

        const messages = h.container
            .get(NotificationServiceDIToken)
            .passive()
            .map((n) => n.message);
        expect(messages).toEqual(["No implementation found"]);
        expect(screen()).toContain("No implementation found");
    });

    describe("the only target is under the caret", () => {
        const useTargetAtCaret = () => {
            useImplementations(() => Promise.resolve([{ uri: uriOf("main.ts"), range: createRange(1, 6, 1, 11) }]));
            group().getActiveEditor()?.goToPosition(1, 8);
        };

        it("the default alternative is empty: the usual handling, the cursor goes to the target start", async () => {
            useTargetAtCaret();

            await service().goToImplementation();

            expect(caret()).toMatchObject({ line: 1, character: 6 });
        });

        it("alternativeImplementationCommand runs, alternativeDefinitionCommand doesn't", async () => {
            const calls: string[] = [];
            // The settings' enum admits only upstream's ids: these two aren't registered otherwise.
            h.commands.register("editor.action.peekImplementation", () => {
                calls.push("implementation");
            });
            h.commands.register("editor.action.peekDefinition", () => {
                calls.push("definition");
            });
            await useSetting(
                "editor.gotoLocation.alternativeImplementationCommand",
                "editor.action.peekImplementation",
            );
            await useSetting("editor.gotoLocation.alternativeDefinitionCommand", "editor.action.peekDefinition");
            useTargetAtCaret();

            await service().goToImplementation();

            expect(calls).toEqual(["implementation"]);
            expect(caret()).toMatchObject({ line: 1, character: 8 });
        });

        it("an alternative pointing back at Go to Implementations doesn't loop", async () => {
            await useSetting(
                "editor.gotoLocation.alternativeImplementationCommand",
                "editor.action.goToImplementation",
            );
            useTargetAtCaret();
            h.container.get(WorkbenchContextKeysDIToken).update();

            await service().goToImplementation();
            await flushMicrotasks(10);

            expect(caret()).toMatchObject({ line: 1, character: 6 });
        });
    });

    it("without an implementation provider Ctrl+F12 is disabled: no toast, the definition provider doesn't help", async () => {
        features().definitionProvider.register("*", { provideDefinition: () => Promise.resolve([]) });

        h.testApp.sendKey("Ctrl+F12");
        await flushMicrotasks(10);

        expect(h.container.get(NotificationServiceDIToken).passive()).toEqual([]);
    });
});
