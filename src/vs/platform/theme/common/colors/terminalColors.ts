import type { ColorContribution } from "../colorRegistry.ts";

/**
 * 16 ANSI-цветов встроенного терминала — `ansiColorMap` эталона
 * (`workbench/contrib/terminal/common/terminalColorRegistry.ts`): ключи, дефолты
 * dark/light и описание дословно. Порядок ключей = индекс цвета в палитре
 * терминала (0 — Black … 15 — BrightWhite), по нему его читает
 * `terminalAnsiColors`. Дефолты high-contrast (`hcDark`/`hcLight` эталона) не
 * перенесены: реестр знает только dark/light.
 */
export const terminalColors = {
    "terminal.ansiBlack": {
        defaults: { dark: "#000000", light: "#000000" },
        description: "'Black' ANSI color in the terminal.",
    },
    "terminal.ansiRed": {
        defaults: { dark: "#cd3131", light: "#cd3131" },
        description: "'Red' ANSI color in the terminal.",
    },
    "terminal.ansiGreen": {
        defaults: { dark: "#0DBC79", light: "#107C10" },
        description: "'Green' ANSI color in the terminal.",
    },
    "terminal.ansiYellow": {
        defaults: { dark: "#e5e510", light: "#949800" },
        description: "'Yellow' ANSI color in the terminal.",
    },
    "terminal.ansiBlue": {
        defaults: { dark: "#2472c8", light: "#0451a5" },
        description: "'Blue' ANSI color in the terminal.",
    },
    "terminal.ansiMagenta": {
        defaults: { dark: "#bc3fbc", light: "#bc05bc" },
        description: "'Magenta' ANSI color in the terminal.",
    },
    "terminal.ansiCyan": {
        defaults: { dark: "#11a8cd", light: "#0598bc" },
        description: "'Cyan' ANSI color in the terminal.",
    },
    "terminal.ansiWhite": {
        defaults: { dark: "#e5e5e5", light: "#555555" },
        description: "'White' ANSI color in the terminal.",
    },
    "terminal.ansiBrightBlack": {
        defaults: { dark: "#666666", light: "#666666" },
        description: "'BrightBlack' ANSI color in the terminal.",
    },
    "terminal.ansiBrightRed": {
        defaults: { dark: "#f14c4c", light: "#cd3131" },
        description: "'BrightRed' ANSI color in the terminal.",
    },
    "terminal.ansiBrightGreen": {
        defaults: { dark: "#23d18b", light: "#14CE14" },
        description: "'BrightGreen' ANSI color in the terminal.",
    },
    "terminal.ansiBrightYellow": {
        defaults: { dark: "#f5f543", light: "#b5ba00" },
        description: "'BrightYellow' ANSI color in the terminal.",
    },
    "terminal.ansiBrightBlue": {
        defaults: { dark: "#3b8eea", light: "#0451a5" },
        description: "'BrightBlue' ANSI color in the terminal.",
    },
    "terminal.ansiBrightMagenta": {
        defaults: { dark: "#d670d6", light: "#bc05bc" },
        description: "'BrightMagenta' ANSI color in the terminal.",
    },
    "terminal.ansiBrightCyan": {
        defaults: { dark: "#29b8db", light: "#0598bc" },
        description: "'BrightCyan' ANSI color in the terminal.",
    },
    "terminal.ansiBrightWhite": {
        defaults: { dark: "#e5e5e5", light: "#a5a5a5" },
        description: "'BrightWhite' ANSI color in the terminal.",
    },
} as const satisfies ColorContribution;

/** Ключи ANSI-цветов в порядке индексов палитры терминала (0..15). */
export const TERMINAL_ANSI_COLOR_KEYS = Object.keys(terminalColors) as readonly (keyof typeof terminalColors)[];
