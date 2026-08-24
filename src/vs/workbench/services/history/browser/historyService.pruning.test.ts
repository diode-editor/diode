import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeHistoryEditorSource } from "../../../../../TestUtils/HistoryEditorSourceFake.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";

import { HistoryService } from "./historyService.ts";

const UNTITLED = "untitled:Untitled-1";

describe("HistoryService — чистка стека и группы", () => {
    let ws: ITempWorkspace;
    let source: FakeHistoryEditorSource;
    let service: HistoryService;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-history-prune-",
            files: { "alpha.ts": "alpha\n", "beta.ts": "beta\n", "gamma.ts": "gamma\n" },
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
    const gamma = (): string => uri("gamma.ts");

    it("удалённый с диска файл выпадает — Back проскакивает к живой записи", () => {
        source.open(gamma());
        source.open(alpha());
        source.open(beta());

        fs.rmSync(ws.path("alpha.ts"));
        service.goBack();

        expect(source.caret()).toMatchObject({ uri: gamma() });
        expect(service.getEntries()).toHaveLength(2);
        expect(service.canGoBack).toBe(false);
    });

    it("выпавшая запись впереди указателя не сдвигает его", () => {
        source.open(alpha());
        source.open(beta());
        source.open(gamma());
        service.goBack();
        service.goBack();

        fs.rmSync(ws.path("gamma.ts"));
        service.goBack();

        expect(service.getEntries()).toHaveLength(2);
        expect(service.currentIndex).toBe(0);
        expect(service.canGoForward).toBe(true);
    });

    it("выпавшая запись под указателем уводит указатель НАЗАД, а не вперёд", () => {
        source.open(alpha());
        source.open(beta());
        source.open(gamma());
        service.goBack(); // указатель на beta

        fs.rmSync(ws.path("beta.ts"));
        service.goForward();

        // beta выпала из-под указателя, значит он встаёт на alpha — и Forward
        // уводит на gamma. Уехал бы указатель вперёд, Forward упёрся бы в конец
        // стека и каретка осталась бы на beta.
        expect(source.caret()).toMatchObject({ uri: gamma() });
        expect(service.getEntries()).toHaveLength(2);
    });

    it("выпавшая запись позади указателя его позицию не меняет", () => {
        source.open(alpha());
        source.open(beta());
        source.open(gamma());
        service.goBack(); // указатель на beta

        fs.rmSync(ws.path("gamma.ts"));
        service.goBack();

        // gamma выпала за указателем, на его позицию это влиять не должно —
        // Back с beta уводит на alpha. Проверка выше про то же берёт указатель в
        // нуле, где Math.max зажимает любой лишний декремент; здесь он в единице,
        // и лишний декремент виден.
        expect(source.caret()).toMatchObject({ uri: alpha() });
        expect(service.currentIndex).toBe(0);
    });

    it("безымянный буфер, открытый в одной группе из двух, остаётся достижимым", () => {
        // Группы заводим до записей: достижимость безымянного считается по ВСЕМ
        // группам полосы, и хватать должно одной — той, где он открыт.
        source.addGroup(2);
        source.focusGroup(1);
        source.open(UNTITLED);
        source.open(alpha());

        service.goBack();

        expect(source.caret()).toMatchObject({ uri: UNTITLED });
        expect(service.getEntries()).toHaveLength(2);
    });

    it("закрытая вкладка живого файла остаётся в истории — Back её переоткрывает", () => {
        source.open(alpha());
        source.moveCaret(30);
        source.open(beta());
        source.close(alpha());

        service.goBack();

        expect(source.openUriCalls).toContain(alpha());
        expect(source.caret()).toMatchObject({ uri: alpha(), line: 30 });
    });

    it("закрытый безымянный буфер выпадает — открывать его нечем", () => {
        source.open(UNTITLED);
        source.open(alpha());
        source.close(UNTITLED);
        source.openUriCalls.length = 0;

        // Настоящий openUri по закрытому untitled: бросил бы — чистка обязана
        // снять запись раньше, чем до неё дойдёт восстановление.
        service.goBack();

        expect(source.openUriCalls).toEqual([]);
        expect(service.getEntries()).toHaveLength(1);
        expect(service.canGoBack).toBe(false);
    });

    it("стек, из которого всё выпало, становится пустым", () => {
        source.open(UNTITLED);
        source.close(UNTITLED);

        service.goBack();

        expect(service.getEntries()).toEqual([]);
        expect(service.currentIndex).toBe(-1);
        expect(service.canGoForward).toBe(false);
    });

    it("закрытие активной вкладки переводит историю на соседнюю, последней — обнуляет", () => {
        source.open(alpha());
        source.open(beta());

        source.close(beta());
        expect(source.caret()).toMatchObject({ uri: alpha() });

        source.close(alpha());
        expect(source.caret()).toBeNull();
    });

    it("открытый безымянный буфер остаётся достижимым", () => {
        source.open(UNTITLED);
        source.moveCaret(20);
        source.open(alpha());

        service.goBack();

        expect(source.caret()).toMatchObject({ uri: UNTITLED, line: 20 });
    });

    it("выпавшая запись под указателем не уводит указатель в минус", () => {
        source.open(UNTITLED);
        source.open(alpha());
        service.goBack();
        source.close(UNTITLED);

        service.goForward();

        expect(service.getEntries()).toHaveLength(1);
        expect(service.currentIndex).toBe(0);
        expect(service.canGoForward).toBe(false);
    });

    it("фейк повторяет отказ настоящего openUri открыть закрытый безымянный буфер", () => {
        source.open(UNTITLED);
        source.close(UNTITLED);

        expect(() => source.openUri(Uri.parse(UNTITLED))).toThrow(/не восстановим/);
    });

    it("запись из другой группы восстанавливается вместе с фокусом группы", () => {
        source.open(alpha());
        source.moveCaret(25);
        source.addGroup(2);
        source.open(beta());

        service.goBack();

        expect(source.focusGroupCalls).toEqual([1]);
        expect(source.caret()).toMatchObject({ uri: alpha(), line: 25 });
    });

    it("исчезнувшая группа не мешает: запись открывается в активной", () => {
        source.open(alpha());
        source.moveCaret(25);
        source.addGroup(2);
        source.open(beta());
        source.removeGroup(1);

        service.goBack();

        expect(source.focusGroupCalls).toEqual([]);
        expect(source.caret()).toMatchObject({ uri: alpha(), line: 25 });
    });
});
