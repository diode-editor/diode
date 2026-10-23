import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

/**
 * `update` is the same install: it removes previous versions. `installAnotherVersion` is upstream
 * `InstallAnotherVersionAction`, which lives in the extension's context menu there; there is no such menu here.
 */
export type ExtensionButtonKind = "install" | "update" | "installAnotherVersion" | "uninstall" | "reload";

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
    const latest = entry.latestVersion;
    if (entry.installedVersion === null) {
        // No registry entry: the button would lead to "not found in registry". Incompatible gets a disabled
        // button: "can't install" is an answer, while a missing button reads as unfinished work.
        if (latest !== null) {
            buttons.push({ kind: "install", label: "Install", enabled: compatible });
        }
    } else if (entry.availability === "outdated") {
        // By semver against the highest compatible version: a newer `.vsix` or a rollback of the registry is not
        // an update, and an incompatible latest is not a target (US-2.1, US-2.3).
        buttons.push({ kind: "update", label: `Update to ${String(latest)}`, enabled: true });
    }
    // Only the registry knows other versions; an incompatible latest may still have older compatible ones.
    if (latest !== null) {
        buttons.push({ kind: "installAnotherVersion", label: "Install Specific Version...", enabled: true });
    }
    if (entry.installedVersion !== null) buttons.push({ kind: "uninstall", label: "Uninstall", enabled: true });
    if (!state.busy) return buttons;
    return buttons.map((button) => ({ ...button, enabled: false }));
}
