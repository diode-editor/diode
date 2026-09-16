import { describe, expect, it } from "vitest";

import { InMemoryClipboardMetadataManager } from "./clipboardMetadata.ts";

describe("InMemoryClipboardMetadataManager", () => {
    it("отдаёт метаданные только при точном совпадении с последней записью", () => {
        const manager = new InMemoryClipboardMetadataManager();
        manager.set("line\n", { isFromEmptySelection: true });

        expect(manager.get("line\n")).toEqual({ isFromEmptySelection: true });
        // Буфер сменился снаружи — метаданные молча устаревают, иначе чужой
        // текст вставлялся бы «линейно» по памяти о прошлом копировании.
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
