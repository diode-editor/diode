import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";

import { BRANCH_ACTIONS } from "./branchActions.ts";
import {
    scmFocusChangesAction,
    scmFocusInputAction,
    scmOpenChangesAction,
    scmOpenFileAction,
    scmViewAsListAction,
    scmViewAsTreeAction,
    showScmAction,
} from "./changesActions.ts";
import { COMMIT_ACTIONS } from "./commitActions.ts";
import { compareWithHeadAction } from "./compareWithHeadAction.ts";
import { gitMutating } from "./gitProgress.ts";
import { GRAPH_VIEW_ACTIONS } from "./graphActions.ts";
import { GRAPH_COMMIT_ACTIONS } from "./graphCommitActions.ts";
import { gitShowOutputAction, REMOTE_TAG_ACTIONS } from "./remoteTagActions.ts";
import {
    gitCleanAction,
    gitCleanAllAction,
    gitStageAction,
    gitStageAllAction,
    gitUnstageAction,
    gitUnstageAllAction,
} from "./stagingActions.ts";
import { STASH_ACTIONS } from "./stashActions.ts";
import { SYNC_ACTIONS } from "./syncActions.ts";

/**
 * Экшены фичи scm одним массивом. Всё, что мутирует репозиторий (или гоняет
 * git по нашей команде), гасится на время уже идущей операции —
 * `enablement: !gitOperationInProgress` ({@link gitMutating}). В VS Code это
 * поле у каждой команды манифеста; у нас — один список здесь, чтобы не
 * расходился с тем, что реально ходит через транспортные швы. Регистрирует
 * агрегатор (`WORKBENCH_ACTIONS`).
 */
export const SCM_ACTIONS: readonly CommandAction[] = [
    compareWithHeadAction,
    showScmAction,
    scmOpenFileAction,
    scmOpenChangesAction,
    scmViewAsTreeAction,
    scmViewAsListAction,
    scmFocusInputAction,
    scmFocusChangesAction,
    gitShowOutputAction,
    ...[
        ...GRAPH_VIEW_ACTIONS,
        ...GRAPH_COMMIT_ACTIONS,
        gitStageAction,
        gitUnstageAction,
        gitStageAllAction,
        gitUnstageAllAction,
        gitCleanAction,
        gitCleanAllAction,
        ...COMMIT_ACTIONS,
        ...SYNC_ACTIONS,
        ...BRANCH_ACTIONS,
        ...STASH_ACTIONS,
        ...REMOTE_TAG_ACTIONS,
    ].map(gitMutating),
];
