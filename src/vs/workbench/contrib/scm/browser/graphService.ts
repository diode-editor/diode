import { Disposable, type IDisposable } from "../../../../../../tuidom/common/disposable.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/**
 * Команда, которой git-расширение публикует последние коммиты репозитория.
 * Зеркало {@link PUBLISH_CHANGES_COMMAND}: набор пушит расширение, а команду
 * регистрирует ядро (см. {@link ScmGraphService}); строка дублируется по
 * значению на стороне расширения — общих импортов через границу процесса нет.
 */
export const PUBLISH_LOG_COMMAND = "vexx.scm.publishLog";

/** Один коммит истории (пока — тривиальный список; настоящий граф позже). */
export interface IScmCommit {
    readonly sha: string;
    /** Короткий sha для показа (`%h`); при отсутствии ядро урезает sha само. */
    readonly shortSha: string;
    readonly subject: string;
}

export const ScmGraphServiceDIToken = token<ScmGraphService>("ScmGraphService");

/**
 * Снимок последних коммитов от git-расширения — данные view **GRAPH**
 * ({@link GraphViewComponent}). Устройство один-в-один со
 * {@link ScmChangesService}: команда-приёмник, валидация payload из-за границы
 * процесса, замена снимка целиком и гашение повторной идентичной публикации.
 */
export class ScmGraphService extends Disposable {
    public static dependencies = [CommandRegistryDIToken] as const;

    private commitList: readonly IScmCommit[] = [];
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

    public onDidChangeCommits(listener: () => void): IDisposable {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            },
        };
    }

    private publish(payload: unknown): void {
        const commits = parseCommits(payload);
        const signature = commits.map((c) => `${c.sha}\t${c.subject}`).join("\n");
        if (signature === this.signature) return;
        this.signature = signature;
        this.commitList = commits;
        for (const listener of [...this.listeners]) listener();
    }
}

/** Разбирает `[{sha, shortSha, subject}]` из-за границы: мусор тихо пропускается. */
function parseCommits(payload: unknown): IScmCommit[] {
    if (!Array.isArray(payload)) return [];
    const commits: IScmCommit[] = [];
    for (const raw of payload) {
        if (typeof raw !== "object" || raw === null) continue;
        const { sha, shortSha, subject } = raw as { sha?: unknown; shortSha?: unknown; subject?: unknown };
        if (typeof sha !== "string" || sha === "" || typeof subject !== "string") continue;
        commits.push({
            sha,
            shortSha: typeof shortSha === "string" && shortSha !== "" ? shortSha : sha.slice(0, 8),
            subject,
        });
    }
    return commits;
}
