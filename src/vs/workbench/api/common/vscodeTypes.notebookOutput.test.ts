import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

/**
 * `NotebookCellOutputItem` — значение в namespace: Claude Code зовёт
 * `NotebookCellOutputItem.error(...).mime` на верхнем уровне модуля, и без
 * класса его точка входа не грузилась. Поведение — эталонное
 * (`extHostTypes/notebooks.ts`).
 */
const { NotebookCellOutputItem } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk()).namespace;
const decode = (data: Uint8Array): string => new TextDecoder().decode(data);

describe("vscode.NotebookCellOutputItem", () => {
    it("error — JSON имени, сообщения и стека под mime ошибки ноутбука", () => {
        const err = new TypeError("boom");
        const item = NotebookCellOutputItem.error(err);
        expect(item.mime).toBe("application/vnd.code.notebook.error");
        expect(JSON.parse(decode(item.data))).toEqual({ name: "TypeError", message: "boom", stack: err.stack });
    });

    it("error — JSON с табуляцией, как у эталона", () => {
        const item = NotebookCellOutputItem.error({ name: "E", message: "m" });
        expect(decode(item.data)).toBe('{\n\t"name": "E",\n\t"message": "m"\n}');
    });

    it("text — UTF-8 байты, дефолтный mime text/plain", () => {
        const item = NotebookCellOutputItem.text("привет");
        expect(item.mime).toBe("text/plain");
        expect(decode(item.data)).toBe("привет");
        expect(NotebookCellOutputItem.text("<b/>", "text/html").mime).toBe("text/html");
    });

    it("text — не-строку приводит к строке (JS-вызывающий)", () => {
        expect(decode(NotebookCellOutputItem.text(42 as unknown as string).data)).toBe("42");
    });

    it("json — дефолтный mime рантайма эталона text/x-json", () => {
        const item = NotebookCellOutputItem.json({ a: [1] });
        expect(item.mime).toBe("text/x-json");
        expect(JSON.parse(decode(item.data))).toEqual({ a: [1] });
        expect(NotebookCellOutputItem.json(1, "application/json").mime).toBe("application/json");
    });

    it("stdout/stderr — свои mime потоков", () => {
        expect(NotebookCellOutputItem.stdout("o").mime).toBe("application/vnd.code.notebook.stdout");
        expect(NotebookCellOutputItem.stderr("e").mime).toBe("application/vnd.code.notebook.stderr");
        expect(decode(NotebookCellOutputItem.stderr("e").data)).toBe("e");
    });

    it("конструктор нормализует тип и подтип в нижний регистр, параметры — как есть", () => {
        const item = new NotebookCellOutputItem(new Uint8Array([1]), "Text/HTML;Charset=UTF-8");
        expect(item.mime).toBe("text/html;Charset=UTF-8");
        expect(item.data).toEqual(new Uint8Array([1]));
    });

    it("конструктор отвергает не-mime с эталонным текстом", () => {
        expect(() => new NotebookCellOutputItem(new Uint8Array(), "plain")).toThrow(
            'INVALID mime type: plain. Must be in the format "type/subtype[;optionalparameter]"',
        );
    });
});
