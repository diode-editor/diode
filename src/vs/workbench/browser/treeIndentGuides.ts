import type { TreeIndentGuides } from "@tuidom/elements/tree/treeViewElement";

import type { IDisposable } from "../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../platform/configuration/common/iConfigurationService.ts";

const RENDER_INDENT_GUIDES = "workbench.tree.renderIndentGuides";

/** `workbench.tree.renderIndentGuides` as the `TreeViewElement` option: read on every frame. */
export function treeIndentGuides(configuration: IConfigurationService): () => TreeIndentGuides {
    return () => configuration.get(RENDER_INDENT_GUIDES);
}

/** The setting changed: the tree repaints, the option reads the new value in that frame. */
export function onDidChangeTreeIndentGuides(configuration: IConfigurationService, listener: () => void): IDisposable {
    return configuration.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(RENDER_INDENT_GUIDES)) listener();
    });
}
