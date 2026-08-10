import { describe, expect, it } from "vitest";

import {
    TabInputCustom,
    TabInputNotebook,
    TabInputNotebookDiff,
    TabInputTerminal,
    TabInputText,
    TabInputTextDiff,
    TabInputWebview,
    Uri,
} from "./vscodeTypes.ts";

// Все семь видов TabInput* обязаны существовать как runtime-классы: расширения
// перебирают вкладки instanceof-каскадом, и отсутствующий класс — это TypeError,
// а не false (см. комментарий в vscodeTypes.ts).
describe("VscodeTypes — TabInput* (window.tabGroups)", () => {
    const a = Uri.file("/p/a.ts");
    const b = Uri.file("/p/b.ts");

    it("TabInputText несёт uri", () => {
        const input = new TabInputText(a);
        expect(input.uri === a).toBe(true);
    });

    it("TabInputTextDiff несёт original/modified", () => {
        const input = new TabInputTextDiff(a, b);
        expect(input.original === a).toBe(true);
        expect(input.modified === b).toBe(true);
    });

    it("TabInputCustom несёт uri и viewType", () => {
        const input = new TabInputCustom(a, "imagePreview.previewEditor");
        expect(input.uri === a).toBe(true);
        expect(input.viewType).toBe("imagePreview.previewEditor");
    });

    it("TabInputWebview несёт viewType", () => {
        const input = new TabInputWebview("markdown.preview");
        expect(input.viewType).toBe("markdown.preview");
    });

    it("TabInputNotebook несёт uri и notebookType", () => {
        const input = new TabInputNotebook(a, "jupyter-notebook");
        expect(input.uri === a).toBe(true);
        expect(input.notebookType).toBe("jupyter-notebook");
    });

    it("TabInputNotebookDiff несёт original/modified/notebookType", () => {
        const input = new TabInputNotebookDiff(a, b, "jupyter-notebook");
        expect(input.original === a).toBe(true);
        expect(input.modified === b).toBe(true);
        expect(input.notebookType).toBe("jupyter-notebook");
    });

    it("TabInputTerminal конструируется без полей", () => {
        const input = new TabInputTerminal();
        expect(input instanceof TabInputTerminal).toBe(true);
    });

    it("instanceof-каскад по чужому виду даёт false, а не TypeError", () => {
        const input: unknown = new TabInputText(a);
        expect(input instanceof TabInputTextDiff).toBe(false);
        expect(input instanceof TabInputCustom).toBe(false);
        expect(input instanceof TabInputWebview).toBe(false);
        expect(input instanceof TabInputNotebook).toBe(false);
        expect(input instanceof TabInputNotebookDiff).toBe(false);
        expect(input instanceof TabInputTerminal).toBe(false);
    });
});
