import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MenuItemEntry } from "@tuidom/elements/menu/popupMenuElement";
import type { PopupMenuElement } from "@tuidom/elements/menu/popupMenuElement";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../base/common/uri.ts";
import { createRange } from "../../editor/common/core/iRange.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";

/** Файл из 40 строк — чтобы порог значимости (10 строк) было чем перешагнуть. */
const lines = (prefix: string): string => Array.from({ length: 40 }, (_, i) => `${prefix} ${String(i)}`).join("\n");

describe("Workbench — навигационная история (Go Back / Go Forward)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-nav-history-",
            files: { "alpha.ts": lines("alpha"), "beta.ts": lines("beta") },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(90, 24) });
        h.workbench.openFile(ws.path("alpha.ts"));
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const editors = () => h.container.get(EditorServiceDIToken);
    const caret = () => {
        const editor = h.activeEditor();
        return { uri: editor.uri.toString(), ...editor.viewState.selections[0].active };
    };
    const uri = (name: string): string => Uri.file(ws.path(name)).toString();

    it("Back возвращает в файл и позицию, откуда ушли, Forward — обратно", () => {
        h.activeEditor().goToPosition(30, 0);
        editors().openFile(ws.path("beta.ts"));
        h.activeEditor().goToPosition(4, 2);

        h.commands.execute("workbench.action.navigateBack");
        expect(caret()).toMatchObject({ uri: uri("alpha.ts"), line: 30 });

        h.commands.execute("workbench.action.navigateForward");
        expect(caret()).toMatchObject({ uri: uri("beta.ts"), line: 4, character: 2 });
    });

    it("Go to Definition + Back возвращает ровно в точку вызова", async () => {
        h.activeEditor().goToPosition(12, 3);
        editors().definitionSource = () =>
            Promise.resolve([{ uri: uri("beta.ts"), range: createRange(20, 5, 20, 9) }]);

        await h.commands.execute("editor.action.revealDefinition");
        expect(caret()).toMatchObject({ uri: uri("beta.ts"), line: 20, character: 5 });

        h.commands.execute("workbench.action.navigateBack");

        // Именно точка вызова, а не начало alpha.ts: шов jump() гасит
        // промежуточную запись «открыли файл в позиции 0:0».
        expect(caret()).toMatchObject({ uri: uri("alpha.ts"), line: 12, character: 3 });
    });

    it("Go to Definition в двух строках ниже — Back всё равно возвращает к вызову", async () => {
        h.activeEditor().goToPosition(12, 3);
        editors().definitionSource = () =>
            Promise.resolve([{ uri: uri("alpha.ts"), range: createRange(14, 2, 14, 6) }]);

        await h.commands.execute("editor.action.revealDefinition");
        expect(caret()).toMatchObject({ uri: uri("alpha.ts"), line: 14, character: 2 });

        h.commands.execute("workbench.action.navigateBack");

        // Две строки — меньше порога значимости, и обычную запись о таком переходе
        // история схлопнула бы. Намеренный прыжок пишется форсом ровно поэтому:
        // иначе Go to Definition рядом с местом вызова стал бы невозвратным.
        expect(caret()).toMatchObject({ uri: uri("alpha.ts"), line: 12, character: 3 });
    });

    it("пункты Go → Back/Forward появляются только когда есть куда идти", () => {
        const goMenuLabels = (): string[] => {
            h.testApp.sendKey("Alt+g");
            const popup = h.testApp.querySelector("PopupMenuElement") as PopupMenuElement | null;
            expect(popup).not.toBeNull();
            const labels = popup!.entries
                .filter((entry): entry is MenuItemEntry => entry.type !== "separator")
                .map((entry) => entry.label);
            h.testApp.sendKey("Escape");
            return labels;
        };

        expect(goMenuLabels()).not.toContain("Back");

        h.activeEditor().goToPosition(30, 0);
        editors().openFile(ws.path("beta.ts"));
        h.workbench.focusEditor();
        expect(goMenuLabels()).toContain("Back");
        expect(goMenuLabels()).not.toContain("Forward");

        h.commands.execute("workbench.action.navigateBack");
        h.workbench.focusEditor();
        expect(goMenuLabels()).toContain("Forward");
    });
});
