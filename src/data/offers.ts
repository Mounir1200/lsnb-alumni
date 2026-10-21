import type { MemberSummary } from "../lib/memberSummary";
import { todayIsoDate, type Offer } from "../lib/offerData";
import { getAlumniProfile } from "./alumni";

const DAY_IN_MS = 86_400_000;

// Relative dates keep the demonstration open whatever the current day.
function daysFromToday(days: number) {
  return todayIsoDate(new Date(Date.now() + days * DAY_IN_MS));
}

function demoAuthor(profileId: string): MemberSummary | null {
  const profile = getAlumniProfile(profileId);
  if (!profile) return null;
  return {
    id: profile.id, firstName: profile.firstName, lastName: profile.lastName, memberRole: "alumni",
    graduationYear: profile.graduationYear, specialty: profile.currentRole, offersMentoring: profile.offersMentoring,
    initials: profile.initials, avatarTone: profile.avatarTone, photoUrl: profile.photoUrl,
  };
}

function demoOffer(offer: Omit<Offer, "author" | "isDemo" | "createdAt"> & { publishedDaysAgo: number }): Offer {
  const { publishedDaysAgo, ...content } = offer;
  return {
    ...content,
    createdAt: new Date(Date.now() - publishedDaysAgo * DAY_IN_MS).toISOString(),
    author: demoAuthor(offer.authorId),
    isDemo: true,
  };
}

// Fictional offers used only to demonstrate the interface before Supabase is connected.
export const demoOffers: Offer[] = [
  demoOffer({
    id: "stage-donnees-sante",
    authorId: "aicha-ouedraogo",
    kind: "internship",
    title: "Stage en analyse de données de santé",
    organization: "Centre de recherche biomédicale",
    location: "Dakar, Sénégal",
    description:
      "Six mois au sein d’une équipe qui analyse des données épidémiologiques.\n\nProfil recherché : étudiant·e en mathématiques appliquées ou en informatique, à l’aise avec Python ou R. Le stage est indemnisé ; le logement reste à la charge du stagiaire.",
    deadline: daysFromToday(24),
    publishedDaysAgo: 2,
  }),
  demoOffer({
    id: "bourse-master-energie",
    authorId: "karim-sanou",
    kind: "scholarship",
    title: "Bourse de master en énergies renouvelables",
    organization: "Fondation pour la transition énergétique",
    location: "Maroc",
    description:
      "La bourse couvre les frais de scolarité et une allocation mensuelle pendant les deux années du master.\n\nIl faut une licence en physique, électrotechnique ou génie énergétique. Je peux relire les lettres de motivation des élèves du LSNB avant l’envoi.",
    deadline: daysFromToday(45),
    publishedDaysAgo: 6,
  }),
  demoOffer({
    id: "admission-classes-preparatoires",
    authorId: "moussa-traore",
    kind: "admission",
    title: "Inscriptions en classes préparatoires scientifiques",
    organization: "Lycée public à classes préparatoires",
    location: "Grenoble, France",
    description:
      "La procédure d’admission pour les bacheliers étrangers ouvre bientôt. Je partage le calendrier, les pièces demandées et les erreurs fréquentes dans les dossiers.",
    deadline: daysFromToday(5),
    publishedDaysAgo: 9,
  }),
  demoOffer({
    id: "stage-developpement-mobile",
    authorId: "fanta-coulibaly",
    kind: "internship",
    title: "Stage en développement web et mobile",
    organization: "Équipe produit numérique",
    location: "Kigali, Rwanda · télétravail possible",
    description:
      "Trois mois pour contribuer à une application mobile utilisée par des coopératives agricoles. Des bases en JavaScript sont appréciées ; la curiosité compte davantage que l’expérience.",
    deadline: null,
    publishedDaysAgo: 14,
  }),
  demoOffer({
    id: "admission-ecole-ingenieurs",
    authorId: "adama-kone",
    kind: "admission",
    title: "Admission parallèle en école d’ingénieurs",
    organization: "École d’ingénieurs",
    location: "Tunis, Tunisie",
    description:
      "Les admissions sur titre en première année du cycle ingénieur sont ouvertes aux titulaires d’un bac+2 scientifique. J’explique volontiers les épreuves et le coût de la vie sur place.",
    deadline: daysFromToday(60),
    publishedDaysAgo: 20,
  }),
];

export function getDemoOffer(id: string) {
  return demoOffers.find((offer) => offer.id === id);
}
