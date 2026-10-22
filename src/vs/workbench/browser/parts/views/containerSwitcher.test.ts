import type { MenuItemEntry } from "@tuidom/elements/menu/popupMenuElement";
import { describe, expect, it } from "vitest";

import { containerSwitcherEntries, switcherLabel } from "./containerSwitcher.ts";
import type { IViewContainerSnapshot } from "./viewsService.ts";

function container(id: string, title: string, location: IViewContainerSnapshot["location"]): IViewContainerSnapshot {
    return { id, title, location, views: [], rejectAddedViews: false };
}

describe("containerSwitcherEntries", () => {
    it("lists only sidebar containers in their order, marks the active one and opens the picked one", () => {
        const opened: string[] = [];
        const entries = containerSwitcherEntries(
            [
                container("explorer", "EXPLORER", "sidebar"),
                container("terminal", "TERMINAL", "panel"),
                container("scm", "SOURCE CONTROL", "sidebar"),
                container("outline", "OUTLINE", "auxiliarybar"),
            ],
            "scm",
            (id) => opened.push(id),
        ) as MenuItemEntry[];

        expect(entries.map((entry) => [entry.icon, entry.label])).toEqual([
            [" ", "Explorer"],
            ["●", "Source Control"],
        ]);
        entries[0].onSelect?.();
        expect(opened).toEqual(["explorer"]);
    });

    it("a container's own label wins over the derived one", () => {
        const entries = containerSwitcherEntries(
            [{ ...container("tf", "HASHICORP TERRAFORM", "sidebar"), label: "HashiCorp Terraform" }],
            null,
            () => {},
        );
        expect((entries[0] as MenuItemEntry).label).toBe("HashiCorp Terraform");
    });

    it("without an active container nothing is marked", () => {
        const entries = containerSwitcherEntries([container("explorer", "EXPLORER", "sidebar")], null, () => {});
        expect((entries[0] as MenuItemEntry).icon).toBe(" ");
    });
});

describe("switcherLabel", () => {
    it("an upper-case title reads in title case, word by word", () => {
        expect(switcherLabel("SOURCE CONTROL")).toBe("Source Control");
        expect(switcherLabel("HCP TERRAFORM")).toBe("Hcp Terraform");
        expect(switcherLabel("RUN-AND DEBUG")).toBe("Run-and Debug");
    });

    it("an author's own casing stays as is", () => {
        expect(switcherLabel("GitLens Inspect")).toBe("GitLens Inspect");
        expect(switcherLabel("")).toBe("");
    });
});
