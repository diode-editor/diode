/**
 * The schema of launch configurations, as upstream builds it for `launch.json`
 * (`debugSchemas.ts` `launchSchema`, `debugAdapterManager.ts` `updateDebugAdapterSchema`,
 * `debugger.ts` `getSchemaAttributes`): the attributes of every debugger's `configurationAttributes`,
 * the attributes shared by all adapters and the `configurationSnippets`. Read from the manifests
 * of the extensions (`contributes.debuggers`), which are already localized.
 */

/** The part of a JSON schema the completion reads. */
export interface IAttributeSchema {
    readonly type?: string | readonly string[];
    readonly enum?: readonly unknown[];
    readonly enumDescriptions?: readonly string[];
    readonly default?: unknown;
    readonly description?: string;
    readonly markdownDescription?: string;
    readonly doNotSuggest?: boolean;
}

export type AttributeMap = Readonly<Record<string, IAttributeSchema>>;

export interface IConfigurationSnippet {
    readonly label: string;
    readonly description?: string;
    readonly body: unknown;
}

export interface IDebuggerSchema {
    readonly type: string;
    /** Only a debugger with a label (or an adapter) is a debugger of its own; the rest add to one. */
    readonly label?: string;
    readonly isMain: boolean;
    readonly deprecated?: string;
    /** Request (`launch`, `attach`) → its attributes. */
    readonly requests: ReadonlyMap<string, AttributeMap>;
    readonly snippets: readonly IConfigurationSnippet[];
}

interface IDebuggerContribution {
    readonly type: string;
    readonly label?: string;
    readonly program?: unknown;
    readonly runtime?: unknown;
    readonly deprecated?: string;
    readonly configurationAttributes?: unknown;
    readonly configurationSnippets?: unknown;
}

/** What `collectDebuggers` builds up before handing it out read-only. */
interface IMutableDebugger {
    type: string;
    label?: string;
    isMain: boolean;
    deprecated?: string;
    requests: Map<string, Record<string, IAttributeSchema>>;
    snippets: IConfigurationSnippet[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contributedDebuggers(packageJSON: unknown): IDebuggerContribution[] {
    const contributes = isRecord(packageJSON) ? packageJSON.contributes : undefined;
    const debuggers = isRecord(contributes) ? contributes.debuggers : undefined;
    return Array.isArray(debuggers)
        ? debuggers.filter(
              (dbg): dbg is IDebuggerContribution => isRecord(dbg) && typeof dbg.type === "string" && dbg.type !== "",
          )
        : [];
}

function isSnippet(value: unknown): value is IConfigurationSnippet {
    return isRecord(value) && typeof value.label === "string" && "body" in value;
}

/**
 * Upstream `Debugger.merge`: contributions of one type from several extensions add up — attributes
 * of a request are merged, snippets are appended (upstream replaces the array, which loses the snippets
 * of all but the last extension).
 */
export function collectDebuggers(packageJSONs: readonly unknown[]): ReadonlyMap<string, IDebuggerSchema> {
    const byType = new Map<string, IMutableDebugger>();
    for (const contribution of packageJSONs.flatMap(contributedDebuggers)) {
        let dbg = byType.get(contribution.type);
        if (dbg === undefined) {
            dbg = { type: contribution.type, isMain: false, requests: new Map(), snippets: [] };
            byType.set(contribution.type, dbg);
        }
        dbg.label ??= contribution.label;
        // Upstream `isDebuggerMainContribution`.
        dbg.isMain ||= [contribution.label, contribution.program, contribution.runtime].some(Boolean);
        dbg.deprecated ??= contribution.deprecated;

        const attributes = contribution.configurationAttributes;
        if (isRecord(attributes)) {
            for (const [request, schema] of Object.entries(attributes)) {
                const properties = isRecord(schema) && isRecord(schema.properties) ? schema.properties : {};
                const merged = dbg.requests.get(request) ?? {};
                for (const [name, property] of Object.entries(properties)) {
                    // Upstream skips a malformed property (a bare string instead of a schema object).
                    if (isRecord(property)) merged[name] = property;
                }
                dbg.requests.set(request, merged);
            }
        }
        const snippets = contribution.configurationSnippets;
        if (Array.isArray(snippets)) dbg.snippets.push(...snippets.filter(isSnippet));
    }
    return byType;
}

/** Upstream `launchSchema`: the top level of `launch.json` (and of the `launch` setting). */
export const LAUNCH_ROOT_ATTRIBUTES: AttributeMap = {
    version: {
        type: "string",
        description: "Version of this file format.",
        default: "0.2.0",
    },
    configurations: {
        type: "array",
        description: "List of configurations. Add new configurations or edit existing ones by using IntelliSense.",
    },
    compounds: {
        type: "array",
        description:
            "List of compounds. Each compound references multiple configurations which will get launched together.",
    },
};

/** Upstream `definitions.common` of `updateDebugAdapterSchema`: the attributes shared by all adapters. */
const COMMON_ATTRIBUTES: AttributeMap = {
    name: {
        type: "string",
        description: "Name of configuration; appears in the launch configuration dropdown menu.",
        default: "Launch",
    },
    debugServer: {
        type: "number",
        description:
            "For debug extension development only: if a port is specified VS Code tries to connect to a debug adapter running in server mode",
        default: 4711,
    },
    preLaunchTask: {
        type: "string",
        description: "Task to run before debug session starts.",
        default: "",
    },
    postDebugTask: {
        type: "string",
        description: "Task to run after debug session ends.",
        default: "",
    },
    // Upstream `presentationSchema`.
    presentation: {
        type: "object",
        description:
            "Presentation options on how to show this configuration in the debug configuration dropdown and the command palette.",
        default: { hidden: false, group: "", order: 1 },
    },
    internalConsoleOptions: {
        enum: ["neverOpen", "openOnSessionStart", "openOnFirstSessionStart"],
        default: "openOnFirstSessionStart",
        description: "Controls when the internal Debug Console should open.",
    },
    suppressMultipleSessionWarning: {
        type: "boolean",
        description: "Disable the warning when trying to start the same debug configuration more than once.",
        default: true,
    },
};

/** Upstream adds them to every request's attributes, not to the platform-specific ones. */
const PLATFORM_ATTRIBUTES: AttributeMap = {
    windows: { type: "object", description: "Windows specific launch configuration attributes." },
    osx: { type: "object", description: "OS X specific launch configuration attributes." },
    linux: { type: "object", description: "Linux specific launch configuration attributes." },
};

/**
 * The attributes of a configuration with the given `type` and `request`, as upstream's `oneOf`
 * branch that matches it. A `request` the debugger doesn't know (or none yet) — the attributes of all
 * its requests; an unknown `type` (or none) — only the attributes every configuration has. Both are the
 * values as written: one that isn't a string (or is missing) matches no debugger and no request.
 */
export function configurationAttributes(
    debuggers: ReadonlyMap<string, IDebuggerSchema>,
    type: unknown,
    request: unknown,
): AttributeMap {
    const requests = debuggers.get(type as string)?.requests ?? new Map<string, AttributeMap>();
    const known = [...requests.keys()];
    const own = known.includes(request as string) ? [request as string] : known;
    const suggested = [...debuggers.values()].filter((d) => d.isMain && d.deprecated === undefined);
    return {
        ...own.reduce<AttributeMap>((all, r) => ({ ...all, ...requests.get(r) }), {}),
        type: {
            enum: suggested.map((d) => d.type),
            enumDescriptions: suggested.map((d) => d.label ?? d.type),
            description: "Type of configuration.",
        },
        request: {
            enum: known.length > 0 ? known : ["launch", "attach"],
            description: 'Request type of configuration. Can be "launch" or "attach".',
        },
        ...COMMON_ATTRIBUTES,
        ...PLATFORM_ATTRIBUTES,
    };
}

/** Upstream `items.defaultSnippets`: the snippets of every debugger, in the order of the debuggers. */
export function configurationSnippets(debuggers: ReadonlyMap<string, IDebuggerSchema>): IConfigurationSnippet[] {
    return [...debuggers.values()].flatMap((d) => d.snippets);
}
