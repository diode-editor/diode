import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MenuItemEntry } from "@tuidom/elements/menu/popupMenuElement";
import type { PopupMenuElement } from "@tuidom/elements/menu/popupMenuElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { IDisposable } from "../../base/common/lifecycle.ts";
import { Uri } from "../../base/common/uri.ts";
import { createRange } from "../../editor/common/core/iRange.ts";
import type { DefinitionProvider } from "../../editor/common/languages/iDefinitionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

/** A 40-line file, so there is room to step past the significance threshold (10 lines). */
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
    let definitions: IDisposable | undefined;
    /** The only definition provider for any document (replaces the previous one). */
    const useDefinitions = (provideDefinition: DefinitionProvider["provideDefinition"]): void => {
        definitions?.dispose();
        definitions = h.container
            .get(LanguageFeaturesServiceDIToken)
            .definitionProvider.register("*", { provideDefinition });
    };
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
        useDefinitions(() => Promise.resolve([{ uri: uri("beta.ts"), range: createRange(20, 5, 20, 9) }]));

        await h.commands.execute("editor.action.revealDefinition");
        expect(caret()).toMatchObject({ uri: uri("beta.ts"), line: 20, character: 5 });

        h.commands.execute("workbench.action.navigateBack");

        // Exactly the call site, not the start of alpha.ts: the jump() seam suppresses
        // the intermediate "opened the file at 0:0" entry.
        expect(caret()).toMatchObject({ uri: uri("alpha.ts"), line: 12, character: 3 });
    });

    it("Go to Definition в двух строках ниже — Back всё равно возвращает к вызову", async () => {
        h.activeEditor().goToPosition(12, 3);
        useDefinitions(() => Promise.resolve([{ uri: uri("alpha.ts"), range: createRange(14, 2, 14, 6) }]));

        await h.commands.execute("editor.action.revealDefinition");
        expect(caret()).toMatchObject({ uri: uri("alpha.ts"), line: 14, character: 2 });

        h.commands.execute("workbench.action.navigateBack");

        // Two lines is below the significance threshold, and history would collapse a regular
        // entry for such a jump. That's exactly why an intentional jump is written forcibly:
        // otherwise Go to Definition near the call site would be impossible to go back from.
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
