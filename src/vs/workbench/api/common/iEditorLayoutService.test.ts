import { describe, expect, it } from "vitest";

import { NULL_EDITOR_LAYOUT_SERVICE } from "./iEditorLayoutService.ts";

describe("NULL_EDITOR_LAYOUT_SERVICE", () => {
    it("knows no languages and refuses a language change", () => {
        expect(NULL_EDITOR_LAYOUT_SERVICE.getLanguages()).toEqual([]);
        expect(NULL_EDITOR_LAYOUT_SERVICE.getLanguageOfDocument("file:///a")).toBeNull();
        expect(() =>
            NULL_EDITOR_LAYOUT_SERVICE.changeDocumentLanguage({ uri: "file:///a", languageId: "json" }),
        ).toThrow("editor layout unavailable");
    });

    it("opens no document: null, like a file the editor does not have", async () => {
        await expect(NULL_EDITOR_LAYOUT_SERVICE.openTextDocument({ uri: "file:///a" })).resolves.toBeNull();
    });
});
