import { describe, expect, it } from "vitest";

import { editorTabIsFile, editorTabPathArg, editorTabTargetArg, type EditorTitleMenuContext } from "./menuContexts.ts";

/** Ошибка здесь не видна в UI — команда просто отработает не по той вкладке. */
const context: EditorTitleMenuContext = {
    groupId: 3,
    index: 2,
    path: "/workspace/alpha.ts",
    resourceScheme: "file",
    tabCount: 4,
    hasTabsToTheRight: true,
    hasSavedTabs: true,
    isPreview: false,
};

describe("аргументы пунктов контекст-меню вкладки", () => {
    it("адрес вкладки — пара чисел в порядке (группа, индекс)", () => {
        expect(editorTabTargetArg(context)).toEqual([3, 2]);
    });

    it("обе части адреса — именно числа", () => {
        // Пустые или нечисловые аргументы команда примет за вызов из палитры.
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
