import * as path from "node:path";

import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import type { IDiffEditorPane2Input } from "../../browser/parts/editor/diffEditorPane2.ts";
import { DiffEditorPane2 } from "../../browser/parts/editor/diffEditorPane2.ts";
import { TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import { DialogService } from "../../services/dialogs/browser/dialogService.ts";
import { EditorService } from "../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";
import type { IWireEditorLayout } from "../common/wireTypes.ts";

import { EditorLayoutServiceAdapter } from "./editorLayoutServiceAdapter.ts";

describe("EditorLayoutServiceAdapter", () => {
    let ws: ITempWorkspace;
    let service: EditorService;
    let dialogs: DialogService;
    let adapter: EditorLayoutServiceAdapter;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-layout-adapter-",
            files: { "a.ts": "alpha", "b.ts": "beta" },
        });
        dialogs = new DialogService();
        dialogs.attachHost(new BodyElement());
        service = new EditorService(
            new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
            new TokenizationRegistry(),
            NULL_TOKEN_STYLE_RESOLVER,
            NULL_LANGUAGE_SERVICE,
            NULL_CONFIGURATION_SERVICE,
            new UndoRedoService(),
            NULL_FILE_WATCHER,
            createTestEditorContextMenuController(),
            NULL_LOG_SERVICE,
            undefined,
            dialogs,
        );
        adapter = new EditorLayoutServiceAdapter(service, service.editorGroups);
    });

    afterEach(() => {
        adapter.dispose();
        service.dispose();
        ws.dispose();
    });

    it("snapshot: groups carry viewColumn, the active tab carries selections", () => {
        service.openFile(ws.path("a.ts"));
        service.openFile(ws.path("b.ts"));
        service.splitActiveGroup();

        const layout = adapter.getLayoutSnapshot();
        expect(layout.groups.length).toBe(2);
        expect(layout.groups[0].viewColumn).toBe(1);
        expect(layout.groups[1].viewColumn).toBe(2);
        expect(layout.groups[1].isActive).toBe(true);
        const tabs = layout.groups[0].tabs;
        expect(tabs.map((tab) => path.basename(tab.uri))).toEqual(["a.ts", "b.ts"]);
        expect(tabs[0].selections).toBeUndefined();
        expect(tabs[1].isActive).toBe(true);
        expect(tabs[1].selections).toBeDefined();
        expect(tabs[1].kind).toBe("text");
    });

    it("producer: split/tab change coalesce into one snapshot per tick", async () => {
        service.openFile(ws.path("a.ts"));
        const pushes: IWireEditorLayout[] = [];
        adapter.onDidChangeLayout((layout) => pushes.push(layout));

        service.openFile(ws.path("b.ts"));
        service.splitActiveGroup();
        await Promise.resolve();

        expect(pushes.length).toBe(1);
        expect(pushes[0].groups.length).toBe(2);
    });

    it("producer: an indentation change of a tab open before the adapter reaches the snapshot", async () => {
        service.openFile(ws.path("a.ts"));
        const late = new EditorLayoutServiceAdapter(service, service.editorGroups);
        const pushes: IWireEditorLayout[] = [];
        late.onDidChangeLayout((layout) => pushes.push(layout));

        (service.editorGroups.groups[0].getPane(0) as TextEditorPane).setIndentOptions({ tabSize: 7 });
        await Promise.resolve();
        late.dispose();

        expect(pushes.at(-1)?.groups[0].tabs[0].tabSize).toBe(7);
    });

    it("onDidChangeLayout: disposing a subscription twice is an idempotent no-op", () => {
        const pushes: IWireEditorLayout[] = [];
        const subscription = adapter.onDidChangeLayout((layout) => pushes.push(layout));
        subscription.dispose();
        subscription.dispose(); // the listener is already removed: a second dispose breaks nothing

        service.openFile(ws.path("a.ts"));
        adapter.flushPendingLayout();
        expect(pushes).toHaveLength(0);
    });

    it("flushPendingLayout delivers the pending snapshot synchronously (invariant before meta)", () => {
        service.openFile(ws.path("a.ts"));
        const pushes: IWireEditorLayout[] = [];
        adapter.onDidChangeLayout((layout) => pushes.push(layout));

        service.splitActiveGroup();
        expect(pushes.length).toBe(0);
        adapter.flushPendingLayout();
        expect(pushes.length).toBe(1);
        adapter.flushPendingLayout();
        expect(pushes.length).toBe(1);
    });

    it("showTextDocument: Active is the active group; reopening is deduplicated", async () => {
        service.openFile(ws.path("a.ts"));

        const result = await adapter.showTextDocument({ uri: service.getActiveEditor()!.uri.toString() });
        expect(result.viewColumn).toBe(1);
        expect(service.editorGroups.activeGroup.editorCount).toBe(1);
    });

    it("showTextDocument: Beside creates a neighbor group; past the grid, groups are created to catch up (AS-5)", async () => {
        service.openFile(ws.path("a.ts"));
        const uriB = service.getActiveEditor()!.uri.toString().replace("a.ts", "b.ts");

        const beside = await adapter.showTextDocument({ uri: uriB, viewColumn: -2 });
        expect(beside.viewColumn).toBe(2);
        expect(service.editorGroups.groups.length).toBe(2);

        // ViewColumn.Three with two groups: a third one is created.
        const third = await adapter.showTextDocument({ uri: uriB, viewColumn: 3 });
        expect(third.viewColumn).toBe(3);
        expect(service.editorGroups.groups.length).toBe(3);
    });

    it("[api:window.showTextDocument] calls of one tick each answer with their own column", async () => {
        service.openFile(ws.path("a.ts"));
        const uri = service.getActiveEditor()!.uri.toString();

        const results = await Promise.all([1, 2, 3].map((viewColumn) => adapter.showTextDocument({ uri, viewColumn })));

        expect(results.map((result) => result.viewColumn)).toEqual([1, 2, 3]);
        expect(new Set(results.map((result) => result.groupId)).size).toBe(3);
    });

    it("[api:window.showTextDocument] calls of one tick each answer with their own document, the last one is active (#134786)", async () => {
        ws.writeFile("c.ts", "gamma");
        const uris = ["a.ts", "b.ts", "c.ts"].map((name) => Uri.file(ws.path(name)).toString());

        const results = await Promise.all(uris.map((uri) => adapter.showTextDocument({ uri })));

        expect(results.map((result) => result.uri)).toEqual(uris);
        expect(service.getActiveEditor()?.uri.toString()).toBe(uris[2]);
    });

    it("[api:window.showTextDocument] preserveFocus does not take focus back from a call made meanwhile", async () => {
        const uriA = Uri.file(ws.path("a.ts")).toString();
        const uriB = Uri.file(ws.path("b.ts")).toString();
        service.openFile(ws.path("a.ts"));

        const [, focused] = await Promise.all([
            adapter.showTextDocument({ uri: uriA, viewColumn: 2, preserveFocus: true }),
            adapter.showTextDocument({ uri: uriB, viewColumn: 3 }),
        ]);

        expect(service.editorGroups.activeGroup.id).toBe(focused.groupId);
    });

    it("[api:window.showTextDocument] a finished call does not take focus back later", async () => {
        const uriB = Uri.file(ws.path("b.ts")).toString();
        service.openFile(ws.path("a.ts"));
        await adapter.showTextDocument({ uri: uriB, viewColumn: 2 });

        service.editorGroups.focusGroup({ index: 0 });
        await adapter.showTextDocument({ uri: uriB, viewColumn: 2, preserveFocus: true });
        expect(service.editorGroups.viewColumnOf(service.editorGroups.activeGroup)).toBe(1);

        const uriA = Uri.file(ws.path("a.ts")).toString();
        await adapter.showTextDocument({ uri: uriA, viewColumn: 2 });
        service.editorGroups.focusGroup({ index: 0 });
        await adapter.showTextDocument({ uri: uriA, viewColumn: 1 });
        expect(service.getActiveEditor()?.uri.toString()).toBe(uriA);
        expect(service.editorGroups.viewColumnOf(service.editorGroups.activeGroup)).toBe(1);
    });

    it("[api:window.showTextDocument] two preserveFocus calls of one tick return to the group active before both", async () => {
        const uriA = Uri.file(ws.path("a.ts")).toString();
        service.openFile(ws.path("a.ts"));
        const before = service.editorGroups.activeGroup;

        await Promise.all([
            adapter.showTextDocument({ uri: uriA, viewColumn: 2, preserveFocus: true }),
            adapter.showTextDocument({ uri: uriA, viewColumn: 3, preserveFocus: true }),
        ]);

        expect(service.editorGroups.activeGroup).toBe(before);
    });

    function slowSource(): { finish: (content: string) => void } {
        const handle = { finish: (_content: string): void => undefined };
        service.virtualDocumentSource = {
            canProvide: () => true,
            provide: () =>
                new Promise<string>((resolve) => {
                    handle.finish = resolve;
                }),
        };
        return handle;
    }

    it("[api:window.showTextDocument] a preserveFocus call is never the newest focused one", async () => {
        const uriA = Uri.file(ws.path("a.ts")).toString();
        const uriB = Uri.file(ws.path("b.ts")).toString();
        const source = slowSource();

        const slow = adapter.showTextDocument({ uri: "slow://host/doc", viewColumn: 1 });
        const focused = await adapter.showTextDocument({ uri: uriB, viewColumn: 2 });
        await adapter.showTextDocument({ uri: uriA, viewColumn: 3, preserveFocus: true });
        source.finish("late");
        await slow;

        expect(service.editorGroups.activeGroup.id).toBe(focused.groupId);
    });

    it("[api:window.showTextDocument] a focused call still loading does not take focus from a finished preserveFocus", async () => {
        const uriA = Uri.file(ws.path("a.ts")).toString();
        service.openFile(ws.path("a.ts"));
        const before = service.editorGroups.activeGroup;
        const source = slowSource();

        const slow = adapter.showTextDocument({ uri: "slow://host/doc", viewColumn: 2 });
        await adapter.showTextDocument({ uri: uriA, viewColumn: 3, preserveFocus: true });

        expect(service.editorGroups.activeGroup).toBe(before);
        source.finish("late");
        await slow;
    });

    it("[api:window.showTextDocument] in one group a slow open does not take the tab of a newer call", async () => {
        const uriB = Uri.file(ws.path("b.ts")).toString();
        const source = slowSource();

        const slow = adapter.showTextDocument({ uri: "slow://host/doc", viewColumn: 1 });
        await adapter.showTextDocument({ uri: uriB, viewColumn: 1 });
        source.finish("late");
        await slow;

        expect(service.getActiveEditor()?.uri.toString()).toBe(uriB);
    });

    it("[api:window.showTextDocument] a failed open rejects and names the resource", async () => {
        await expect(adapter.showTextDocument({ uri: "nope://host/missing" })).rejects.toThrow(
            'Could NOT open editor for "nope://host/missing".',
        );
    });

    it("[api:window.showTextDocument] a slow non-disk open does not end up on top of a newer call", async () => {
        const uriB = Uri.file(ws.path("b.ts")).toString();
        let provide: (content: string) => void = () => undefined;
        service.virtualDocumentSource = {
            canProvide: () => true,
            provide: () =>
                new Promise<string>((resolve) => {
                    provide = resolve;
                }),
        };

        const slow = adapter.showTextDocument({ uri: "slow://host/doc", viewColumn: 1 });
        const newer = adapter.showTextDocument({ uri: uriB, viewColumn: 2 });
        const newerResult = await newer;
        provide("late");
        const slowResult = await slow;

        expect(slowResult.viewColumn).toBe(1);
        expect(slowResult.uri).toBe("slow://host/doc");
        expect(service.editorGroups.activeGroup.id).toBe(newerResult.groupId);
        expect(service.getActiveEditor()?.uri.toString()).toBe(uriB);
    });

    it("showTextDocument: preserveFocus keeps focus, selection sets the cursor", async () => {
        ws.writeFile("long.ts", Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n"));
        service.openFile(ws.path("a.ts"));
        const before = service.editorGroups.activeGroup;
        // Focus lives in the control tree, which the bare service lacks: here we check the flag reaches
        // openUri; focus itself is covered by `editorService.virtualDocument.test.ts`.
        const openUri = vi.spyOn(service, "openUri");

        await adapter.showTextDocument({
            uri: service.getActiveEditor()!.uri.toString().replace("a.ts", "long.ts"),
            preserveFocus: true,
            selection: { anchorLine: 5, anchorCharacter: 1, activeLine: 5, activeCharacter: 1 },
        });

        expect(openUri).toHaveBeenCalledWith(expect.anything(), { focus: false, group: before });
        expect(service.editorGroups.activeGroup === before).toBe(true);
        expect(service.getActiveEditor()!.viewState.selections[0].active).toEqual({ line: 5, character: 1 });
    });

    /** A cursor past the end of line crashes the very first frame in occurrence highlighting. */
    it("showTextDocument: a selection past the document bounds is clamped", async () => {
        ws.writeFile("short.ts", "ab\ncd");
        service.openFile(ws.path("a.ts"));

        await adapter.showTextDocument({
            uri: service.getActiveEditor()!.uri.toString().replace("a.ts", "short.ts"),
            selection: { anchorLine: -3, anchorCharacter: -7, activeLine: 99, activeCharacter: 99 },
        });

        const selection = service.getActiveEditor()!.viewState.selections[0];
        expect(selection.anchor).toEqual({ line: 0, character: 0 });
        expect(selection.active).toEqual({ line: 1, character: 2 });
    });

    it("closeTabs closes a clean tab; a dead group is an idempotent success", async () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        const group = service.editorGroups.activeGroup;
        const uri = group.activePane!.uri.toString();

        await expect(adapter.closeTabs({ tabs: [{ groupId: group.id, uri }] })).resolves.toBe(true);
        expect(service.editorGroups.groups.length).toBe(1);
        await expect(adapter.closeTabs({ tabs: [{ groupId: group.id, uri }] })).resolves.toBe(true);
    });

    it("closeGroups closes all tabs of the group", async () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        service.openFile(ws.path("b.ts"));
        const group = service.editorGroups.activeGroup;
        expect(group.editorCount).toBe(2);

        await expect(adapter.closeGroups({ groupIds: [group.id] })).resolves.toBe(true);
        expect(service.editorGroups.groups.length).toBe(1);
    });

    it("closeTabs with an unsaved last tab waits for the answer: Cancel gives false, the tab stays", async () => {
        service.openFile(ws.path("a.ts"));
        const editor = service.getActiveEditor()!;
        editor.viewState.type("dirty");
        const group = service.editorGroups.activeGroup;

        const closed = adapter.closeTabs({ tabs: [{ groupId: group.id, uri: editor.uri.toString() }] });
        expect(dialogs.getOpenConfirmSaveDialog()).not.toBeNull();
        dialogs.getOpenConfirmSaveDialog()?.onCancel?.();

        await expect(closed).resolves.toBe(false);
        expect(group.editorCount).toBe(1);
    });

    it("closeTabs: Don't Save on a dirty tab gives true, all listed targets are closed", async () => {
        service.openFile(ws.path("a.ts"));
        const dirty = service.getActiveEditor()!;
        dirty.viewState.type("dirty");
        service.openFile(ws.path("b.ts"));
        const clean = service.getActiveEditor()!;
        const group = service.editorGroups.activeGroup;

        const closed = adapter.closeTabs({
            tabs: [
                { groupId: group.id, uri: dirty.uri.toString() },
                { groupId: group.id, uri: clean.uri.toString() },
            ],
        });
        dialogs.getOpenConfirmSaveDialog()?.onDontSave?.();

        await expect(closed).resolves.toBe(true);
        expect(group.editorCount).toBe(0);
    });

    it("closeTabs: a uri not in the group is skipped as an idempotent success", async () => {
        service.openFile(ws.path("a.ts"));
        const group = service.editorGroups.activeGroup;

        await expect(
            adapter.closeTabs({ tabs: [{ groupId: group.id, uri: Uri.file(ws.path("b.ts")).toString() }] }),
        ).resolves.toBe(true);
        expect(group.editorCount).toBe(1);
    });

    describe("ViewColumn and focus along the strip", () => {
        function twoGroups() {
            service.openFile(ws.path("a.ts"));
            service.editorGroups.newGroup("after", { focus: false });
            service.openFile(ws.path("b.ts"));
            const [first, second] = service.editorGroups.groups;
            const focused: number[] = [];
            service.editorGroups.focusGroupContentHook = (group) =>
                focused.push(service.editorGroups.viewColumnOf(group));
            return { first, second, focused };
        }

        const uriOf = (name: string) => Uri.file(ws.path(name)).toString();

        it("Active is the active group even when it is not the first", async () => {
            const { second } = twoGroups();

            const result = await adapter.showTextDocument({ uri: uriOf("a.ts"), viewColumn: -1 });

            expect(result.viewColumn).toBe(2);
            expect(second.editorCount).toBe(2);
        });

        it("an existing inactive column opens there without focusing group content", async () => {
            const { first, focused } = twoGroups();

            const result = await adapter.showTextDocument({ uri: uriOf("b.ts"), viewColumn: 1 });

            expect(result.viewColumn).toBe(1);
            expect(first.getPanes().map((pane) => path.basename(pane.uri.path))).toEqual(["a.ts", "b.ts"]);
            expect(service.editorGroups.activeGroup).toBe(first);
            expect(focused).toEqual([]);
        });

        it("preserveFocus keeps the previous group active, group content gets no focus", async () => {
            const { first, second, focused } = twoGroups();

            await adapter.showTextDocument({ uri: uriOf("b.ts"), viewColumn: 1, preserveFocus: true });

            expect(first.editorCount).toBe(2);
            expect(service.editorGroups.activeGroup).toBe(second);
            expect(focused).toEqual([]);
        });

        it("Beside with preserveFocus adds a group to the right without touching content focus", async () => {
            const { second, focused } = twoGroups();

            const result = await adapter.showTextDocument({ uri: uriOf("a.ts"), viewColumn: -2, preserveFocus: true });

            expect(result.viewColumn).toBe(3);
            expect(service.editorGroups.activeGroup).toBe(second);
            expect(focused).toEqual([]);
        });

        it("a column past the edge appends trailing groups at the end of the strip, not next to the active one", async () => {
            const { first, second, focused } = twoGroups();
            service.editorGroups.focusGroup({ index: 0 }, { focus: false });

            const result = await adapter.showTextDocument({ uri: uriOf("a.ts"), viewColumn: 4 });

            expect(result.viewColumn).toBe(4);
            expect(service.editorGroups.groups).toHaveLength(4);
            expect(service.editorGroups.groups.slice(0, 2)).toEqual([first, second]);
            expect(focused).toEqual([]);
        });

        it("snapshot: exactly one group is active", () => {
            twoGroups();

            const layout = adapter.getLayoutSnapshot();

            expect(layout.groups.map((group) => group.isActive)).toEqual([false, true]);
        });

        it("closeTabs addresses a tab by group: the same file in another group stays", async () => {
            service.openFile(ws.path("a.ts"));
            service.splitActiveGroup();
            const [first, second] = service.editorGroups.groups;

            await adapter.closeTabs({ tabs: [{ groupId: second.id, uri: uriOf("a.ts") }] });

            expect(first.editorCount).toBe(1);
            expect(service.editorGroups.groups).toEqual([first]);
        });
    });

    it("closeGroups: an unknown group is skipped as an idempotent success", async () => {
        service.openFile(ws.path("a.ts"));

        await expect(adapter.closeGroups({ groupIds: [999] })).resolves.toBe(true);
        expect(service.editorGroups.groups.length).toBe(1);
    });

    it("closeGroups: a veto in one group does not block closing another, the answer is false", async () => {
        service.openFile(ws.path("a.ts"));
        service.getActiveEditor()!.viewState.type("dirty");
        const first = service.editorGroups.activeGroup;
        service.editorGroups.newGroup("after");
        service.openFile(ws.path("b.ts"));
        const second = service.editorGroups.activeGroup;
        expect(service.editorGroups.groups.length).toBe(2);

        const closed = adapter.closeGroups({ groupIds: [first.id, second.id] });
        dialogs.getOpenConfirmSaveDialog()?.onCancel?.();

        await expect(closed).resolves.toBe(false);
        expect(first.editorCount).toBe(1);
        expect(service.editorGroups.groups).toEqual([first]);
    });

    it("snapshot: a diff tab carries kind=diff and side uris (when present)", () => {
        service.openFile(ws.path("a.ts"));
        const diffInput: IDiffEditorPane2Input = {
            uri: Uri.parse("diode-diff:/a.ts?vs=HEAD"),
            label: "a.ts (diff)",
            originalLabel: "HEAD",
            modifiedLabel: "a.ts",
            original: { kind: "snapshot", text: "alpha" },
            modified: { kind: "snapshot", text: "alpha!" },
            languageId: "plaintext",
            originalUri: Uri.parse("git:/a.ts"),
            modifiedUri: Uri.file(ws.path("a.ts")),
        };
        const makePane = (input: IDiffEditorPane2Input) =>
            new DiffEditorPane2(
                NULL_LANGUAGE_SERVICE,
                new UndoRedoService(),
                diskFileService(),
                new TokenizationRegistry(),
                NULL_TOKEN_STYLE_RESOLVER,
                input,
            );
        service.openPane(makePane(diffInput));
        // The sides are optional (the HEAD version may not exist as a resource).
        service.openPane(
            makePane({
                ...diffInput,
                uri: Uri.parse("diode-diff:/bare.ts"),
                originalUri: undefined,
                modifiedUri: undefined,
            }),
        );

        const tabs = adapter.getLayoutSnapshot().groups[0].tabs;
        expect(tabs.map((tab) => tab.kind)).toEqual(["text", "diff", "diff"]);
        expect(tabs[1].original).toBe("git:/a.ts");
        expect(tabs[1].modified).toBe(Uri.file(ws.path("a.ts")).toString());
        expect(tabs[2].original).toBeUndefined();
        expect(tabs[2].modified).toBeUndefined();
        expect(tabs[1].sideEditors).toEqual([]);
    });

    it("snapshot: sideEditors lists document uris of model sides, the snapshot side is excluded", () => {
        const shared = service.textFileModels.acquire(Uri.file(ws.path("a.ts")));
        const owned = service.textFileModels.createUntitledModel();
        service.openPane(
            new DiffEditorPane2(
                NULL_LANGUAGE_SERVICE,
                new UndoRedoService(),
                diskFileService(),
                new TokenizationRegistry(),
                NULL_TOKEN_STYLE_RESOLVER,
                {
                    uri: Uri.parse("diode-diff:/a.ts?pair"),
                    label: "pair",
                    originalLabel: "a.ts",
                    modifiedLabel: "Untitled",
                    original: { kind: "shared", ref: shared },
                    modified: { kind: "owned", model: owned },
                    languageId: "plaintext",
                },
            ),
        );
        service.openPane(
            new DiffEditorPane2(
                NULL_LANGUAGE_SERVICE,
                new UndoRedoService(),
                diskFileService(),
                new TokenizationRegistry(),
                NULL_TOKEN_STYLE_RESOLVER,
                {
                    uri: Uri.parse("diode-diff:/a.ts?half"),
                    label: "half",
                    originalLabel: "HEAD",
                    modifiedLabel: "a.ts",
                    original: { kind: "snapshot", text: "alpha" },
                    modified: { kind: "shared", ref: service.textFileModels.acquire(Uri.file(ws.path("a.ts"))) },
                    languageId: "plaintext",
                },
            ),
        );

        const [pair, half] = adapter.getLayoutSnapshot().groups[0].tabs;
        expect(pair.sideEditors).toEqual([Uri.file(ws.path("a.ts")).toString(), owned.uri.toString()]);
        expect(half.sideEditors).toEqual([Uri.file(ws.path("a.ts")).toString()]);
    });

    it("showTextDocument: Beside without enough room falls back to the active group", async () => {
        service.openFile(ws.path("a.ts"));
        service.editorGroups.canAddGroupHook = () => false;

        const result = await adapter.showTextDocument({
            uri: Uri.file(ws.path("b.ts")).toString(),
            viewColumn: -2,
        });
        expect(result.viewColumn).toBe(1);
        expect(service.editorGroups.groups.length).toBe(1);
        expect(service.editorGroups.activeGroup.editorCount).toBe(2);
    });

    it("showTextDocument: a ViewColumn past the edge without enough room opens in the last group", async () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup();
        service.editorGroups.canAddGroupHook = () => false;

        const result = await adapter.showTextDocument({
            uri: Uri.file(ws.path("b.ts")).toString(),
            viewColumn: 5,
        });
        expect(result.viewColumn).toBe(2);
        expect(service.editorGroups.groups.length).toBe(2);
    });
});
