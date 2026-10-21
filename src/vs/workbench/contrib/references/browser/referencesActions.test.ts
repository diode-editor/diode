import { describe, expect, it } from "vitest";

import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { formatKeybinding, KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { SidebarService } from "../../../browser/parts/sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";

import {
    clearReferencesAction,
    collapseReferencesAction,
    expandReferencesAction,
    findAllReferencesAction,
    nextReferenceAction,
    previousReferenceAction,
    showReferencesAction,
} from "./referencesActions.ts";
import type { ReferencesComponent } from "./referencesComponent.ts";
import { REFERENCES_VIEW_ID, REFERENCES_VIEWLET_ID, ReferencesComponentDIToken } from "./referencesComponent.ts";
import type { ReferencesService } from "./referencesService.ts";
import { ReferencesServiceDIToken } from "./referencesService.ts";

function makeAccessor(): { accessor: Container; calls: string[] } {
    const calls: string[] = [];
    const accessor = new Container();
    accessor.bind(
        SidebarServiceDIToken,
        () => ({ showViewlet: (id: string) => calls.push(`show:${id}`) }) as unknown as SidebarService,
    );
    accessor.bind(
        ReferencesServiceDIToken,
        () =>
            ({
                findReferences: () => {
                    calls.push("find");
                    return Promise.resolve();
                },
                clear: () => calls.push("clear"),
            }) as unknown as ReferencesService,
    );
    accessor.bind(
        ReferencesComponentDIToken,
        () =>
            ({
                goToNextReference: () => calls.push("next"),
                goToPreviousReference: () => calls.push("prev"),
                collapseDeepestLevel: () => calls.push("collapse"),
                expandAll: () => calls.push("expand"),
            }) as unknown as ReferencesComponent,
    );
    return { accessor, calls };
}

function keybindingOf(action: typeof findAllReferencesAction): string | undefined {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    registerAction(commands, keybindings, new Container(), action);
    const bound = keybindings.getKeybindingForCommand(action.id);
    return bound == null ? undefined : formatKeybinding(bound);
}

describe("referencesActions — declarations", () => {
    it("command ids match VS Code", () => {
        expect(findAllReferencesAction.id).toBe("references-view.findReferences");
        expect(nextReferenceAction.id).toBe("references-view.next");
        expect(previousReferenceAction.id).toBe("references-view.prev");
        expect(clearReferencesAction.id).toBe("references-view.clear");
    });

    it("Find All References: the chord is the primary path, Shift+Alt+F12 the second keybinding", () => {
        expect(keybindingOf(findAllReferencesAction)).toBe("Ctrl+K Ctrl+R");
        // The canonical VS Code binding stays, but F-keys with modifiers don't
        // reach us on every terminal — hence the chord is the primary one.
        expect(findAllReferencesAction.keybindings).toHaveLength(1);
        expect(findAllReferencesAction.when).toBe("textInputFocus");
    });

    it("F4/Shift+F4 work while the panel has a result", () => {
        expect(keybindingOf(nextReferenceAction)).toBe("F4");
        expect(keybindingOf(previousReferenceAction)).toBe("Shift+F4");
        expect(nextReferenceAction.when).toBe("hasReferenceResult");
        expect(previousReferenceAction.when).toBe("hasReferenceResult");
    });

    it("showing the viewlet lives in the View menu after Extensions", () => {
        expect(keybindingOf(showReferencesAction)).toBe("Ctrl+K R");
        const placement = showReferencesAction.menus?.[0];
        expect(placement?.menuId).toBe(MenuId.MenubarViewMenu);
        expect(placement?.group).toBe("3_views");
        // Extensions is at 16 — References comes next.
        expect(placement?.order).toBe(18);
    });

    it("title buttons belong only to their own section and share one slot", () => {
        for (const action of [collapseReferencesAction, expandReferencesAction, clearReferencesAction]) {
            const placement = action.menus?.[0];
            expect(placement?.menuId).toBe(MenuId.ViewTitle);
            expect(placement?.group).toBe("navigation");
            expect(placement?.visible?.({ view: REFERENCES_VIEW_ID })).toBe(true);
            expect(placement?.visible?.({ view: "workbench.search.results" })).toBe(false);
            expect(action.when).toBe("referencesViewletVisible");
        }

        // Collapse and Expand share one slot with mutually exclusive conditions.
        expect(collapseReferencesAction.menus?.[0].order).toBe(expandReferencesAction.menus?.[0].order);
        expect(collapseReferencesAction.menus?.[0].when).toBe(
            "!hasReferenceResult || referencesViewHasSomeCollapsibleResult",
        );
        expect(expandReferencesAction.menus?.[0].when).toBe(
            "hasReferenceResult && !referencesViewHasSomeCollapsibleResult",
        );
        expect(clearReferencesAction.menus?.[0].when).toBe("hasReferenceResult");
    });
});

describe("referencesActions — delegation", () => {
    it("each action calls its own service", () => {
        const h = makeAccessor();

        findAllReferencesAction.run(h.accessor);
        showReferencesAction.run(h.accessor);
        nextReferenceAction.run(h.accessor);
        previousReferenceAction.run(h.accessor);
        clearReferencesAction.run(h.accessor);
        collapseReferencesAction.run(h.accessor);
        expandReferencesAction.run(h.accessor);

        expect(h.calls).toEqual([
            "find",
            `show:${REFERENCES_VIEWLET_ID}`,
            "next",
            "prev",
            "clear",
            "collapse",
            "expand",
        ]);
    });
});
