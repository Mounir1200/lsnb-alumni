import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlumniCard } from "../components/alumni/AlumniCard";
import { DirectoryConstellation } from "../components/directory/DirectoryConstellation";
import { Button } from "../components/ui/Button";
import { alumniProfiles, type AlumniProfile } from "../data/alumni";
import { loadProfiles } from "../lib/profileRepository";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function DirectoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [profiles, setProfiles] = useState<AlumniProfile[]>(alumniProfiles);
  const [profileSource, setProfileSource] = useState<"demo" | "supabase">("demo");
  const query = searchParams.get("q") ?? "";
  const domain = searchParams.get("domaine") ?? "";
  const country = searchParams.get("pays") ?? "";
  const mentoringOnly = searchParams.get("mentor") === "true";

  useEffect(() => {
    let active = true;
    loadProfiles()
      .then((result) => {
        if (!active) return;
        setProfiles(result.profiles);
        setProfileSource(result.source);
      })
      .catch(() => {
        if (!active) return;
        setProfiles(alumniProfiles);
        setProfileSource("demo");
      });
    return () => {
      active = false;
    };
  }, []);

  const availableDomains = useMemo(
    () => [...new Set(profiles.map((profile) => profile.domain))].sort(),
    [profiles],
  );
  const availableCountries = useMemo(
    () => [...new Set(profiles.map((profile) => profile.country))].sort(),
    [profiles],
  );

  const updateFilter = (key: string, value: string | boolean) => {
    const next = new URLSearchParams(searchParams);
    if (typeof value === "boolean") {
      value ? next.set(key, "true") : next.delete(key);
    } else if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };

  const filteredProfiles = useMemo(() => {
    const needle = normalize(query.trim());
    return profiles.filter((profile) => {
      const searchable = normalize(
        [
          profile.firstName,
          profile.lastName,
          profile.currentRole,
          profile.domain,
          profile.specialties.join(" "),
          profile.city,
          profile.country,
        ].join(" "),
      );

      return (
        (!needle || searchable.includes(needle)) &&
        (!domain || profile.domain === domain) &&
        (!country || profile.country === country) &&
        (!mentoringOnly || profile.offersMentoring)
      );
    });
  }, [country, domain, mentoringOnly, profiles, query]);

  const hasFilters = Boolean(query || domain || country || mentoringOnly);
  const activeFilterCount = [query, domain, country, mentoringOnly].filter(Boolean).length;

  return (
    <div className="directory-page">
      <header className="directory-hero">
        <div className="page-shell directory-hero__inner">
          <div className="directory-hero__copy">
            <p className="eyebrow">Annuaire LSNB</p>
            <h1>Trouver la bonne personne,<br />pas seulement un nom.</h1>
            <p>
              Cherchez une spécialité, un domaine, un pays ou une disponibilité au mentorat.
              Les coordonnées restent sous le contrôle de chaque membre.
            </p>
          </div>
          <DirectoryConstellation />
        </div>
      </header>

      <section className="page-shell directory-content" aria-label="Annuaire des alumni">
        <aside className="directory-filters" aria-label="Filtres de recherche">
          <div className="directory-filters__title">
            <div className="directory-filters__titleline">
              <span><SlidersHorizontal size={17} aria-hidden="true" /> Outil de repérage</span>
              <b>{activeFilterCount > 0 ? `${activeFilterCount} actif${activeFilterCount > 1 ? "s" : ""}` : "Tout le réseau"}</b>
            </div>
            <h2>Cibler une trajectoire.</h2>
            <p>Combinez les repères utiles, sans réduire un profil à son intitulé.</p>
          </div>

          <div className="directory-filters__controls">
            <label className="directory-filter-field directory-filter-field--search">
              <span>Nom ou spécialité</span>
              <span className="input-with-icon">
                <Search size={18} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  placeholder="Ex. physique, énergie, Aïcha…"
                  onChange={(event) => updateFilter("q", event.target.value)}
                />
              </span>
            </label>

            <label className="directory-filter-field">
              <span>Domaine</span>
              <select value={domain} onChange={(event) => updateFilter("domaine", event.target.value)}>
                <option value="">Tous les domaines</option>
                {availableDomains.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>

            <label className="directory-filter-field">
              <span>Pays</span>
              <select value={country} onChange={(event) => updateFilter("pays", event.target.value)}>
                <option value="">Tous les pays</option>
                {availableCountries.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>

            <label className="directory-filter-switch">
              <input
                type="checkbox"
                checked={mentoringOnly}
                onChange={(event) => updateFilter("mentor", event.target.checked)}
              />
              <span className="directory-filter-switch__track" aria-hidden="true"><i /></span>
              <span>
                <b>Mentorat ouvert</b>
                Alumni disponibles uniquement
              </span>
            </label>

            {hasFilters && (
              <Button className="directory-filters__reset" variant="outline" onClick={() => setSearchParams({})}>
                <RotateCcw size={16} aria-hidden="true" /> Réinitialiser
              </Button>
            )}
          </div>
        </aside>

        <div className="directory-results">
          <div className="directory-results__bar">
            <p role="status" aria-live="polite">
              <b>{filteredProfiles.length}</b> profil{filteredProfiles.length > 1 ? "s" : ""} trouvé{filteredProfiles.length > 1 ? "s" : ""}
            </p>
            <span>
              {profileSource === "demo" ? "Profils fictifs · démonstration" : "Profils des membres"}
            </span>
          </div>

          {filteredProfiles.length > 0 ? (
            <div className="directory-grid">
              {filteredProfiles.map((profile) => (
                <AlumniCard key={profile.id} profile={profile} />
              ))}
            </div>
          ) : (
            <div className="directory-empty">
              <Search size={34} aria-hidden="true" />
              <h2>Aucun parcours ne correspond encore.</h2>
              <p>Essayez une spécialité plus large ou retirez un filtre.</p>
              <Button variant="outline" onClick={() => setSearchParams({})}>
                Voir tous les profils
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
