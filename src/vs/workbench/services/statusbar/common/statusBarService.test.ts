import { describe, expect, it } from "vitest";

import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";

import { StatusBarService } from "./statusBarService.ts";

function texts(service: StatusBarService): string[] {
    return service.entries().map((entry) => entry.text);
}

describe("StatusBarService", () => {
    it("addEntry публикует запись и уведомляет подписчиков", () => {
        const service = new StatusBarService(NULL_STATE_SERVICE);
        let fired = 0;
        service.onDidChangeEntries(() => fired++);

        service.addEntry({ id: "a", text: "A", alignment: "left", priority: 0 });

        expect(fired).toBe(1);
        expect(texts(service)).toEqual(["A"]);
    });

    it("entries: сперва left, потом right; внутри стороны — по убыванию priority", () => {
        const service = new StatusBarService(NULL_STATE_SERVICE);
        service.addEntry({ id: "r-low", text: "R10", alignment: "right", priority: 10 });
        service.addEntry({ id: "l-low", text: "L10", alignment: "left", priority: 10 });
        service.addEntry({ id: "r-high", text: "R90", alignment: "right", priority: 90 });
        service.addEntry({ id: "l-high", text: "L90", alignment: "left", priority: 90 });

        expect(texts(service)).toEqual(["L90", "L10", "R90", "R10"]);
    });

    it("при равном priority порядок стабильный — по порядку добавления", () => {
        const service = new StatusBarService(NULL_STATE_SERVICE);
        service.addEntry({ id: "first", text: "first", alignment: "left", priority: 5 });
        service.addEntry({ id: "second", text: "second", alignment: "left", priority: 5 });

        expect(texts(service)).toEqual(["first", "second"]);
    });

    it("update ручки частично обновляет запись и уведомляет", () => {
        const service = new StatusBarService(NULL_STATE_SERVICE);
        const handle = service.addEntry({ id: "a", text: "before", alignment: "left", priority: 1 });
        let fired = 0;
        service.onDidChangeEntries(() => fired++);

        handle.update({ text: "after" });

        expect(fired).toBe(1);
        const [entry] = service.entries();
        expect(entry).toMatchObject({ id: "a", text: "after", alignment: "left", priority: 1 });
    });

    it("dispose ручки снимает запись; повторный dispose и update после — no-op", () => {
        const service = new StatusBarService(NULL_STATE_SERVICE);
        const handle = service.addEntry({ id: "a", text: "A", alignment: "left", priority: 1 });
        service.addEntry({ id: "b", text: "B", alignment: "left", priority: 0 });

        handle.dispose();
        expect(texts(service)).toEqual(["B"]);

        let fired = 0;
        service.onDidChangeEntries(() => fired++);
        handle.dispose();
        handle.update({ text: "ghost" });

        expect(fired).toBe(0);
        expect(texts(service)).toEqual(["B"]);
    });

    it("onClick сохраняется в записи и переживает update текста", () => {
        const service = new StatusBarService(NULL_STATE_SERVICE);
        const onClick = (): void => {};
        const handle = service.addEntry({ id: "a", text: "A", alignment: "right", priority: 1, onClick });

        handle.update({ text: "A2" });

        expect(service.entries()[0].onClick).toBe(onClick);
    });

    it("dispose подписки onDidChangeEntries снимает листенер", () => {
        const service = new StatusBarService(NULL_STATE_SERVICE);
        let fired = 0;
        const subscription = service.onDidChangeEntries(() => fired++);

        subscription.dispose();
        service.addEntry({ id: "a", text: "A", alignment: "left", priority: 0 });

        expect(fired).toBe(0);
    });
});
