import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { GIT_OP_COMMAND } from "../common/gitProtocol.ts";

/**
 * Команда, которой git-расширение публикует страницу истории репозитория.
 * Зеркало {@link PUBLISH_CHANGES_COMMAND}: набор пушит расширение, а команду
 * регистрирует ядро (см. {@link ScmGraphService}); строка дублируется по
 * значению на стороне расширения — общих импортов через границу процесса нет.
 */
export const PUBLISH_LOG_COMMAND = "diode.scm.publishLog";

/**
 * Расширение спрашивает ядро, нужна ли графу история. Единственный pull-канал
 * в эту сторону: остальные (`PUBLISH_*`) — push. Нужен, потому что в момент,
 * когда ядро впервые объявляет своё состояние ({@link ScmGraphService.setActive}),
 * расширения может ещё не быть, а перезапуск extension host'а обнуляет его
 * память. Ответ `undefined` (команды нет) расширение трактует как «канал не
 * поддержан» и работает по-старому.
 */
export const GRAPH_ENABLED_COMMAND = "diode.scm.graphEnabled";

/**
 * Операция диспетчера `diode.git.op`, которой ядро включает и выключает
 * публикацию истории. Строка дублируется по значению на стороне расширения —
 * общих импортов через границу процесса нет.
 */
const LOG_SET_ENABLED_OP = "logSetEnabled";

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
 *
 * Сервис же держит и обратный конец канала: {@link setActive} говорит
 * расширению, нужна ли история вообще. Пока секция GRAPH не раскрыта, `git log`
 * в расширении не запускается — граф не стоит подпроцесса на каждое сохранение
 * файла.
 */
export class ScmGraphService extends Disposable {
    public static dependencies = [CommandRegistryDIToken] as const;

    private commitList: readonly IScmCommit[] = [];
    private more = false;
    /** Подпись текущего набора — чтобы не файрить при повторной публикации того же. */
    private signature = "";
    private readonly listeners = new Set<() => void>();
    /** Нужна ли графу история; `null` — ядро ещё не объявляло своё состояние. */
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

    /** Последний опубликованный набор (от новых коммитов к старым). */
    public get commits(): readonly IScmCommit[] {
        return this.commitList;
    }

    /** Есть ли за последним коммитом ещё история. */
    public get hasMore(): boolean {
        return this.more;
    }

    /**
     * Объявляет расширению, нужна ли история. Зовёт {@link GraphViewComponent}
     * на каждой смене раскрытости своей секции; первый вызов уходит всегда,
     * даже если состояние совпало с дефолтом.
     *
     * Best-effort, как и приём публикаций: расширения может ещё не быть — тогда
     * сигнал теряется, и его подберёт pull по {@link GRAPH_ENABLED_COMMAND} при
     * активации. Полноценный `runGitOp` здесь не нужен: он требует
     * `ServiceAccessor` и показывает notice в статус-баре, а фоновому сигналу
     * рассказывать пользователю не о чем.
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
