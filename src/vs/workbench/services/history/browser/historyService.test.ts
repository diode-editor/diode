import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeHistoryEditorSource } from "../../../../../TestUtils/HistoryEditorSourceFake.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";

import { HistoryService } from "./historyService.ts";

describe("HistoryService — стек навигации", () => {
    let ws: ITempWorkspace;
    let source: FakeHistoryEditorSource;

    // Записи чистятся по факту существования файла, поэтому ресурсы — настоящие.
    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-history-",
            files: { "alpha.ts": "alpha\n", "beta.ts": "beta\n" },
        });
        source = new FakeHistoryEditorSource();
    });

    afterEach(() => {
        ws.dispose();
    });

    const uri = (name: string): string => Uri.file(ws.path(name)).toString();
    const alpha = (): string => uri("alpha.ts");
    const beta = (): string => uri("beta.ts");

    /** Сервис создаётся после сида — чтобы проверять и подхват активного редактора. */
    const createService = (): HistoryService => new HistoryService(source);

    it("пустой стек: идти некуда, goBack/goForward — no-op", () => {
        const service = createService();

        expect(service.canGoBack).toBe(false);
        expect(service.canGoForward).toBe(false);
        service.goBack();
        service.goForward();

        expect(service.getEntries()).toEqual([]);
        expect(service.currentIndex).toBe(-1);
    });

    it("подхватывает редактор, ставший активным до создания сервиса", () => {
        source.open(alpha());
        source.moveCaret(7);

        const service = createService();

        expect(service.getEntries()).toMatchObject([{ line: 7 }]);
    });

    it("кросс-файловый переход пушит запись, Back возвращает файл и позицию", () => {
        const service = createService();
        source.open(alpha());
        source.moveCaret(40);
        source.open(beta());

        expect(service.canGoBack).toBe(true);
        service.goBack();

        expect(source.caret()).toEqual({ uri: alpha(), line: 40, character: 0 });
        expect(service.currentIndex).toBe(1);
    });

    it("движение ближе порога значимости обновляет запись, а не растит стек", () => {
        const service = createService();
        source.open(alpha());
        source.moveCaret(5);
        source.moveCaret(9);

        expect(service.getEntries()).toMatchObject([{ line: 9 }]);
    });

    it("движение от порога и дальше заводит новую запись", () => {
        const service = createService();
        source.open(alpha());
        source.moveCaret(10);

        expect(service.getEntries()).toMatchObject([{ line: 0 }, { line: 10 }]);
    });

    it("Back → Forward возвращает в точку, откуда ушли", () => {
        const service = createService();
        source.open(alpha());
        source.moveCaret(40);
        source.open(beta());
        source.moveCaret(5);

        service.goBack();
        expect(source.caret()).toMatchObject({ uri: alpha(), line: 40 });

        expect(service.canGoForward).toBe(true);
        service.goForward();

        expect(source.caret()).toMatchObject({ uri: beta(), line: 5 });
    });

    it("мелкое движение после Back не съедает forward-хвост, значимое — отсекает", () => {
        const service = createService();
        source.open(alpha());
        source.moveCaret(40);
        source.open(beta());
        service.goBack();

        source.moveCaret(43);
        expect(service.canGoForward).toBe(true);

        source.moveCaret(80);
        expect(service.canGoForward).toBe(false);
        // Хвост (запись beta) отсечён и заменён новой записью alpha.
        expect(service.getEntries()).toMatchObject([{ line: 0 }, { line: 43 }, { line: 80 }]);
        expect(service.getEntries()[2].uri.toString()).toBe(alpha());
    });

    it("кап стека: старейшие записи выпадают, указатель остаётся на последней", () => {
        const service = createService();
        source.open(alpha());
        for (let i = 1; i <= 60; i++) source.moveCaret(i * 20);

        const entries = service.getEntries();
        expect(entries).toHaveLength(50);
        // Всего было 61 запись (стартовая + 60 прыжков), выпали первые 11.
        expect(entries[0]).toMatchObject({ line: 220 });
        expect(entries[49]).toMatchObject({ line: 1200 });
        expect(service.currentIndex).toBe(49);
    });

    it("восстановление позиции не пишется в стек само по себе", () => {
        const service = createService();
        source.open(alpha());
        source.moveCaret(40);
        source.open(beta());

        service.goBack();

        // openUri и goToPosition внутри Back шлют те же события, что и пользователь;
        // без гашения они завели бы новую запись и убили forward-хвост.
        expect(service.getEntries()).toHaveLength(3);
        expect(service.currentIndex).toBe(1);
        expect(service.canGoForward).toBe(true);
    });

    it("позиция за границей документа переписывается фактической", () => {
        const service = createService();
        source.open(beta());
        source.moveCaret(100);
        source.open(alpha());

        // Файл «сократился»: вкладку закрыли, а при переоткрытии в нём 5 строк.
        source.lineCounts.set(beta(), 5);
        source.close(beta());
        service.goBack();

        expect(source.caret()).toMatchObject({ uri: beta(), line: 4 });
        expect(service.getEntries()[service.currentIndex]).toMatchObject({ line: 4 });
    });

    it("невосстановимые схемы в стек не попадают", () => {
        const service = createService();
        source.open(alpha());
        source.open("output:extensions");

        expect(service.getEntries()).toMatchObject([{ line: 0 }]);
        expect(service.getEntries()[0].uri.toString()).toBe(alpha());
    });

    it("после dispose подписки сняты", () => {
        const service = createService();
        source.open(alpha());
        service.dispose();

        source.open(beta());
        source.moveCaret(40);

        expect(service.getEntries()).toHaveLength(1);
    });
});
