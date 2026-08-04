import { Disposable, type IDisposable } from "../../../../../../tuidom/common/disposable.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/** Команда, которой git-расширение публикует снимок состояния репозитория. */
export const PUBLISH_REPO_STATE_COMMAND = "vexx.scm.publishRepoState";

export type ScmRepoOpState = "idle" | "merging" | "rebasing" | "cherry-picking";

export interface IScmRepoState {
    readonly branch: string | null;
    readonly detached: boolean;
    readonly upstream: string | null;
    readonly ahead: number;
    readonly behind: number;
    readonly remotes: readonly string[];
    readonly state: ScmRepoOpState;
}

/** До первой публикации: репозитория нет (или расширение не активно). */
const NO_REPO: IScmRepoState = {
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    remotes: [],
    state: "idle",
};

const OP_STATES: readonly ScmRepoOpState[] = ["idle", "merging", "rebasing", "cherry-picking"];

export const ScmRepoStateServiceDIToken = token<ScmRepoStateService>("ScmRepoStateService");

/**
 * Снимок состояния репозитория от git-расширения (ветка/upstream/ahead-behind/
 * remotes/merge-rebase) + деривация when-ключей `gitHasRepo, gitHasRemotes,
 * gitHasUpstream, gitMerging, gitRebasing, gitDetached` — на них висят
 * sync/branch/stash-команды. Паттерн — {@link ScmChangesService}: приватная
 * push-команда, валидация через границу процесса, дедуп по подписи.
 */
export class ScmRepoStateService extends Disposable {
    public static dependencies = [CommandRegistryDIToken, ContextKeyServiceDIToken] as const;

    private repoState: IScmRepoState = NO_REPO;
    private hasRepo = false;
    private signature = "";
    private readonly listeners = new Set<() => void>();

    public constructor(
        commands: CommandRegistry,
        private readonly contextKeys: ContextKeyService,
    ) {
        super();
        this.applyContextKeys();
        this.register(
            commands.register(PUBLISH_REPO_STATE_COMMAND, (payload) => {
                this.publish(payload);
            }),
        );
    }

    /** Последний опубликованный снимок ({@link NO_REPO} до первой публикации). */
    public get state(): IScmRepoState {
        return this.repoState;
    }

    /** Публиковалось ли состояние вообще (расширение активно, репозиторий есть). */
    public get hasRepository(): boolean {
        return this.hasRepo;
    }

    public onDidChangeState(listener: () => void): IDisposable {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            },
        };
    }

    private publish(payload: unknown): void {
        const parsed = parseRepoState(payload);
        if (parsed === null) return;
        const signature = JSON.stringify(parsed);
        if (this.hasRepo && signature === this.signature) return;
        this.signature = signature;
        this.repoState = parsed;
        this.hasRepo = true;
        this.applyContextKeys();
        for (const listener of [...this.listeners]) listener();
    }

    private applyContextKeys(): void {
        this.contextKeys.set("gitHasRepo", this.hasRepo);
        this.contextKeys.set("gitHasRemotes", this.repoState.remotes.length > 0);
        this.contextKeys.set("gitHasUpstream", this.repoState.upstream !== null);
        this.contextKeys.set("gitMerging", this.repoState.state === "merging");
        this.contextKeys.set("gitRebasing", this.repoState.state === "rebasing");
        this.contextKeys.set("gitDetached", this.repoState.detached);
    }
}

/** Валидация payload из-за границы процесса: всё непохожее — null (снимок не трогаем). */
function parseRepoState(payload: unknown): IScmRepoState | null {
    if (typeof payload !== "object" || payload === null) return null;
    const raw = payload as Record<string, unknown>;
    if (raw.branch !== null && typeof raw.branch !== "string") return null;
    if (raw.upstream !== null && typeof raw.upstream !== "string") return null;
    if (typeof raw.detached !== "boolean") return null;
    if (typeof raw.ahead !== "number" || typeof raw.behind !== "number") return null;
    if (!Array.isArray(raw.remotes) || !raw.remotes.every((r): r is string => typeof r === "string")) return null;
    if (!OP_STATES.includes(raw.state as ScmRepoOpState)) return null;
    return {
        branch: raw.branch,
        detached: raw.detached,
        upstream: raw.upstream,
        ahead: raw.ahead,
        behind: raw.behind,
        remotes: raw.remotes,
        state: raw.state as ScmRepoOpState,
    };
}
