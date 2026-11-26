import { describe, expect, it } from "vitest";

import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import { withSortBy } from "../common/extensionQuery.ts";

import { EXTENSION_CATEGORIES, EXTENSION_FILTER_ACTIONS } from "./extensionFilterActions.ts";
import { EXTENSIONS_VIEWLET_ID, ExtensionsComponentDIToken } from "./extensionsComponent.ts";

function run(id: string, initialQuery = ""): { shown: string[]; query: string } {
    const shown: string[] = [];
    let query = initialQuery;
    const accessor = {
        get: (token: unknown) => {
            if (token === SidebarServiceDIToken) return { showViewlet: (viewlet: string) => shown.push(viewlet) };
            if (token === ExtensionsComponentDIToken) {
                return {
                    getQuery: () => query,
                    setQuery: (value: string) => {
                        query = value;
                    },
                };
            }
            throw new Error("unexpected token");
        },
    } as unknown as ServiceAccessor;
    action(id).run(accessor);
    return { shown, query };
}

function action(id: string): CommandAction {
    const found = EXTENSION_FILTER_ACTIONS.find((a) => a.id === id);
    expect(found, `action ${id} not found`).toBeDefined();
    return found!;
}

describe("extension filter actions", () => {
    it("Installed and Updates open the marketplace with upstream's queries", () => {
        expect(run("workbench.extensions.action.installedExtensions")).toEqual({
            shown: [EXTENSIONS_VIEWLET_ID],
            query: "@installed ",
        });
        expect(run("workbench.extensions.action.extensionUpdates").query).toBe("@updates");
        expect(action("workbench.extensions.action.installedExtensions").title).toBe(
            "Extensions: Show Installed Extensions",
        );
        expect(action("workbench.extensions.action.extensionUpdates").title).toBe("Extensions: Show Extension Updates");
    });

    it("a category searches for it lowercased and quoted; categories stay out of the palette", () => {
        expect(run("extensions.actions.searchByCategory.Programming Languages").query).toBe(
            '@category:"programming languages"',
        );
        const categories = EXTENSION_FILTER_ACTIONS.filter((a) =>
            a.id.startsWith("extensions.actions.searchByCategory."),
        );
        expect(categories.map((a) => a.title)).toEqual(EXTENSION_CATEGORIES);
        for (const category of categories) {
            expect(category.menus).toContainEqual({ menuId: MenuId.CommandPalette, when: "false" });
        }
    });

    it("a sort keeps the query and replaces its @sort:", () => {
        expect(run("extensions.sort.name", "@category:themes dark @sort:publishedDate").query).toBe(
            "@category:themes dark @sort:name",
        );
        expect(run("extensions.sort.publishedDate").query).toBe("@sort:publishedDate");
    });
});

describe("withSortBy", () => {
    it("appends the sort after the query, replacing any previous one", () => {
        expect(withSortBy("", "name")).toBe("@sort:name");
        expect(withSortBy("  acme  ", "name")).toBe("acme @sort:name");
        expect(withSortBy("@sort:name-desc acme", "publishedDate")).toBe("acme @sort:publishedDate");
    });
});
