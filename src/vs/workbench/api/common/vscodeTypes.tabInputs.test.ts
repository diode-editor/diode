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

describe("VscodeTypes — TabInput* (window.tabGroups)", () => {
    const a = Uri.file("/p/a.ts");
    const b = Uri.file("/p/b.ts");

    it("TabInputText carries uri", () => {
        const input = new TabInputText(a);
        expect(input.uri === a).toBe(true);
    });

    it("TabInputTextDiff carries original/modified", () => {
        const input = new TabInputTextDiff(a, b);
        expect(input.original === a).toBe(true);
        expect(input.modified === b).toBe(true);
    });

    it("TabInputCustom carries uri and viewType", () => {
        const input = new TabInputCustom(a, "imagePreview.previewEditor");
        expect(input.uri === a).toBe(true);
        expect(input.viewType).toBe("imagePreview.previewEditor");
    });

    it("TabInputWebview carries viewType", () => {
        const input = new TabInputWebview("markdown.preview");
        expect(input.viewType).toBe("markdown.preview");
    });

    it("TabInputNotebook carries uri and notebookType", () => {
        const input = new TabInputNotebook(a, "jupyter-notebook");
        expect(input.uri === a).toBe(true);
        expect(input.notebookType).toBe("jupyter-notebook");
    });

    it("TabInputNotebookDiff carries original/modified/notebookType", () => {
        const input = new TabInputNotebookDiff(a, b, "jupyter-notebook");
        expect(input.original === a).toBe(true);
        expect(input.modified === b).toBe(true);
        expect(input.notebookType).toBe("jupyter-notebook");
    });

    it("TabInputTerminal is constructed without fields", () => {
        const input = new TabInputTerminal();
        expect(input instanceof TabInputTerminal).toBe(true);
    });

    it("an instanceof cascade on a foreign kind gives false, not TypeError", () => {
        const input: unknown = new TabInputText(a);
        expect(input instanceof TabInputTextDiff).toBe(false);
        expect(input instanceof TabInputCustom).toBe(false);
        expect(input instanceof TabInputWebview).toBe(false);
        expect(input instanceof TabInputNotebook).toBe(false);
        expect(input instanceof TabInputNotebookDiff).toBe(false);
        expect(input instanceof TabInputTerminal).toBe(false);
    });
});
