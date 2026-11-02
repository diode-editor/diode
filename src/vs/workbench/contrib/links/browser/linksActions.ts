import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";

import { LinksServiceDIToken } from "./linksService.ts";

/** Upstream `OpenLinkAction`: no keybinding and no precondition. */
export const openLinkAction: CommandAction = {
    id: "editor.action.openLink",
    title: "Open Link",
    run(accessor) {
        accessor.get(LinksServiceDIToken).openLinksAtSelections();
    },
};

export const LINKS_ACTIONS: readonly CommandAction[] = [openLinkAction];
