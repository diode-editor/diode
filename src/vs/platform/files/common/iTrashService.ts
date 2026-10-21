import { token } from "../../instantiation/common/diContainer.ts";

export interface ITrashEntry {
    /** Куда восстанавливать. */
    readonly originalPath: string;
    readonly trashedPath: string;
    /** У freedesktop — `.trashinfo`. */
    readonly infoPath: string;
}

/** Шире эталона: Undo возвращает файл из корзины, поэтому есть и «восстановить» (#480). */
export interface ITrashService {
    /** Дёшево, без ожидания. */
    isAvailable(): boolean;
    trash(filePath: string): Promise<ITrashEntry>;
    /** Место заняли — кладёт рядом. Отдаёт итоговый путь. */
    restore(entry: ITrashEntry): Promise<string>;
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const ITrashServiceDIToken = token<ITrashService>("TrashService");
