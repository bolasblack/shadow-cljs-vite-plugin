declare module "virtual:shadow-cljs/browser" {
  export function greet(name: string): string;
  export function add(a: number, b: number): number;
}

declare module "virtual:shadow-cljs/worker" {
  const worker: ExportedHandler;
  export default worker;
}
