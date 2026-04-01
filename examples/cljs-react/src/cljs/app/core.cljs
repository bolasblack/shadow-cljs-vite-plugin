(ns app.core)

(defn greet [name]
  (str "Hello, " name "! (from ClojureScript)"))

(defn add [a b]
  (+ a b))

(defn fibonacci [n]
  (clj->js
   (loop [a 0 b 1 i 0 result []]
     (if (>= i n)
       result
       (recur b (+ a b) (inc i) (conj result a))))))

(defn init []
  (js/console.log "ClojureScript app initialized"))
