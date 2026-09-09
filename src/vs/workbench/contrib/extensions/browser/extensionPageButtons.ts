import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

/**
 * Кнопки страницы расширения как данные: что показать и что из этого доступно.
 * Чистая функция — её читают тесты, а элемент лишь делает из описания
 * `ButtonElement`ы (тот же приём, что `describeExtensionRow` у строк списка).
 */

/** Что делает кнопка. `update` — та же установка: она сносит прежние версии. */
export type ExtensionButtonKind = "install" | "update" | "uninstall" | "reload";

export interface IExtensionButton {
    readonly kind: ExtensionButtonKind;
    readonly label: string;
    /** Выключенная кнопка видна, но не нажимается (несовместимость, идущая операция). */
    readonly enabled: boolean;
}

export interface IExtensionButtonState {
    /** Идёт установка/удаление: кнопки гаснут, чтобы не запустить вторую операцию. */
    readonly busy: boolean;
    /** Расширение ставили/удаляли в этой сессии — вклады доедут после перезагрузки окна. */
    readonly needsReload: boolean;
}

export function describeExtensionButtons(
    entry: IExtensionListEntry,
    state: IExtensionButtonState,
): IExtensionButton[] {
    const buttons: IExtensionButton[] = [];
    // Перезагрузка идёт первой: после установки это следующий шаг пользователя,
    // и фокус страницы встаёт именно на неё.
    if (state.needsReload) buttons.push({ kind: "reload", label: "Reload Window", enabled: true });
    const compatible = entry.availability !== "incompatible";
    if (entry.installedVersion === null) {
        // Ставить нечего, если записи в реестре нет (расширение поставили из
        // файла и уже удалили): кнопка вела бы прямиком в «not found in registry».
        // Несовместимое, наоборот, показываем выключенной кнопкой — «поставить
        // нельзя» это ответ, а отсутствие кнопки читается как недоделка.
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
