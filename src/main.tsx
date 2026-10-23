import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { PendingRequestsProvider } from "./components/mentoring/PendingRequestsProvider";
import { SiteAvailability } from "./components/maintenance/SiteAvailability";
import { MessagingProvider } from "./components/messaging/MessagingProvider";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SiteAvailability>
          <PendingRequestsProvider>
            <MessagingProvider>
              <App />
            </MessagingProvider>
          </PendingRequestsProvider>
        </SiteAvailability>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
