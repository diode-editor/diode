import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { GIT_OP_COMMAND } from "../common/gitProtocol.ts";

/**
 * Набор пушит git-расширение, команду регистрирует ядро; строка дублируется по
 * значению на стороне расширения — общих импортов через границу процесса нет.
 */
export const PUBLISH_LOG_COMMAND = "diode.scm.publishLog";

/**
 * Единственный pull-канал (остальные — push): на первом {@link ScmGraphService.setActive}
 * расширения может ещё не быть, а перезапуск extension host'а обнуляет его память.
 * Ответ `undefined` (команды нет) расширение трактует как «канал не поддержан».
 */
export const GRAPH_ENABLED_COMMAND = "diode.scm.graphEnabled";

/** Операция `diode.git.op`; строка дублируется по значению на стороне расширения. */
const LOG_SET_ENABLED_OP = "logSetEnabled";

export interface IScmCommitRef {
    readonly name: string;
    readonly kind: "head" | "remote" | "tag";
    /** Ветка, на которой стоит HEAD. */
    readonly current: boolean;
}

export interface IScmCommit {
    readonly sha: string;
    /** При отсутствии ядро урезает sha само. */
    readonly shortSha: string;
    /** В порядке git; пусто — корневой коммит. */
    readonly parents: readonly string[];
    readonly refs: readonly IScmCommitRef[];
    readonly author: string;
    /** Unix-секунды. */
    readonly timestamp: number;
    readonly subject: string;
}

export const ScmGraphServiceDIToken = token<ScmGraphService>("ScmGraphService");

const REF_KINDS = new Set(["head", "remote", "tag"]);

/**
 * Устройство — как у {@link ScmChangesService}. Обратный конец канала — {@link setActive}:
 * пока GRAPH не раскрыта, `git log` не запускается — граф не стоит подпроцесса на каждое сохранение.
 */
export class ScmGraphService extends Disposable {
    public static dependencies = [CommandRegistryDIToken] as const;

    private commitList: readonly IScmCommit[] = [];
    private more = false;
    /** Гасит повторную публикацию того же набора. */
    private signature = "";
    private readonly onDidChangeCommitsEmitter = this.register(new Emitter<void>());
    /** `null` — ядро ещё не объявляло своё состояние. */
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

    /** От новых коммитов к старым. */
    public get commits(): readonly IScmCommit[] {
        return this.commitList;
    }

    public get hasMore(): boolean {
        return this.more;
    }

    /**
     * Первый вызов уходит всегда, даже если совпал с дефолтом. Best-effort: потерянный
     * сигнал подберёт pull по {@link GRAPH_ENABLED_COMMAND}. Не `runGitOp`: тот требует
     * `ServiceAccessor` и показывает notice, а фоновому сигналу сказать пользователю нечего.
     */
    public setActive(active: boolean): void {
        if (this.active === active) return;
        this.active = active;
        if (!this.commands.has(GIT_OP_COMMAND)) return;
        void Promise.resolve(
            this.commands.execute(GIT_OP_COMMAND, { op: LOG_SET_ENABLED_OP, params: { enabled: active } }),
        ).catch(
            /* v8 ignore next -- best-effort: канал отвалится только при завершении процесса */
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

/** Всё, от чего зависит кадр: sha, тема строки, укладка графа и бейджи. */
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
