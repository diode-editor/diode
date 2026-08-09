import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { InMemoryFileClipboard } from "../../../../platform/clipboard/common/inMemoryFileClipboard.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { MENU_CONTRIBUTIONS } from "../../../browser/actions/menuContributions.ts";
import type { IViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";

import { EXPLORER_VIEW_ID, EXPLORER_VIEWLET_ID, ExplorerComponent } from "./explorerComponent.ts";
import { ExplorerService } from "./explorerService.ts";

/**
 * Explorer идёт тем же путём, что Search и SCM: сам он владеет только телом
 * секции, а заголовок, «⋯»-меню и кнопки даёт общая модель контейнеров. Тест
 * держит именно это — что компонент ничего не рисует сам.
 */
describe("ExplorerComponent — контейнер сайдбара", () => {
    let ws: ITempWorkspace;
    let h: IViewsHarness;
    let service: ExplorerService;
    let component: ExplorerComponent;

    function attach(): void {
        h.service.registerContainer({ id: EXPLORER_VIEWLET_ID, title: "EXPLORER", location: "sidebar" });
        h.service.attachContainer(EXPLORER_VIEWLET_ID);
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-explorer-container-", files: { "index.ts": "" } });
        h = makeViewsHarness(MENU_CONTRIBUTIONS);
        const clipboard = new InMemoryFileClipboard();
        service = new ExplorerService(clipboard, NULL_CONFIGURATION_SERVICE, NULL_LOG_SERVICE);
        component = new ExplorerComponent(
            service,
            new CommandRegistry(),
            clipboard,
            new ContextMenuService(h.menuService),
            h.service,
        );
    });

    afterEach(() => {
        component.dispose();
        service.dispose();
        ws.dispose();
    });

    it("контейнер merged: единственная секция несёт заголовок EXPLORER и не сворачивается", () => {
        service.setRootPath(ws.dir);
        attach();

        expect(h.header(EXPLORER_VIEWLET_ID)).toBeNull();
        const paneView = h.paneView(EXPLORER_VIEWLET_ID);
        expect(paneView.getPaneIds()).toEqual([EXPLORER_VIEW_ID]);
        expect(paneView.querySelector("#paneHeader-workbench-explorer-fileView")?.inspectState()).toMatchObject({
            title: "EXPLORER",
            collapsible: false,
        });
    });

    it("до открытия папки секция рисует подсказку, после — дерево", () => {
        attach();
        const paneView = h.paneView(EXPLORER_VIEWLET_ID);
        const placeholder = paneView.querySelector("#viewPlaceholder-workbench-explorer-fileView") as TextLabelElement;
        expect(placeholder.getText()).toBe("No folder opened.");

        service.setRootPath(ws.dir);
        expect(paneView.querySelector("#explorerView")).toBe(component.view);
        expect(paneView.querySelector("#viewPlaceholder-workbench-explorer-fileView")).toBeNull();
    });

    it("смена корня меняет тело на месте — сайдбар держит тот же корень контейнера", () => {
        service.setRootPath(ws.dir);
        attach();
        const root = h.root(EXPLORER_VIEWLET_ID);
        const firstBody = component.view;

        const other = createTempWorkspace({ prefix: "vexx-explorer-container-2-", files: { "a.ts": "" } });
        service.setRootPath(other.dir);

        expect(h.root(EXPLORER_VIEWLET_ID)).toBe(root);
        expect(component.view).not.toBe(firstBody);
        expect(h.paneView(EXPLORER_VIEWLET_ID).querySelector("#explorerView")).toBe(component.view);
        other.dispose();
    });

    it("заголовок несёт кнопки New File / New Folder / Refresh", () => {
        service.setRootPath(ws.dir);
        attach();
        const header = h.paneView(EXPLORER_VIEWLET_ID).querySelector("#paneHeader-workbench-explorer-fileView")!;
        const buttons = header
            .querySelectorAll("TextLabelElement")
            .slice(1, -1)
            .map((label) => (label as TextLabelElement).getText().trim());
        expect(buttons).toEqual(["", "", ""]);
    });

    it("«⋯» merged-секции держит подменю контейнера, а не пункты заголовка", () => {
        service.setRootPath(ws.dir);
        attach();
        h.paneView(EXPLORER_VIEWLET_ID).onDidRequestPaneMenu?.(EXPLORER_VIEW_ID, { screenX: 0, screenY: 0 });
        // Своих overflow-пунктов у Explorer'а нет, у контейнера — тоже: меню пустое.
        expect(h.shown.at(-1)!.getEntries!()).toEqual([]);
    });
});
