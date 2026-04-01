(ns app.worker
  (:require [app.shared :as shared]))

(defn- render-html
  "Render a simple HTML page with SSR content from CLJS"
  [name]
  (str "<!DOCTYPE html>
<html>
<head><title>CLJS Worker SSR</title></head>
<body>
  <h1>" (shared/greet name) "</h1>
  <p>add(21, 21) = " (shared/add 21 21) "</p>
  <p>Rendered by Cloudflare Worker with ClojureScript</p>
</body>
</html>"))

(defn- handle-request
  "Handle incoming HTTP request"
  [request env]
  (let [url (js/URL. (.-url request))
        pathname (.-pathname url)
        name (or (-> url .-searchParams (.get "name")) "World")]
    (case pathname
      "/api/greet"
      (js/Response.
       (js/JSON.stringify #js {:greeting (shared/greet name)
                               :sum (shared/add 21 21)})
       #js {:headers #js {"Content-Type" "application/json"}})

      ;; Default: return SSR HTML
      (js/Response.
       (render-html name)
       #js {:headers #js {"Content-Type" "text/html;charset=UTF-8"}}))))

(def ^:export default
  #js {:fetch (fn [request env _ctx]
                (handle-request request env))})
