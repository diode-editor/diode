import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import { EditorPaneFactoriesDIToken } from "../../../services/editor/browser/editorPaneFactory.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { DIFF_EDITOR_PANE_TYPE_ID } from "./diffEditorPaneFactory.ts";
import { type IOpenDiffPairOptions, openDiffPair } from "./openDiffPair.ts";

describe("Diff tab factory", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-diff-factory-", files: { "a.txt": "one\n", "b.txt": "two\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const service = () => h.container.get(EditorServiceDIToken);
    const factory = () => {
        const found = h.container.get(EditorPaneFactoriesDIToken).find((f) => f.typeId === DIFF_EDITOR_PANE_TYPE_ID);
        if (found === undefined) throw new Error("the diff factory is missing from the profile list");
        return found;
    };
    const files = (): IOpenDiffPairOptions => ({
        original: { uri: Uri.file(ws.path("a.txt")), label: "a.txt", identity: "a", preferDisk: true },
        modified: { uri: Uri.file(ws.path("b.txt")), label: "b.txt", identity: "b", onMissing: "empty" },
        title: "a ↔ b",
    });

    async function openFilesDiff(): Promise<DiffEditorPane2> {
        await openDiffPair(h.container, files());
        return service().getActiveTabPane() as DiffEditorPane2;
    }

    it("a split repeats a file diff in a new group, sides on the same documents", async () => {
        const source = await openFilesDiff();

        const group = service().splitActiveGroup();
        await vi.waitFor(() => {
            expect(group?.editorCount).toBe(1);
        });

        const copy = group!.activePane as DiffEditorPane2;
        expect(copy).not.toBe(source);
        expect(copy.uri.toString()).toBe(source.uri.toString());
        expect(copy.label).toBe("a ↔ b");
        // The modified side is the file's live shared model; original is a snapshot from disk.
        expect(copy.sidePanes()[1].model).toBe(source.sidePanes()[1].model);
    });

    it("a copy to the neighbor group: the diff is there, the source stays", async () => {
        await openFilesDiff();

        service().copyActiveEditorToGroup("next");
        await vi.waitFor(() => {
            expect(service().editorGroups.groups.at(1)?.editorCount).toBe(1);
        });

        expect(service().editorGroups.groups[0].editorCount).toBe(1);
        expect(service().editorGroups.groups[1].activePane instanceof DiffEditorPane2).toBe(true);
    });

    it("repeating into a group looks for the tab only there: a diff in the neighbor group does not interfere", async () => {
        const source = await openFilesDiff();
        const right = service().editorGroups.newGroup("after", { focus: false })!;

        await openDiffPair(h.container, files(), { group: right, focus: false });

        expect(right.editorCount).toBe(1);
        expect(right.activePane).not.toBe(source);
        expect(service().editorGroups.groups[0].activePane).toBe(source);
    });

    it("repeating into a group where the diff is already open activates it without focus", async () => {
        const source = await openFilesDiff();
        service().openFile(ws.path("a.txt"));

        await openDiffPair(h.container, files(), { group: service().editorGroups.activeGroup, focus: false });

        expect(service().editorGroups.activeGroup.editorCount).toBe(2);
        expect(service().editorGroups.activeGroup.activePane).toBe(source);
        // Focus was in the a.txt tab, which left the tree; it was not put into the diff.
        expect(h.testApp.focusedElement).toBeNull();
    });

    it("repeating into a group refreshes the snapshot of the diff already open there", async () => {
        const clip = (text: string): IOpenDiffPairOptions => ({
            ...files(),
            original: { text, label: "Clipboard", identity: "clip" },
        });
        await openDiffPair(h.container, clip("old"));
        const pane = service().getActiveTabPane() as DiffEditorPane2;
        const right = service().editorGroups.newGroup("after", { focus: false })!;

        await openDiffPair(h.container, clip("new"), { group: service().editorGroups.groups[0], focus: false });

        // Same tab, fresh text; the active group did not change.
        expect(service().editorGroups.groups[0].editorCount).toBe(1);
        expect(pane.sidePanes()[0].getText()).toBe("new");
        expect(service().editorGroups.activeGroup).toBe(right);
    });

    it("the compare command finds the diff in another group and makes that group active", async () => {
        const source = await openFilesDiff();
        service().editorGroups.newGroup("after");
        service().openFile(ws.path("a.txt"));
        const focusedBefore = h.testApp.focusedElement;

        await openDiffPair(h.container, files());

        expect(service().editorGroups.groups.length).toBe(2);
        expect(service().editorGroups.activeGroup).toBe(service().editorGroups.groups[0]);
        expect(service().getActiveTabPane()).toBe(source);
        // Focus moved into the diff: the compare command shows it, not just activates it.
        expect(h.testApp.focusedElement).not.toBeNull();
        expect(h.testApp.focusedElement).not.toBe(focusedBefore);
    });

    it("a diff with a model side on the left cannot be repeated", async () => {
        const owned = service().textFileModels.createUntitledModel();
        await openDiffPair(h.container, {
            original: { ownedModel: owned, label: "Untitled", identity: "u" },
            modified: { uri: Uri.file(ws.path("a.txt")), label: "a.txt", identity: "a" },
        });
        const pane = service().getActiveTabPane() as DiffEditorPane2;

        expect(factory().describe(pane)).toBeUndefined();
    });

    it("a diff with a model side on the right cannot be repeated", async () => {
        const owned = service().textFileModels.createUntitledModel();
        await openDiffPair(h.container, {
            original: { uri: Uri.file(ws.path("a.txt")), label: "a.txt", identity: "a" },
            modified: { ownedModel: owned, label: "Untitled", identity: "u" },
        });
        const pane = service().getActiveTabPane() as DiffEditorPane2;

        expect(factory().describe(pane)).toBeUndefined();
    });

    it("an untitled pair cannot be repeated: its sides belong to one pane", async () => {
        h.commands.execute("workbench.files.action.compareNewUntitledTextFiles");
        await vi.waitFor(() => {
            expect(service().getActiveTabPane() instanceof DiffEditorPane2).toBe(true);
        });

        const group = service().splitActiveGroup();

        expect(group?.editorCount).toBe(0);
    });

    it("a file recipe survives a round trip through the session string", async () => {
        const pane = await openFilesDiff();
        const recipe = factory().describe(pane);

        const value = factory().serialize(recipe);

        expect(value).toBeDefined();
        expect(factory().deserialize(value!)).toEqual(files());
    });

    it("clipboard and git: sides do not go into the session", () => {
        const clipboard: IOpenDiffPairOptions = {
            ...files(),
            original: { text: "clip", label: "Clipboard", identity: "c" },
        };
        const git: IOpenDiffPairOptions = {
            ...files(),
            modified: { uri: Uri.from({ scheme: "git", path: "/b.txt", query: "HEAD" }), label: "HEAD", identity: "g" },
        };

        expect(factory().serialize(clipboard)).toBeUndefined();
        expect(factory().serialize(git)).toBeUndefined();
        // The resource is file:, but the side's content is not it: text or its own model.
        const fileUri = Uri.file(ws.path("a.txt"));
        expect(
            factory().serialize({ ...files(), original: { uri: fileUri, text: "x", label: "a", identity: "t" } }),
        ).toBeUndefined();
        const owned = service().textFileModels.createUntitledModel();
        expect(
            factory().serialize({
                ...files(),
                modified: { uri: fileUri, ownedModel: owned, label: "a", identity: "o" },
            }),
        ).toBeUndefined();
    });

    it("a foreign or broken session string is undefined, not an exception", () => {
        const side = { uri: "file:///a", label: "a", identity: "a" };
        for (const value of [
            JSON.stringify({ original: null, modified: side }),
            "{not json",
            "null",
            "42",
            JSON.stringify({ original: side }),
            JSON.stringify({ original: side, modified: null }),
            JSON.stringify({ original: side, modified: { uri: "file:///b", label: 1, identity: "b" } }),
            JSON.stringify({ original: side, modified: { uri: 1, label: "b", identity: "b" } }),
            JSON.stringify({ original: side, modified: { uri: "file:///b", label: "b" } }),
        ]) {
            expect(factory().deserialize(value)).toBeUndefined();
        }
    });

    it("optional side fields are read only for their own kind", () => {
        const value = JSON.stringify({
            original: { uri: "file:///a", label: "a", identity: "a", preferDisk: "yes", onMissing: "maybe" },
            modified: { uri: "file:///b", label: "b", identity: "b", preferDisk: false, onMissing: "error" },
            title: 7,
        });

        expect(factory().deserialize(value)).toEqual({
            original: { uri: Uri.parse("file:///a"), label: "a", identity: "a" },
            modified: { uri: Uri.parse("file:///b"), label: "b", identity: "b", preferDisk: false, onMissing: "error" },
        });
    });
});
