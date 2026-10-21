import type { ColorContribution } from "../colorRegistry.ts";

/**
 * Deviation from upstream: there the colors are translucent (`rgba(155,185,85,.2)`), here they are
 * the result of compositing them over `editor.background` of the dark and light themes. A theme
 * that overrides the editor background must override these colors too.
 */
export const diffColors = {
    "diffEditor.insertedLineBackground": {
        defaults: { dark: "#373D29", light: "#EBF1DD" },
        description: "Background color for lines that got inserted (opaque blend of the VS Code value).",
    },
    "diffEditor.removedLineBackground": {
        defaults: { dark: "#4B1818", light: "#FFCCCC" },
        description: "Background color for lines that got removed (opaque blend of the VS Code value).",
    },
    "diffEditor.insertedTextBackground": {
        defaults: { dark: "#374121", light: "#E6F2CA" },
        description: "Background color for text that got inserted (opaque blend of the VS Code value).",
    },
    "diffEditor.removedTextBackground": {
        defaults: { dark: "#4B1818", light: "#FFCCCC" },
        description: "Background color for text that got removed (opaque blend of the VS Code value).",
    },
    "diffEditor.unchangedRegionForeground": {
        defaults: { dark: "#8C8C8C", light: "#6E6E6E" },
        description: "Foreground color of the placeholder that stands for collapsed unchanged lines.",
    },
    "diffEditor.diagonalFill": {
        defaults: { dark: "#414141", light: "#D3D3D3" },
        description:
            "Color of the diagonal fill shown on side-by-side filler lines (opaque blend of the VS Code value).",
    },
} as const satisfies ColorContribution;
