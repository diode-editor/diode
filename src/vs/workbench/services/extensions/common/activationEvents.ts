/**
 * Чтение `activationEvents` расширения — один разбор на всех потребителей
 * активации (`ExtensionHost`).
 *
 * Событие в манифесте — строка вида `<вид>` или `<вид>:<аргумент>`. Точным
 * сравнением закрываются только виды без аргумента (`*`, `onStartupFinished`) и
 * те, где аргумент приходит от вызывающего (`onLanguage:<id>`, `onCommand:<id>`).
 * `workspaceContains:<glob>` так не закрывается: его аргумент надо сопоставлять
 * с содержимым папок воркспейса — разбор паттернов живёт здесь, сам обход в
 * `../node/workspaceContainsActivation.ts`.
 */

/** «В открытой папке воркспейса есть файл по паттерну». */
const WORKSPACE_CONTAINS_PREFIX = "workspaceContains:";

/** «Исполнили команду с таким id». */
const ON_COMMAND_PREFIX = "onCommand:";

/**
 * Манифестная часть регистрации, из которой читаются события активации:
 * объявленные события плюс `contributes.commands` (источник НЕЯВНЫХ событий,
 * см. {@link readActivationEvents}).
 */
export interface IActivationEventSource {
    readonly activationEvents?: readonly string[];
    readonly commandTitles?: Readonly<Record<string, string>>;
}

/**
 * Нормализует `activationEvents`: пусто/отсутствует ⇒ `["*"]` (eager). Так
 * расширение без описанных событий сохраняет прежнее поведение — активируется
 * на общем стартовом `activateByEvent("*")`.
 */
export function normalizeActivationEvents(events: readonly string[] | undefined): readonly string[] {
    return events !== undefined && events.length > 0 ? events : ["*"];
}

/**
 * Полный набор событий активации расширения: объявленные в манифесте плюс
 * НЕЯВНЫЕ.
 *
 * Неявные события — эталонное поведение (`ImplicitActivationEvents` в
 * `abstractExtensionService`): каждая запись `contributes.commands` порождает
 * `onCommand:<id>`, поэтому расширение, объявившее команду и НЕ объявившее под
 * неё событие, всё равно поднимается по её исполнению. Без этого команда из
 * палитры была бы вечным no-op у любого не-eager расширения.
 */
export function readActivationEvents(source: IActivationEventSource): readonly string[] {
    const events = [...normalizeActivationEvents(source.activationEvents)];
    for (const id of Object.keys(source.commandTitles ?? {})) {
        const implicit = `${ON_COMMAND_PREFIX}${id}`;
        if (!events.includes(implicit)) events.push(implicit);
    }
    return events;
}

/**
 * id команд, по исполнению которых расширение обязано активироваться —
 * `onCommand:<id>` из манифеста плюс неявные из `contributes.commands`
 * (см. {@link readActivationEvents}). Без дублей; порядок — манифестный.
 */
export function readCommandActivationIds(source: IActivationEventSource): readonly string[] {
    const ids: string[] = [];
    for (const event of readActivationEvents(source)) {
        if (!event.startsWith(ON_COMMAND_PREFIX)) continue;
        const id = event.slice(ON_COMMAND_PREFIX.length);
        if (id !== "" && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

/**
 * Паттерны `workspaceContains:` расширения, разведённые по СЕМАНТИКЕ. У одного
 * префикса их две (и в эталоне тоже — `checkActivateWorkspaceContainsExtension`):
 * паттерн без glob-символов — это простая проверка существования пути
 * относительно каждой папки воркспейса, паттерн с ними уходит в поиск по дереву.
 * Сводить обе к поиску нельзя: `workspaceContains:.vscode` должен срабатывать и
 * на каталоге, а `workspaceContains:pom.xml` не обязан читать дерево вообще.
 */
export interface IWorkspaceContainsPatterns {
    /** Без `*`/`?` — проверка существования пути (файл ИЛИ каталог). */
    readonly paths: readonly string[];
    /** С `*`/`?` — поиск файла по дереву. */
    readonly globs: readonly string[];
}

/** Пустой набор — расширение про `workspaceContains:` ничего не говорило. */
export const NO_WORKSPACE_CONTAINS_PATTERNS: IWorkspaceContainsPatterns = { paths: [], globs: [] };

/** Есть ли в наборе хоть один паттерн (иначе считать нечего). */
export function hasWorkspaceContainsPatterns(patterns: IWorkspaceContainsPatterns): boolean {
    return patterns.paths.length > 0 || patterns.globs.length > 0;
}

/**
 * Разбирает `workspaceContains:`-события источника на два стока
 * {@link IWorkspaceContainsPatterns}. Пустой паттерн (`workspaceContains:`)
 * отбрасывается: как «путь» он указывал бы на саму папку воркспейса и матчил
 * любой воркспейс.
 */
export function readWorkspaceContainsPatterns(source: IActivationEventSource): IWorkspaceContainsPatterns {
    const paths: string[] = [];
    const globs: string[] = [];
    for (const event of normalizeActivationEvents(source.activationEvents)) {
        if (!event.startsWith(WORKSPACE_CONTAINS_PREFIX)) continue;
        const pattern = event.slice(WORKSPACE_CONTAINS_PREFIX.length);
        if (pattern === "") continue;
        const sink = pattern.includes("*") || pattern.includes("?") ? globs : paths;
        if (!sink.includes(pattern)) sink.push(pattern);
    }
    return { paths, globs };
}
