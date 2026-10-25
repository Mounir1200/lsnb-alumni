import { useEffect, useRef } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { RequireAuth } from "./components/auth/RequireAuth";
import { SiteFooter } from "./components/layout/SiteFooter";
import { SiteHeader } from "./components/layout/SiteHeader";
import { RouteTransition } from "./components/motion/RouteTransition";
import { legacyCallbackPath } from "./lib/authCallback";
import { DirectoryPage } from "./pages/DirectoryPage";
import { EditProfilePage } from "./pages/EditProfilePage";
import { HighlightsPage } from "./pages/HighlightsPage";
import { HomePage } from "./pages/HomePage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { JoinPage } from "./pages/JoinPage";
import { LoginPage } from "./pages/LoginPage";
import { MemberPage } from "./pages/MemberPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OfferEditorPage } from "./pages/OfferEditorPage";
import { OfferPage } from "./pages/OfferPage";
import { OffersPage } from "./pages/OffersPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { ProfilePage } from "./pages/ProfilePage";
import { CompleteProfilePage } from "./pages/CompleteProfilePage";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { MessagesPage } from "./pages/MessagesPage";

function PostConfirmationRedirect() {
  const navigate = useNavigate();
  const legacyReturn = useRef(new URL(window.location.href));

  useEffect(() => {
    const path = legacyCallbackPath(legacyReturn.current, new URL(window.location.href));
    if (path) navigate(path, { replace: true });
  }, [navigate]);

  return null;
}

export function App() {
  return (
    <div className="app-shell">
      <PostConfirmationRedirect />
      <a className="skip-link" href="#main-content">
        Aller au contenu principal
      </a>
      <SiteHeader />
      <main id="main-content">
        <RouteTransition>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/annuaire" element={<DirectoryPage />} />
            <Route path="/highlights" element={<HighlightsPage />} />
            <Route path="/offres" element={<OffersPage />} />
            <Route
              path="/offres/publier"
              element={
                <RequireAuth>
                  <OfferEditorPage />
                </RequireAuth>
              }
            />
            <Route path="/offres/:offerId" element={<OfferPage />} />
            <Route
              path="/offres/:offerId/modifier"
              element={
                <RequireAuth>
                  <OfferEditorPage />
                </RequireAuth>
              }
            />
            <Route path="/alumni/:profileId" element={<ProfilePage />} />
            <Route path="/rejoindre" element={<JoinPage />} />
            <Route path="/connexion" element={<LoginPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/completer-profil" element={<RequireAuth allowIncomplete><CompleteProfilePage /></RequireAuth>} />
            <Route
              path="/espace"
              element={
                <RequireAuth>
                  <MemberPage />
                </RequireAuth>
              }
            />
            <Route
              path="/espace/relations"
              element={
                <RequireAuth>
                  <ConnectionsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/espace/modifier"
              element={
                <RequireAuth>
                  <EditProfilePage />
                </RequireAuth>
              }
            />
            <Route path="/confidentialite" element={<PrivacyPage />} />
            <Route path="/espace/messages" element={<RequireAuth><MessagesPage /></RequireAuth>} />
            <Route path="/espace/messages/:conversationId" element={<RequireAuth><MessagesPage /></RequireAuth>} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </RouteTransition>
      </main>
      <SiteFooter />
    </div>
  );
}
