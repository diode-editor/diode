// Сообщения редактора, которые печатаются в терминал поверх вывода процесса
// («Executing task: …», код выхода, «press any key to close»), — перенос
// `platform/terminal/common/terminalStrings.ts` эталона: те же escape-
// последовательности, поэтому выглядят они так же, как в VS Code.

export interface ITerminalFormatMessageOptions {
    /** Не начинать сообщение с новой строки (по умолчанию — начинать). */
    excludeLeadingNewLine?: boolean;
}

/** Оформляет сообщение редактора для печати в терминал: инверсная метка ` * ` и сброс стилей. */
export function formatMessageForTerminal(message: string, options: ITerminalFormatMessageOptions = {}): string {
    let result = "";
    if (options.excludeLeadingNewLine !== true) result += "\r\n";
    // «Громкого» оформления эталона (`loudFormatting`) нет: потребителя у него пока нет.
    result += `\x1b[0m\x1b[7m * \x1b[0m ${message} \x1b[0m\n\r`;
    return result;
}
