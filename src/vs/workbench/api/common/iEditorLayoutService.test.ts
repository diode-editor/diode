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
});
