import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeHistoryEditorSource } from "../../../../../TestUtils/HistoryEditorSourceFake.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";

import { HistoryService } from "./historyService.ts";

describe("HistoryService — шов прыжка", () => {
    let ws: ITempWorkspace;
    let source: FakeHistoryEditorSource;
    let service: HistoryService;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-history-jump-",
            files: { "alpha.ts": "alpha\n", "beta.ts": "beta\n" },
        });
        source = new FakeHistoryEditorSource();
        service = new HistoryService(source);
    });

    afterEach(() => {
        ws.dispose();
    });

    const uri = (name: string): string => Uri.file(ws.path(name)).toString();
    const alpha = (): string => uri("alpha.ts");
    const beta = (): string => uri("beta.ts");

    it("кросс-файловый прыжок кладёт ровно две записи — origin и цель", () => {
        source.open(alpha());
        source.moveCaret(20);

        service.jump(() => {
            // Как это делает сайт навигации: сначала ресурс, потом позиция.
            source.open(beta());
            source.moveCaret(50);
        });

        const entries = service.getEntries();
        expect(entries).toMatchObject([{ line: 0 }, { line: 20 }, { line: 50 }]);
        // Промежуточной записи «начало beta» нет — иначе первый Back вёл бы туда.
        expect(entries[2].uri.toString()).toBe(beta());
        expect(service.currentIndex).toBe(2);

        service.goBack();
        expect(source.caret()).toMatchObject({ uri: alpha(), line: 20 });
    });

    it("намеренный прыжок ближе порога значимости всё равно попадает в стек", () => {
        source.open(alpha());

        service.jump(() => {
            source.moveCaret(3);
        });

        expect(service.getEntries()).toMatchObject([{ line: 0 }, { line: 3 }]);
    });

    it("прыжок без активного редактора не падает и ничего не пишет", () => {
        service.jump(() => undefined);

        expect(service.getEntries()).toEqual([]);
    });

    it("возвращает результат перехода", () => {
        source.open(alpha());

        expect(service.jump(() => "done")).toBe("done");
    });

    it("исключение внутри перехода не оставляет историю заглушенной", () => {
        source.open(alpha());

        expect(() =>
            service.jump(() => {
                throw new Error("переход сорвался");
            }),
        ).toThrow("переход сорвался");

        source.moveCaret(40);
        expect(service.getEntries()).toMatchObject([{ line: 0 }, { line: 40 }]);
    });
});
