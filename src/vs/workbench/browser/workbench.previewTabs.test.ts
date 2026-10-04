import type { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { Uri } from "../../base/common/uri.ts";
import type { IConfigurationService } from "../../platform/configuration/common/iConfigurationService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

/**
 * Режим предпросмотра вкладок сквозь весь workbench: настоящее дерево Explorer,
 * настоящий диспетчер биндов, настоящая полоса вкладок. Юниты сервиса
 * (`editorService.preview.test.ts`) проверяют механику замещения, а здесь —
 * что до неё доезжает одиночная активация файла в дереве и что ПРИКАЛЫВАНИЕ
 * видно в той же полосе, на которую смотрит пользователь.
 */

/** Метки вкладок полосы — ровно то, что видно на кадре. */
function tabLabels(h: IAppHarness): string[] {
    const strip = h.testApp.querySelector("EditorTabStripElement") as EditorTabStripElement;
    return strip.getItemElements().map((item) => item.getLabel());
}

describe("Workbench — предпросмотр вкладок из дерева", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    function boot(configurationService?: IConfigurationService): void {
        h = createAppTestHarness({ workspaceFolder: ws.dir, configurationService });
    }

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-preview-tabs-",
            // Три файла без каталогов: дерево сортирует их по алфавиту, и
            // ArrowDown шагает ровно по ним.
            files: {
                "alpha.txt": "Alpha",
                "beta.txt": "Beta",
                "gamma.txt": "Gamma",
            },
        });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    /** Активирует в дереве файл под номером `index` (сверху, с нуля). */
    async function activateInTree(index: number): Promise<void> {
        await h.workbench.activate();
        h.testApp.render();
        const tree = h.testApp.querySelector("TreeViewElement");
        if (tree === null) throw new Error("дерево не найдено");
        tree.focus();
        h.testApp.render();
        for (let step = 0; step < index; step++) h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        h.testApp.render();
    }

    /** Повторная активация — дерево уже поднято, фокус надо вернуть ему. */
    function activateAgainInTree(index: number): void {
        const tree = h.testApp.querySelector("TreeViewElement");
        if (tree === null) throw new Error("дерево не найдено");
        tree.focus();
        h.testApp.render();
        // Курсор дерева остался там, где его оставила прошлая активация, —
        // шагаем от нуля, перегнав его в начало.
        for (let step = 0; step < 10; step++) h.testApp.sendKey("ArrowUp");
        for (let step = 0; step < index; step++) h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        h.testApp.render();
    }

    it("обход дерева не копит вкладки: второй файл занимает слот первого", async () => {
        boot();
        await activateInTree(0);
        expect(tabLabels(h)).toEqual(["alpha.txt"]);

        activateAgainInTree(1);

        expect(tabLabels(h)).toEqual(["beta.txt"]);
    });

    it("правка прикалывает превью — следующий файл открывается рядом", async () => {
        boot();
        await activateInTree(0);

        // Печатаем в открытую превью-вкладку: фокус уже в редакторе.
        h.testApp.sendKey("x");
        h.testApp.render();
        activateAgainInTree(1);

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
    });

    it("Ctrl+K Enter прикалывает превью, не меняя его содержимое", async () => {
        boot();
        await activateInTree(0);

        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Enter");
        h.testApp.render();
        activateAgainInTree(1);

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
        // Enter чорда в редактор не протёк — текст файла целый.
        expect(h.activeEditor().getText()).toBe("Beta");
    });

    it("приколотая вкладка и следующее превью живут рядом, а превью замещается", async () => {
        boot();
        await activateInTree(0);
        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Enter");
        h.testApp.render();

        activateAgainInTree(1);
        activateAgainInTree(2);

        // Третий файл заместил второй (превью), приколотый первый остался.
        expect(tabLabels(h)).toEqual(["alpha.txt", "gamma.txt"]);
    });

    it("`workbench.openFile` без опций (CLI, Quick Open) превью не делает", async () => {
        boot();
        await activateInTree(0);

        // Ровно тот вызов, который делают Quick Open и CLI — без `preview`.
        h.commands.execute("workbench.openFile", ws.path("beta.txt"));
        h.testApp.render();

        // Постоянное открытие ПРИКОЛОЛО превью-вкладку: alpha осталась.
        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
    });

    it("замещение с `focus: false` фокус не уводит", async () => {
        boot();
        await activateInTree(0);
        const tree = h.testApp.querySelector("TreeViewElement");
        if (tree === null) throw new Error("дерево не найдено");
        tree.focus();
        h.testApp.render();

        // Превью замещается, но фокус остаётся там, где был: на этом держится
        // `preserveFocus` у `showTextDocument` и реveal'ов.
        await h.container.get(EditorServiceDIToken).openUri(Uri.file(ws.path("beta.txt")), {
            preview: true,
            focus: false,
        });
        h.testApp.render();

        expect(tabLabels(h)).toEqual(["beta.txt"]);
        expect(h.testApp.focusedElement).toBe(tree);
    });

    it("с выключенной настройкой дерево копит вкладки, как до фичи", async () => {
        boot(createTestConfigurationService({ "workbench.editor.enablePreview": false }));
        await activateInTree(0);

        activateAgainInTree(1);

        expect(tabLabels(h)).toEqual(["alpha.txt", "beta.txt"]);
    });
});
