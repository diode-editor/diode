import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";

import type { IViewContainerSnapshot } from "./viewsService.ts";

const ACTIVE_MARK = "●";

/**
 * The container switcher under the sidebar title — our stand-in for the activity bar (deviation:
 * upstream switches viewlets with the activity bar icons, a terminal has no room for that column).
 * Lists only sidebar containers: the panel and the auxiliary bar have their own tabs.
 */
export function containerSwitcherEntries(
    containers: readonly IViewContainerSnapshot[],
    activeId: string | null,
    open: (containerId: string) => void,
): MenuEntry[] {
    return containers
        .filter((container) => container.location === "sidebar")
        .map((container) => ({
            label: container.label ?? switcherLabel(container.title),
            // A blank icon keeps the labels in one column with the marked row.
            icon: container.id === activeId ? ACTIVE_MARK : " ",
            onSelect: () => {
                open(container.id);
            },
        }));
}

/**
 * Built-in container titles are stored upper-case, as upstream shows them (CSS `text-transform`); a
 * menu reads better in title case. A title with lower-case letters is already its author's casing
 * (a generated container carries its view's title) and stays as is.
 */
export function switcherLabel(title: string): string {
    if (title !== title.toUpperCase()) return title;
    return title
        .toLowerCase()
        .replace(/(^|\s)(\S)/g, (_match, space: string, letter: string) => space + letter.toUpperCase());
}
