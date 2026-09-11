export function greet(name: string): string {
  if (name.length === 0) {
    return "hello, stranger";
  }
  return `hello, ${name}`;
}
