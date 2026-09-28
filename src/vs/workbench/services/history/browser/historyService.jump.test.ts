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

    it("jumpAsync: точка назначения снимается ПОСЛЕ асинхронного открытия", async () => {
        source.open(alpha());
        source.moveCaret(20);
        source.providedSchemes.add("jdt");
        const target = "jdt://contents/lib.jar/pkg/Foo.java";

        await service.jumpAsync(async () => {
            // Так ведёт себя открытие недискового ресурса: содержимое приезжает
            // от провайдера через тик, и только потом можно двигать каретку.
            await Promise.resolve();
            source.open(target);
            source.moveCaret(50);
        });

        const entries = service.getEntries();
        expect(entries).toMatchObject([{ line: 0 }, { line: 20 }, { line: 50 }]);
        expect(entries[2].uri.toString()).toBe(target);
        service.goBack();
        expect(source.caret()).toMatchObject({ uri: alpha(), line: 20 });
    });

    it("jumpAsync: промежуточные перемещения внутри перехода в стек не попадают", async () => {
        source.open(alpha());

        await service.jumpAsync(async () => {
            source.moveCaret(5);
            await Promise.resolve();
            source.moveCaret(50);
        });

        // Ни 5, ни 0 целевого файла — только origin и итоговая позиция.
        expect(service.getEntries()).toMatchObject([{ line: 0 }, { line: 50 }]);
    });

    it("jumpAsync: отказ перехода не оставляет историю заглушенной", async () => {
        source.open(alpha());

        await expect(
            service.jumpAsync(async () => {
                await Promise.resolve();
                throw new Error("переход сорвался");
            }),
        ).rejects.toThrow("переход сорвался");

        source.moveCaret(40);
        expect(service.getEntries()).toMatchObject([{ line: 0 }, { line: 40 }]);
    });

    it("недисковый ресурс без провайдера схемы в стек не пишется", () => {
        source.open(alpha());

        service.jump(() => {
            source.open("output:extensions");
            source.moveCaret(50);
        });

        // Вернуться в Output через openUri нельзя — его содержимое пишет
        // владелец панели, а не ресурс; записи о нём быть не должно.
        expect(service.getEntries().map((e) => e.uri.scheme)).toEqual(["file"]);
    });
});
