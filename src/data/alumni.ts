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
  education: string[];
  experience: string;
  offersMentoring: boolean;
  mentoringTopics: string[];
  availability?: string;
  initials: string;
  avatarTone: "ochre" | "green" | "blue" | "sand";
  photoUrl?: string;
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
    education: ["Licence de mathématiques appliquées", "Master en science des données"],
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
    education: ["Classes préparatoires scientifiques", "Diplôme d'ingénieur"],
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
    education: ["Doctorat de médecine en cours"],
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
    education: ["Licence de physique", "Master matériaux avancés", "Doctorat en cours"],
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
    education: ["Licence informatique", "Certification cloud"],
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
    education: ["Cycle ingénieur en eau et environnement"],
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
    education: ["Licence de mathématiques", "Master actuariat"],
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
    education: ["Cycle préparatoire", "Cycle ingénieur en cours"],
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
