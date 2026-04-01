(ns app.browser
  (:require [app.shared :as shared]))

;; Browser entry point — called by shadow-cljs :init-fn
(defn init []
  (js/console.log (shared/greet "Browser")))

;; Hot-reload callback — called by shadow-cljs :after-load
(defn remount []
  (js/console.log "shadow-cljs: browser remounted"))
