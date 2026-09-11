import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";

/**
 * Событие `onDidChangeIndentOptions`: смена действующих `tabSize`/`insertSpaces`
 * обязана доезжать до подписчиков (статус-бар), а холостые вызовы — нет.
 */
describe("EditorComponent — onDidChangeIndentOptions", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-indent-events-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function openPane(name: string, content: string): TextEditorPane {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile(name, content)));
        return ctrl;
    }

    function countEvents(ctrl: TextEditorPane): { count: () => number } {
        let fired = 0;
        ctrl.onDidChangeIndentOptions(() => {
            fired++;
        });
        return { count: () => fired };
    }

    it("файрит на сдвиг из setIndentOptions", () => {
        const ctrl = openPane("a.ts", "x");
        const events = countEvents(ctrl);

        ctrl.setIndentOptions({ tabSize: 2, insertSpaces: true });

        expect(events.count()).toBe(1);
    });

    it("молчит, когда патч совпал с действующими значениями", () => {
        const ctrl = openPane("a.ts", "x");
        const events = countEvents(ctrl);

        ctrl.setIndentOptions({ tabSize: 4, insertSpaces: false });

        expect(events.count()).toBe(0);
    });

    it("файрит на сдвиг из applyIndentConfiguration", () => {
        const ctrl = openPane("a.ts", "x");
        const events = countEvents(ctrl);

        ctrl.applyIndentConfiguration({ tabSize: 8, insertSpaces: true, detectIndentation: false });

        expect(events.count()).toBe(1);
    });

    it("файрит, когда конфиг сдвинул только размер таба (tabSize)", () => {
        const ctrl = openPane("a.ts", "x");
        const events = countEvents(ctrl);

        // insertSpaces остаётся false — сдвигается только ось tabSize.
        ctrl.applyIndentConfiguration({ tabSize: 8, detectIndentation: false });

        expect(events.count()).toBe(1);
        expect(ctrl.viewState.insertSpaces).toBe(false);
    });

    it("файрит, когда конфиг сдвинул только вид отступа (insertSpaces)", () => {
        const ctrl = openPane("a.ts", "x");
        const events = countEvents(ctrl);

        // tabSize остаётся 4 — сдвигается только ось insertSpaces.
        ctrl.applyIndentConfiguration({ insertSpaces: true, detectIndentation: false });

        expect(events.count()).toBe(1);
        expect(ctrl.viewState.tabSize).toBe(4);
    });

    it("молчит, когда конфиг не сдвинул действующие значения", () => {
        const ctrl = openPane("a.ts", "x");
        const events = countEvents(ctrl);

        ctrl.applyIndentConfiguration({ tabSize: 4, insertSpaces: false, detectIndentation: false });

        expect(events.count()).toBe(0);
    });

    it("файрит, когда открытие файла пере-детектировало отступ", () => {
        const ctrl = createEditorPane();
        const events = countEvents(ctrl);

        // Двухпробельные отступы: детекция сдвигает дефолтные табы на Spaces: 2.
        ctrl.openFile(Uri.file(ws.writeFile("a.ts", "if (a) {\n  b();\n  c();\n}\n")));

        expect(events.count()).toBe(1);
        expect(ctrl.viewState.insertSpaces).toBe(true);
        expect(ctrl.viewState.tabSize).toBe(2);
    });

    it("подписка переживает перечитку документа (файрит и после неё)", () => {
        const ctrl = openPane("a.ts", "if (a) {\n  b();\n  c();\n}\n");
        const events = countEvents(ctrl);

        // Перечитка пересоздаёт view-state; подписка живёт на компоненте.
        ctrl.openFile(Uri.file(ws.writeFile("b.ts", "if (a) {\n\tb();\n\tc();\n}\n")));

        expect(events.count()).toBe(1);
        expect(ctrl.viewState.insertSpaces).toBe(false);
    });

    it("молчит на перечитку, когда детекция дала тот же отступ", () => {
        const ctrl = openPane("a.ts", "if (a) {\n  b();\n  c();\n}\n");
        const events = countEvents(ctrl);

        // Другой файл с теми же двухпробельными отступами: view-state пересоздан,
        // но действующие значения не сдвинулись — событие не нужно.
        ctrl.openFile(Uri.file(ws.writeFile("b.ts", "if (x) {\n  y();\n}\n")));

        expect(events.count()).toBe(0);
    });

    it("dispose подписки останавливает доставку и не задевает соседнюю", () => {
        const ctrl = openPane("a.ts", "x");
        let firstFired = 0;
        let secondFired = 0;
        const first = ctrl.onDidChangeIndentOptions(() => {
            firstFired++;
        });
        ctrl.onDidChangeIndentOptions(() => {
            secondFired++;
        });

        first.dispose();
        // Повторный dispose — no-op: соседняя подписка не должна пострадать.
        first.dispose();
        ctrl.setIndentOptions({ tabSize: 2 });

        expect(firstFired).toBe(0);
        expect(secondFired).toBe(1);
    });
});
