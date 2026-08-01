import type { StyleColor } from "../../dom/styles/tuiStyle.ts";

export interface ITreeItem {
    readonly label: string;
    readonly icon?: string;
    readonly iconColor?: StyleColor;
    readonly collapsible: boolean;
    /** Помечает элемент как символическую ссылку: рисуется стрелка-badge у левого края. */
    readonly symlink?: boolean;
    /** Буква-бейдж статуса (1–2 символа), рисуется у правого края строки (напр. git-статус). */
    readonly badge?: string;
    /** Упакованный RGB-цвет имени: переопределяет fg спана метки (напр. git-статус). */
    readonly labelColor?: StyleColor;
}

export interface ITreeDataProvider<T> {
    getTreeItem(element: T): ITreeItem;
    getChildren(element?: T): T[] | Promise<T[]>;
    getKey(element: T): string;
    onChange?: (element?: T) => void;
}
