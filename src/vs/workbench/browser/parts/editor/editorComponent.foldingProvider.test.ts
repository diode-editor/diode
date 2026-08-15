import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { FoldingRangeSource } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { IFoldingRegion } from "../../../../editor/contrib/folding/iFoldingRegion.ts";

/** The provider merge resolves on a microtask; a macrotask tick flushes it. */
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function starts(ctrl: TextEditorPane): number[] {
    return ctrl.viewState.foldedRegions.map((r) => r.startLine).sort((a, b) => a - b);
}

/** A folding source returning fixed regions for any request. */
function sourceOf(regions: IFoldingRegion[]): FoldingRangeSource {
    return async () => regions.map((r) => ({ ...r }));
}

describe("EditorComponent – extension folding provider merge", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-foldprov-" });
    });
    afterEach(() => {
        ws.dispose();
    });

    function open(content: string): TextEditorPane {
        const filePath = ws.writeFile("doc.txt", content);
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(filePath));
        return ctrl;
    }

    it("provider-регион появляется там, где indentation-фолдов нет", async () => {
        // Пять строк без отступов — indentation folding не даёт ни одной области.
        const ctrl = open("a\nb\nc\nd\ne");
        expect(starts(ctrl)).toEqual([]);

        const source = sourceOf([{ startLine: 0, endLine: 3, isCollapsed: false }]);
        ctrl.foldingRangeSource = source;
        expect(ctrl.foldingRangeSource).toBe(source); // геттер отдаёт установленный источник
        await flush();

        expect(starts(ctrl)).toEqual([0]);
        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.endLine).toBe(3);
    });

    it("union: provider ∪ indentation (обе области сохраняются)", async () => {
        // Indentation-область 0..2 (header + два отступа); provider добавляет 3..4.
        const ctrl = open("header\n  x\n  y\nfooter\nmore");
        expect(starts(ctrl)).toEqual([0]);

        ctrl.foldingRangeSource = sourceOf([{ startLine: 3, endLine: 4, isCollapsed: false }]);
        await flush();

        expect(starts(ctrl)).toEqual([0, 3]);
    });

    it("provider выигрывает по общей startLine", async () => {
        // Indentation даёт 0..2; provider отдаёт 0..3 на той же строке → берём 0..3.
        const ctrl = open("header\n  x\n  y\nfooter");
        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.endLine).toBe(2);

        ctrl.foldingRangeSource = sourceOf([{ startLine: 0, endLine: 3, isCollapsed: false }]);
        await flush();

        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.endLine).toBe(3);
    });

    it("collapsed переносится через provider-мерж по startLine", async () => {
        const ctrl = open("a\nb\nc\nd\ne");
        ctrl.foldingRangeSource = sourceOf([{ startLine: 0, endLine: 3, isCollapsed: false }]);
        await flush();

        ctrl.viewState.foldRegionContaining(0); // пользователь свернул
        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.isCollapsed).toBe(true);

        // Пере-подключение источника перезапускает мерж — свёрнутость обязана уцелеть.
        ctrl.foldingRangeSource = sourceOf([{ startLine: 0, endLine: 3, isCollapsed: false }]);
        await flush();
        expect(ctrl.viewState.foldedRegions.find((r) => r.startLine === 0)?.isCollapsed).toBe(true);
    });

    it("провайдер упал/таймаут → остаются indentation-фолды (без throw)", async () => {
        const ctrl = open("header\n  x\n  y\nfooter");
        expect(starts(ctrl)).toEqual([0]);

        ctrl.foldingRangeSource = async () => {
            throw new Error("provider boom");
        };
        await flush();

        expect(starts(ctrl)).toEqual([0]); // indentation-фолды уцелели
    });

    it("пустой ответ провайдера → остаются только indentation-фолды", async () => {
        const ctrl = open("header\n  x\n  y\nfooter");
        expect(starts(ctrl)).toEqual([0]);

        ctrl.foldingRangeSource = sourceOf([]);
        await flush();

        expect(starts(ctrl)).toEqual([0]); // indentation не потерян
    });
});
