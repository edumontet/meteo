// Calendrier des fêtes à souhaiter (calendrier français usuel).
// Un nom précédé de « = » est une fête religieuse ou civile, affichée telle quelle.
const S = [
  // Janvier
  ["=Jour de l'An", "Basile", "Geneviève", "Odilon", "Édouard", "Mélaine", "Raymond", "Lucien", "Alix", "Guillaume", "Paulin", "Tatiana", "Yvette", "Nina", "Rémi", "Marcel", "Roseline", "Prisca", "Marius", "Sébastien", "Agnès", "Vincent", "Barnard", "François de Sales", "=Conversion de saint Paul", "Paule", "Angèle", "Thomas d'Aquin", "Gildas", "Martine", "Marcelle"],
  // Février
  ["Ella", "=Chandeleur", "Blaise", "Véronique", "Agathe", "Gaston", "Eugénie", "Jacqueline", "Apolline", "Arnaud", "=Notre-Dame de Lourdes", "Félix", "Béatrice", "Valentin", "Claude", "Julienne", "Alexis", "Bernadette", "Gabin", "Aimée", "Damien", "Isabelle", "Lazare", "Modeste", "Roméo", "Nestor", "Honorine", "Romain", "Auguste"],
  // Mars
  ["Aubin", "Charles le Bon", "Guénolé", "Casimir", "Olive", "Colette", "Félicité", "Jean de Dieu", "Françoise", "Vivien", "Rosine", "Justine", "Rodrigue", "Mathilde", "Louise", "Bénédicte", "Patrice", "Cyrille", "Joseph", "Herbert", "Clémence", "Léa", "Victorien", "Catherine de Suède", "=Annonciation", "Larissa", "Habib", "Gontran", "Gwladys", "Amédée", "Benjamin"],
  // Avril
  ["Hugues", "Sandrine", "Richard", "Isidore", "Irène", "Marcellin", "Jean-Baptiste de la Salle", "Julie", "Gautier", "Fulbert", "Stanislas", "Jules", "Ida", "Maxime", "Paterne", "Benoît-Joseph", "Anicet", "Parfait", "Emma", "Odette", "Anselme", "Alexandre", "Georges", "Fidèle", "Marc", "Alida", "Zita", "Valérie", "Catherine de Sienne", "Robert"],
  // Mai
  ["=Fête du Travail", "Boris", "Philippe et Jacques", "Sylvain", "Judith", "Prudence", "Gisèle", "=Victoire 1945", "Pacôme", "Solange", "Estelle", "Achille", "Rolande", "Matthias", "Denise", "Honoré", "Pascal", "Éric", "Yves", "Bernardin", "Constantin", "Émile", "Didier", "Donatien", "Sophie", "Bérenger", "Augustin de Cantorbéry", "Germain", "Aymar", "Ferdinand", "=Visitation de la Vierge"],
  // Juin
  ["Justin", "Blandine", "Kévin", "Clotilde", "Igor", "Norbert", "Gilbert", "Médard", "Diane", "Landry", "Barnabé", "Guy", "Antoine de Padoue", "Élisée", "Germaine", "Jean-François Régis", "Hervé", "Léonce", "Romuald", "Silvère", "Rodolphe", "Alban", "Audrey", "Jean-Baptiste", "Prosper", "Anthelme", "Fernand", "Irénée", "Pierre et Paul", "Martial"],
  // Juillet
  ["Thierry", "Martinien", "Thomas", "Florent", "Antoine-Marie", "Mariette", "Raoul", "Thibault", "Amandine", "Ulrich", "Benoît", "Olivier", "Henri et Joël", "=Fête nationale", "Donald", "=Notre-Dame du Mont-Carmel", "Charlotte", "Frédéric", "Arsène", "Marina", "Victor", "Marie-Madeleine", "Brigitte", "Christine", "Jacques", "Anne et Joachim", "Nathalie", "Samson", "Marthe", "Juliette", "Ignace de Loyola"],
  // Août
  ["Alphonse", "Julien Eymard", "Lydie", "Jean-Marie Vianney", "Abel", "=Transfiguration", "Gaétan", "Dominique", "Amour", "Laurent", "Claire", "Clarisse", "Hippolyte", "Evrard", "=Assomption", "Armel", "Hyacinthe", "Hélène", "Jean Eudes", "Bernard", "Christophe", "Fabrice", "Rose de Lima", "Barthélemy", "Louis", "Natacha", "Monique", "Augustin", "Sabine", "Fiacre", "Aristide"],
  // Septembre
  ["Gilles", "Ingrid", "Grégoire", "Rosalie", "Raïssa", "Bertrand", "Reine", "Adrien", "Alain", "Inès", "Adelphe", "Apollinaire", "Aimé", "=Croix Glorieuse", "Roland", "Édith", "Renaud", "Nadège", "Émilie", "Davy", "Matthieu", "Maurice", "Constant", "Thècle", "Hermann", "Côme et Damien", "Vincent de Paul", "Venceslas", "Michel, Gabriel et Raphaël", "Jérôme"],
  // Octobre
  ["Thérèse de l'Enfant-Jésus", "Léger", "Gérard", "François d'Assise", "Fleur", "Bruno", "Serge", "Pélagie", "Denis", "Ghislain", "Firmin", "Wilfried", "Géraud", "Juste", "Thérèse d'Avila", "Edwige", "Baudouin", "Luc", "René", "Adeline", "Céline", "Élodie", "Jean de Capistran", "Florentin", "Crépin", "Dimitri", "Émeline", "Simon et Jude", "Narcisse", "Bienvenue", "Quentin"],
  // Novembre
  ["=Toussaint", "=Commémoration des défunts", "Hubert", "Charles", "Sylvie", "Bertille", "Carine", "Geoffroy", "Théodore", "Léon", "Martin", "Christian", "Brice", "Sidoine", "Albert", "Marguerite", "Élisabeth", "Aude", "Tanguy", "Edmond", "=Présentation de Marie", "Cécile", "Clément", "Flora", "Catherine", "Delphine", "Séverin", "Jacques de la Marche", "Saturnin", "André"],
  // Décembre
  ["Florence", "Viviane", "François-Xavier", "Barbara", "Gérald", "Nicolas", "Ambroise", "=Immaculée Conception", "Pierre Fourier", "Romaric", "Daniel", "Jeanne-Françoise de Chantal", "Lucie", "Odile", "Ninon", "Alice", "Gaël", "Gatien", "Urbain", "Théophile", "Pierre Canisius", "Françoise-Xavière", "Armand", "Adèle", "=Noël", "Étienne", "Jean", "=Saints Innocents", "David", "Roger", "Sylvestre"]
];

export function saintDuJour(date) {
  const name = S[date.getMonth()][date.getDate() - 1] || "";
  if (name.startsWith("=")) return name.slice(1);
  return "Bonne fête aux " + name;
}
