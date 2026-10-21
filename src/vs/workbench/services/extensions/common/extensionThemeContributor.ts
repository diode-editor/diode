import { joinVirtualPath } from "../../../../base/common/assets/assetBundleFormat.ts";
import type { IAssetAccess } from "../../../../base/common/assets/iAssetAccess.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IThemeContribution } from "../../../../platform/extensions/common/iThemeContribution.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IThemeFile } from "../../../../platform/theme/common/iThemeFile.ts";
import { mergeThemeFiles } from "../../../../platform/theme/common/mergeThemeFiles.ts";
import { parseThemeFile } from "../../../../platform/theme/common/themeFileParser.ts";
import type { ThemeRegistry } from "../../themes/common/themeRegistry.ts";

/** Manifest `uiTheme` → `IThemeFile.type` (decision 7 in docs/arch/Theme.md). */
const UI_THEME_TYPES: Partial<Record<string, IThemeFile["type"]>> = {
    vs: "light",
    "vs-dark": "dark",
    "hc-black": "hc",
    "hc-light": "hcLight",
};

interface IThemeEntry {
    readonly extension: IExtension;
    readonly contribution: IThemeContribution;
}

/**
 * All themes are read before the first frame: the picker needs a synchronous `resolve` for live preview
 * (decision 2 in docs/arch/Theme.md). The last registration of a `label` wins;
 * `dispose()` doesn't restore a shadowed builtin theme.
 */
export class ExtensionThemeContributor implements IDisposable {
    private readonly assets: IAssetAccess;
    private readonly extensions: readonly IExtension[];
    private readonly themeRegistry: ThemeRegistry;
    private readonly logger: ILogger | undefined;
    private registeredLabels: string[] = [];

    public constructor(
        assets: IAssetAccess,
        extensions: readonly IExtension[],
        themeRegistry: ThemeRegistry,
        logger?: ILogger,
    ) {
        this.assets = assets;
        this.extensions = extensions;
        this.themeRegistry = themeRegistry;
        this.logger = logger;
    }

    public async apply(): Promise<void> {
        const entries = this.collectEntries();
        const files = await Promise.all(entries.map((entry) => this.loadTheme(entry)));

        const owners = new Map<string, string>();
        entries.forEach((entry, index) => {
            const file = files[index];
            if (file === null) return;
            const label = entry.contribution.label;
            const previousOwner = owners.get(label);
            if (previousOwner !== undefined) {
                this.logger?.warn(
                    `${entry.extension.id}: theme "${label}" shadows the theme with the same label from ${previousOwner}`,
                );
            } else if (this.themeRegistry.has(label)) {
                this.logger?.warn(`${entry.extension.id}: theme "${label}" shadows the built-in theme`);
            }
            this.themeRegistry.register(file);
            owners.set(label, entry.extension.id);
            this.registeredLabels.push(label);
        });
    }

    public dispose(): void {
        for (const label of this.registeredLabels) this.themeRegistry.unregister(label);
        this.registeredLabels = [];
    }

    private collectEntries(): IThemeEntry[] {
        const entries: IThemeEntry[] = [];
        for (const extension of this.extensions) {
            const themes = extension.manifest.contributes?.themes;
            if (!Array.isArray(themes)) continue;
            (themes as unknown[]).forEach((contribution, index) => {
                if (isThemeContribution(contribution)) {
                    entries.push({ extension, contribution });
                } else {
                    this.logger?.warn(
                        `${extension.id}: contributes.themes[${String(index)}] skipped — "label" and "path" must be non-empty strings`,
                    );
                }
            });
        }
        return entries;
    }

    private async loadTheme({ extension, contribution }: IThemeEntry): Promise<IThemeFile | null> {
        const { label, path, uiTheme } = contribution;
        const describe = `${extension.id}: theme "${label}"`;
        try {
            const flat = await this.readThemeChain(extension, joinVirtualPath(extension.location, path), [], describe);
            // Stryker disable next-line ConditionalExpression: indexing the table with undefined gives the same undefined
            let type = uiTheme === undefined ? undefined : UI_THEME_TYPES[uiTheme];
            if (type === undefined) {
                this.logger?.warn(`${describe}: unknown uiTheme ${JSON.stringify(uiTheme)} — treated as dark`);
                type = "dark";
            }
            return { name: label, type, colors: flat.colors, tokenColors: flat.tokenColors };
        } catch (err) {
            this.logger?.error(`${describe} skipped — ${errorMessage(err)}`);
            return null;
        }
    }

    /** The base is merged under the including theme; `chain` is the visited paths, for cycle detection. */
    private async readThemeChain(
        extension: IExtension,
        virtualPath: string,
        chain: readonly string[],
        describe: string,
    ): Promise<IThemeFile> {
        if (chain.includes(virtualPath)) {
            throw new Error(`include cycle: ${[...chain, virtualPath].join(" → ")}`);
        }
        let text: string;
        try {
            text = await this.assets.readText(virtualPath);
        } catch (err) {
            // Stryker disable next-line ObjectLiteral: cause is needed for the error chain (preserve-caught-error), only the text goes out
            throw new Error(`cannot read ${virtualPath}: ${errorMessage(err)}`, { cause: err });
        }
        let file: IThemeFile;
        try {
            file = parseThemeFile(text, (message) => {
                this.logger?.warn(`${describe} (${virtualPath}): ${message}`);
            });
        } catch (err) {
            // Stryker disable next-line ObjectLiteral: see above
            throw new Error(`${virtualPath}: ${errorMessage(err)}`, { cause: err });
        }
        if (file.include === undefined) return file;
        const includePath = resolveIncludePath(extension.location, virtualPath, file.include);
        const base = await this.readThemeChain(extension, includePath, [...chain, virtualPath], describe);
        return mergeThemeFiles(base, file);
    }
}

function isThemeContribution(value: unknown): value is IThemeContribution {
    // Optional chaining covers both null and primitives; an object check would be redundant.
    const record = value as Partial<Record<"label" | "path", unknown>> | null | undefined;
    const label = record?.label;
    const path = record?.path;
    return typeof label === "string" && label.length > 0 && typeof path === "string" && path.length > 0;
}

/** `IAssetAccess` rejects `..`, and escaping the extension directory is an error. */
function resolveIncludePath(extensionLocation: string, themePath: string, include: string): string {
    const dir = themePath.slice(0, themePath.lastIndexOf("/") + 1);
    const segments: string[] = [];
    for (const segment of `${dir}${include}`.split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") {
            segments.pop();
            continue;
        }
        segments.push(segment);
    }
    const resolved = segments.join("/");
    if (!resolved.startsWith(extensionLocation)) throw new Error(`include "${include}" escapes the extension`);
    return resolved;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
