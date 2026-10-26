export function demo(): string {
    return describe({
        name: "demo",
        retries: 3,
    });
}

// Fixture for the "diagnostics over indent guides" demo: a real tsserver
// error sits on a MULTI-LINE range (an object argument where a string is
// expected) at the VERY TOP of the file. So, first, it covers the indentation
// of the inner lines — exactly the cells where the `▏` folding guides are
// drawn — and second, it falls under the quick pick overlay, which opens
// at the top edge of the screen.
export function describe(label: string): string {
    return `[${label}]`;
}
