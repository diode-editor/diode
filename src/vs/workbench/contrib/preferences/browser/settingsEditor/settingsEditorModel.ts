import type { IConfigurationPropertySchema } from "../../../../../platform/configuration/common/configurationRegistry.ts";

// SPIKE: Settings UI look-and-feel. The TOC is a trimmed port of upstream `settingsLayout.ts`.

export type SettingControlKind = "boolean" | "enum" | "string" | "number" | "stringArray" | "object" | "complex";

export interface ISettingDescriptor {
    readonly key: string;
    readonly schema: IConfigurationPropertySchema;
    /** `Editor › Find` — every key segment but the last, wordified. */
    readonly category: string;
    /** `Seed Search String` — the last key segment, wordified. */
    readonly title: string;
    readonly description: string;
    readonly kind: SettingControlKind;
}

export interface ITocEntry {
    readonly id: string;
    readonly label: string;
    readonly patterns?: readonly string[];
    readonly children?: readonly ITocEntry[];
}

export interface ISettingsGroup {
    readonly id: string;
    readonly label: string;
    readonly depth: number;
    readonly parentId: string | null;
    readonly settings: readonly ISettingDescriptor[];
}

export const COMMONLY_USED_SETTINGS: readonly string[] = [
    "editor.fontSize",
    "editor.formatOnSave",
    "files.autoSave",
    "editor.defaultFormatter",
    "editor.fontFamily",
    "editor.wordWrap",
    "files.exclude",
    "workbench.colorTheme",
    "editor.tabSize",
    "editor.mouseWheelZoom",
    "editor.formatOnPaste",
];

export const TOC_DATA: readonly ITocEntry[] = [
    {
        id: "editor",
        label: "Text Editor",
        patterns: ["editor.*"],
        children: [
            { id: "editor/cursor", label: "Cursor", patterns: ["editor.cursor*"] },
            { id: "editor/find", label: "Find", patterns: ["editor.find.*"] },
            { id: "editor/font", label: "Font", patterns: ["editor.font*"] },
            { id: "editor/format", label: "Formatting", patterns: ["editor.format*"] },
            { id: "editor/diffEditor", label: "Diff Editor", patterns: ["diffEditor.*"] },
            { id: "editor/minimap", label: "Minimap", patterns: ["editor.minimap.*"] },
            { id: "editor/suggestions", label: "Suggestions", patterns: ["editor.*suggest*"] },
            { id: "editor/files", label: "Files", patterns: ["files.*"] },
        ],
    },
    {
        id: "workbench",
        label: "Workbench",
        patterns: ["workbench.*"],
        children: [
            {
                id: "workbench/appearance",
                label: "Appearance",
                patterns: [
                    "workbench.activityBar.*",
                    "workbench.*color*",
                    "workbench.iconTheme",
                    "workbench.sideBar.location",
                    "workbench.*.visible",
                    "workbench.tree.*",
                    "workbench.view.*",
                ],
            },
            { id: "workbench/breadcrumbs", label: "Breadcrumbs", patterns: ["breadcrumbs.*"] },
            { id: "workbench/editor", label: "Editor Management", patterns: ["workbench.editor.*"] },
            { id: "workbench/settings", label: "Settings Editor", patterns: ["workbench.settings.*"] },
        ],
    },
    {
        id: "window",
        label: "Window",
        patterns: ["window.*"],
    },
    {
        id: "features",
        label: "Features",
        children: [
            { id: "features/accessibility", label: "Accessibility", patterns: ["accessibility.*"] },
            { id: "features/explorer", label: "Explorer", patterns: ["explorer.*", "outline.*"] },
            { id: "features/search", label: "Search", patterns: ["search.*"] },
            { id: "features/debug", label: "Debug", patterns: ["debug.*", "launch"] },
            { id: "features/testing", label: "Testing", patterns: ["testing.*"] },
            { id: "features/scm", label: "Source Control", patterns: ["scm.*", "git.*"] },
            { id: "features/extensions", label: "Extensions", patterns: ["extensions.*"] },
            { id: "features/terminal", label: "Terminal", patterns: ["terminal.*"] },
            { id: "features/task", label: "Task", patterns: ["task.*"] },
            { id: "features/problems", label: "Problems", patterns: ["problems.*"] },
            { id: "features/output", label: "Output", patterns: ["output.*"] },
            { id: "features/comments", label: "Comments", patterns: ["comments.*"] },
        ],
    },
    {
        id: "application",
        label: "Application",
        children: [
            { id: "application/http", label: "Proxy", patterns: ["http.*"] },
            { id: "application/keyboard", label: "Keyboard", patterns: ["keyboard.*"] },
            { id: "application/update", label: "Update", patterns: ["update.*"] },
            { id: "application/telemetry", label: "Telemetry", patterns: ["telemetry.*"] },
            { id: "application/other", label: "Other", patterns: ["application.*"] },
        ],
    },
    {
        id: "security",
        label: "Security",
        patterns: ["security.*"],
    },
    {
        id: "other",
        label: "Other",
        patterns: ["*"],
    },
];

const KNOWN_ACRONYMS = new Map([
    ["css", "CSS"],
    ["html", "HTML"],
    ["json", "JSON"],
    ["scm", "SCM"],
    ["http", "HTTP"],
    ["url", "URL"],
    ["ui", "UI"],
    ["id", "ID"],
]);

function wordify(segment: string): string {
    const known = KNOWN_ACRONYMS.get(segment.toLowerCase());
    if (known !== undefined) return known;
    const spaced = segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
    return spaced
        .split(" ")
        .map((word) => KNOWN_ACRONYMS.get(word.toLowerCase()) ?? word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

/** Upstream `settingKeyToDisplayFormat`: `editor.find.seedSearchString` → `Editor › Find` + `Seed Search String`. */
export function settingKeyToDisplayFormat(key: string): { category: string; title: string } {
    const segments = key.split(".");
    const last = segments.pop() ?? key;
    return { category: segments.map(wordify).join(" › "), title: wordify(last) };
}

function controlKind(schema: IConfigurationPropertySchema): SettingControlKind {
    if (schema.enum !== undefined) return "enum";
    const type = Array.isArray(schema.type) ? undefined : (schema.type as string);
    switch (type) {
        case "boolean":
            return "boolean";
        case "string":
            return "string";
        case "number":
        case "integer":
            return "number";
        case "array":
            return Array.isArray(schema.default) && schema.default.every((v) => typeof v === "string")
                ? "stringArray"
                : "complex";
        case "object":
            return "object";
        default:
            return "complex";
    }
}

export function describeSetting(key: string, schema: IConfigurationPropertySchema): ISettingDescriptor {
    const { category, title } = settingKeyToDisplayFormat(key);
    return { key, schema, category, title, description: schema.description ?? "", kind: controlKind(schema) };
}

function patternToRegExp(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i");
}

function matchesAny(key: string, patterns: readonly string[] | undefined): boolean {
    return patterns?.some((p) => patternToRegExp(p).test(key)) ?? false;
}

/**
 * Children claim first, the parent takes the leftovers matching its own patterns (upstream order).
 * The result is flat in display order: a parent group, then its children.
 */
export function buildSettingsGroups(settings: readonly ISettingDescriptor[]): ISettingsGroup[] {
    const remaining = new Map(settings.map((s) => [s.key, s]));
    const claimed = new Map<string, ISettingDescriptor[]>();

    const claim = (entry: ITocEntry): void => {
        for (const child of entry.children ?? []) claim(child);
        const mine: ISettingDescriptor[] = [];
        for (const [key, setting] of remaining) {
            if (matchesAny(key, entry.patterns)) mine.push(setting);
        }
        for (const s of mine) remaining.delete(s.key);
        mine.sort((a, b) => a.key.localeCompare(b.key));
        claimed.set(entry.id, mine);
    };
    for (const entry of TOC_DATA) claim(entry);

    const groups: ISettingsGroup[] = [];
    const commonlyUsed = COMMONLY_USED_SETTINGS.flatMap((key) => {
        const setting = settings.find((s) => s.key === key);
        return setting !== undefined ? [setting] : [];
    });
    groups.push({ id: "commonlyUsed", label: "Commonly Used", depth: 0, parentId: null, settings: commonlyUsed });

    const flatten = (entry: ITocEntry, depth: number, parentId: string | null): void => {
        groups.push({ id: entry.id, label: entry.label, depth, parentId, settings: claimed.get(entry.id) ?? [] });
        for (const child of entry.children ?? []) flatten(child, depth + 1, entry.id);
    };
    for (const entry of TOC_DATA) flatten(entry, 0, null);
    return groups;
}

/** All words must occur in the key, the display title or the description. */
export function matchesQuery(setting: ISettingDescriptor, words: readonly string[]): boolean {
    if (words.length === 0) return true;
    const haystack =
        `${setting.key} ${setting.category} ${setting.title} ${setting.description}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
}

export interface IParsedQuery {
    readonly words: readonly string[];
    readonly modifiedOnly: boolean;
}

export function parseQuery(query: string): IParsedQuery {
    const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
    return {
        words: tokens.filter((t) => !t.startsWith("@")),
        modifiedOnly: tokens.includes("@modified"),
    };
}
