import type { IDisposable } from "@tuidom/core/common/disposable";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";

import type { IEditorPane } from "./iEditorPane.ts";
import { computeTabLabels } from "./tabLabels.ts";

function pane(uriPath: string): IEditorPane {
    return {
        uri: Uri.file(uriPath),
        label: uriPath.split("/").pop() ?? uriPath,
        view: {} as TUIElement,
        isModified: false,
        readOnly: false,
        getSelectedTexts: () => [],
        onDidChangeState: (): IDisposable => ({ dispose: () => {} }),
        focusEditor() {},
        dispose() {},
    };
}

function labels(...paths: string[]): string[] {
    const panes = paths.map(pane);
    return computeTabLabels(panes, (editor) => editor.label);
}

describe("computeTabLabels — разводка тёзок минимальным суффиксом пути", () => {
    it("без тёзок метки — просто имена файлов", () => {
        expect(labels("/p/a.ts", "/p/b.ts")).toEqual(["a.ts", "b.ts"]);
    });

    it("тёзки получают минимальный различающий сегмент родителя", () => {
        expect(labels("/p/x/a.ts", "/p/y/a.ts", "/p/b.ts")).toEqual(["a.ts — x", "a.ts — y", "b.ts"]);
    });

    it("совпадающий последний сегмент — суффикс растёт до различающего хвоста", () => {
        // dirs: [x, s] и [s]: k=1 коллизия (s/s), у длинного пути уникальность
        // на k=2 ("x/s"), у короткого — тоже на k=2 (хвост тот же "s", но чужой
        // хвост уже "x/s"). Уникальность ровно на k = maxK — граница цикла.
        expect(labels("/x/s/a.ts", "/s/a.ts")).toEqual(["a.ts — x/s", "a.ts — s"]);
    });

    it("файл у корня: пустые сегменты пути не участвуют в суффиксе", () => {
        // Без filter(Boolean) dirname("/") дал бы [""], а "/m/n" — ["", "m", "n"],
        // и суффиксы получили бы ведущий разделитель.
        expect(labels("/n/a.ts", "/m/n/a.ts")).toEqual(["a.ts — n", "a.ts — m/n"]);
    });
});
