import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { Event } from "../../../base/common/event.ts";
import type { IRange } from "../core/iRange.ts";
import type { ILanguageFeatureTarget } from "../languageFeatureRegistry.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

/** upstream `languages.Command`. `tooltip` is carried, not shown: there is no mouse hover on a zone. */
export interface CodeLensCommand {
    readonly id: string;
    readonly title: string;
    readonly tooltip?: string;
    readonly arguments?: readonly unknown[];
    /**
     * Set when the command is not the registry's to run: the arguments of an extension's lens stay in the
     * subprocess, so its proxy runs it there by the address of the lens. Otherwise `id` and `arguments` go to the registry.
     */
    readonly run?: () => Promise<void>;
}

/** upstream `languages.CodeLens`, 0-based like the rest of the core. Without `command` it waits for a resolve. */
export interface CodeLens {
    readonly range: IRange;
    readonly id?: string;
    readonly command?: CodeLensCommand;
}

/** upstream `languages.CodeLensList`: the controller disposes it once the lenses are replaced. */
export interface CodeLensList {
    readonly lenses: readonly CodeLens[];
    dispose(): void;
}

/** What crosses to the extension host: the core asks about a document, the wire about its identity. */
export interface ICodeLensRequest {
    readonly uri: string;
    readonly languageId: string;
    readonly versionId: number;
}

/** What a provider is asked about. */
export interface ICodeLensTarget extends ILanguageFeatureTarget {
    readonly document: ITextDocument;
}

type CodeLensListResult = CodeLensList | null | undefined;
type CodeLensResult = CodeLens | null | undefined;

/** upstream `languages.CodeLensProvider`. */
export interface CodeLensProvider {
    provideCodeLenses(
        model: ICodeLensTarget,
        token: ICancellationToken,
    ): CodeLensListResult | Promise<CodeLensListResult>;
    resolveCodeLens?(
        model: ICodeLensTarget,
        lens: CodeLens,
        token: ICancellationToken,
    ): CodeLensResult | Promise<CodeLensResult>;
    readonly onDidChange?: Event<unknown>;
}

/** A clickable title inside {@link ICodeLensZone.text}, in UTF-16 offsets of that text. */
export interface ICodeLensAction {
    readonly start: number;
    readonly end: number;
    readonly command: CodeLensCommand;
}

/**
 * One row above {@link line}. The indent is not in {@link text}: it depends on the tab size and on the line as
 * it is now, so the element computes it when it paints.
 */
export interface ICodeLensZone {
    readonly line: number;
    readonly text: string;
    readonly actions: readonly ICodeLensAction[];
}
