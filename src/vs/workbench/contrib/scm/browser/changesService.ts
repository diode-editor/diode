import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/** The extension pushes the set, the core registers the command: the reverse of {@link ORIGINAL_RESOURCE_COMMAND}. */
export const PUBLISH_CHANGES_COMMAND = "diode.scm.publishChanges";

/**
 * Like VS Code resource groups; untracked is shown under "Changes" (`scmChangeGroups.ts`).
 * An `MM` file arrives as two entries: in `index` and in `worktree`.
 */
export type ScmGroupId = "merge" | "index" | "worktree" | "untracked";

/** Order is display order (as in VS Code). */
export const SCM_GROUP_IDS: readonly ScmGroupId[] = ["merge", "index", "worktree", "untracked"];

export interface IScmChange {
    readonly uri: Uri;
    readonly status: string;
    /** Separate from `status`: untracked and conflicts both use the letter `U`, only the color tells them apart. */
    readonly colorId: string;
    /**
     * Relative to the repository root, `/`-separated. The extension computes it: matching absolute
     * paths in the core is unreliable (Windows: 8.3 names, drive letter case). Empty means basename.
     */
    readonly path: string;
    readonly group: ScmGroupId;
}

export const ScmChangesServiceDIToken = token<ScmChangesService>("ScmChangesService");

/**
 * The transport is a command, not the `scm` namespace: it is still commented out in `vscode.d.ts`
 * (docs/TODO/Diff.md). Moving to `scm` will replace the source, not this service.
 */
export class ScmChangesService extends Disposable {
    public static dependencies = [CommandRegistryDIToken] as const;

    private changeList: readonly IScmChange[] = [];
    /** Suppresses republishing the same set. */
    private signature = "";
    private readonly onDidChangeChangesEmitter = this.register(new Emitter<void>());

    public constructor(commands: CommandRegistry) {
        super();
        this.register(
            commands.register(PUBLISH_CHANGES_COMMAND, (payload) => {
                this.publish(payload);
            }),
        );
    }

    /** In the order received from the extension. */
    public get changes(): readonly IScmChange[] {
        return this.changeList;
    }

    public readonly onDidChangeChanges = this.onDidChangeChangesEmitter.event;

    /** A non-array means an empty set; malformed entries are dropped. */
    private publish(payload: unknown): void {
        const changes = parseChanges(payload);
        // The extension publishes the set on every refresh (and on active editor change):
        // without suppression the Changes tab would rebuild for nothing.
        const signature = changes
            .map((c) => `${c.uri.toString()}\t${c.status}\t${c.colorId}\t${c.path}\t${c.group}`)
            .join("\n");
        if (signature === this.signature) return;
        this.signature = signature;
        this.changeList = changes;
        this.onDidChangeChangesEmitter.fire();
    }
}

function parseChanges(payload: unknown): IScmChange[] {
    if (!Array.isArray(payload)) return [];
    const changes: IScmChange[] = [];
    for (const raw of payload) {
        if (typeof raw !== "object" || raw === null) continue;
        const { uri, status, colorId, path, group } = raw as {
            uri?: unknown;
            status?: unknown;
            colorId?: unknown;
            path?: unknown;
            group?: unknown;
        };
        if (typeof uri !== "string" || uri === "" || typeof status !== "string") continue;
        // The group is required and must be from the enum: staging commands decide
        // applicability by it, so an entry with a bogus group is worse than a skipped one.
        if (!SCM_GROUP_IDS.includes(group as ScmGroupId)) continue;
        changes.push({
            uri: Uri.parse(uri),
            status,
            colorId: typeof colorId === "string" ? colorId : "",
            path: typeof path === "string" ? path : "",
            group: group as ScmGroupId,
        });
    }
    return changes;
}
