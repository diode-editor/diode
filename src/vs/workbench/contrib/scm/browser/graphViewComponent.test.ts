import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import type { IViewDescriptor } from "../../../browser/parts/views/viewsService.ts";

import { SCM_VIEWLET_ID } from "./changesComponent.ts";
import { PUBLISH_LOG_COMMAND, ScmGraphService } from "./graphService.ts";
import { GraphViewComponent, SCM_GRAPH_VIEW_ID } from "./graphViewComponent.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function make(): {
    component: GraphViewComponent;
    commands: CommandRegistry;
    registered: IViewDescriptor[];
} {
    const commands = new CommandRegistry();
    const graphService = new ScmGraphService(commands);
    const registered: IViewDescriptor[] = [];
    const viewsService = {
        registerView: (descriptor: IViewDescriptor) => {
            registered.push(descriptor);
        },
    } as unknown as ViewsService;
    const component = new GraphViewComponent(graphService, viewsService);
    return { component, commands, registered };
}

function publish(commands: CommandRegistry, entries: { sha: string; subject: string }[]): void {
    commands.execute(
        PUBLISH_LOG_COMMAND,
        entries.map((e) => ({ sha: e.sha, shortSha: e.sha.slice(0, 8), subject: e.subject })),
    );
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

    it("рисует короткий sha и subject коммита; id строки — полный sha", () => {
        const { component, commands } = make();
        publish(commands, [
            { sha: SHA_A, subject: "feat: панель" },
            { sha: SHA_B, subject: "fix: сэш" },
        ]);

        expect(component.list.rowCount).toBe(2);
        const screen = renderElement(component.view, 40, 6, { themeVars: true }).screenToString();
        expect(screen).toContain("aaaaaaaa");
        expect(screen).toContain("feat: панель");
        expect(screen).toContain("bbbbbbbb");
        expect(screen).toContain("fix: сэш");
        component.list.setCursorTo(SHA_B);
        expect(component.list.getCursorElement()?.id).toBe(SHA_B);
    });

    it("перепубликация пересобирает строки, курсор переживает её по sha", () => {
        const { component, commands } = make();
        publish(commands, [
            { sha: SHA_A, subject: "first" },
            { sha: SHA_B, subject: "second" },
        ]);
        component.list.setCursorTo(SHA_B);

        publish(commands, [
            { sha: "c".repeat(40), subject: "third" },
            { sha: SHA_B, subject: "second" },
        ]);
        expect(component.list.rowCount).toBe(2);
        expect(component.list.getCursorElement()?.id).toBe(SHA_B);
    });

    it("пустая публикация очищает список", () => {
        const { component, commands } = make();
        publish(commands, [{ sha: SHA_A, subject: "first" }]);
        commands.execute(PUBLISH_LOG_COMMAND, []);
        expect(component.list.rowCount).toBe(0);
    });

    it("focus фокусирует список через дескриптор view", () => {
        const { component, registered } = make();
        // Standalone-компонент без корня: focus не должен бросать.
        expect(() => registered[0].focus()).not.toThrow();
        expect(registered[0].body).toBe(component.view);
    });
});
