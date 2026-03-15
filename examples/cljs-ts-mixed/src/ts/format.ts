// TypeScript utility functions shared with ClojureScript.
//
// CLJS imports this module via (:require ["@ts/format" :as fmt]),
// which works because Vite resolves the "@ts/" alias when processing
// the shadow-cljs compiled output.

export function formatUpperCase(s: string): string {
  return s.toUpperCase();
}
