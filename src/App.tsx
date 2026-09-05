import { useEffect, useRef } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { RequireAuth } from "./components/auth/RequireAuth";
import { SiteFooter } from "./components/layout/SiteFooter";
import { SiteHeader } from "./components/layout/SiteHeader";
import { RouteTransition } from "./components/motion/RouteTransition";
import { uploadPendingAvatar } from "./lib/avatarRepository";
import { DirectoryPage } from "./pages/DirectoryPage";
import { EditProfilePage } from "./pages/EditProfilePage";
import { HomePage } from "./pages/HomePage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { JoinPage } from "./pages/JoinPage";
import { LoginPage } from "./pages/LoginPage";
import { MemberPage } from "./pages/MemberPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { ProfilePage } from "./pages/ProfilePage";
import { CompleteProfilePage } from "./pages/CompleteProfilePage";

function PostConfirmationRedirect() {
  const { lastEvent, user } = useAuth();
  const navigate = useNavigate();
  const isLegacyReturn = useRef(window.location.pathname === "/" &&
    /(?:[?#&])(access_token|code|token_hash)=/.test(window.location.search + window.location.hash));

  useEffect(() => {
    if (isLegacyReturn.current && lastEvent === "SIGNED_IN" && user && window.location.pathname === "/") {
      let active = true;
      void uploadPendingAvatar(user)
        .then((photoUrl) => {
          if (active) {
            navigate(`/espace?confirmed=true${photoUrl ? "&photo=uploaded" : ""}`, {
              replace: true,
            });
          }
        })
        .catch(() => {
          if (active) navigate("/espace?confirmed=true&photo=retry", { replace: true });
        });
      return () => {
        active = false;
      };
    }
  }, [lastEvent, navigate, user]);

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
              path="/espace/modifier"
              element={
                <RequireAuth>
                  <EditProfilePage />
                </RequireAuth>
              }
            />
            <Route path="/confidentialite" element={<PrivacyPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </RouteTransition>
      </main>
      <SiteFooter />
    </div>
  );
}
