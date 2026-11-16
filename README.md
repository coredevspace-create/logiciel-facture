# FactuLocal — Devis & factures pour les commerces de proximité

Logiciel de devis et de factures **100 % local** : pas de serveur, pas d'abonnement, pas d'IA, aucun coût de fonctionnement.
Il s'ouvre dans le navigateur (Chrome, Edge, Firefox) et les données restent **sur l'ordinateur du client**.

Pensé pour les petits commerces qui facturent des professionnels ou des particuliers : producteurs de cidre, fleuristes, bouchers, épiceries, traiteurs…

## Fonctionnalités

- **Tableau de bord** : chiffre d'affaires du mois, encaissements, reste à encaisser, retards de paiement, courbe sur 12 mois, meilleurs clients.
- **Devis** : création en quelques clics depuis le catalogue, suivi (envoyé, accepté, refusé, expiré), **transformation en facture en un clic**.
- **Factures** : brouillon modifiable, puis validation avec **numéro définitif, continu et chronologique** (F-2026-0001…). Une facture validée ne peut plus être modifiée.
- **Avoirs** pour corriger ou annuler une facture validée.
- **Paiements** : paiements partiels ou complets, mode de règlement, reste dû calculé automatiquement.
- **Relances** des impayés : 3 modèles de courrier de plus en plus fermes, envoyés via la messagerie du client.
- **Catalogue** d'articles avec prix HT ou TTC et taux de TVA (20 %, 10 %, 5,5 %, 2,1 %, 0 %).
- **Clients** professionnels ou particuliers, avec SIREN et numéro de TVA intracommunautaire.
- **PDF** : bouton « Imprimer / PDF », qui produit une facture A4 propre avec le logo.
- **Mentions légales** ajoutées automatiquement : identité du vendeur, SIRET, TVA, pénalités de retard, indemnité de 40 € (clients professionnels), « TVA non applicable, art. 293 B du CGI » (micro-entreprise), nature de l'opération, SIREN du client, adresse de livraison.
- **Exports pour le comptable** au format CSV, lisibles dans Excel : journal des ventes avec TVA par taux, encaissements, clients.
- **Sauvegarde et restauration** dans un fichier (`.json`), avec un rappel automatique si aucune sauvegarde n'a été faite depuis 7 jours.
- **Exemple de démonstration** (une cidrerie fictive), pour présenter le logiciel à un prospect.

## Installation chez un client

1. Copier le dossier complet (`index.html`, `css/`, `js/`) sur l'ordinateur du client, par exemple dans `Documents/FactuLocal`.
2. Ouvrir `index.html` avec Chrome ou Edge, puis créer un raccourci sur le bureau.
3. Aller dans **Mon entreprise** et remplir le nom, l'adresse, le SIRET, le logo, l'IBAN et le régime de TVA.
4. Saisir les articles du **Catalogue** et les **Clients** habituels.
5. Montrer au client le bouton **Sauvegarde** et lui conseiller de sauvegarder chaque semaine sur une clé USB.

> ⚠️ Toujours ouvrir le logiciel avec **le même navigateur** et **le même fichier** : les données sont liées au navigateur. Pour changer d'ordinateur, il faut faire une sauvegarde puis la restaurer sur le nouveau poste.

## Facturation électronique 2026-2027

- Depuis le **1er septembre 2026**, toutes les entreprises doivent pouvoir **recevoir** des factures électroniques.
- À partir du **1er septembre 2027**, les PME, TPE et micro-entreprises devront **émettre** leurs factures aux professionnels dans un format électronique (Factur-X, UBL ou CII) via une **plateforme agréée**. Elles devront aussi transmettre les données de leurs ventes aux particuliers (e-reporting).

FactuLocal gère déjà les nouvelles mentions obligatoires (SIREN du client, nature de l'opération, adresse de livraison, option TVA sur les débits).
**Prochaine étape prévue** : export au format **Factur-X** (PDF contenant les données XML), à déposer sur la plateforme agréée choisie par le client.

## À savoir

- FactuLocal est un logiciel de **facturation**, pas un **logiciel de caisse**. Les ventes au comptoir aux particuliers doivent continuer à passer par une caisse certifiée (NF525 ou équivalent).
- Les taux de TVA proposés dans l'aide sont indicatifs. Le commerçant doit les faire valider par son comptable.
- Les factures doivent être conservées **10 ans** : d'où l'importance des sauvegardes.

## Technique

- HTML, CSS et JavaScript, sans aucune dépendance ni étape de compilation.
- Données stockées dans le `localStorage` du navigateur (clé `factulocal_v1`).
- Thème sombre inspiré des plateformes de trading. Les documents imprimés restent sur fond blanc.
