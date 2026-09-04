import { Route, Routes } from "react-router-dom";
import { SiteFooter } from "./components/layout/SiteFooter";
import { SiteHeader } from "./components/layout/SiteHeader";
import { RouteTransition } from "./components/motion/RouteTransition";
import { DirectoryPage } from "./pages/DirectoryPage";
import { HomePage } from "./pages/HomePage";
import { JoinPage } from "./pages/JoinPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { ProfilePage } from "./pages/ProfilePage";

export function App() {
  return (
    <div className="app-shell">
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
            <Route path="/confidentialite" element={<PrivacyPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </RouteTransition>
      </main>
      <SiteFooter />
    </div>
  );
}
