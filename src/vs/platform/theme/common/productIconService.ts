import { codicon, iconGlyph, type IProductIcon, renderCodicons } from "../../../base/common/codicons.ts";
import { Emitter, type Event } from "../../../base/common/event.ts";
import { type FileIcon, getFileIcon } from "../../../base/common/fileIcons.ts";
import { DisposableStore, type IDisposable } from "../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../configuration/common/iConfigurationService.ts";
import { token } from "../../instantiation/common/diContainer.ts";

export const NERD_FONT_SETTING = "diode.icons.nerdFont";

/**
 * `auto`: the font cannot be detected (the terminal reports neither its glyphs nor real widths), so only
 * a terminal known to lack the glyphs turns them off — the Linux console, `TERM=linux`. An unknown
 * terminal keeps them: no regression for users who have the font. WezTerm, kitty and Ghostty carry the
 * symbols themselves, so for them `auto` is "on" whatever the font. An unknown setting value is `auto`.
 */
export function resolveNerdFont(setting: unknown, term: string | undefined): boolean {
    if (setting === "on") return true;
    if (setting === "off") return false;
    return term !== "linux";
}

/**
 * The one source of truth for which glyph set icons are drawn with. Ours: upstream picks icons through
 * `workbench.productIconTheme` and `workbench.iconTheme`; `off` is a built-in "Unicode" product icon
 * theme plus the `null` file icon theme ("No file icons").
 */
export interface IProductIconService {
    readonly nerdFont: boolean;
    /** Everything that bakes a glyph into its rendering re-renders on it. */
    readonly onDidChange: Event<void>;
    /** A plain string is a literal (`✓`, `★`) and passes through unchanged. */
    glyph(icon: IProductIcon | string): string;
    codicon(name: string): string;
    renderCodicons(text: string): string;
    /** `undefined` means "no file icon": the column and its gap disappear, not a blank cell. */
    fileIcon(filename: string): FileIcon | undefined;
}

export const ProductIconServiceDIToken = token<IProductIconService>("ProductIconService");

abstract class ProductIcons implements IProductIconService {
    public abstract readonly nerdFont: boolean;
    public abstract readonly onDidChange: Event<void>;

    public glyph(icon: IProductIcon | string): string {
        return typeof icon === "string" ? icon : iconGlyph(icon, this.nerdFont);
    }

    public codicon(name: string): string {
        return iconGlyph(codicon(name), this.nerdFont);
    }

    public renderCodicons(text: string): string {
        return renderCodicons(text, this.nerdFont);
    }

    public fileIcon(filename: string): FileIcon | undefined {
        return this.nerdFont ? getFileIcon(filename) : undefined;
    }
}

/** A fixed glyph set, for tests and for code outside the workbench. */
export class StaticProductIconService extends ProductIcons {
    public readonly onDidChange: Event<void> = () => ({ dispose: () => undefined });

    public constructor(public readonly nerdFont: boolean) {
        super();
    }
}

/** Nerd Font glyphs: the default of code built without the workbench service. */
export const NERD_FONT_ICONS: IProductIconService = new StaticProductIconService(true);

export class ProductIconService extends ProductIcons implements IDisposable {
    private readonly disposables = new DisposableStore();
    private readonly onDidChangeEmitter = this.disposables.add(new Emitter<void>());
    public readonly onDidChange = this.onDidChangeEmitter.event;
    private nerdFontValue: boolean;

    public constructor(
        private readonly config: IConfigurationService,
        private readonly term: string | undefined,
    ) {
        super();
        this.nerdFontValue = this.resolve();
        this.disposables.add(
            config.onDidChangeConfiguration((event) => {
                // Stryker disable next-line ConditionalExpression: a fast path — for any other key the resolved mode is unchanged and the equality guard below returns anyway
                if (!event.affectsConfiguration(NERD_FONT_SETTING)) return;
                const next = this.resolve();
                if (next === this.nerdFontValue) return;
                this.nerdFontValue = next;
                this.onDidChangeEmitter.fire();
            }),
        );
    }

    public dispose(): void {
        this.disposables.dispose();
    }

    public get nerdFont(): boolean {
        return this.nerdFontValue;
    }

    private resolve(): boolean {
        return resolveNerdFont(this.config.get<string>(NERD_FONT_SETTING), this.term);
    }
}
