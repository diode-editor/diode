import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";

import {
    copyLinesDownAction,
    copyLinesUpAction,
    deleteLinesAction,
    duplicateSelectionAction,
    moveLinesDownAction,
    moveLinesUpAction,
} from "./lineOperationActions.ts";
import { insertFinalNewLineAction, trimTrailingWhitespaceAction } from "./whitespaceActions.ts";

/**
 * Экшены фичи linesOperations одним массивом (как `editor/contrib/linesOperations`
 * upstream): дубль, перенос и удаление строк, обрезка хвостовых пробелов и
 * финальный перевод строки. Регистрирует агрегатор (`WORKBENCH_ACTIONS`).
 */
export const LINES_OPERATIONS_ACTIONS: readonly CommandAction[] = [
    copyLinesUpAction,
    copyLinesDownAction,
    moveLinesUpAction,
    moveLinesDownAction,
    duplicateSelectionAction,
    deleteLinesAction,
    trimTrailingWhitespaceAction,
    insertFinalNewLineAction,
];
