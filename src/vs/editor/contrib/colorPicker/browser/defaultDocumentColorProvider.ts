import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
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
import { MODEL_SYNC_LIMIT, scanDocumentInIdleSlices } from "../../../common/languages/idleDocumentScan.ts";
import type { ITextDocument } from "../../../common/model/iTextDocument.ts";
import type { ILanguageFeaturesService } from "../../../common/services/languageFeatures.ts";

/**
 * Upstream's worker mirror model over the lines `[from, to)`: matches are searched line by line, offsets count
 * `\n` as one. A color never crosses a line, so the colors of the slices together are those of the document.
 */
class DocumentColorComputerTarget implements IDocumentColorComputerTarget {
    private readonly lineStarts: number[] = [];

    public constructor(
        private readonly document: ITextDocument,
        private readonly from: number,
        to: number,
    ) {
        let offset = 0;
        for (let line = from; line < to; line++) {
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
        return { line: this.from + low, character: offset - this.lineStarts[low] };
    }

    public findMatches(regex: RegExp): RegExpMatchArray[] {
        const matches: RegExpMatchArray[] = [];
        for (let i = 0; i < this.lineStarts.length; i++) {
            for (const match of this.document.getLineContent(this.from + i).matchAll(regex)) {
                match.index += this.lineStarts[i];
                matches.push(match);
            }
        }
        return matches;
    }
}

/**
 * Port of upstream `DefaultDocumentColorProvider`: the built-in detector of hex/rgb/hsl colors in any file.
 * Upstream scans in a worker; here {@link scanDocumentInIdleSlices} does.
 */
export class DefaultDocumentColorProvider implements DocumentColorProvider {
    public constructor(private readonly syncLimit = MODEL_SYNC_LIMIT) {}

    public provideDocumentColors(
        request: IDocumentColorRequest,
        token: ICancellationToken,
    ): Promise<IColorInformation[] | null> {
        const { document, versionId } = request;
        return scanDocumentInIdleSlices(document, versionId, token, this.syncLimit, (from, to) =>
            computeDefaultDocumentColors(new DocumentColorComputerTarget(document, from, to)),
        );
    }
}

/** Upstream `DefaultDocumentColorProviderFeature`. */
export function registerDefaultDocumentColorProvider(languageFeatures: ILanguageFeaturesService): IDisposable {
    return languageFeatures.colorProvider.register("*", new DefaultDocumentColorProvider());
}
