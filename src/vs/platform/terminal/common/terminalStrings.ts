// Перенос terminalStrings.ts эталона: те же escape-последовательности, что в VS Code.

export interface ITerminalFormatMessageOptions {
    /** Не начинать сообщение с новой строки (по умолчанию — начинать). */
    excludeLeadingNewLine?: boolean;
}

export function formatMessageForTerminal(message: string, options: ITerminalFormatMessageOptions = {}): string {
    let result = "";
    if (options.excludeLeadingNewLine !== true) result += "\r\n";
    // «Громкого» оформления эталона (`loudFormatting`) нет: потребителя у него пока нет.
    result += `\x1b[0m\x1b[7m * \x1b[0m ${message} \x1b[0m\n\r`;
    return result;
}
