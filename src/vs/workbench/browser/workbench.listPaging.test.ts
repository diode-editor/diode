import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import type { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";

import { SidebarServiceDIToken } from "./parts/sidebar/sidebarService.ts";

/**
 * Регрессия двойного срабатывания клавиши над списком: команда list.* съедает
 * keydown, но каждый keydown порождает парный keypress, и до фикса диспатчер
 * гасил его только над текстовым инпутом — PageDown двигал курсор списка на ДВЕ
 * страницы (команда + собственный дефолт ListViewElement). Тест идёт полным
 * путём (raw key → парсер → dispatch → команда) и сверяет результат с чистым
 * вызовом команды.
 */
describe("Workbench — клавиша над списком срабатывает ровно один раз", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let list: ListViewElement;
    let commands: CommandRegistry;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-list-paging-" });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 40) });
        commands = h.container.get(CommandRegistryDIToken);
        await h.workbench.activate();

        h.container.get(SidebarServiceDIToken).showViewlet("search", false);
        list = h.testApp.querySelector("#searchResults") as ListViewElement;
        for (let i = 0; i < 100; i++) {
            const row = new TextLabelElement(`row ${String(i)}`);
            row.id = `row-${String(i)}`;
            list.appendRow(row);
        }
        list.focus();
        // Два кадра: первый рендер после наполнения ещё меняет высоту списка
        // (устаканивание скроллбара) — калибровка «одной страницы» должна идти
        // по той же геометрии, что и клавиатурный путь.
        h.testApp.render();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function cursorIndex(): number {
        const id = list.getCursorElement()?.id ?? "";
        return Number(id.replace("row-", ""));
    }

    it("PageDown двигает курсор ровно на одну страницу (не на две)", () => {
        // Калибровка: чистый вызов команды — «одна страница» без клавиатурного пути.
        commands.execute("list.focusPageDown");
        h.testApp.render();
        const onePage = cursorIndex();
        expect(onePage).toBeGreaterThan(0);

        commands.execute("list.focusFirst");
        h.testApp.render();
        expect(cursorIndex()).toBe(0);

        h.testApp.sendKey("PageDown");
        h.testApp.render();
        expect(cursorIndex()).toBe(onePage);
    });

    it("End + PageUp через клавиатуру симметричны чистым командам", () => {
        h.testApp.sendKey("End");
        h.testApp.render();
        expect(cursorIndex()).toBe(99);

        commands.execute("list.focusPageUp");
        h.testApp.render();
        const onePageUp = cursorIndex();
        expect(onePageUp).toBeLessThan(99);

        commands.execute("list.focusLast");
        h.testApp.render();
        h.testApp.sendKey("PageUp");
        h.testApp.render();
        expect(cursorIndex()).toBe(onePageUp);
    });
});
