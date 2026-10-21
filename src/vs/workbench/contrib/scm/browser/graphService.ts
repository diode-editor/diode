import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { GIT_OP_COMMAND } from "../common/gitProtocol.ts";

/**
 * The git extension pushes the set, the core registers the command; the string is duplicated
 * by value on the extension side, since there are no shared imports across the process boundary.
 */
export const PUBLISH_LOG_COMMAND = "diode.scm.publishLog";

/**
 * The only pull channel (the rest are push): on the first {@link ScmGraphService.setActive}
 * the extension may not exist yet, and an extension host restart wipes its memory.
 * The extension treats an `undefined` answer (no command) as "channel not supported".
 */
export const GRAPH_ENABLED_COMMAND = "diode.scm.graphEnabled";

/** A `diode.git.op` operation; the string is duplicated by value on the extension side. */
const LOG_SET_ENABLED_OP = "logSetEnabled";

export interface IScmCommitRef {
    readonly name: string;
    readonly kind: "head" | "remote" | "tag";
    /** The branch HEAD is on. */
    readonly current: boolean;
}

export interface IScmCommit {
    readonly sha: string;
    /** If absent, the core shortens the sha itself. */
    readonly shortSha: string;
    /** In git order; empty means a root commit. */
    readonly parents: readonly string[];
    readonly refs: readonly IScmCommitRef[];
    readonly author: string;
    /** Unix seconds. */
    readonly timestamp: number;
    readonly subject: string;
}

export const ScmGraphServiceDIToken = token<ScmGraphService>("ScmGraphService");

const REF_KINDS = new Set(["head", "remote", "tag"]);

/**
 * Built like {@link ScmChangesService}. The reverse end of the channel is {@link setActive}:
 * while GRAPH is collapsed, `git log` does not run, so the graph costs no subprocess per save.
 */
export class ScmGraphService extends Disposable {
    public static dependencies = [CommandRegistryDIToken] as const;

    private commitList: readonly IScmCommit[] = [];
    private more = false;
    /** Suppresses republishing the same set. */
    private signature = "";
    private readonly onDidChangeCommitsEmitter = this.register(new Emitter<void>());
    /** `null` means the core has not announced its state yet. */
    private active: boolean | null = null;

    public constructor(private readonly commands: CommandRegistry) {
        super();
        this.register(
            commands.register(PUBLISH_LOG_COMMAND, (payload) => {
                this.publish(payload);
            }),
        );
        this.register(commands.register(GRAPH_ENABLED_COMMAND, () => this.active === true));
    }

    /** Newest commits first. */
    public get commits(): readonly IScmCommit[] {
        return this.commitList;
    }

    public get hasMore(): boolean {
        return this.more;
    }

    /**
     * The first call is always sent, even if it matches the default. Best-effort: a lost
     * signal is picked up by the pull via {@link GRAPH_ENABLED_COMMAND}. Not `runGitOp`: it needs
     * a `ServiceAccessor` and shows a notice, while a background signal has nothing to tell the user.
     */
    public setActive(active: boolean): void {
        if (this.active === active) return;
        this.active = active;
        if (!this.commands.has(GIT_OP_COMMAND)) return;
        void Promise.resolve(
            this.commands.execute(GIT_OP_COMMAND, { op: LOG_SET_ENABLED_OP, params: { enabled: active } }),
        ).catch(
            /* v8 ignore next -- best-effort: the channel only drops when the process exits */
            () => undefined,
        );
    }

    public readonly onDidChangeCommits = this.onDidChangeCommitsEmitter.event;

    private publish(payload: unknown): void {
        const { commits, hasMore } = parseLogPayload(payload);
        const signature = `${hasMore ? "1" : "0"}\n${commits.map(commitSignature).join("\n")}`;
        if (signature === this.signature) return;
        this.signature = signature;
        this.commitList = commits;
        this.more = hasMore;
        this.onDidChangeCommitsEmitter.fire();
    }
}

/** Everything the frame depends on: sha, commit subject, graph layout and badges. */
function commitSignature(commit: IScmCommit): string {
    const refs = commit.refs.map((ref) => `${ref.kind}:${ref.current ? "*" : ""}${ref.name}`).join(",");
    return `${commit.sha}\t${commit.subject}\t${commit.parents.join(" ")}\t${refs}`;
}

function parseLogPayload(payload: unknown): { commits: IScmCommit[]; hasMore: boolean } {
    if (typeof payload !== "object" || payload === null) return { commits: [], hasMore: false };
    const { commits, hasMore } = payload as { commits?: unknown; hasMore?: unknown };
    return { commits: parseCommits(commits), hasMore: hasMore === true };
}

function parseCommits(raw: unknown): IScmCommit[] {
    if (!Array.isArray(raw)) return [];
    const commits: IScmCommit[] = [];
    for (const entry of raw) {
        if (typeof entry !== "object" || entry === null) continue;
        const { sha, shortSha, subject, parents, refs, author, timestamp } = entry as Record<string, unknown>;
        if (typeof sha !== "string" || sha === "" || typeof subject !== "string") continue;
        commits.push({
            sha,
            shortSha: typeof shortSha === "string" && shortSha !== "" ? shortSha : sha.slice(0, 8),
            parents: parseStringList(parents),
            refs: parseRefs(refs),
            author: typeof author === "string" ? author : "",
            timestamp: typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : 0,
            subject,
        });
    }
    return commits;
}

function parseStringList(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is string => typeof item === "string" && item !== "");
}

function parseRefs(raw: unknown): IScmCommitRef[] {
    if (!Array.isArray(raw)) return [];
    const refs: IScmCommitRef[] = [];
    for (const entry of raw) {
        if (typeof entry !== "object" || entry === null) continue;
        const { name, kind, current } = entry as Record<string, unknown>;
        if (typeof name !== "string" || name === "") continue;
        if (typeof kind !== "string" || !REF_KINDS.has(kind)) continue;
        refs.push({ name, kind: kind as IScmCommitRef["kind"], current: current === true });
    }
    return refs;
}
