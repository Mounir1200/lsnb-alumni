import { ArrowRight, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { countries, domains } from "../../data/alumni";
import { Button } from "../ui/Button";

export function HeroSearch() {
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const filtersId = useId();
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [country, setCountry] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = Number(Boolean(domain)) + Number(Boolean(country));

  useEffect(() => {
    if (!filtersOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!formRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [filtersOpen]);

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (domain) params.set("domaine", domain);
    if (country) params.set("pays", country);
    navigate(`/annuaire${params.size ? `?${params.toString()}` : ""}`);
  };

  const resetFilters = () => {
    setDomain("");
    setCountry("");
  };

  return (
    <div className="hero-search-anchor page-shell" data-hero-enter>
      <form ref={formRef} className="hero-search" onSubmit={handleSearch}>
        <div className="hero-search__meta">
          <p className="hero-search__meta-copy">
            <span aria-hidden="true" className="hero-search__route-mark" />
            <strong>Trouver un parcours</strong>
            <span id="hero-search-hint">Nom, spécialité ou domaine</span>
          </p>

          <button
            type="button"
            className="hero-search__filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
            data-active={activeFilterCount > 0}
            onClick={() => setFiltersOpen((isOpen) => !isOpen)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            Affiner
            {activeFilterCount > 0 && (
              <span className="hero-search__filter-count" aria-label={`${activeFilterCount} filtres actifs`}>
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        <div className="hero-search__field">
          <Search size={21} aria-hidden="true" />
          <label htmlFor="hero-search-query" className="sr-only">Rechercher un parcours</label>
          <input
            id="hero-search-query"
            type="search"
            placeholder="Ex. physique, énergie, Aïcha…"
            value={query}
            aria-describedby="hero-search-hint"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              className="hero-search__clear"
              aria-label="Effacer la recherche"
              onClick={() => setQuery("")}
            >
              <X size={17} aria-hidden="true" />
            </button>
          )}
          <Button type="submit" className="hero-search__submit" aria-label="Lancer la recherche">
            Rechercher <ArrowRight size={18} aria-hidden="true" />
          </Button>
        </div>

        {filtersOpen && (
          <div id={filtersId} className="hero-search__filter-panel" aria-label="Filtres de recherche">
            <div className="hero-search__filter-heading">
              <div>
                <strong>Affiner la recherche</strong>
                <span>Ces filtres restent facultatifs.</span>
              </div>
              <button
                type="button"
                className="hero-search__filter-close"
                aria-label="Fermer les filtres"
                onClick={() => setFiltersOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <label>
              <span>Domaine</span>
              <select value={domain} onChange={(event) => setDomain(event.target.value)}>
                <option value="">Tous les domaines</option>
                {domains.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>

            <label>
              <span>Pays</span>
              <select value={country} onChange={(event) => setCountry(event.target.value)}>
                <option value="">Tous les pays</option>
                {countries.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>

            <div className="hero-search__filter-actions">
              {activeFilterCount > 0 && (
                <button type="button" className="hero-search__reset" onClick={resetFilters}>
                  Réinitialiser
                </button>
              )}
              <Button type="submit" size="sm" onClick={() => setFiltersOpen(false)}>
                Voir les parcours <ArrowRight size={16} aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
