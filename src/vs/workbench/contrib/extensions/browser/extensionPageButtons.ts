import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

/** `update` is the same install: it removes previous versions. */
export type ExtensionButtonKind = "install" | "update" | "uninstall" | "reload";

export interface IExtensionButton {
    readonly kind: ExtensionButtonKind;
    readonly label: string;
    /** A disabled button is visible but cannot be pressed (incompatibility, operation in progress). */
    readonly enabled: boolean;
}

export interface IExtensionButtonState {
    readonly busy: boolean;
    readonly needsReload: boolean;
}

export function describeExtensionButtons(entry: IExtensionListEntry, state: IExtensionButtonState): IExtensionButton[] {
    const buttons: IExtensionButton[] = [];
    // Reload goes first: after an install it is the user's next step,
    // and the page focus lands on it.
    if (state.needsReload) buttons.push({ kind: "reload", label: "Reload Window", enabled: true });
    const compatible = entry.availability !== "incompatible";
    if (entry.installedVersion === null) {
        // No registry entry: the button would lead to "not found in registry". Incompatible gets a disabled
        // button: "can't install" is an answer, while a missing button reads as unfinished work.
        if (entry.latestVersion !== null) {
            buttons.push({ kind: "install", label: "Install", enabled: compatible });
        }
    } else {
        const latest = entry.latestVersion;
        // Updating to an incompatible version is a dead end, not an action: no button.
        if (latest !== null && latest !== entry.installedVersion && compatible) {
            buttons.push({ kind: "update", label: `Update to ${latest}`, enabled: true });
        }
        buttons.push({ kind: "uninstall", label: "Uninstall", enabled: true });
    }
    if (!state.busy) return buttons;
    return buttons.map((button) => ({ ...button, enabled: false }));
}
