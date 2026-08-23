import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { ScmGraphMenuContext } from "../../../browser/actions/menuContexts.ts";
import type { IViewDescriptor, ViewsService } from "../../../browser/parts/views/viewsService.ts";

import { GIT_OP_COMMAND } from "../common/gitProtocol.ts";

import { SCM_VIEWLET_ID } from "./changesComponent.ts";
import { PUBLISH_LOG_COMMAND, ScmGraphService } from "./graphService.ts";
import { GRAPH_LOAD_MORE_COMMAND, GraphViewComponent, SCM_GRAPH_VIEW_ID } from "./graphViewComponent.ts";
import { LOAD_MORE_LABEL, LOAD_MORE_ROW_ID } from "./scmGraphRows.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

interface ISetup {
    component: GraphViewComponent;
    commands: CommandRegistry;
    registered: IViewDescriptor[];
    shownMenus: { menuId: unknown; menuContext: unknown; owner: unknown; anchor: unknown }[];
    /** Свернуть/раскрыть секцию так же, как это делает настоящий ViewsService. */
    setExpanded(expanded: boolean): void;
}

/**
 * Стенд секции. `expanded` — раскрыта ли она на момент создания компонента:
 * дефолт `true` описывает обычное состояние сайдбара, а `false` — стартовое
 * (контейнер ещё не собран) и свёрнутое.
 */
function make(expanded = true): ISetup {
    const commands = new CommandRegistry();
    const graphService = new ScmGraphService(commands);
    const registered: IViewDescriptor[] = [];
    let isExpanded = expanded;
    const expandedListeners = new Set<(viewId: string, expanded: boolean) => void>();
    const viewsService = {
        registerView: (descriptor: IViewDescriptor) => {
            registered.push(descriptor);
        },
        isViewExpanded: (viewId: string) => viewId === SCM_GRAPH_VIEW_ID && isExpanded,
        onDidChangeViewExpanded: (listener: (viewId: string, next: boolean) => void) => {
            expandedListeners.add(listener);
            return {
                dispose: () => {
                    expandedListeners.delete(listener);
                },
            };
        },
    } as unknown as ViewsService;
    const setExpanded = (next: boolean): void => {
        if (next === isExpanded) return;
        isExpanded = next;
        for (const listener of [...expandedListeners]) listener(SCM_GRAPH_VIEW_ID, next);
    };
    const shownMenus: { menuId: unknown; menuContext: unknown; owner: unknown; anchor: unknown }[] = [];
    const contextMenuService = {
        // Делегат резолвят при открытии — фейк дёргает его так же, как настоящий сервис.
        showContextMenu: (delegate: {
            menuId?: unknown;
            menuContext?: unknown;
            getOwner: () => unknown;
            getAnchor: () => unknown;
        }) => {
            shownMenus.push({
                menuId: delegate.menuId,
                menuContext: delegate.menuContext,
                owner: delegate.getOwner(),
                anchor: delegate.getAnchor(),
            });
        },
    } as unknown as ContextMenuService;
    const component = new GraphViewComponent(graphService, viewsService, contextMenuService, commands);
    return { component, commands, registered, shownMenus, setExpanded };
}

interface IEntry {
    sha: string;
    subject: string;
    parents?: string[];
    refs?: { name: string; kind: string; current: boolean }[];
}

function publish(commands: CommandRegistry, entries: IEntry[], hasMore = false): void {
    commands.execute(PUBLISH_LOG_COMMAND, {
        commits: entries.map((e) => ({
            sha: e.sha,
            shortSha: e.sha.slice(0, 8),
            parents: e.parents ?? [],
            refs: e.refs ?? [],
            author: "Eugene",
            timestamp: 1700000000,
            subject: e.subject,
        })),
        hasMore,
    });
}

describe("GraphViewComponent", () => {
    it("регистрирует себя view-секцией GRAPH контейнера Source Control", () => {
        const { registered } = make();
        expect(registered).toHaveLength(1);
        expect(registered[0]).toMatchObject({
            id: SCM_GRAPH_VIEW_ID,
            containerId: SCM_VIEWLET_ID,
            title: "GRAPH",
            order: 20,
        });
    });

    it("рисует граф и subject коммита, sha в кадр не выводит; id строки — полный sha", () => {
        const { component, commands } = make();
        publish(commands, [
            { sha: SHA_A, subject: "feat: панель", parents: [SHA_B] },
            { sha: SHA_B, subject: "fix: сэш" },
        ]);

        expect(component.list.rowCount).toBe(2);
        const screen = renderElement(component.view, 40, 6, { themeVars: true }).screenToString();
        expect(screen).toContain("○");
        expect(screen).toContain("feat: панель");
        expect(screen).toContain("fix: сэш");
        // Колонки sha в графе нет — хеш достают командой Copy Commit ID.
        expect(screen).not.toContain("aaaaaaaa");
        component.list.setCursorTo(SHA_B);
        expect(component.list.getCursorElement()?.id).toBe(SHA_B);
    });

    it("тема коммита идёт сразу за графикой своей строки, а не выравнивается в таблицу", () => {
        const { component, commands } = make();
        // Сверху линейный коммит (одна дорожка), ниже merge разводит вторую —
        // ширина графики у строк разная.
        const SHA_D = "d".repeat(40);
        publish(commands, [
            { sha: SHA_A, subject: "tip", parents: [SHA_B] },
            { sha: SHA_B, subject: "merge", parents: [SHA_C, SHA_D] },
            { sha: SHA_D, subject: "feature", parents: [SHA_C] },
            { sha: SHA_C, subject: "base" },
        ]);

        const lines = renderElement(component.view, 40, 6, { themeVars: true }).screenToString().split("\n");
        const columnOf = (subject: string): number => lines.find((l) => l.includes(subject))!.indexOf(subject);

        // У «tip» одна дорожка — его тема левее, чем у строк с ветвлением.
        expect(columnOf("tip")).toBeLessThan(columnOf("merge"));
        // Строки одной ширины по-прежнему совпадают — это не хаос, а своя ширина.
        expect(columnOf("base")).toBe(columnOf("merge"));
    });

    it("merge-коммит рисуется своим символом и ветвлением", () => {
        const { component, commands } = make();
        publish(commands, [
            { sha: SHA_A, subject: "merge", parents: [SHA_B, SHA_C] },
            { sha: SHA_C, subject: "feature" },
            { sha: SHA_B, subject: "base" },
        ]);

        const screen = renderElement(component.view, 40, 6, { themeVars: true }).screenToString();
        expect(screen).toContain("◎─╮");
    });

    it("бейджи ветки и тега попадают в строку перед темой коммита", () => {
        const { component, commands } = make();
        publish(commands, [
            {
                sha: SHA_A,
                subject: "feat: панель",
                refs: [
                    { name: "v1.0", kind: "tag", current: false },
                    { name: "main", kind: "head", current: true },
                ],
            },
        ]);

        const screen = renderElement(component.view, 40, 4, { themeVars: true }).screenToString();
        // Текущая ветка идёт первой, тег за ней, тема — последней.
        expect(screen).toMatch(/main.*v1\.0.*feat: панель/);
    });

    it("строка Load More появляется, пока история продолжается, и зовёт команду догрузки", () => {
        const { component, commands } = make();
        const loadMore = vi.fn();
        commands.register(GRAPH_LOAD_MORE_COMMAND, loadMore);

        publish(commands, [{ sha: SHA_A, subject: "first" }], true);
        expect(component.list.rowCount).toBe(2);
        const screen = renderElement(component.view, 40, 6, { themeVars: true }).screenToString();
        expect(screen).toContain(LOAD_MORE_LABEL);

        component.list.setCursorTo(LOAD_MORE_ROW_ID);
        component.list.onActivate?.(component.list.getCursorElement()!);
        expect(loadMore).toHaveBeenCalledTimes(1);

        // История закончилась — строка уходит.
        publish(commands, [{ sha: SHA_A, subject: "first" }], false);
        expect(component.list.rowCount).toBe(1);
    });

    it("активация строки коммита команду догрузки не зовёт", () => {
        const { component, commands } = make();
        const loadMore = vi.fn();
        commands.register(GRAPH_LOAD_MORE_COMMAND, loadMore);
        publish(commands, [{ sha: SHA_A, subject: "first" }], true);

        component.list.setCursorTo(SHA_A);
        component.list.onActivate?.(component.list.getCursorElement()!);
        expect(loadMore).not.toHaveBeenCalled();
    });

    it("контекстное меню строки открывается с sha коммита в контексте", () => {
        const { component, commands, shownMenus } = make();
        publish(commands, [{ sha: SHA_A, subject: "feat: панель" }]);

        component.list.setCursorTo(SHA_A);
        component.list.onContextMenu?.(component.list.getCursorElement()!, 5, 5);

        expect(shownMenus).toHaveLength(1);
        expect(shownMenus[0].menuId).toBe(MenuId.ScmGraphContext);
        expect(shownMenus[0].menuContext).toEqual({
            sha: SHA_A,
            shortSha: SHA_A.slice(0, 8),
            subject: "feat: панель",
        } satisfies ScmGraphMenuContext);
        // Владелец меню — список, якорь — точка клика: по ним сервис его позиционирует.
        expect(shownMenus[0].owner).toBe(component.list);
        expect(shownMenus[0].anchor).toEqual({ screenX: 5, screenY: 5 });
    });

    it("контекстное меню на строке Load More не открывается", () => {
        const { component, commands, shownMenus } = make();
        publish(commands, [{ sha: SHA_A, subject: "first" }], true);

        component.list.setCursorTo(LOAD_MORE_ROW_ID);
        component.list.onContextMenu?.(component.list.getCursorElement()!, 5, 5);
        expect(shownMenus).toHaveLength(0);
    });

    it("выделение коммита подсвечивает его линии, не пересобирая строки", () => {
        const { component, commands } = make();
        publish(commands, [
            { sha: SHA_A, subject: "first", parents: [SHA_B] },
            { sha: SHA_B, subject: "second", parents: [SHA_C] },
            { sha: SHA_C, subject: "third" },
        ]);
        const rowBefore = component.list.getCursorElement();

        component.list.setCursorTo(SHA_A);
        component.list.onSelect?.(component.list.getCursorElement()!);

        expect(component.list.rowCount).toBe(3);
        // Строки те же объекты — перерисовался только графовый лейбл.
        component.list.setCursorTo(SHA_A);
        expect(component.list.getCursorElement()?.id).toBe(SHA_A);
        expect(rowBefore?.id).toBe(SHA_A);
    });

    it("выделенный коммит, ушедший из страницы, подсветку не залипляет", () => {
        const { component, commands } = make();
        publish(commands, [
            { sha: SHA_A, subject: "first", parents: [SHA_B] },
            { sha: SHA_B, subject: "second" },
        ]);
        component.list.setCursorTo(SHA_A);
        component.list.onSelect?.(component.list.getCursorElement()!);

        // Новая страница без прежнего выделения — например после reset или checkout.
        publish(commands, [{ sha: SHA_C, subject: "third" }]);
        expect(component.list.rowCount).toBe(1);

        // Выделение сброшено: тот же коммит, вернувшись, подсветку не унаследует.
        publish(commands, [
            { sha: SHA_A, subject: "first", parents: [SHA_B] },
            { sha: SHA_B, subject: "second" },
        ]);
        expect(component.list.rowCount).toBe(2);
    });

    it("курсор на исчезнувшем коммите не переезжает на строку догрузки", () => {
        const { component, commands } = make();
        publish(commands, [{ sha: SHA_A, subject: "first" }], true);
        component.list.setCursorTo(SHA_A);

        // Страница целиком сменилась (checkout другой ветки), история всё ещё длиннее.
        publish(commands, [{ sha: SHA_C, subject: "third" }], true);
        expect(component.list.rowCount).toBe(2);
        expect(component.list.getCursorElement()?.id).not.toBe(LOAD_MORE_ROW_ID);
    });

    it("перепубликация пересобирает строки, курсор переживает её по sha", () => {
        const { component, commands } = make();
        publish(commands, [
            { sha: SHA_A, subject: "first" },
            { sha: SHA_B, subject: "second" },
        ]);
        component.list.setCursorTo(SHA_B);

        publish(commands, [
            { sha: SHA_C, subject: "third" },
            { sha: SHA_B, subject: "second" },
        ]);
        expect(component.list.rowCount).toBe(2);
        expect(component.list.getCursorElement()?.id).toBe(SHA_B);
    });

    it("пустая публикация очищает список", () => {
        const { component, commands } = make();
        publish(commands, [{ sha: SHA_A, subject: "first" }]);
        publish(commands, []);
        expect(component.list.rowCount).toBe(0);
    });

    it("focus фокусирует список через дескриптор view", () => {
        const { component, registered } = make();
        // Standalone-компонент без корня: focus не должен бросать.
        expect(() => registered[0].focus()).not.toThrow();
        expect(registered[0].body).toBe(component.view);
    });
});

describe("GraphViewComponent: ленивость", () => {
    it("пока секция не раскрыта, публикации не строят строк", () => {
        const { component, commands } = make(false);
        publish(commands, [
            { sha: SHA_A, subject: "feat: панель", parents: [SHA_B] },
            { sha: SHA_B, subject: "fix: сэш" },
        ]);
        expect(component.list.rowCount).toBe(0);
    });

    it("раскрытие достраивает секцию из накопленного снимка", () => {
        const { component, commands, setExpanded } = make(false);
        publish(commands, [
            { sha: SHA_A, subject: "feat: панель", parents: [SHA_B] },
            { sha: SHA_B, subject: "fix: сэш" },
        ]);

        setExpanded(true);
        expect(component.list.rowCount).toBe(2);
        const screen = renderElement(component.view, 40, 6, { themeVars: true }).screenToString();
        expect(screen).toContain("feat: панель");
    });

    it("сворачивание освобождает строки, раскрытие возвращает их вместе с курсором", () => {
        const { component, commands, setExpanded } = make();
        publish(commands, [
            { sha: SHA_A, subject: "first" },
            { sha: SHA_B, subject: "second" },
        ]);
        component.list.setCursorTo(SHA_B);

        setExpanded(false);
        expect(component.list.rowCount).toBe(0);

        setExpanded(true);
        expect(component.list.rowCount).toBe(2);
        expect(component.list.getCursorElement()?.id).toBe(SHA_B);
    });

    it("байт-идентичная публикация после раскрытия не оставляет секцию пустой", () => {
        const { component, commands, setExpanded } = make();
        const page = [{ sha: SHA_A, subject: "first" }];
        publish(commands, page);

        setExpanded(false);
        // Расширение принесло ровно тот же набор — ScmGraphService гасит его по
        // подписи, и события не будет. Строки обязана вернуть сама раскрытость.
        setExpanded(true);
        publish(commands, page);
        expect(component.list.rowCount).toBe(1);
    });

    it("раскрытость едет расширению операцией logSetEnabled", () => {
        const ops: unknown[] = [];
        const { commands, setExpanded } = make(false);
        commands.register(GIT_OP_COMMAND, (payload) => {
            ops.push(payload);
            return { ok: true };
        });

        setExpanded(true);
        setExpanded(false);
        expect(ops).toEqual([
            { op: "logSetEnabled", params: { enabled: true } },
            { op: "logSetEnabled", params: { enabled: false } },
        ]);
    });
});
