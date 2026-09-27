import type { IDisposable } from "@tuidom/core/common/disposable";

import { joinVirtualPath } from "../../../../base/common/assets/assetBundleFormat.ts";
import type { IAssetAccess } from "../../../../base/common/assets/iAssetAccess.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IThemeContribution } from "../../../../platform/extensions/common/iThemeContribution.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IThemeFile } from "../../../../platform/theme/common/iThemeFile.ts";
import { mergeThemeFiles } from "../../../../platform/theme/common/mergeThemeFiles.ts";
import { parseThemeFile } from "../../../../platform/theme/common/themeFileParser.ts";
import type { ThemeRegistry } from "../../themes/common/themeRegistry.ts";

/** `uiTheme` манифеста → `IThemeFile.type` (решение 7 в Theming.md). */
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
 * Применяет вклад расширений в цветовые темы (`contributes.themes`):
 *   - читает файл каждой темы через {@link IAssetAccess} (виртуальный путь —
 *     `joinVirtualPath(ext.location, path)`), разбирает JSONC, резолвит цепочку
 *     `include` относительно файла темы и сливает её ({@link mergeThemeFiles}),
 *   - маппит `uiTheme` → `type` и регистрирует `{ ...file, name: label }` в
 *     {@link ThemeRegistry}.
 *
 * В отличие от грамматик, файлы тем читаются на старте — **все и до первого
 * кадра**: тема — десятки килобайт, а пикеру нужен синхронный `resolve` для
 * live preview, и первый кадр обязан быть уже в теме из `workbench.colorTheme`
 * (решение 2 в Theming.md). Чтение параллельное, регистрация — в порядке
 * расширений (встроенные → пользовательские): последняя регистрация одного
 * `label` побеждает, о затенении — warning с обоими id.
 *
 * Ошибка одной темы (нет файла, битый JSON, цикл `include`) — ошибка в лог с
 * id расширения, label и причиной, и пропуск: ни расширение, ни старт не падают.
 *
 * `dispose()` снимает регистрации этого контрибьютора (под будущую выгрузку
 * расширений); затенённая встроенная тема при этом не восстанавливается.
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

    /** Читает все темы расширений и регистрирует их в реестре. */
    public async apply(): Promise<void> {
        const entries = this.collectEntries();
        const files = await Promise.all(entries.map((entry) => this.loadTheme(entry)));

        // Кто из расширений уже занял label — для warning'а о затенении между
        // двумя расширениями (встроенную тему затеняет первое пришедшее).
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

    /** Записи `contributes.themes` всех расширений; битые (без `label`/`path`) — пропуск с warning. */
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
            // Stryker disable next-line ConditionalExpression: индекс undefined в таблице даёт то же undefined
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

    /**
     * Файл темы с разрешённой цепочкой `include`: база читается первой и
     * сливается под включающую тему. `chain` — уже пройденные пути, для
     * обнаружения цикла.
     */
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
            // Stryker disable next-line ObjectLiteral: cause нужен цепочке ошибок (preserve-caught-error), наружу уходит только текст
            throw new Error(`cannot read ${virtualPath}: ${errorMessage(err)}`, { cause: err });
        }
        let file: IThemeFile;
        try {
            file = parseThemeFile(text, (message) => {
                this.logger?.warn(`${describe} (${virtualPath}): ${message}`);
            });
        } catch (err) {
            // Stryker disable next-line ObjectLiteral: см. выше
            throw new Error(`${virtualPath}: ${errorMessage(err)}`, { cause: err });
        }
        if (file.include === undefined) return file;
        const includePath = resolveIncludePath(extension.location, virtualPath, file.include);
        const base = await this.readThemeChain(extension, includePath, [...chain, virtualPath], describe);
        return mergeThemeFiles(base, file);
    }
}

function isThemeContribution(value: unknown): value is IThemeContribution {
    // Опциональная цепочка покрывает и null/undefined, и примитивы (у них нет
    // таких полей) — отдельная проверка на объект была бы избыточной.
    const record = value as Partial<Record<"label" | "path", unknown>> | null | undefined;
    const label = record?.label;
    const path = record?.path;
    return typeof label === "string" && label.length > 0 && typeof path === "string" && path.length > 0;
}

/**
 * Путь `include` относительно файла темы, нормализованный (`.`/`..`, пустые
 * сегменты) внутри каталога расширения: `IAssetAccess` сегменты `..` не
 * пропускает, а выход за пределы расширения (`extension.location` — префикс с
 * `/` на конце) — ошибка: чужие файлы тема включать не может.
 */
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
