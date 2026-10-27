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

    public getValue(): string {
        return this.document.getText();
    }

    public positionAt(offset: number): IPosition {
        let low = 0;
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

/**
 * Port of upstream `DefaultDocumentColorProvider`: the built-in detector of hex/rgb/hsl colors in any file.
 * Computed in place, not in a worker: the large-file mode never asks for colors.
 */
export class DefaultDocumentColorProvider implements DocumentColorProvider {
    public provideDocumentColors(request: IDocumentColorRequest): Promise<IColorInformation[]> {
        return Promise.resolve(computeDefaultDocumentColors(new DocumentColorComputerTarget(request.document)));
    }
}

/** Upstream `DefaultDocumentColorProviderFeature`. */
export function registerDefaultDocumentColorProvider(languageFeatures: ILanguageFeaturesService): IDisposable {
    return languageFeatures.colorProvider.register("*", new DefaultDocumentColorProvider());
}
