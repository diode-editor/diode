import { describe, expect, it } from "vitest";

import { Uri } from "../../base/common/uri.ts";
import { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";

import { RESOURCE_CONTEXT_KEYS, ResourceContextKeys } from "./resourceContextKeys.ts";

function setup(editor: { uri: Uri; languageId: string } | null): {
    keys: ContextKeyService;
    update: (editorAreaFocus: boolean) => void;
} {
    const keys = new ContextKeyService();
    const editors = { getActiveEditor: () => editor } as unknown as IEditorService;
    const contributor = new ResourceContextKeys(editors);
    return {
        keys,
        update: (editorAreaFocus) => {
            keys.set("editorAreaFocus", editorAreaFocus);
            contributor.updateContextKeys(keys);
        },
    };
}

describe("ResourceContextKeys", () => {
    it("with the focus in the editor area the keys describe the active editor's resource, as upstream", () => {
        const uri = Uri.file("/w/src/shape.h");
        const { keys, update } = setup({ uri, languageId: "cpp" });

        update(true);

        expect(keys.get("resource")).toBe(uri.toString());
        expect(keys.get("resourceScheme")).toBe("file");
        expect(keys.get("resourceFilename")).toBe("shape.h");
        expect(keys.get("resourceDirname")).toBe(Uri.file("/w/src").fsPath);
        expect(keys.get("resourcePath")).toBe(uri.fsPath);
        expect(keys.get("resourceLangId")).toBe("cpp");
        expect(keys.get("resourceExtname")).toBe(".h");
        expect(keys.get("resourceSet")).toBe(true);
        expect(keys.evaluate("resourceLangId == cpp && resourceExtname == .h")).toBe(true);
    });

    it("a resource outside the file system has its path, not an fs path", () => {
        const { keys, update } = setup({ uri: Uri.parse("git:/w/src/shape.h?ref"), languageId: "cpp" });

        update(true);

        expect(keys.get("resourceScheme")).toBe("git");
        expect(keys.get("resourcePath")).toBe("/w/src/shape.h");
        expect(keys.get("resourceDirname")).toBe("/w/src");
    });

    it("a file path is the fs path, not the uri path: a drive letter loses its leading slash", () => {
        const uri = Uri.file("C:/w/src/shape.h");
        const { keys, update } = setup({ uri, languageId: "cpp" });

        update(true);

        expect(uri.path).toBe("/C:/w/src/shape.h");
        expect(keys.get("resourcePath")).toBe(uri.fsPath);
        expect(keys.get("resourceDirname")).toBe(Uri.file("C:/w/src").fsPath);
    });

    it("the focus leaving the editor area unsets the keys: a sidebar menu does not see the editor's file", () => {
        const { keys, update } = setup({ uri: Uri.file("/w/a.cpp"), languageId: "cpp" });
        update(true);

        update(false);

        for (const key of RESOURCE_CONTEXT_KEYS) {
            expect(keys.get(key), key).toBeUndefined();
        }
        expect(keys.evaluate("resourceLangId == cpp")).toBe(false);
    });

    it("an empty editor area has no resource", () => {
        const { keys, update } = setup(null);

        update(true);

        expect(keys.get("resourceSet")).toBeUndefined();
        expect(keys.get("resourceLangId")).toBeUndefined();
    });
});
