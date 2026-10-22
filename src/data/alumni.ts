import type { CareerStep } from "../lib/careerSteps";

export type AlumniProfile = {
  id: string;
  firstName: string;
  lastName: string;
  graduationYear: number;
  currentRole: string;
  organization: string;
  city: string;
  country: string;
  domain: string;
  specialties: string[];
  careerSteps: CareerStep[];
  experience: string;
  offersMentoring: boolean;
  mentoringTopics: string[];
  availability?: string;
  initials: string;
  avatarTone: "ochre" | "green" | "blue" | "sand";
  photoUrl?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  isDemo?: boolean;
};

// Fictional profiles used only to demonstrate the interface before Supabase is connected.
export const alumniProfiles: AlumniProfile[] = [
  {
    id: "aicha-ouedraogo",
    firstName: "Aïcha",
    lastName: "Ouédraogo",
    graduationYear: 2019,
    currentRole: "Data scientist en santé",
    organization: "Centre de recherche biomédicale",
    city: "Dakar",
    country: "Sénégal",
    domain: "Données & IA",
    specialties: ["Biostatistiques", "Machine learning", "Santé publique"],
    careerSteps: [
      { kind: "education", title: "Licence de mathématiques appliquées", organization: "Université", location: "Dakar, Sénégal", startYear: 2019, endYear: 2022 },
      { kind: "education", title: "Master en science des données", organization: "Université", location: "Dakar, Sénégal", startYear: 2022, endYear: 2024 },
      { kind: "work", title: "Data scientist en santé", organization: "Centre de recherche biomédicale", location: "Dakar, Sénégal", startYear: 2024, endYear: null },
    ],
    experience:
      "Je travaille à l'intersection des données et de la santé. Mon parcours m'a appris à chercher les bonnes questions avant les bons modèles.",
    offersMentoring: true,
    mentoringTopics: ["Choix d'études", "Data science", "Bourses"],
    availability: "1 échange par mois",
    initials: "AO",
    avatarTone: "ochre",
    photoUrl: "/images/alumni/aicha-ouedraogo.jpg",
  },
  {
    id: "karim-sanou",
    firstName: "Karim",
    lastName: "Sanou",
    graduationYear: 2018,
    currentRole: "Ingénieur en systèmes énergétiques",
    organization: "Bureau d'études énergie",
    city: "Casablanca",
    country: "Maroc",
    domain: "Énergie & Industrie",
    specialties: ["Énergies renouvelables", "Électrotechnique", "Modélisation"],
    careerSteps: [
      { kind: "education", title: "Classes préparatoires scientifiques", organization: "Lycée à classes préparatoires", location: "Casablanca, Maroc", startYear: 2018, endYear: 2020 },
      { kind: "education", title: "Diplôme d’ingénieur", organization: "École d’ingénieurs", location: "Casablanca, Maroc", startYear: 2020, endYear: 2023 },
      { kind: "work", title: "Ingénieur en systèmes énergétiques", organization: "Bureau d’études énergie", location: "Casablanca, Maroc", startYear: 2023, endYear: null },
    ],
    experience:
      "Après une prépa exigeante, j'ai choisi l'énergie pour travailler sur des problèmes concrets de résilience et d'accès.",
    offersMentoring: true,
    mentoringTopics: ["Classes préparatoires", "Écoles d'ingénieurs", "Organisation"],
    availability: "2 échanges par trimestre",
    initials: "KS",
    avatarTone: "blue",
    photoUrl: "/images/alumni/karim-sanou.jpg",
  },
  {
    id: "clarisse-kabore",
    firstName: "Clarisse",
    lastName: "Kaboré",
    graduationYear: 2020,
    currentRole: "Interne en médecine",
    organization: "Centre hospitalier universitaire",
    city: "Ouagadougou",
    country: "Burkina Faso",
    domain: "Santé & Médecine",
    specialties: ["Médecine", "Biologie", "Recherche clinique"],
    careerSteps: [
      { kind: "education", title: "Doctorat de médecine", organization: "Faculté de médecine", location: "Ouagadougou, Burkina Faso", startYear: 2020, endYear: null },
    ],
    experience:
      "La médecine m'a donné un terrain où la rigueur scientifique rencontre chaque jour l'écoute et la responsabilité.",
    offersMentoring: false,
    mentoringTopics: [],
    initials: "CK",
    avatarTone: "green",
  },
  {
    id: "moussa-traore",
    firstName: "Moussa",
    lastName: "Traoré",
    graduationYear: 2017,
    currentRole: "Doctorant en physique des matériaux",
    organization: "Laboratoire universitaire",
    city: "Grenoble",
    country: "France",
    domain: "Recherche scientifique",
    specialties: ["Physique", "Matériaux", "Simulation numérique"],
    careerSteps: [
      { kind: "education", title: "Licence de physique", organization: "Université", location: "Grenoble, France", startYear: 2017, endYear: 2020 },
      { kind: "education", title: "Master matériaux avancés", organization: "Université", location: "Grenoble, France", startYear: 2020, endYear: 2022 },
      { kind: "education", title: "Doctorat en physique des matériaux", organization: "Laboratoire universitaire", location: "Grenoble, France", startYear: 2022, endYear: null },
    ],
    experience:
      "Je mène des travaux de simulation et j'aime aider les élèves à comprendre ce que recouvre vraiment une carrière de recherche.",
    offersMentoring: true,
    mentoringTopics: ["Recherche", "Candidatures", "Vie étudiante"],
    availability: "1 échange toutes les 6 semaines",
    initials: "MT",
    avatarTone: "sand",
    photoUrl: "/images/alumni/moussa-traore.jpg",
  },
  {
    id: "fanta-coulibaly",
    firstName: "Fanta",
    lastName: "Coulibaly",
    graduationYear: 2021,
    currentRole: "Développeuse logiciel",
    organization: "Équipe produit numérique",
    city: "Kigali",
    country: "Rwanda",
    domain: "Logiciel & Numérique",
    specialties: ["Développement web", "Cloud", "Accessibilité"],
    careerSteps: [
      { kind: "education", title: "Licence informatique", organization: "Université", location: "Kigali, Rwanda", startYear: 2021, endYear: 2024 },
      { kind: "education", title: "Certification cloud", organization: "Formation en ligne", location: "", startYear: 2024, endYear: 2024 },
      { kind: "work", title: "Développeuse logiciel", organization: "Équipe produit numérique", location: "Kigali, Rwanda", startYear: 2024, endYear: null },
    ],
    experience:
      "J'ai appris le développement en construisant de petits outils utiles, puis en consolidant mes bases d'algorithmique et de produit.",
    offersMentoring: true,
    mentoringTopics: ["Informatique", "Portfolio", "Apprentissage autonome"],
    availability: "1 échange par mois",
    initials: "FC",
    avatarTone: "green",
    photoUrl: "/images/alumni/fanta-coulibaly.jpg",
  },
  {
    id: "idrissa-sawadogo",
    firstName: "Idrissa",
    lastName: "Sawadogo",
    graduationYear: 2019,
    currentRole: "Ingénieur eau et environnement",
    organization: "Programme d'aménagement urbain",
    city: "Bobo-Dioulasso",
    country: "Burkina Faso",
    domain: "Environnement",
    specialties: ["Hydraulique", "Climat", "Territoires"],
    careerSteps: [
      { kind: "education", title: "Cycle ingénieur en eau et environnement", organization: "École d’ingénieurs", location: "Ouagadougou, Burkina Faso", startYear: 2019, endYear: 2024 },
      { kind: "work", title: "Ingénieur eau et environnement", organization: "Programme d’aménagement urbain", location: "Bobo-Dioulasso, Burkina Faso", startYear: 2024, endYear: null },
    ],
    experience:
      "Je travaille sur des projets où la science doit rester lisible pour les habitants et directement utile aux territoires.",
    offersMentoring: false,
    mentoringTopics: [],
    initials: "IS",
    avatarTone: "ochre",
  },
  {
    id: "awa-bamba",
    firstName: "Awa",
    lastName: "Bamba",
    graduationYear: 2018,
    currentRole: "Actuaire",
    organization: "Cabinet de conseil en risques",
    city: "Abidjan",
    country: "Côte d’Ivoire",
    domain: "Finance & Mathématiques",
    specialties: ["Probabilités", "Actuariat", "Gestion des risques"],
    careerSteps: [
      { kind: "education", title: "Licence de mathématiques", organization: "Université", location: "Abidjan, Côte d’Ivoire", startYear: 2018, endYear: 2021 },
      { kind: "education", title: "Master actuariat", organization: "Université", location: "Abidjan, Côte d’Ivoire", startYear: 2021, endYear: 2023 },
      { kind: "work", title: "Actuaire", organization: "Cabinet de conseil en risques", location: "Abidjan, Côte d’Ivoire", startYear: 2023, endYear: null },
    ],
    experience:
      "Les mathématiques m'ont menée vers l'actuariat. Je partage volontiers les repères qui m'ont manqué au moment de choisir cette voie.",
    offersMentoring: true,
    mentoringTopics: ["Mathématiques", "Actuariat", "Orientation"],
    availability: "2 échanges par trimestre",
    initials: "AB",
    avatarTone: "blue",
  },
  {
    id: "adama-kone",
    firstName: "Adama",
    lastName: "Koné",
    graduationYear: 2022,
    currentRole: "Étudiant en génie civil",
    organization: "École d'ingénieurs",
    city: "Tunis",
    country: "Tunisie",
    domain: "Bâtiment & Infrastructures",
    specialties: ["Génie civil", "Structures", "Construction durable"],
    careerSteps: [
      { kind: "education", title: "Cycle préparatoire", organization: "École d’ingénieurs", location: "Tunis, Tunisie", startYear: 2022, endYear: 2024 },
      { kind: "education", title: "Cycle ingénieur en génie civil", organization: "École d’ingénieurs", location: "Tunis, Tunisie", startYear: 2024, endYear: null },
    ],
    experience:
      "Encore proche du lycée, je peux surtout partager un retour récent sur les candidatures, l'adaptation et le rythme en cycle préparatoire.",
    offersMentoring: true,
    mentoringTopics: ["Transition post-bac", "Prépa", "Méthodes de travail"],
    availability: "1 échange par mois",
    initials: "AK",
    avatarTone: "sand",
  },
];

export const domains = [...new Set(alumniProfiles.map((profile) => profile.domain))].sort();
export const countries = [...new Set(alumniProfiles.map((profile) => profile.country))].sort();

export function getAlumniProfile(id: string) {
  return alumniProfiles.find((profile) => profile.id === id);
}
