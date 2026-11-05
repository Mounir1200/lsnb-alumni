/** A home page photo with what readers need: a description and where it comes from. */
export type HomePhoto = {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  credit: { label: string; href?: string };
};

/**
 * Each home page slot draws one photo at random from its own pool on every visit.
 * Add the school's photos to the matching pool, with their credit.
 */
export const homePhotos = {
  mentoring: [
    {
      src: "/images/mentoring-lab.jpg",
      alt: "Illustration éditoriale de trois jeunes Burkinabè échangeant dans un laboratoire scolaire",
      credit: { label: "Visuel original généré pour le projet" },
    },
  ],
  school: [
    {
      src: "https://www.lobspaalga.com/wp-content/uploads/2023/07/IMG-20210921-WA0003-840x480-1-780x470.jpg",
      alt: "Entrée du Lycée Scientifique National de Bobo-Dioulasso",
      credit: {
        label: "Photo : L’Obs Paalga",
        href: "https://www.lobspaalga.com/2023/07/02/lycee-scientifique-de-bobo-pas-de-frais-de-scolarite-pour-les-eleves/",
      },
    },
  ],
  city: [
    {
      src: "/images/bobo-grand-mosque.jpg",
      alt: "Grande Mosquée de Bobo-Dioulasso, exemple d’architecture soudano-sahélienne",
      width: 1280,
      height: 960,
      credit: { label: "Photo : Semiliki · CC BY-SA 3.0", href: "https://commons.wikimedia.org/wiki/File:BoboDioulasso-GrandMosqueN.JPG" },
    },
  ],
} satisfies Record<string, HomePhoto[]>;

export type HomePhotoSlot = keyof typeof homePhotos;

export function pickPhoto(pool: HomePhoto[], random: () => number = Math.random): HomePhoto {
  // Math.random() stays below 1, so the index never reaches the pool's length.
  return pool[Math.floor(random() * pool.length)]!;
}

export function pickHomePhotos(random: () => number = Math.random): Record<HomePhotoSlot, HomePhoto> {
  return {
    mentoring: pickPhoto(homePhotos.mentoring, random),
    school: pickPhoto(homePhotos.school, random),
    city: pickPhoto(homePhotos.city, random),
  };
}
