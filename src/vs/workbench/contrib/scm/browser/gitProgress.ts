import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { combineWhen } from "../../../../platform/actions/common/commandAction.ts";
import { SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

const NOT_BUSY = "!gitOperationInProgress";

/**
 * Аналог `"enablement": "!operationInProgress"` у git-расширения VS Code, только
 * объявлен одним списком в `WORKBENCH_ACTIONS`, а не полем у каждой команды.
 */
export function gitMutating(action: CommandAction): CommandAction {
    return { ...action, enablement: combineWhen(action.enablement, NOT_BUSY) };
}

export interface IGitProgressTarget {
    readonly viewId: string;
    /** Сетевые операции идут секундами — их видно, даже когда в сайдбаре не Source Control. */
    readonly window: boolean;
}

const NETWORK_OPS = new Set(["pull", "push", "fetch", "sync"]);

/** Всё остальное адресуется CHANGES. */
const GRAPH_OPS = new Set(["logLoadMore", "refresh"]);

/** Неизвестная операция — «Working…»: подпись — украшение, ронять из-за неё нечего. */
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

export function gitProgressTarget(op: string): IGitProgressTarget {
    return {
        viewId: GRAPH_OPS.has(op) ? SCM_GRAPH_VIEW_ID : SCM_CHANGES_VIEW_ID,
        window: NETWORK_OPS.has(op),
    };
}
