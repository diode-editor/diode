import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

/**
 * `update` is the same install: it removes previous versions. `installing` and `uninstalling` are upstream
 * `InstallingLabelAction` and `UninstallAction`'s `Uninstalling` label: disabled, in place of the action they run. `installAnotherVersion` is upstream
 * `InstallAnotherVersionAction`, which lives in the extension's context menu there; there is no such menu here.
 * `toggleAutoUpdate` is upstream `ToggleAutoUpdateForExtensionAction`.
 */
export type ExtensionButtonKind =
    | "install"
    | "update"
    | "installing"
    | "uninstalling"
    | "installAnotherVersion"
    | "uninstall"
    | "reload"
    | "toggleAutoUpdate";

export interface IExtensionButton {
    readonly kind: ExtensionButtonKind;
    readonly label: string;
    /** A disabled button is visible but cannot be pressed (incompatibility, operation in progress). */
    readonly enabled: boolean;
}

export interface IExtensionButtonState {
    readonly needsReload: boolean;
    /** The progress ticker's frame for an operation in progress. */
    readonly spinner: string;
    /** Download percent of an install, our deviation: upstream has none. `null`: indeterminate. */
    readonly percent: number | null;
    /** `extensions.autoUpdate` is `on`. */
    readonly autoUpdate: boolean;
}

export function describeExtensionButtons(entry: IExtensionListEntry, state: IExtensionButtonState): IExtensionButton[] {
    const buttons: IExtensionButton[] = [];
    // Reload goes first: after an install it is the user's next step,
    // and the page focus lands on it.
    if (state.needsReload) buttons.push({ kind: "reload", label: "Reload Window", enabled: true });
    const compatible = entry.availability !== "incompatible";
    const latest = entry.latestVersion;
    if (entry.operation === "installing") {
        // Upstream shows `Installing` whenever the state is, an update or a given version included.
        const percent = state.percent === null ? "" : ` ${String(state.percent)}%`;
        // Stryker disable next-line BooleanLiteral: the operation disables every button below anyway; `false` says so here too
        buttons.push({ kind: "installing", label: `${state.spinner} Installing${percent}`, enabled: false });
    } else if (entry.installedVersion === null) {
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
    if (entry.operation === "uninstalling") {
        // Stryker disable next-line BooleanLiteral: the operation disables every button below anyway; `false` says so here too
        buttons.push({ kind: "uninstalling", label: `${state.spinner} Uninstalling`, enabled: false });
    } else if (entry.installedVersion !== null) {
        buttons.push({ kind: "uninstall", label: "Uninstall", enabled: true });
    }
    // Only the registry updates (decision J2: checked is not pinned). With the setting off upstream keeps the
    // toggle for an allow-list we don't have: here it is visible, unchecked and disabled, and names the reason.
    if (entry.installedVersion !== null && latest !== null) buttons.push(autoUpdateButton(entry, state.autoUpdate));
    // No second operation while one runs, whoever started it.
    if (entry.operation === null) return buttons;
    return buttons.map((button) => ({ ...button, enabled: false }));
}

function autoUpdateButton(entry: IExtensionListEntry, autoUpdate: boolean): IExtensionButton {
    if (!autoUpdate) {
        return { kind: "toggleAutoUpdate", label: "[ ] Auto Update (extensions.autoUpdate is off)", enabled: false };
    }
    return { kind: "toggleAutoUpdate", label: `${entry.pinned ? "[ ]" : "[x]"} Auto Update`, enabled: true };
}
