import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type {
    DefinitionProvider,
    ICoreDefinitionLocation,
    IDefinitionRequest,
} from "../../../../editor/common/languages/iDefinitionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import { ReferencesComponentDIToken } from "../../references/browser/referencesComponent.ts";

import { DefinitionServiceDIToken } from "./definitionService.ts";

describe("DefinitionService — Go to Definition", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-gotodef-",
            files: {
                "main.ts": "const answer = compute();\nconst other = 1;\n",
                "defs.ts": "export function compute(): number {\n    return 42;\n}\n",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const group = () => h.container.get(EditorServiceDIToken);
    let definitions: IDisposable | undefined;
    const useDefinitions = (provideDefinition: DefinitionProvider["provideDefinition"]): void => {
        definitions?.dispose();
        definitions = h.container
            .get(LanguageFeaturesServiceDIToken)
            .definitionProvider.register("*", { provideDefinition });
    };
    const service = () => h.container.get(DefinitionServiceDIToken);
    const caret = () => group().getActiveEditor()?.viewState.selections[0].active;

    it("a jump within the same file puts the cursor at the target start", async () => {
        const mainUri = Uri.file(ws.path("main.ts")).toString();
        const seen: { request?: IDefinitionRequest } = {};
        useDefinitions((request) => {
            seen.request = request;
            return Promise.resolve([{ uri: mainUri, range: createRange(1, 6, 1, 11) }]);
        });

        await service().revealDefinition();

        expect(caret()).toMatchObject({ line: 1, character: 6 });
        expect(seen.request).toMatchObject({ uri: mainUri, line: 0, character: 0 });
        expect(seen.request?.versionId).toBe(group().getActiveEditor()?.model.document.versionId);
    });

    it("a cross-file jump opens the other file and moves the cursor", async () => {
        const defsUri = Uri.file(ws.path("defs.ts")).toString();
        useDefinitions(() => Promise.resolve([{ uri: defsUri, range: createRange(0, 16, 0, 23) }]));

        await service().revealDefinition();

        expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri);
        expect(caret()).toMatchObject({ line: 0, character: 16 });
    });

    it("F12 from user state starts a jump", async () => {
        const defsUri = Uri.file(ws.path("defs.ts")).toString();
        useDefinitions(() => Promise.resolve([{ uri: defsUri, range: createRange(1, 4, 1, 10) }]));

        h.testApp.sendKey("F12");
        // The command isn't awaited: pump the registry → providers → file open chain.
        await flushMicrotasks(10);

        expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri);
        expect(caret()).toMatchObject({ line: 1, character: 4 });
    });

    it("Ctrl+K F12 (revealDefinitionAside): the target opens in the neighbor group", async () => {
        const defsUri = Uri.file(ws.path("defs.ts")).toString();
        const mainUri = Uri.file(ws.path("main.ts")).toString();
        useDefinitions(() => Promise.resolve([{ uri: defsUri, range: createRange(0, 16, 0, 23) }]));
        h.container.get(WorkbenchContextKeysDIToken).update();

        h.commands.execute("editor.action.revealDefinitionAside");
        // The command isn't awaited: pump the registry → providers → file open chain.
        await flushMicrotasks(10);

        const groups = group().editorGroups.groups;
        expect(groups.length).toBe(2);
        expect(groups[0].activePane?.uri.toString()).toBe(mainUri);
        expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri);
        expect(caret()).toMatchObject({ line: 0, character: 16 });
    });

    it("moving the cursor away also cancels the request at the provider", () => {
        const tokens: ICancellationToken[] = [];
        useDefinitions((_request, token) => {
            tokens.push(token);
            return new Promise(() => undefined);
        });

        void service().revealDefinition();
        expect(tokens.map((token) => token.isCancellationRequested)).toEqual([false]);

        group().getActiveEditor()?.goToPosition(1, 2);
        expect(tokens.map((token) => token.isCancellationRequested)).toEqual([true]);
    });

    function deferredSource(): ((locations: readonly ICoreDefinitionLocation[]) => void)[] {
        const pending: ((locations: readonly ICoreDefinitionLocation[]) => void)[] = [];
        useDefinitions(
            () =>
                new Promise((resolve) => {
                    pending.push(resolve);
                }),
        );
        return pending;
    }

    it("a response after a document edit does not jump", async () => {
        const defsUri = Uri.file(ws.path("defs.ts")).toString();
        const mainUri = Uri.file(ws.path("main.ts")).toString();
        const pending = deferredSource();

        const reveal = service().revealDefinition();
        h.testApp.sendKey("x");
        pending[0]([{ uri: defsUri, range: createRange(1, 4, 1, 10) }]);
        await reveal;

        expect(group().getActiveEditor()?.uri.toString()).toBe(mainUri);
        expect(caret()).toMatchObject({ line: 0, character: 1 });
    });

    it("a response after the cursor moves away does not jump", async () => {
        const mainUri = Uri.file(ws.path("main.ts")).toString();
        const pending = deferredSource();

        const reveal = service().revealDefinition();
        group().getActiveEditor()?.goToPosition(1, 2);
        pending[0]([{ uri: mainUri, range: createRange(0, 6, 0, 12) }]);
        await reveal;

        expect(caret()).toMatchObject({ line: 1, character: 2 });
    });

    it("a response after switching to another file does not jump, and the provider's token is cancelled", async () => {
        const mainUri = Uri.file(ws.path("main.ts")).toString();
        const defsUri = Uri.file(ws.path("defs.ts")).toString();
        let answer: (targets: ICoreDefinitionLocation[]) => void = () => undefined;
        let seen: ICancellationToken | undefined;
        useDefinitions((_request, token) => {
            seen = token;
            return new Promise((resolve) => {
                answer = resolve;
            });
        });

        const reveal = service().revealDefinition();
        h.workbench.openFile(ws.path("defs.ts"));
        expect(seen?.isCancellationRequested).toBe(true);
        answer([{ uri: mainUri, range: createRange(1, 6, 1, 11) }]);
        await reveal;

        expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri);
    });

    it("a repeated F12 supersedes the previous one: a late first response does not jump", async () => {
        const defsUri = Uri.file(ws.path("defs.ts")).toString();
        const mainUri = Uri.file(ws.path("main.ts")).toString();
        const pending = deferredSource();

        const first = service().revealDefinition();
        const second = service().revealDefinition();
        pending[1]([{ uri: mainUri, range: createRange(1, 6, 1, 11) }]);
        await second;
        expect(caret()).toMatchObject({ line: 1, character: 6 });

        pending[0]([{ uri: defsUri, range: createRange(1, 4, 1, 10) }]);
        await first;
        expect(group().getActiveEditor()?.uri.toString()).toBe(mainUri);
        expect(caret()).toMatchObject({ line: 1, character: 6 });
    });

    describe("several targets", () => {
        const notifications = () => h.container.get(NotificationServiceDIToken).passive();
        const panel = () => h.container.get(ReferencesComponentDIToken);
        const contextKeys = () => h.container.get(ContextKeyServiceDIToken);
        const useSetting = (key: string, value: unknown) =>
            h.container.get(IConfigurationServiceDIToken).updateValue(key, value);
        /** Provider order: defs.ts line 1, then main.ts lines 1 and 0. */
        const useThreeTargets = () => {
            const mainUri = Uri.file(ws.path("main.ts")).toString();
            const defsUri = Uri.file(ws.path("defs.ts")).toString();
            useDefinitions(() =>
                Promise.resolve([
                    { uri: defsUri, range: createRange(1, 4, 1, 10) },
                    { uri: mainUri, range: createRange(1, 6, 1, 11) },
                    { uri: mainUri, range: createRange(0, 6, 0, 12) },
                ]),
            );
            return { mainUri, defsUri };
        };
        const screen = () => {
            h.testApp.render();
            return h.testApp.backend.screenToString();
        };

        it("peek (default): the panel shows the targets, the editor stays, the first target is active", async () => {
            const { mainUri } = useThreeTargets();

            await service().revealDefinition();

            expect(group().getActiveEditor()?.uri.toString()).toBe(mainUri);
            expect(caret()).toMatchObject({ line: 0, character: 0 });
            const shown = screen();
            expect(shown).toContain("Definitions");
            expect(shown).toContain("3 results in 2 files");
            expect(contextKeys().get("referencesViewletVisible")).toBe(true);
            expect(panel().results.getCursorElement()?.id).toBe("ref:defs.ts:0");
        });

        it("Enter on the active row jumps to the provider's first target", async () => {
            const { defsUri } = useThreeTargets();
            await service().revealDefinition();

            h.testApp.sendKey("Enter");
            await flushMicrotasks(10);

            expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri);
            expect(caret()).toMatchObject({ line: 1, character: 4 });
        });

        it("gotoAndPeek: jumps to the provider's first target and shows the panel", async () => {
            const { defsUri } = useThreeTargets();
            await useSetting("editor.gotoLocation.multipleDefinitions", "gotoAndPeek");

            await service().revealDefinition();

            expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri);
            expect(caret()).toMatchObject({ line: 1, character: 4 });
            expect(screen()).toContain("Definitions");
            expect(contextKeys().get("referencesViewletVisible")).toBe(true);
        });

        it("goto: jumps, the panel stays hidden, and F4 walks the targets", async () => {
            const { defsUri, mainUri } = useThreeTargets();
            await useSetting("editor.gotoLocation.multipleDefinitions", "goto");

            await service().revealDefinition();

            expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri);
            expect(contextKeys().get("referencesViewletVisible")).not.toBe(true);
            expect(screen()).not.toContain("Definitions");

            h.commands.execute("references-view.next");
            await flushMicrotasks(10);

            expect(group().getActiveEditor()?.uri.toString()).toBe(mainUri);
            expect(caret()).toMatchObject({ line: 0, character: 6 });
        });

        it("the setting is read for the document's language", async () => {
            const { defsUri } = useThreeTargets();
            await useSetting(`[${group().getActiveEditor()?.languageId ?? ""}]`, {
                "editor.gotoLocation.multipleDefinitions": "goto",
            });

            await service().revealDefinition();

            expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri);
        });

        it("an unknown setting value means peek", async () => {
            const { mainUri } = useThreeTargets();
            await useSetting("editor.gotoLocation.multipleDefinitions", "nonsense");

            await service().revealDefinition();

            expect(group().getActiveEditor()?.uri.toString()).toBe(mainUri);
            expect(screen()).toContain("Definitions");
        });

        it("two providers naming the same target are one target: a plain jump, the panel stays empty", async () => {
            const mainUri = Uri.file(ws.path("main.ts")).toString();
            const same = { uri: mainUri, range: createRange(1, 6, 1, 11) };
            useDefinitions(() => Promise.resolve([same, same]));

            await service().revealDefinition();

            expect(caret()).toMatchObject({ line: 1, character: 6 });
            expect(contextKeys().get("hasReferenceResult")).toBe(false);
        });

        it("one target ignores the setting and leaves the panel alone", async () => {
            const mainUri = Uri.file(ws.path("main.ts")).toString();
            await useSetting("editor.gotoLocation.multipleDefinitions", "gotoAndPeek");
            useDefinitions(() => Promise.resolve([{ uri: mainUri, range: createRange(1, 6, 1, 11) }]));

            await service().revealDefinition();

            expect(caret()).toMatchObject({ line: 1, character: 6 });
            expect(contextKeys().get("hasReferenceResult")).toBe(false);
            expect(contextKeys().get("referencesViewletVisible")).not.toBe(true);
        });

        it("zero targets: an info toast names the word under the cursor", async () => {
            useDefinitions(() => Promise.resolve([]));

            await service().revealDefinition();

            expect(notifications().map((n) => [n.severity, n.message])).toEqual([
                ["info", "No definition found for 'const'"],
            ]);
        });

        it("zero targets off a word: a toast without a word", async () => {
            useDefinitions(() => Promise.resolve([]));
            group().getActiveEditor()?.goToPosition(2, 0);

            await service().revealDefinition();

            expect(notifications().map((n) => n.message)).toEqual(["No definition found"]);
        });

        it("a stale empty response shows no toast", async () => {
            const pending = deferredSource();

            const reveal = service().revealDefinition();
            group().getActiveEditor()?.goToPosition(1, 2);
            pending[0]([]);
            await reveal;

            expect(notifications()).toEqual([]);
        });
    });

    describe("target at the current position", () => {
        const useSetting = (key: string, value: unknown) =>
            h.container.get(IConfigurationServiceDIToken).updateValue(key, value);
        /** The caret is inside the only target. */
        const useTargetAtCaret = () => {
            const mainUri = Uri.file(ws.path("main.ts")).toString();
            useDefinitions(() => Promise.resolve([{ uri: mainUri, range: createRange(1, 6, 1, 11) }]));
            group().getActiveEditor()?.goToPosition(1, 8);
        };
        const useCommand = (id: string) => {
            const calls: string[] = [];
            h.commands.register(id, () => {
                calls.push(id);
            });
            return calls;
        };

        it("runs the alternative command and does not move", async () => {
            const calls = useCommand("editor.action.referenceSearch.trigger");
            await useSetting(
                "editor.gotoLocation.alternativeDefinitionCommand",
                "editor.action.referenceSearch.trigger",
            );
            useTargetAtCaret();

            await service().revealDefinition();

            expect(calls).toEqual(["editor.action.referenceSearch.trigger"]);
            expect(caret()).toMatchObject({ line: 1, character: 8 });
        });

        it("the default alternative is Go to References", async () => {
            const seen: unknown[] = [];
            h.container.get(LanguageFeaturesServiceDIToken).referenceProvider.register("*", {
                provideReferences: (request) => {
                    seen.push(request.line);
                    return Promise.resolve([]);
                },
            });
            useTargetAtCaret();
            h.container.get(WorkbenchContextKeysDIToken).update();

            await service().revealDefinition();
            await flushMicrotasks(10);

            expect(seen).toEqual([1]);
        });

        it("an empty alternative is the usual handling: the cursor goes to the target start", async () => {
            await useSetting("editor.gotoLocation.alternativeDefinitionCommand", "");
            useTargetAtCaret();

            await service().revealDefinition();

            expect(caret()).toMatchObject({ line: 1, character: 6 });
        });

        it("an unregistered alternative is the usual handling", async () => {
            await useSetting(
                "editor.gotoLocation.alternativeDefinitionCommand",
                "editor.action.referenceSearch.trigger",
            );
            useTargetAtCaret();

            await service().revealDefinition();

            expect(caret()).toMatchObject({ line: 1, character: 6 });
        });

        it("an alternative pointing back at Go to Definition doesn't loop", async () => {
            const provide = vi.fn(() =>
                Promise.resolve([{ uri: Uri.file(ws.path("main.ts")).toString(), range: createRange(1, 6, 1, 11) }]),
            );
            await useSetting("editor.gotoLocation.alternativeDefinitionCommand", "editor.action.revealDefinition");
            useDefinitions(provide);
            group().getActiveEditor()?.goToPosition(1, 8);
            h.container.get(WorkbenchContextKeysDIToken).update();

            await service().revealDefinition();

            // The outer request, then the alternative: the guard turns the second one into a plain jump.
            expect(provide).toHaveBeenCalledTimes(2);
            expect(caret()).toMatchObject({ line: 1, character: 6 });

            // The guard is released: the next F12 runs the alternative again.
            group().getActiveEditor()?.goToPosition(1, 8);
            await service().revealDefinition();
            expect(provide).toHaveBeenCalledTimes(4);
        });

        it("the caret outside the target, or several targets, skip the alternative", async () => {
            const calls = useCommand("editor.action.referenceSearch.trigger");
            await useSetting(
                "editor.gotoLocation.alternativeDefinitionCommand",
                "editor.action.referenceSearch.trigger",
            );
            const mainUri = Uri.file(ws.path("main.ts")).toString();
            const defsUri = Uri.file(ws.path("defs.ts")).toString();

            // Same position numbers, another file.
            useDefinitions(() => Promise.resolve([{ uri: defsUri, range: createRange(1, 6, 1, 11) }]));
            group().getActiveEditor()?.goToPosition(1, 8);
            await service().revealDefinition();
            expect(calls).toEqual([]);

            // Same file, another line.
            await group().openUri(Uri.parse(mainUri));
            useDefinitions(() => Promise.resolve([{ uri: mainUri, range: createRange(0, 6, 0, 11) }]));
            group().getActiveEditor()?.goToPosition(1, 8);
            await service().revealDefinition();
            expect(calls).toEqual([]);

            // Several targets; the one at the caret sorts first, so only the count can skip the alternative.
            useDefinitions(() =>
                Promise.resolve([
                    { uri: mainUri, range: createRange(1, 6, 1, 11) },
                    { uri: mainUri, range: createRange(3, 0, 3, 1) },
                ]),
            );
            group().getActiveEditor()?.goToPosition(1, 8);
            await service().revealDefinition();
            expect(calls).toEqual([]);
        });
    });

    describe("commands with arguments", () => {
        const panel = () => h.container.get(ReferencesComponentDIToken);
        const notifications = () => h.container.get(NotificationServiceDIToken).passive();
        const contextKeys = () => h.container.get(ContextKeyServiceDIToken);
        const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
        const targets = () => {
            const mainUri = Uri.file(ws.path("main.ts"));
            const defsUri = Uri.file(ws.path("defs.ts"));
            return {
                defsUri,
                mainUri,
                two: [
                    { uri: defsUri.toString(), range: createRange(1, 4, 1, 10) },
                    { uri: mainUri.toString(), range: createRange(1, 6, 1, 11) },
                ],
            };
        };

        it("showReferences takes JSON-serialized arguments: opens the file, puts the cursor, fills the panel", async () => {
            const { defsUri, two } = targets();

            await h.commands.execute(
                "editor.action.showReferences",
                json(defsUri),
                { line: 2, character: 0 },
                json([{ uri: json(defsUri), range: two[0].range }, two[1]]),
            );

            expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri.toString());
            expect(caret()).toMatchObject({ line: 2, character: 0 });
            expect(panel().resultCount).toBe(2);
            expect(contextKeys().get("referencesViewletVisible")).toBe(true);
            h.testApp.render();
            expect(h.testApp.backend.screenToString()).toContain("Locations");
        });

        it("peekLocations shows the panel even for one location", async () => {
            const { mainUri, two } = targets();

            await h.commands.execute("editor.action.peekLocations", mainUri.toString(), { line: 0, character: 0 }, [
                two[0],
            ]);

            expect(group().getActiveEditor()?.uri.toString()).toBe(mainUri.toString());
            expect(panel().resultCount).toBe(1);
            expect(contextKeys().get("referencesViewletVisible")).toBe(true);
        });

        it("goToLocations: one location is a jump", async () => {
            const { defsUri, mainUri, two } = targets();

            await h.commands.execute("editor.action.goToLocations", mainUri.toString(), { line: 0, character: 0 }, [
                two[0],
            ]);

            expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri.toString());
            expect(caret()).toMatchObject({ line: 1, character: 4 });
        });

        it("goToLocations: `multiple` beats the setting, which is the default", async () => {
            const { defsUri, mainUri, two } = targets();
            const start = { line: 0, character: 0 };

            // The default of `multipleReferences` is peek: no jump.
            await h.commands.execute("editor.action.goToLocations", mainUri.toString(), start, two);
            expect(group().getActiveEditor()?.uri.toString()).toBe(mainUri.toString());

            await h.container
                .get(IConfigurationServiceDIToken)
                .updateValue("editor.gotoLocation.multipleReferences", "goto");
            await h.commands.execute("editor.action.goToLocations", mainUri.toString(), start, two, "peek");
            expect(group().getActiveEditor()?.uri.toString()).toBe(mainUri.toString());

            await h.commands.execute("editor.action.goToLocations", mainUri.toString(), start, two);
            expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri.toString());
        });

        it("goToLocations stays in the active group, for the start and for the jump", async () => {
            const { mainUri, two } = targets();

            await h.commands.execute("editor.action.goToLocations", mainUri.toString(), { line: 0, character: 0 }, [
                two[0],
            ]);

            expect(group().editorGroups.groups.length).toBe(1);
        });

        it("goToLocations: an unknown `multiple` means peek", async () => {
            const { mainUri, two } = targets();
            const start = { line: 0, character: 0 };

            await h.commands.execute("editor.action.goToLocations", mainUri.toString(), start, two, "nonsense");

            expect(group().getActiveEditor()?.uri.toString()).toBe(mainUri.toString());
            expect(panel().resultCount).toBe(2);
        });

        it("goToLocations: multipleReferences is read for the started document's language", async () => {
            const { defsUri, mainUri, two } = targets();
            await h.container
                .get(IConfigurationServiceDIToken)
                .updateValue(`[${group().getActiveEditor()?.languageId ?? ""}]`, {
                    "editor.gotoLocation.multipleReferences": "goto",
                });

            await h.commands.execute("editor.action.goToLocations", mainUri.toString(), { line: 0, character: 0 }, two);

            expect(group().getActiveEditor()?.uri.toString()).toBe(defsUri.toString());
        });

        it("goToLocations survives a start resource that doesn't open with no editor left", async () => {
            const { two } = targets();
            h.commands.execute("workbench.action.closeActiveEditor");
            expect(group().getActiveEditor()).toBeNull();

            await h.commands.execute("editor.action.goToLocations", "nope:/missing", { line: 0, character: 0 }, two);

            expect(panel().resultCount).toBe(2);
        });

        it("an empty message is no message", async () => {
            const { mainUri } = targets();

            await h.commands.execute(
                "editor.action.goToLocations",
                mainUri.toString(),
                { line: 0, character: 0 },
                [],
                undefined,
                "",
            );

            expect(notifications()).toEqual([]);
        });

        it("an empty list: silent without a message, a toast with one, the panel stays", async () => {
            const { mainUri } = targets();
            const start = { line: 0, character: 0 };

            await h.commands.execute("editor.action.goToLocations", mainUri.toString(), start, []);
            expect(notifications()).toEqual([]);

            await h.commands.execute(
                "editor.action.goToLocations",
                mainUri.toString(),
                start,
                [],
                undefined,
                "Nothing",
            );
            expect(notifications().map((n) => n.message)).toEqual(["Nothing"]);
            expect(contextKeys().get("hasReferenceResult")).toBe(false);
        });

        it("these commands stay out of the command palette", () => {
            for (const id of [
                "editor.action.goToLocations",
                "editor.action.peekLocations",
                "editor.action.showReferences",
            ]) {
                expect(h.commands.has(id)).toBe(true);
                expect(h.commands.getTitle(id)).toBeUndefined();
            }
        });
    });

    it("without a definition provider F12 is disabled: no toast, the command doesn't run", async () => {
        h.container.get(WorkbenchContextKeysDIToken).update();

        await h.commands.execute("editor.action.revealDefinition");
        await h.commands.execute("editor.action.revealDefinitionAside");

        expect(h.container.get(NotificationServiceDIToken).passive()).toEqual([]);
        expect(h.commands.getTitle("editor.action.revealDefinitionAside")).toBe("Open Definition to the Side");
    });

    it("no source / empty result / no active editor is a no-op", async () => {
        // No source.
        await service().revealDefinition();
        expect(caret()).toMatchObject({ line: 0, character: 0 });

        // Empty result.
        useDefinitions(() => Promise.resolve([]));
        await service().revealDefinition();
        expect(caret()).toMatchObject({ line: 0, character: 0 });

        // No active editor: the source must not be called at all.
        let called = false;
        useDefinitions(() => {
            called = true;
            return Promise.resolve([]);
        });
        h.commands.execute("workbench.action.closeActiveEditor");
        h.commands.execute("workbench.action.closeActiveEditor");
        expect(group().getActiveEditor()).toBeNull();
        await service().revealDefinition();
        expect(called).toBe(false);
    });
});
