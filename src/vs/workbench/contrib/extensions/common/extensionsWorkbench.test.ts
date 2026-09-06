import { describe, expect, it } from "vitest";

import { filterExtensionEntries, type IExtensionListEntry } from "./extensionsWorkbench.ts";
import { createNullExtensionsWorkbenchService } from "./nullExtensionsWorkbenchService.ts";

function entry(overrides: Partial<IExtensionListEntry> & { id: string }): IExtensionListEntry {
    const [publisher, name] = overrides.id.split(".");
    return {
        publisher: publisher!,
        name: name!,
        displayName: name!,
        description: "",
        kind: "native",
        latestVersion: "1.0.0",
        installedVersion: null,
        availability: "available",
        ...overrides,
    };
}

const ENTRIES = [
    entry({ id: "acme.tools", displayName: "Acme Tools", description: "Formatting helpers" }),
    entry({ id: "other.thing", displayName: "Other Thing", description: "Unrelated" }),
];

describe("filterExtensionEntries", () => {
    it("пустой запрос отдаёт весь список", () => {
        expect(filterExtensionEntries(ENTRIES, "")).toEqual(ENTRIES);
        expect(filterExtensionEntries(ENTRIES, "   ")).toEqual(ENTRIES);
    });

    it("ищет по id, displayName и описанию, без учёта регистра", () => {
        expect(filterExtensionEntries(ENTRIES, "ACME").map((e) => e.id)).toEqual(["acme.tools"]);
        expect(filterExtensionEntries(ENTRIES, "Other Thing").map((e) => e.id)).toEqual(["other.thing"]);
        expect(filterExtensionEntries(ENTRIES, "other.").map((e) => e.id)).toEqual(["other.thing"]);
        expect(filterExtensionEntries(ENTRIES, "formatting").map((e) => e.id)).toEqual(["acme.tools"]);
    });

    it("ничего не совпало — пустой список", () => {
        expect(filterExtensionEntries(ENTRIES, "zzz")).toEqual([]);
    });
});

describe("createNullExtensionsWorkbenchService", () => {
    it("инертен: пустой каталог, без ошибок и событий", async () => {
        const service = createNullExtensionsWorkbenchService();
        await service.ensureLoaded();
        await service.refresh();

        expect(service.getEntries()).toEqual([]);
        expect(service.getCatalogError()).toBeNull();
        // Именно промисы: вызывающий их ждёт, и «просто undefined» сломал бы и
        // `await`, и `finally` вокруг загрузки каталога.
        await expect(service.ensureLoaded()).resolves.toBeUndefined();
        await expect(service.refresh()).resolves.toBeUndefined();
        await expect(service.getMeta("acme.tools")).resolves.toBeUndefined();
        // Подписка законна и снимается — потребителю не нужно знать, что сервис пуст.
        expect(() => {
            service.onDidChange(() => {}).dispose();
        }).not.toThrow();
    });
});
