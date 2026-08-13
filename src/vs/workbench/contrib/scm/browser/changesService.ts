import { Disposable, type IDisposable } from "@tuidom/all/common/disposable";
import { Uri } from "../../../../base/common/uri.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/**
 * Команда, которой SCM-расширение публикует **полный** набор изменённых файлов
 * рабочего дерева. Зеркало {@link ORIGINAL_RESOURCE_COMMAND}, но в обратную
 * сторону: там ресурс *спрашивает* ядро, здесь набор *пушит* расширение — а
 * регистрирует команду ядро (см. {@link ScmChangesService}).
 */
export const PUBLISH_CHANGES_COMMAND = "vexx.scm.publishChanges";

/**
 * Один изменённый ресурс. `status` — буква-бейдж для показа (`M`/`A`/`D`/`R`/`U`…),
 * `colorId` — id темы для её цвета (`gitDecoration.*`). Цвет отдельно от буквы,
 * потому что буква `U` неоднозначна: и untracked, и конфликт рисуются `U`, но
 * разными цветами — их различает только `colorId`, который расширение уже
 * посчитало для дерева.
 */
/**
 * Группа ресурсов, в которой живёт запись — как resource groups VS Code
 * (merge / index / worktree / untracked; заголовков в списке три — untracked
 * показывается под «Changes», см. `scmChangeGroups.ts`). Файл со
 * статусом `MM` приходит двумя записями: в `index` и в `worktree`.
 */
export type ScmGroupId = "merge" | "index" | "worktree" | "untracked";

/** Все группы — и порядок их показа (как в VS Code). */
export const SCM_GROUP_IDS: readonly ScmGroupId[] = ["merge", "index", "worktree", "untracked"];

export interface IScmChange {
    readonly uri: Uri;
    readonly status: string;
    readonly colorId: string;
    /**
     * Путь для показа — относительно корня репозитория, из git (всегда через `/`).
     * Метку считает расширение, а не ядро: сопоставлять абсолютные пути с корнем
     * воркспейса на стороне ядра ненадёжно кроссплатформенно (Windows: 8.3-имена,
     * регистр диска). Пусто — если расширение путь не прислало (тогда basename).
     */
    readonly path: string;
    readonly group: ScmGroupId;
}

export const ScmChangesServiceDIToken = token<ScmChangesService>("ScmChangesService");

/**
 * Снимок изменений рабочего дерева от SCM-расширения. Хранит последний
 * опубликованный набор и файрит {@link onDidChangeChanges} при каждой замене;
 * вкладка Changes ({@link ChangesComponent}) на него подписана.
 *
 * Транспорт — команда (как у {@link CommandOriginalResourceProvider}) и по той же
 * причине: канонический путь — `scm`-неймспейс, но он в `vscode.d.ts` ещё
 * закомментирован (docs/TODO/Diff.md, пункт F). Граница владения уже правильная —
 * что «изменено» и с каким статусом, знает только расширение, — поэтому переход
 * на `scm` заменит источник, а не этот сервис.
 */
export class ScmChangesService extends Disposable {
    public static dependencies = [CommandRegistryDIToken] as const;

    private changeList: readonly IScmChange[] = [];
    /** Подпись текущего набора — чтобы не файрить при повторной публикации того же. */
    private signature = "";
    private readonly listeners = new Set<() => void>();

    public constructor(commands: CommandRegistry) {
        super();
        this.register(
            commands.register(PUBLISH_CHANGES_COMMAND, (payload) => {
                this.publish(payload);
            }),
        );
    }

    /** Последний опубликованный набор (в порядке прихода от расширения). */
    public get changes(): readonly IScmChange[] {
        return this.changeList;
    }

    public onDidChangeChanges(listener: () => void): IDisposable {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            },
        };
    }

    /**
     * Хендлер {@link PUBLISH_CHANGES_COMMAND}: заменяет набор целиком. Payload
     * приходит из-за границы процесса, поэтому валидируется — мусорные записи
     * отбрасываются, не-массив трактуется как пустой набор.
     */
    private publish(payload: unknown): void {
        const changes = parseChanges(payload);
        // Расширение публикует набор на каждый refresh (в т.ч. на смену активного
        // редактора), поэтому идентичный набор гасим тут — иначе вкладка Changes
        // пересобиралась бы вхолостую.
        const signature = changes
            .map((c) => `${c.uri.toString()}\t${c.status}\t${c.colorId}\t${c.path}\t${c.group}`)
            .join("\n");
        if (signature === this.signature) return;
        this.signature = signature;
        this.changeList = changes;
        for (const listener of [...this.listeners]) listener();
    }
}

/** Разбирает `[{uri, status, group}]` из-за границы: тихо пропускает всё, что не подходит. */
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
        // Группа обязательна и строго из enum — команды staging решают
        // применимость по ней, запись с мусорной группой опаснее пропущенной.
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
