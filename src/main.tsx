import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { PendingRequestsProvider } from "./components/mentoring/PendingRequestsProvider";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <PendingRequestsProvider>
          <App />
        </PendingRequestsProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
