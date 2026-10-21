import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

/** `update` — та же установка: она сносит прежние версии. */
export type ExtensionButtonKind = "install" | "update" | "uninstall" | "reload";

export interface IExtensionButton {
    readonly kind: ExtensionButtonKind;
    readonly label: string;
    /** Выключенная кнопка видна, но не нажимается (несовместимость, идущая операция). */
    readonly enabled: boolean;
}

export interface IExtensionButtonState {
    readonly busy: boolean;
    readonly needsReload: boolean;
}

export function describeExtensionButtons(entry: IExtensionListEntry, state: IExtensionButtonState): IExtensionButton[] {
    const buttons: IExtensionButton[] = [];
    // Перезагрузка идёт первой: после установки это следующий шаг пользователя,
    // и фокус страницы встаёт именно на неё.
    if (state.needsReload) buttons.push({ kind: "reload", label: "Reload Window", enabled: true });
    const compatible = entry.availability !== "incompatible";
    if (entry.installedVersion === null) {
        // Записи в реестре нет — кнопка вела бы в «not found in registry». Несовместимое — выключенной
        // кнопкой: «поставить нельзя» — ответ, а отсутствие кнопки читается как недоделка.
        if (entry.latestVersion !== null) {
            buttons.push({ kind: "install", label: "Install", enabled: compatible });
        }
    } else {
        const latest = entry.latestVersion;
        // Обновление до несовместимой версии — не действие, а тупик: кнопки нет.
        if (latest !== null && latest !== entry.installedVersion && compatible) {
            buttons.push({ kind: "update", label: `Update to ${latest}`, enabled: true });
        }
        buttons.push({ kind: "uninstall", label: "Uninstall", enabled: true });
    }
    if (!state.busy) return buttons;
    return buttons.map((button) => ({ ...button, enabled: false }));
}
