# Activer la sauvegarde Google Drive

Ce guide explique comment créer l'**identifiant Google** dont Ardoise a besoin pour proposer « Se connecter à Google Drive ».
Cela prend environ **15 minutes**, c'est **gratuit**, et ça ne se fait **qu'une seule fois** pour tous tes clients.

> **Pourquoi c'est toi qui dois le faire ?** Google exige que l'application soit déclarée par son éditeur, avec un compte Google qui lui appartient. Je ne peux pas le faire à ta place.

## Avant de commencer

- Un **compte Google** (idéalement une adresse dédiée à ton activité, par exemple `contact.ardoise@gmail.com`).
- L'adresse de ton site Vercel, par exemple `https://ardoise.vercel.app`. Elle est visible dans Vercel, onglet *Domains*.
- Le site doit déjà être en ligne avec ces deux pages :
  - la page d'accueil : `https://ton-site/` ;
  - la politique de confidentialité : `https://ton-site/confidentialite.html`. Pense à y mettre ton nom et ton e-mail, dans le bloc `CONTACT` en bas du fichier.

Dans la suite, remplace `https://ton-site` par ta vraie adresse.

## Étape 1 — Créer le projet

1. Va sur **https://console.cloud.google.com** et connecte-toi.
2. En haut, clique sur le sélecteur de projet puis sur **Nouveau projet**.
3. Nom : `Ardoise`, puis **Créer**. Vérifie que le projet `Ardoise` est bien sélectionné en haut de la page.

## Étape 2 — Activer l'API Google Drive

1. Menu ☰ → **API et services** → **Bibliothèque**.
2. Cherche **Google Drive API**, ouvre-la et clique sur **Activer**.

## Étape 3 — Écran de consentement (ce que verra le commerçant)

1. Menu ☰ → **Google Auth Platform**, ou **API et services → Écran de consentement OAuth**, puis **Commencer**.
2. **Informations sur l'application** : nom `Ardoise`, adresse e-mail d'assistance = ton adresse.
3. **Audience** : choisis **Externe**.
4. **Coordonnées** : ton adresse e-mail. Accepte les conditions, puis **Créer**.
5. Dans **Branding** (Image de marque), complète :
   - **Logo** : le fichier `images/logo-512.png` du projet ;
   - **Page d'accueil** : `https://ton-site/` ;
   - **Règles de confidentialité** : `https://ton-site/confidentialite.html` ;
   - **Domaines autorisés** : le domaine de ton site (par exemple `ardoise.vercel.app`, ou ton propre nom de domaine).
6. Dans **Accès aux données** (Data access) → **Ajouter ou supprimer des champs d'application** → coche `.../auth/drive.file`, décrit comme « Afficher, créer et supprimer ses propres données de configuration dans Google Drive » ou « fichiers utilisés avec cette application ». Puis **Mettre à jour** et **Enregistrer**.

> `drive.file` est une autorisation **non sensible** : Ardoise ne voit que les fichiers qu'il a créés. C'est ce qui évite l'audit de sécurité payant exigé pour les accès complets à Drive.

## Étape 4 — Créer l'identifiant

1. **Clients** (ou **API et services → Identifiants**) → **Créer un client**, ou **Créer des identifiants → ID client OAuth**.
2. Type d'application : **Application Web**.
3. Nom : `Ardoise - site`.
4. **Origines JavaScript autorisées** → **Ajouter un URI** :
   - `https://ton-site` (sans `/` à la fin) ;
   - si tu as ton propre nom de domaine, ajoute-le aussi : `https://www.ton-domaine.fr` ;
   - pour tester sur ton ordinateur (facultatif) : `http://localhost:8000`.
5. **URI de redirection autorisés** : laisse vide, ce n'est pas utile pour Ardoise.
6. **Créer**. Copie l'**ID client**, qui ressemble à `123456789-abc...apps.googleusercontent.com`.

## Étape 5 — Mettre l'identifiant dans Ardoise

1. Dans le dépôt GitHub, ouvre le fichier **`js/config.js`**.
2. Colle l'identifiant entre les apostrophes :
   ```js
   window.ARDOISE_CONFIG = {
     googleClientId: '123456789-abc...apps.googleusercontent.com',
   };
   ```
3. Enregistre (*Commit changes*). Vercel remet le site à jour automatiquement en une minute.

> L'ID client **n'est pas un secret** : il peut être publié dans le code. Il ne fonctionne que depuis les adresses déclarées à l'étape 4.

## Étape 6 — Tester

1. Va dans Google Cloud → **Audience** → **Utilisateurs test** → ajoute ton adresse Gmail.
2. Ouvre `https://ton-site/app.html` → menu **Sauvegarde** → **Se connecter à Google Drive**.
3. Google affiche sa fenêtre de connexion. Accepte l'accès : un dossier **« Ardoise - Sauvegardes »** apparaît dans ton Drive, avec la sauvegarde du jour.

Tant que l'application est en mode **Test**, seuls les utilisateurs test (100 au maximum) peuvent se connecter. Pratique pour tes premiers clients : ajoute leur adresse Gmail.

## Étape 7 — Ouvrir à tous les clients

1. **Audience** → **Publier l'application** → l'état passe à **En production**.
2. Avec uniquement l'autorisation non sensible `drive.file`, il n'y a **pas d'audit de sécurité**. Pour que le nom et le logo d'Ardoise s'affichent dans la fenêtre Google, Google demande une **validation de la marque**, généralement en quelques jours. Elle demande en général :
   - de prouver que le domaine t'appartient, via la Google Search Console (une balise à ajouter au site, je peux le faire) ;
   - que la page d'accueil et la page de confidentialité soient en ligne et cohérentes.

> Conseil : pour la validation et pour l'image de marque, un **nom de domaine à toi** (environ 10 €/an, par exemple `ardoise-facture.fr`) est plus simple et plus pro qu'une adresse `vercel.app`.

## Ce que voit le commerçant

- Menu **Sauvegarde** → carte **« Sauvegarde Google Drive »** → **Se connecter à Google Drive**.
- Ensuite, **chaque modification est sauvegardée automatiquement** dans son Drive, 15 secondes après la dernière saisie, dans un fichier par jour.
- Pour des raisons de sécurité, Google fait expirer la connexion au bout d'environ une heure. Si un jour la sauvegarde n'a pas pu partir, un bandeau propose **« Reconnecter Google Drive »** : un clic suffit.
- **Restaurer depuis Drive** permet de récupérer ses données sur un autre ordinateur ou après une panne.

## En cas de problème

| Message | Solution |
|---|---|
| « Service non activé » | L'ID client n'est pas dans `js/config.js`, ou le site n'a pas encore été remis à jour. |
| Erreur Google `origin_mismatch` | L'adresse du site n'est pas dans les **Origines JavaScript autorisées** (étape 4). Vérifie le `https://` et l'absence de `/` final. |
| Erreur `access_denied` ou « application non validée » | L'application est en mode Test et l'adresse n'est pas dans les **utilisateurs test**, ou la publication est en attente. |
| « La fenêtre Google a été bloquée » | Autorise les fenêtres pop-up pour le site dans le navigateur. |
| « Disponible dans la version en ligne » | Le commerçant utilise `Ardoise.html` ouvert depuis son ordinateur. Google refuse ce cas : il faut utiliser l'adresse du site. |
