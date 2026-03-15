// Type declarations for shadow-cljs virtual modules.
// Since ClojureScript has no type information, we declare the exports manually.
declare module "virtual:shadow-cljs/app" {
  export function greet(name: string): string;
  export function add(a: number, b: number): number;
  export function formattedGreeting(name: string): string;
}
