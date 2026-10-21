// Port of upstream terminalStrings.ts: the same escape sequences as VS Code.

export interface ITerminalFormatMessageOptions {
    /** Don't start the message on a new line (it does by default). */
    excludeLeadingNewLine?: boolean;
}

export function formatMessageForTerminal(message: string, options: ITerminalFormatMessageOptions = {}): string {
    let result = "";
    if (options.excludeLeadingNewLine !== true) result += "\r\n";
    // Upstream's "loud" formatting (`loudFormatting`) is left out: nothing consumes it yet.
    result += `\x1b[0m\x1b[7m * \x1b[0m ${message} \x1b[0m\n\r`;
    return result;
}
