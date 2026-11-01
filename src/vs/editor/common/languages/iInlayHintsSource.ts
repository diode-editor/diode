import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { Event } from "../../../base/common/event.ts";
import type { IPosition } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";
import type { ILanguageFeatureTarget } from "../languageFeatureRegistry.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

/** Values match upstream `languages.InlayHintKind`. */
export enum InlayHintKind {
    Type = 1,
    Parameter = 2,
}

/**
 * upstream `languages.InlayHintLabelPart`. `tooltip`, `location` and `command` are carried, not drawn yet:
 * there is no mouse hover or Ctrl+click on a hint (docs/TODO/InlayHintsCodeLens.md).
 */
export interface InlayHintLabelPart {
    readonly label: string;
    readonly tooltip?: unknown;
    readonly location?: { readonly uri: string; readonly range: IRange };
    readonly command?: { readonly id: string; readonly title: string; readonly arguments?: readonly unknown[] };
}

/** upstream `languages.InlayHint`, 0-based like the rest of the core. `tooltip` and `textEdits` are carried, not used. */
export interface InlayHint {
    readonly position: IPosition;
    readonly label: string | readonly InlayHintLabelPart[];
    readonly kind?: InlayHintKind;
    readonly paddingLeft?: boolean;
    readonly paddingRight?: boolean;
    readonly tooltip?: unknown;
    readonly textEdits?: readonly { readonly range: IRange; readonly text: string }[];
}

/** upstream `languages.InlayHintList`: the controller disposes it once the hints are replaced. */
export interface InlayHintList {
    readonly hints: readonly InlayHint[];
    dispose(): void;
}

/** What a provider is asked about: `document.versionId` is the version the answer must describe. */
export interface IInlayHintsTarget extends ILanguageFeatureTarget {
    readonly document: ITextDocument;
}

type InlayHintsResult = InlayHintList | null | undefined;

/** upstream `languages.InlayHintsProvider`. `resolveInlayHint` is not called yet. */
export interface InlayHintsProvider {
    provideInlayHints(
        model: IInlayHintsTarget,
        range: IRange,
        token: ICancellationToken,
    ): InlayHintsResult | Promise<InlayHintsResult>;
    resolveInlayHint?(
        hint: InlayHint,
        token: ICancellationToken,
    ): InlayHint | null | undefined | Promise<InlayHint | null | undefined>;
    readonly onDidChangeInlayHints?: Event<void>;
}
