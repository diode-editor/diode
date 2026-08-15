// Sample file for the test fixture.
// Open diode with this fixture without touching the real ~/.diode:
//
//   npm start -- --user-data-dir ./test-fixtures/diode-home test-fixtures/diode-home/sample.ts
//
// Try the "compact" profile (tabSize=8, tabs instead of spaces):
//
//   npm start -- --user-data-dir ./test-fixtures/diode-home --profile compact \
//       test-fixtures/diode-home/sample.ts

export function greet(name: string): string {
    return `Hello, ${name}!`;
}

const numbers = [1, 2, 3, 4, 5];
for (const n of numbers) {
    console.log(greet(`item ${n}`));
}
