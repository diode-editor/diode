import { describe, expect, it } from "vitest";

import { DocumentDropOrPasteEditKind } from "./vscodeTypes.ts";

const kind = (value: string) => DocumentDropOrPasteEditKind.Empty.append(...value.split("."));

/** Upstream's `extHostTypes.DocumentDropOrPasteEditKind`: the kind is a dot-separated scope path. */
describe("DocumentDropOrPasteEditKind", () => {
    it("[api:DocumentDropOrPasteEditKind.Empty] [api:DocumentDropOrPasteEditKind.value] the empty root has an empty value", () => {
        expect(DocumentDropOrPasteEditKind.Empty.value).toBe("");
    });

    it("[api:DocumentDropOrPasteEditKind.Text] [api:DocumentDropOrPasteEditKind.TextUpdateImports] the text roots", () => {
        expect(DocumentDropOrPasteEditKind.Text.value).toBe("text");
        expect(DocumentDropOrPasteEditKind.TextUpdateImports.value).toBe("text.updateImports");
    });

    it("[api:DocumentDropOrPasteEditKind.append] appends every part with a dot and does not modify the kind", () => {
        // The call jbang makes at module load: activation failed while the class was missing.
        expect(DocumentDropOrPasteEditKind.Empty.append("jbang", "dependency").value).toBe("jbang.dependency");
        expect(DocumentDropOrPasteEditKind.Text.append("plain", "list").value).toBe("text.plain.list");
        expect(DocumentDropOrPasteEditKind.Empty.value).toBe("");
        expect(DocumentDropOrPasteEditKind.Text.value).toBe("text");
    });

    it("[api:DocumentDropOrPasteEditKind.contains] contains itself and its sub-kinds, not parents or prefixes", () => {
        const plain = kind("text.plain");

        expect(plain.contains(kind("text.plain"))).toBe(true);
        expect(plain.contains(kind("text.plain.list"))).toBe(true);
        expect(plain.contains(kind("text"))).toBe(false);
        expect(plain.contains(kind("unicorn.text.plain"))).toBe(false);
        expect(plain.contains(kind("text.plainer"))).toBe(false);
        expect(DocumentDropOrPasteEditKind.Empty.contains(kind("text"))).toBe(false);
    });

    it("[api:DocumentDropOrPasteEditKind.intersects] intersects parents and sub-kinds, not siblings", () => {
        const plain = kind("text.plain");

        expect(plain.intersects(kind("text"))).toBe(true);
        expect(plain.intersects(kind("text.plain"))).toBe(true);
        expect(plain.intersects(kind("text.plain.list"))).toBe(true);
        expect(plain.intersects(kind("unicorn"))).toBe(false);
        expect(plain.intersects(kind("textUnicorn.plain"))).toBe(false);
    });
});
