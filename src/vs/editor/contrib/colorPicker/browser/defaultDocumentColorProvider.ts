import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IPosition } from "../../../common/core/iPosition.ts";
import {
    computeDefaultDocumentColors,
    type IDocumentColorComputerTarget,
} from "../../../common/languages/defaultDocumentColorsComputer.ts";
import type {
    DocumentColorProvider,
    IColorInformation,
    IDocumentColorRequest,
} from "../../../common/languages/iColorSource.ts";
import type { ITextDocument } from "../../../common/model/iTextDocument.ts";
import type { ILanguageFeaturesService } from "../../../common/services/languageFeatures.ts";

/** Upstream's worker mirror model: matches are searched line by line, offsets count `\n` as one. */
class DocumentColorComputerTarget implements IDocumentColorComputerTarget {
    private readonly lineStarts: number[] = [];

    public constructor(private readonly document: ITextDocument) {
        let offset = 0;
        for (let line = 0; line < document.lineCount; line++) {
            this.lineStarts.push(offset);
            offset += document.getLineLength(line) + 1;
        }
    }

    public positionAt(offset: number): IPosition {
        let low = 0;
        // Stryker disable next-line ArithmeticOperator: a `high` past the end only adds probes of undefined, which compare false
        let high = this.lineStarts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (this.lineStarts[mid] <= offset) low = mid;
            else high = mid - 1;
        }
        return { line: low, character: offset - this.lineStarts[low] };
    }

    public findMatches(regex: RegExp): RegExpMatchArray[] {
        const matches: RegExpMatchArray[] = [];
        for (let line = 0; line < this.lineStarts.length; line++) {
            for (const match of this.document.getLineContent(line).matchAll(regex)) {
                match.index += this.lineStarts[line];
                matches.push(match);
            }
        }
        return matches;
    }
}

/** Upstream `_MODEL_SYNC_LIMIT`, in characters. */
const MODEL_SYNC_LIMIT = 50 * 1024 * 1024;

/**
 * Port of upstream `DefaultDocumentColorProvider`: the built-in detector of hex/rgb/hsl colors in any file.
 * Computed in place, not in a worker. Upstream's worker never gets a document above `_MODEL_SYNC_LIMIT` and
 * answers `null` for it; the same here, so "Enable Editing" on a huge log does not scan it for seconds.
 */
export class DefaultDocumentColorProvider implements DocumentColorProvider {
    public constructor(private readonly syncLimit = MODEL_SYNC_LIMIT) {}

    public provideDocumentColors(request: IDocumentColorRequest): Promise<IColorInformation[] | null> {
        if (request.document.getValueLength() > this.syncLimit) return Promise.resolve(null);
        return Promise.resolve(computeDefaultDocumentColors(new DocumentColorComputerTarget(request.document)));
    }
}

/** Upstream `DefaultDocumentColorProviderFeature`. */
export function registerDefaultDocumentColorProvider(languageFeatures: ILanguageFeaturesService): IDisposable {
    return languageFeatures.colorProvider.register("*", new DefaultDocumentColorProvider());
}
