import type { ITreeDataProvider, ITreeItem } from "../../../../../../tuidom/ui/tree/iTreeDataProvider.ts";

import type { IScmChange } from "./changesService.ts";

/** Узел вкладки Changes — один изменённый файл (список плоский, без группировки). */
export type ChangeNode = IScmChange;

/**
 * Данные плоского списка изменённых файлов. Провайдер-агностик: держит снимок,
 * выданный ему {@link setChanges}, а контроллер обновляет его по
 * `ScmChangesService.onDidChangeChanges`. Метка — путь относительно корня
 * репозитория (его прислало git-расширение), иначе basename; цвет буквы-статуса —
 * из карты `colorId → RGB`, которую пушит контроллер из темы.
 */
export class ChangesTreeDataProvider implements ITreeDataProvider<ChangeNode> {
    /** `gitDecoration.*` id → упакованный RGB, из темы (пушит контроллер). */
    public statusColors: Record<string, number> = {};
    public onChange?: (element?: ChangeNode) => void;

    private changeList: readonly ChangeNode[] = [];

    /** Заменяет содержимое списка снимком изменений (сортировка — по пути, стабильно). */
    public setChanges(changes: readonly IScmChange[]): void {
        this.changeList = [...changes].sort((a, b) => this.label(a).localeCompare(this.label(b)));
    }

    public getChildren(element?: ChangeNode): ChangeNode[] {
        // Плоский список: дети есть только у корня.
        return element === undefined ? [...this.changeList] : [];
    }

    public getTreeItem(element: ChangeNode): ITreeItem {
        return {
            label: this.label(element),
            collapsible: false,
            badge: element.status,
            labelColor: this.statusColors[element.colorId],
        };
    }

    public getKey(element: ChangeNode): string {
        return element.uri.toString();
    }

    /** Путь от git (относительно корня репо); если его нет — basename из URI. */
    private label(element: ChangeNode): string {
        if (element.path !== "") return element.path;
        const uriPath = element.uri.path;
        return uriPath.slice(uriPath.lastIndexOf("/") + 1);
    }
}
