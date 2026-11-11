import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import App from "./App";
import { UpdateBoundary } from "./components/shell/UpdateBoundary";
import { persistQueries } from "./lib/persist";
import "./index.css";

// No global `vite:preloadError` reload: Vite fires it for speculative prefetches too (the idle discussion / add-form
// prefetch, a hover on Add), and those must fail quietly. A view that really needs a chunk recovers in its
// UpdateBoundary (one guarded reload onto the new build, then "SeaSensei was updated — Reload").

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      // A rate limit (Open-Meteo's 429) is not helped by asking again within seconds: wait for the next refresh.
      retry: (failures, error) => failures < 2 && !/\b429\b/.test(String((error as Error)?.message)),
    },
  },
});
// The last known board, back before the first render; each successful fetch is saved from here on (lib/persist.ts).
persistQueries(queryClient);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UpdateBoundary variant="screen">
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
          <App />
        </MotionConfig>
      </QueryClientProvider>
    </UpdateBoundary>
  </StrictMode>,
);

// Registered after load so it never competes with the first paint for the network.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
  if (document.readyState === "complete") register(); else window.addEventListener("load", register, { once: true });
}
