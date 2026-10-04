import { token } from "../../instantiation/common/diContainer.ts";

/** Запись корзины: откуда файл удалён и где он теперь лежит. */
export interface ITrashEntry {
    /** Абсолютный путь, откуда файл удалён (куда восстанавливать). */
    readonly originalPath: string;
    /** Текущее положение в корзине. */
    readonly trashedPath: string;
    /** Сопроводительная запись корзины (у freedesktop — `.trashinfo`). */
    readonly infoPath: string;
}

/**
 * Системная корзина. Шире эталона: у vscode удаление в корзину из редактора не
 * отменяется, у нас Undo возвращает файл из корзины — поэтому кроме «удалить»
 * есть и «восстановить» (docs/TODO/FileService.md, §8 PR 3, §12.4).
 */
export interface ITrashService {
    /** Есть ли пригодная корзина (и можно ли в неё писать) — дёшево, без ожидания. */
    isAvailable(): boolean;
    /** Переносит путь в корзину. */
    trash(filePath: string): Promise<ITrashEntry>;
    /** Возвращает файл на место (или рядом, если место заняли). Отдаёт итоговый путь. */
    restore(entry: ITrashEntry): Promise<string>;
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const ITrashServiceDIToken = token<ITrashService>("TrashService");
