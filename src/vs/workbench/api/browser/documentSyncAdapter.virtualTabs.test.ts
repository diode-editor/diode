import { describe, expect, it, vi } from "vitest";

import { Emitter } from "../../../base/common/event.ts";
import { Uri } from "../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import { SyntheticTextModel } from "../../common/editor/syntheticTextModel.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import type { IDocumentSyncTarget } from "../common/iDocumentSyncTarget.ts";

import { bindDocumentSync } from "./documentSyncAdapter.ts";

function model(uri: string): SyntheticTextModel {
    return new SyntheticTextModel(NULL_LANGUAGE_SERVICE, new UndoRedoService(), Uri.parse(uri), "plaintext");
}

describe("bindDocumentSync: each tab of a virtual document has its own model", () => {
    it("the document closes with its last model, not with the first", () => {
        const first = model("foo:/a");
        const second = model("foo:/a");
        const other = model("foo:/b");
        let surfaces = [first, second, other];
        const editorsChanged = new Emitter<void>();
        const group = {
            getTextSurfaces: () => surfaces.map((m) => ({ model: m })),
            getUntitledModelsWithoutEditor: () => [],
            getFileModelsWithoutEditor: () => [],
            onDidChangeEditors: editorsChanged.event,
        } as unknown as IEditorService;
        const groups = { onDidGroupsChange: () => ({ dispose: () => undefined }) } as unknown as IEditorGroupsService;
        const didClose = vi.fn();
        const host: IDocumentSyncTarget = {
            didOpenTextDocument: () => undefined,
            didChangeTextDocument: () => undefined,
            didChangeTextDocumentContent: () => undefined,
            didCloseTextDocument: didClose,
            didChangeTextDocumentState: () => undefined,
        };
        bindDocumentSync(group, groups, host);

        surfaces = [second, other];
        editorsChanged.fire();
        expect(didClose).not.toHaveBeenCalled();

        surfaces = [other];
        editorsChanged.fire();
        expect(didClose.mock.calls).toEqual([["foo:/a"]]);

        surfaces = [];
        editorsChanged.fire();
        expect(didClose.mock.calls).toEqual([["foo:/a"], ["foo:/b"]]);
    });
});
