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
