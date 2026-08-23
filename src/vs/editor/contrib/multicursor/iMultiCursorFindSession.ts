import type { IRange } from "../../common/core/iRange.ts";
import type { ISelection } from "../../common/core/iSelection.ts";

/** Что и как ищет семейство «выделить следующее вхождение». */
export interface IMultiCursorSearchSpec {
    /** Искомый текст. Никогда не содержит перевода строки — многострочный поиск не поддержан. */
    readonly searchText: string;
    /** Только целые слова: так стартует сессия от схлопнутой каретки (первый Ctrl+D). */
    readonly wholeWord: boolean;
    /**
     * Учитывать регистр. Пока всегда `true` — осознанное расхождение с VS Code, где эта ось
     * берётся из состояния find-виджета (по умолчанию выключена) и Ctrl+D на `foo` цепляет
     * `FOO`, портя регистр при наборе. Поле оставлено швом к `FindService`.
     */
    readonly matchCase: boolean;
}

/**
 * Живая сессия Ctrl+D: что ищем и куда доехали. Лежит на `EditorViewState`, потому что
 * умирает вместе со вью бесплатно; вся логика — чистые функции в `multiCursorSession.ts`.
 */
export interface IMultiCursorFindSession extends IMultiCursorSearchSpec {
    /**
     * Диапазон выделения, добавленного ПОСЛЕДНИМ, — точка отсчёта следующего шага.
     * Хранится явно: выделения отсортированы, поэтому «последний в массиве» ≠ «последний
     * добавленный».
     */
    readonly lastAdded: IRange;
    /**
     * Выделения, которые произвела сессия. Разошлись с текущими — значит пользователь
     * подвигал курсор мимо этих команд, и сессию надо начинать заново. Снимок ловит любую
     * причину (мышь, стрелки, undo, правка расширением, find) одним механизмом, без флагов
     * реентрантности в горячем сеттере модели.
     */
    readonly selectionsSnapshot: readonly ISelection[];
    /** Версия документа на момент снимка: любая правка обнуляет сессию. */
    readonly documentVersion: number;
}
