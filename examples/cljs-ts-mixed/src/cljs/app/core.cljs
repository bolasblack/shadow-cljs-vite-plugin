(ns app.core
  (:require ["@ts/format" :as fmt]))

(defn greet [name]
  (str "Hello, " name "! (from ClojureScript)"))

(defn add [a b]
  (+ a b))

;; Call a TypeScript function directly via Vite alias.
;; shadow-cljs preserves the "@ts/format" import specifier as-is,
;; and Vite resolves it to src/ts/format.ts.
(defn formatted-greeting [name]
  (let [upper-name (fmt/formatUpperCase name)]
    (str "Hello, " upper-name "! (from CLJS, formatted by TS)")))

(defn init []
  (js/console.log "ClojureScript app initialized"))
