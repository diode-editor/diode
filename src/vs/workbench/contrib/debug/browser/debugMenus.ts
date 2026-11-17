// Upstream `debug.contribution.ts`, "Editor Title Menu's Run/Debug dropdown item": the `editor/title/run` submenu
// as a split button left of the other editor title buttons. Its items come from extensions (Python, Java, JBang).

import { codicon } from "../../../../base/common/codicons.ts";
import type { ISubmenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";

export const DEBUG_MENU_SUBMENUS: readonly ISubmenuContribution[] = [
    {
        menuId: MenuId.EditorTitle,
        submenu: MenuId.EditorTitleRun,
        isSplitButton: { togglePrimaryAction: true },
        title: "Run or Debug...",
        // Upstream `icons.debugRun` is `Codicon.run`, an alias of `play`.
        icon: codicon("play"),
        group: "navigation",
        order: -1,
    },
];
