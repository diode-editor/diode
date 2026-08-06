import { Disposable, type IDisposable } from "../../../../../../tuidom/common/disposable.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/**
 * Команда, которой git-расширение публикует страницу истории репозитория.
 * Зеркало {@link PUBLISH_CHANGES_COMMAND}: набор пушит расширение, а команду
 * регистрирует ядро (см. {@link ScmGraphService}); строка дублируется по
 * значению на стороне расширения — общих импортов через границу процесса нет.
 */
export const PUBLISH_LOG_COMMAND = "vexx.scm.publishLog";

/** Ссылка на коммит — бейдж рядом со строкой графа. */
export interface IScmCommitRef {
    /** Короткое имя: `main`, `origin/main`, `v1.0`. */
    readonly name: string;
    readonly kind: "head" | "remote" | "tag";
    /** Ветка, на которой стоит HEAD. */
    readonly current: boolean;
}

/** Один коммит истории — вход укладки графа и материал строки списка. */
export interface IScmCommit {
    readonly sha: string;
    /** Короткий sha (`%h`); при отсутствии ядро урезает sha само. */
    readonly shortSha: string;
    /** Родители в порядке git; пусто — корневой коммит. */
    readonly parents: readonly string[];
    readonly refs: readonly IScmCommitRef[];
    readonly author: string;
    /** Время коммита, unix-секунды. */
    readonly timestamp: number;
    readonly subject: string;
}

export const ScmGraphServiceDIToken = token<ScmGraphService>("ScmGraphService");

const REF_KINDS = new Set(["head", "remote", "tag"]);

/**
 * Снимок истории от git-расширения — данные view **GRAPH**
 * ({@link GraphViewComponent}). Устройство один-в-один со
 * {@link ScmChangesService}: команда-приёмник, валидация payload из-за границы
 * процесса, замена снимка целиком и гашение повторной идентичной публикации.
 *
 * Страница ограничена (`scm.graph.pageSize`); {@link hasMore} говорит, что
 * история продолжается — view рисует строку «Load More…».
 */
export class ScmGraphService extends Disposable {
    public static dependencies = [CommandRegistryDIToken] as const;

    private commitList: readonly IScmCommit[] = [];
    private more = false;
    /** Подпись текущего набора — чтобы не файрить при повторной публикации того же. */
    private signature = "";
    private readonly listeners = new Set<() => void>();

    public constructor(commands: CommandRegistry) {
        super();
        this.register(
            commands.register(PUBLISH_LOG_COMMAND, (payload) => {
                this.publish(payload);
            }),
        );
    }

    /** Последний опубликованный набор (от новых коммитов к старым). */
    public get commits(): readonly IScmCommit[] {
        return this.commitList;
    }

    /** Есть ли за последним коммитом ещё история. */
    public get hasMore(): boolean {
        return this.more;
    }

    public onDidChangeCommits(listener: () => void): IDisposable {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            },
        };
    }

    private publish(payload: unknown): void {
        const { commits, hasMore } = parseLogPayload(payload);
        const signature = `${hasMore ? "1" : "0"}\n${commits.map(commitSignature).join("\n")}`;
        if (signature === this.signature) return;
        this.signature = signature;
        this.commitList = commits;
        this.more = hasMore;
        for (const listener of [...this.listeners]) listener();
    }
}

/** Всё, от чего зависит кадр: sha, тема строки, укладка графа и бейджи. */
function commitSignature(commit: IScmCommit): string {
    const refs = commit.refs.map((ref) => `${ref.kind}:${ref.current ? "*" : ""}${ref.name}`).join(",");
    return `${commit.sha}\t${commit.subject}\t${commit.parents.join(" ")}\t${refs}`;
}

/** Разбирает `{commits, hasMore}` из-за границы: мусор тихо пропускается. */
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
