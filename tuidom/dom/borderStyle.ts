/**
 * Толщина рамки drawBox в ячейках. В клеточном терминале рамка — это
 * box-drawing-глиф, физически всегда 1 ячейка; константа никогда не сменит
 * значение. Её ценность — имя: все места, где рамка участвует в формулах
 * размеров/смещений, находятся грепом и отличимы от настоящих отступов.
 */
export const BORDER_THICKNESS = 1;

/**
 * Набор box-drawing глифов для рамки виджета. Используется общим хелпером
 * {@link RenderContext.drawBox}, чтобы отрисовка рамок не дублировалась по
 * виджетам и стиль углов был единым.
 *
 * `leftJoint`/`rightJoint` — T-коннекторы (`├`/`┤`) для строк-сепараторов
 * (ряд-разделитель внутри рамки).
 */
export interface BorderStyle {
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
    horizontal: string;
    vertical: string;
    leftJoint: string;
    rightJoint: string;
}

/** Прямые углы `┌┐└┘`. Пресет на будущее (по умолчанию не используется). */
export const BORDER_SINGLE: BorderStyle = {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    horizontal: "─",
    vertical: "│",
    leftJoint: "├",
    rightJoint: "┤",
};

/** Скруглённые углы `╭╮╰╯` (nvchad-стиль) — канонический стиль рамок во всех оверлеях Vexx. */
export const BORDER_ROUNDED: BorderStyle = {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
    leftJoint: "├",
    rightJoint: "┤",
};

/** Двойные линии `╔╗╚╝`. Пресет на будущее (по умолчанию не используется). */
export const BORDER_DOUBLE: BorderStyle = {
    topLeft: "╔",
    topRight: "╗",
    bottomLeft: "╚",
    bottomRight: "╝",
    horizontal: "═",
    vertical: "║",
    leftJoint: "╠",
    rightJoint: "╣",
};
