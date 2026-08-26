import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { combineWhen } from "../../../../platform/actions/common/commandAction.ts";
import { SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

/** Доступность мутирующих git-команд: пока идёт операция — недоступны. */
const NOT_BUSY = "!gitOperationInProgress";

/**
 * Помечает команду мутирующей: её `enablement` сужается ключом занятости, и
 * пока идёт другая операция, она гаснет во всех точках сразу (кнопка заголовка,
 * пункт меню, кейбинд, палитра). Аналог `"enablement": "!operationInProgress"`
 * у команд git-расширения VS Code — только объявлен одним списком в
 * `builtinActions`, а не полем у каждой команды.
 */
export function gitMutating(action: CommandAction): CommandAction {
    return { ...action, enablement: combineWhen(action.enablement, NOT_BUSY) };
}

/** Куда адресован прогресс операции и стоит ли дублировать его в статус-баре. */
export interface IGitProgressTarget {
    readonly viewId: string;
    /**
     * Показать ещё и в статус-баре: сетевые операции идут секундами, и их
     * видно, даже когда в сайдбаре открыт не Source Control.
     */
    readonly window: boolean;
}

/** Сетевые операции — единственные, которые стоят записи в статус-баре. */
const NETWORK_OPS = new Set(["pull", "push", "fetch", "sync"]);

/** Операции секции GRAPH; всё остальное адресуется CHANGES. */
const GRAPH_OPS = new Set(["logLoadMore", "refresh"]);

/**
 * Подпись прогресса по имени операции — герундий, как в VS Code
 * («Committing…», «Syncing Changes…»). Неизвестная операция получает
 * нейтральное «Working…»: подпись — украшение, ронять из-за неё нечего.
 */
export function gitProgressTitle(op: string): string {
    switch (op) {
        case "commit":
            return "Committing…";
        case "undoCommit":
            return "Undoing Commit…";
        case "stage":
            return "Staging…";
        case "unstage":
            return "Unstaging…";
        case "clean":
            return "Discarding…";
        case "pull":
            return "Pulling…";
        case "push":
        case "pushDelete":
            return "Pushing…";
        case "fetch":
            return "Fetching…";
        case "sync":
            return "Syncing Changes…";
        case "checkout":
            return "Checking Out…";
        case "branchCreate":
        case "branchDelete":
        case "branchRename":
            return "Updating Branch…";
        case "merge":
        case "mergeAbort":
            return "Merging…";
        case "rebase":
        case "rebaseAbort":
            return "Rebasing…";
        case "cherryPick":
            return "Cherry-Picking…";
        case "reset":
            return "Resetting…";
        case "revert":
            return "Reverting…";
        case "stashPush":
        case "stashPop":
        case "stashApply":
        case "stashDrop":
        case "stashClear":
            return "Stashing…";
        case "remoteAdd":
        case "remoteRemove":
            return "Updating Remotes…";
        case "tagCreate":
        case "tagDelete":
            return "Updating Tags…";
        case "logLoadMore":
        case "refresh":
            return "Loading History…";
        default:
            return "Working…";
    }
}

/** Секция, чей заголовок крутит спиннер, и нужен ли дубль в статус-баре. */
export function gitProgressTarget(op: string): IGitProgressTarget {
    return {
        viewId: GRAPH_OPS.has(op) ? SCM_GRAPH_VIEW_ID : SCM_CHANGES_VIEW_ID,
        window: NETWORK_OPS.has(op),
    };
}
