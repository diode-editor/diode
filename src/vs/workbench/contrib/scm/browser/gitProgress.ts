import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { combineWhen } from "../../../../platform/actions/common/commandAction.ts";
import { SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

const NOT_BUSY = "!gitOperationInProgress";

/**
 * Counterpart of `"enablement": "!operationInProgress"` in the VS Code git extension, but
 * declared as one list in `WORKBENCH_ACTIONS` rather than a field on each command.
 */
export function gitMutating(action: CommandAction): CommandAction {
    return { ...action, enablement: combineWhen(action.enablement, NOT_BUSY) };
}

export interface IGitProgressTarget {
    readonly viewId: string;
    /** Network operations take seconds, so they show even when the sidebar is not on Source Control. */
    readonly window: boolean;
}

const NETWORK_OPS = new Set(["pull", "push", "fetch", "sync"]);

/** Everything else goes to CHANGES. */
const GRAPH_OPS = new Set(["logLoadMore"]);

/** An unknown operation gets "Working…": the title is cosmetic, nothing worth failing over. */
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
            return "Loading History…";
        case "refresh":
            return "Refreshing…";
        default:
            return "Working…";
    }
}

/** `viewId` overrides the section: one op is started from several titles (`refresh` from CHANGES and GRAPH). */
export function gitProgressTarget(op: string, viewId?: string): IGitProgressTarget {
    return {
        viewId: viewId ?? (GRAPH_OPS.has(op) ? SCM_GRAPH_VIEW_ID : SCM_CHANGES_VIEW_ID),
        window: NETWORK_OPS.has(op),
    };
}
