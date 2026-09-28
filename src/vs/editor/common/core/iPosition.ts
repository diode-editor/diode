/**
 * Represents a position in a text document (0-based line and character).
 */
export interface IPosition {
    readonly line: number;
    readonly character: number;
}

export function createPosition(line: number, character: number): IPosition {
    return { line, character };
}

/**
 * Compares two positions. Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function comparePositions(a: IPosition, b: IPosition): number {
    if (a.line !== b.line) {
        return a.line - b.line;
    }
    return a.character - b.character;
}

export function positionsEqual(a: IPosition, b: IPosition): boolean {
    return a.line === b.line && a.character === b.character;
}

/** Минимум документа, нужный клампу позиции: число строк и длины строк. */
export interface IPositionClampTarget {
    readonly lineCount: number;
    getLineLength(line: number): number;
}

/**
 * Позиция, приведённая к границам документа — аналог `validatePosition` в
 * vscode. Дверь для позиций из внешнего источника (расширение, LSP, снимок
 * прежнего документа): их автор не обязан знать текущее содержимое, а позиция
 * за концом строки — это уже не «неточная каретка», а сломанный кадр:
 * highlight вхождений зовётся из render, и читатель строки по такой позиции
 * роняет редактор целиком.
 */
export function clampPositionToDocument(doc: IPositionClampTarget, position: IPosition): IPosition {
    const line = Math.min(Math.max(position.line, 0), doc.lineCount - 1);
    const character = Math.min(Math.max(position.character, 0), doc.getLineLength(line));
    return { line, character };
}
