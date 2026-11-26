export interface User {
    name: string;
}

export function greet(user: User): string {
    return `Hello, ${user.name}`;
}
