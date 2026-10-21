import { describe, expect, it } from "vitest";

import { InMemoryClipboardMetadataManager } from "./clipboardMetadata.ts";

describe("InMemoryClipboardMetadataManager", () => {
    it("отдаёт метаданные только при точном совпадении с последней записью", () => {
        const manager = new InMemoryClipboardMetadataManager();
        manager.set("line\n", { isFromEmptySelection: true });

        expect(manager.get("line\n")).toEqual({ isFromEmptySelection: true });
        // The clipboard changed externally: the metadata silently goes stale, otherwise foreign
        // text would be pasted "as a line" based on the previous copy.
        expect(manager.get("other")).toBeNull();
    });

    it("до первой записи метаданных нет", () => {
        expect(new InMemoryClipboardMetadataManager().get("anything")).toBeNull();
    });

    it("новая запись замещает прежнюю", () => {
        const manager = new InMemoryClipboardMetadataManager();
        manager.set("a", { isFromEmptySelection: true });
        manager.set("b", { isFromEmptySelection: false });
        expect(manager.get("a")).toBeNull();
        expect(manager.get("b")).toEqual({ isFromEmptySelection: false });
    });
});
