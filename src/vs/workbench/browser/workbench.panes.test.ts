import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { Uri } from "../../base/common/uri.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";

import type { IEditorPane } from "./parts/editor/iEditorPane.ts";
import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

/**
 * Гейт «шов настоящий, а не декоративный»: панель не-текстового вида,
 * открытая в группе, обязана **дорисоваться до кадра** — её контент виден на
 * экране, а таб-стрип показывает обе вкладки. Настоящим вторым видом станет
 * дифф (этап 5); здесь его роль играет панель с одной строкой текста.
 */

const PANE_TEXT = "СОДЕРЖИМОЕ-ПАНЕЛИ";

/** Панель не-текстового вида: рисует одну строку и больше ничего не умеет. */
class TextOnlyPane implements IEditorPane {
    public readonly view = new TextLabelElement(PANE_TEXT);
    public readonly isModified = false;
    public readonly readOnly = false;

    public readonly label = "diff-stub";

    public constructor(public readonly uri: Uri) {}

    public onDidChangeState(): { dispose: () => void } {
        return { dispose: () => undefined };
    }

    public focusEditor(): void {
        // Нечего фокусировать — панель не принимает ввод.
    }

    public getSelectedText(): string {
        return ""; // понятия выделения у панели нет
    }

    public dispose(): void {
        // view не отцепляем: пока группа держит его как content, setParent(null)
        // оставил бы полуприкреплённое состояние (ловит validateTree). Отцепляет
        // владелец монтирования — контент-слот EditorGroupComponent при смене.
    }
}

describe("Workbench — панель не-текстового вида во вкладке", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let commands: CommandRegistry;
    let editors: EditorService;
    let testApp: TestApp;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-panes-", files: { "a.txt": "первая строка\n" } });

        const { container, bindApp } = createTestContainer();
        workbench = container.get(WorkbenchComponentDIToken);
        commands = container.get(CommandRegistryDIToken);
        editors = container.get(EditorServiceDIToken);

        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        testApp = TestApp.create(workbench.view, new Size(90, 14));
        bindApp(testApp.app);

        commands.execute("workbench.openFile", ws.path("a.txt"));
        await settle(0);
    });

    afterEach(() => {
        workbench.dispose();
        ws.dispose();
    });

    it("контент панели виден на экране, а текстового редактора — нет", () => {
        testApp.render();
        expect(testApp.backend.screenToString()).toContain("первая строка");

        editors.openPane(new TextOnlyPane(Uri.from({ scheme: "fake", path: "/changes" })));
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(screen).toContain(PANE_TEXT);
        // Контент прежней вкладки ушёл — группа подменила view, а не наложила.
        expect(screen).not.toContain("первая строка");
    });

    it("таб-стрип показывает обе вкладки", () => {
        editors.openPane(new TextOnlyPane(Uri.from({ scheme: "fake", path: "/changes" })));
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(screen).toContain("a.txt");
        expect(screen).toContain("diff-stub");
    });

    it("возврат на текстовую вкладку возвращает и её контент", () => {
        editors.openPane(new TextOnlyPane(Uri.from({ scheme: "fake", path: "/changes" })));
        testApp.render();
        expect(testApp.backend.screenToString()).toContain(PANE_TEXT);

        editors.activateTab(0);
        testApp.render();

        const screen = testApp.backend.screenToString();
        expect(screen).toContain("первая строка");
        expect(screen).not.toContain(PANE_TEXT);
    });

    it("закрытие вкладки панели убирает её с экрана", () => {
        editors.openPane(new TextOnlyPane(Uri.from({ scheme: "fake", path: "/changes" })));
        testApp.render();

        editors.closeTab(editors.activeIndex);
        testApp.render();

        expect(testApp.backend.screenToString()).not.toContain(PANE_TEXT);
        expect(testApp.backend.screenToString()).toContain("первая строка");
    });
});
