import type { ReactNode } from "react";
import { BrandMark } from "../ui/BrandMark";
import { RouteStop } from "../visual/RouteStop";
import "./Auth.css";

type AccountPageProps = { stop: string; title: string; intro: ReactNode; children: ReactNode };

/** The sign-in family of pages: a form panel beside the mentoring photo. */
export function AccountPage({ stop, title, intro, children }: AccountPageProps) {
  return (
    <div className="login-page">
      <div className="login-page__panel">
        <BrandMark className="login-page__brand" />
        <div className="login-page__heading">
          <RouteStop>{stop}</RouteStop>
          <h1>{title}</h1>
          <p>{intro}</p>
        </div>
        {children}
      </div>

      <aside className="login-page__visual" aria-hidden="true">
        <img src="/images/mentoring-lab.jpg" alt="" />
        <blockquote>“Une trajectoire devient plus lisible quand quelqu’un accepte d’en partager les détours.”</blockquote>
      </aside>
    </div>
  );
}
