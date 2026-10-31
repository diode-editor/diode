import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";

import { SyntheticTextModel } from "./syntheticTextModel.ts";

describe("SyntheticTextModel.replaceContent", () => {
    it("leaves the document clean, also for a listener of the content event", () => {
        const model = new SyntheticTextModel(
            NULL_LANGUAGE_SERVICE,
            new UndoRedoService(),
            Uri.parse("foo:/a"),
            "plaintext",
        );
        const seen: boolean[] = [];
        model.document.onDidChangeModelContent(() => seen.push(model.isModified));

        model.replaceContent("second");

        expect(model.document.getText()).toBe("second");
        expect(seen).toEqual([false]);
        expect(model.isModified).toBe(false);
    });
});
