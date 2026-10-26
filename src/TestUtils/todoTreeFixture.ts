import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";

/** Scans the workspace with rg from `env.appRoot`; the TODOS view stays hidden until the first match. */
export const TODO_TREE_ID = "Gruntfuggly.todo-tree";

export const TODO_TREE_CONTAINER = "workbench.view.extension.todo-tree-container";

export interface IInstalledTodoTree {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

export async function installTodoTree(): Promise<IInstalledTodoTree> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(TODO_TREE_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
