import { describe, expect, it } from "vitest";

import { editorTabIsFile, editorTabPathArg, editorTabTargetArg, type EditorTitleMenuContext } from "./menuContexts.ts";

/**
 * Контракт между контекст-меню вкладки и командами: меню передаёт АДРЕС вкладки
 * под курсором, а не полагается на активную. Ошибка здесь не видна в UI — команда
 * просто отработает не по той вкладке, — поэтому проверяем форму аргументов.
 */
const context: EditorTitleMenuContext = {
    groupId: 3,
    index: 2,
    path: "/workspace/alpha.ts",
    tabCount: 4,
    hasTabsToTheRight: true,
    hasSavedTabs: true,
};

describe("аргументы пунктов контекст-меню вкладки", () => {
    it("адрес вкладки — пара чисел в порядке (группа, индекс)", () => {
        expect(editorTabTargetArg(context)).toEqual([3, 2]);
    });

    it("обе части адреса — именно числа", () => {
        // По паре ЧИСЕЛ команда отличает адрес из меню от вызова с клавиатуры.
        // Пустые или нечисловые аргументы она примет за вызов из палитры и
        // выполнится по активной вкладке, а не по той, где открыли меню.
        expect(editorTabTargetArg(context).map((value) => typeof value)).toEqual(["number", "number"]);
    });

    it("файловым пунктам едет путь вкладки", () => {
        expect(editorTabPathArg(context)).toEqual(["/workspace/alpha.ts"]);
    });

    it("у вкладки без файла на диске файловые пункты прячутся", () => {
        expect(editorTabIsFile(context)).toBe(true);
        expect(editorTabIsFile({ ...context, path: null })).toBe(false);
    });
});
