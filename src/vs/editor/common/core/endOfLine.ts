/**
 * Значения — как у публичного `EndOfLine` VS Code. Документ хранит строки без
 * терминаторов; EOL применяется только на границе с диском.
 */
export enum EndOfLine {
    LF = 1,
    CRLF = 2,
}

export function eolToSequence(eol: EndOfLine): "\n" | "\r\n" {
    return eol === EndOfLine.CRLF ? "\r\n" : "\n";
}

/** Большинство побеждает; ничья и текст без переводов строк — LF. */
export function detectEndOfLine(text: string): EndOfLine {
    let crlf = 0;
    let index = text.indexOf("\r\n");
    while (index !== -1) {
        crlf++;
        index = text.indexOf("\r\n", index + 2);
    }

    let totalLf = 0;
    index = text.indexOf("\n");
    while (index !== -1) {
        totalLf++;
        index = text.indexOf("\n", index + 1);
    }

    const loneLf = totalLf - crlf;
    return crlf > loneLf ? EndOfLine.CRLF : EndOfLine.LF;
}
