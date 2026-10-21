import type { IRange } from "../../common/core/iRange.ts";
import type { ISelection } from "../../common/core/iSelection.ts";

export interface IMultiCursorSearchSpec {
    /** Без перевода строки — многострочный поиск не поддержан. */
    readonly searchText: string;
    readonly wholeWord: boolean;
    /**
     * Пока всегда `true` — осознанное расхождение с VS Code, где ось берётся из find-виджета
     * (по умолчанию выключена) и Ctrl+D на `foo` цепляет `FOO`, портя регистр при наборе.
     */
    readonly matchCase: boolean;
}

export interface IMultiCursorFindSession extends IMultiCursorSearchSpec {
    /** Хранится явно: выделения отсортированы, «последний в массиве» ≠ «последний добавленный». */
    readonly lastAdded: IRange;
    /**
     * Разошлись с текущими — сессию начинать заново. Снимок ловит любую причину (мышь, undo,
     * правка расширением, find) без флагов реентрантности в горячем сеттере модели.
     */
    readonly selectionsSnapshot: readonly ISelection[];
    readonly documentVersion: number;
}
