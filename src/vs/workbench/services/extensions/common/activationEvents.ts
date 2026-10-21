// `workspaceContains:<glob>` can't be settled by exact comparison: the argument is matched
// against the workspace folder contents (the walk is in `../node/workspaceContainsActivation.ts`).

import type {
    IExtensionContributions,
    IExtensionManifest,
} from "../../../../platform/extensions/common/iExtensionManifest.ts";

const WORKSPACE_CONTAINS_PREFIX = "workspaceContains:";

const ON_COMMAND_PREFIX = "onCommand:";

const ON_LANGUAGE_PREFIX = "onLanguage:";

/**
 * The full set ({@link computeActivationEvents}): the host only compares strings and knows nothing about
 * `contributes`.
 */
export interface IActivationEventSource {
    readonly activationEvents?: readonly string[];
}

/** Like upstream `activationEventsGenerator` on extension point descriptors. */
export interface IImplicitActivationEventGenerator {
    readonly point: keyof IExtensionContributions;
    generate(contributes: IExtensionContributions): Iterable<string>;
}

const NO_CONTRIBUTIONS: readonly never[] = [];

/**
 * `commands` ⇒ `onCommand:<id>`: otherwise a palette-visible command of a non-eager extension would be a permanent
 * no-op.
 */
export const IMPLICIT_ACTIVATION_EVENT_GENERATORS: readonly IImplicitActivationEventGenerator[] = [
    {
        point: "commands",
        *generate(contributes) {
            for (const command of contributes.commands ?? NO_CONTRIBUTIONS) {
                if (typeof command.command === "string") yield `${ON_COMMAND_PREFIX}${command.command}`;
            }
        },
    },
    {
        point: "languages",
        *generate(contributes) {
            for (const language of contributes.languages ?? NO_CONTRIBUTIONS) {
                if (typeof language.id === "string") yield `${ON_LANGUAGE_PREFIX}${language.id}`;
            }
        },
    },
    {
        point: "taskDefinitions",
        *generate(contributes) {
            for (const definition of contributes.taskDefinitions ?? NO_CONTRIBUTIONS) {
                if (typeof definition.type === "string" && definition.type !== "")
                    yield `onTaskType:${definition.type}`;
            }
        },
    },
];

/**
 * Bare `onUri` → `onUri:<lowercase id>` (upstream `_readActivationEvents`).
 * Deviation: a manifest without events is treated as eager (`*`); published extensions
 * (`test.tab-setter`) rely on it; dropped once their registry entries are updated
 * (docs/TODO/VscodeStructureFollowUps.md).
 */
export function computeActivationEvents(
    manifest: Pick<IExtensionManifest, "activationEvents" | "contributes">,
    extensionId: string,
): readonly string[] {
    const declared = (manifest.activationEvents ?? []).map((event) =>
        event === "onUri" ? `onUri:${extensionId.toLowerCase()}` : event,
    );
    const events = declared.length > 0 ? [...declared] : ["*"];
    const contributes = manifest.contributes ?? {};
    for (const generator of IMPLICIT_ACTIVATION_EVENT_GENERATORS) {
        for (const event of generator.generate(contributes)) {
            if (!events.includes(event)) events.push(event);
        }
    }
    return events;
}

export function readActivationEvents(source: IActivationEventSource): readonly string[] {
    return source.activationEvents ?? [];
}

/** No duplicates, in manifest order. */
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
 * Two semantics of one prefix, like upstream `checkActivateWorkspaceContainsExtension`: they can't
 * be reduced to a search — `.vscode` also matches a directory, and `pom.xml` needn't walk the tree.
 */
export interface IWorkspaceContainsPatterns {
    /** No `*`/`?`: a path existence check (file OR directory). */
    readonly paths: readonly string[];
    readonly globs: readonly string[];
}

export const NO_WORKSPACE_CONTAINS_PATTERNS: IWorkspaceContainsPatterns = { paths: [], globs: [] };

export function hasWorkspaceContainsPatterns(patterns: IWorkspaceContainsPatterns): boolean {
    return patterns.paths.length > 0 || patterns.globs.length > 0;
}

/** An empty pattern is dropped: as a path it would point at the workspace folder and match any workspace. */
export function readWorkspaceContainsPatterns(source: IActivationEventSource): IWorkspaceContainsPatterns {
    const paths: string[] = [];
    const globs: string[] = [];
    for (const event of readActivationEvents(source)) {
        if (!event.startsWith(WORKSPACE_CONTAINS_PREFIX)) continue;
        const pattern = event.slice(WORKSPACE_CONTAINS_PREFIX.length);
        if (pattern === "") continue;
        const sink = pattern.includes("*") || pattern.includes("?") ? globs : paths;
        if (!sink.includes(pattern)) sink.push(pattern);
    }
    return { paths, globs };
}
