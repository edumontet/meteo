# Météo

Web app météo pour iPhone, en français, sans installation ni compte : une page web qu'on ajoute à l'écran d'accueil.

## Les onglets

- **Météo** : hier, aujourd'hui et demain (min/max, pluie, risque de neige), pluie dans l'heure par quart d'heure, radar animé et cartes de prévision (pluie, nuages), Lune (phase, croissante/décroissante, compte à rebours), saint du jour, marées de Saint-Malo (horaires, courbe, coefficients, prochaines grandes marées).
- **Modèles** : comparaison AROME, ARPEGE, ECMWF et GFS (température sur 48 h, pluie), avec un indice de confiance.
- **Orages** : carte des impacts de foudre en direct (Blitzortung) et risque d'orage sur 24 h.
- **Soleil** : images du Soleil en direct (NASA SDO), éruptions, indice Kp, chances d'aurores en Bretagne, vent solaire.
- **Champis** : indice champignons calculé pour ta position (pluie des 15 derniers jours, température et humidité du sol, gel, vent) sur 15 jours, avec la Lune à titre indicatif.

## Mettre en ligne

1. Dans le dépôt GitHub : **Settings › Pages**.
2. Source : **Deploy from a branch**, branche **main**, dossier **/ (root)**, puis **Save**.
3. L'appli est en ligne au bout d'une minute à l'adresse `https://edumontet.github.io/meteo/`.
4. Sur l'iPhone, ouvre l'adresse, touche **Partager** puis **Sur l'écran d'accueil**.

Le lieu suit ta position GPS (Rennes par défaut). Touche le nom du lieu en haut pour en choisir un autre. Tire la page vers le bas (ou touche l'heure en haut à droite) pour actualiser.

## Sources de données

Toutes gratuites et sans clé :

- [Open-Meteo](https://open-meteo.com) : prévisions (Météo-France AROME/ARPEGE, ECMWF, NOAA GFS), sol, géocodage.
- [RainViewer](https://www.rainviewer.com) : radar de la dernière heure. [EUMETSAT](https://view.eumetsat.int) : images satellite Meteosat (nuages). [Windy](https://www.windy.com) : carte de pluie prévue.
- [Blitzortung.org](https://www.blitzortung.org) : foudre en temps réel (réseau participatif, usage personnel).
- [NASA SDO](https://sdo.gsfc.nasa.gov) et [NOAA SWPC](https://www.swpc.noaa.gov) : Soleil et météo de l'espace.
- Marées : constantes harmoniques [TICON-4](https://www.seanoe.org/data/00980/109129/) (CC BY 4.0) via [@neaps/tide-database](https://github.com/openwatersio/tide-database), calcul avec [@neaps/tide-predictor](https://github.com/openwatersio/neaps) (MIT). Coefficients calculés à Brest selon la méthode du SHOM (à 2 ou 3 points près). **Ne pas utiliser pour la navigation.**
- Lune : calcul local (algorithme de Jean Meeus). Saints : calendrier français usuel.

## Technique

HTML, CSS et JavaScript sans étape de build. Le fichier `js/tides-engine.js` est le prédicteur de marées Neaps empaqueté avec les données de Saint-Malo et Brest (`tools/build-tides.sh` pour le régénérer).
