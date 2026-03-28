(ns app.core
  (:require [reagent.core :as r]
            [reagent.dom.client :as rdc]))

;; --- State ---

(defonce counter (r/atom 0))
(defonce name-input (r/atom "World"))

;; --- Components ---

(defn greeting []
  [:div
   [:h2 "Greeting"]
   [:input {:value @name-input
            :on-change #(reset! name-input (.. % -target -value))}]
   [:p (str "Hello, " @name-input "! (from Reagent)")]])

(defn counter-widget []
  [:div
   [:h2 "Counter"]
   [:p "Count: " @counter]
   [:button {:on-click #(swap! counter inc)} "+"]
   " "
   [:button {:on-click #(swap! counter dec)} "-"]])

(defn fibonacci [n]
  (loop [a 0 b 1 i 0 result []]
    (if (>= i n)
      result
      (recur b (+ a b) (inc i) (conj result a)))))

(defn fibonacci-widget []
  (let [n (r/atom 10)]
    (fn []
      [:div
       [:h2 "Fibonacci"]
       [:label "n = "
        [:input {:type "number"
                 :value @n
                 :on-change #(reset! n (js/parseInt (.. % -target -value) 10))
                 :style {:width 60}}]]
       [:p (str "fibonacci(" @n ") = [" (clojure.string/join ", " (fibonacci @n)) "]")]])))

(defn app []
  [:div {:style {:font-family "system-ui" :max-width 600 :margin "0 auto" :padding 20}}
   [:h1 "CLJS Reagent Example"]
   [greeting]
   [counter-widget]
   [fibonacci-widget]])

;; --- Mount ---

(defonce root (atom nil))

(defn ^:dev/after-load render []
  (when-let [el (js/document.getElementById "root")]
    (when (nil? @root)
      (reset! root (rdc/create-root el)))
    (rdc/render @root [app])))

(defn init []
  (render))
