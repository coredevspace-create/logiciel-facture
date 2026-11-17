# Sécurité d'Ardoise

## Pourquoi l'architecture est déjà très protectrice

**Il n'existe aucun serveur Ardoise qui stocke les données des clients.**
- Les factures, clients et paiements restent **dans le navigateur du commerçant**.
- Les sauvegardes vont **directement dans son propre Google Drive**, sans passer par vous.
- Il n'y a donc **pas de base de données centrale à pirater**. C'est la cause de la plupart des fuites massives (mots de passe, fichiers clients), et elle n'existe pas ici.

## Protections en place dans le logiciel

| Risque | Protection | Vérifié par test |
|---|---|---|
| Code malveillant caché dans un nom de client, une note… (XSS) | Tout texte est « échappé » avant affichage | ✔ |
| Fichier de sauvegarde piégé (restauration fichier ou Drive) | Toutes les données sont nettoyées et validées au chargement : identifiants, dates, nombres, logo, listes de valeurs | ✔ aucune exécution, même sans les protections suivantes |
| Script injecté ou ajouté au site | Politique de sécurité **CSP stricte** : seuls les scripts du site et de Google (connexion Drive) peuvent s'exécuter, aucun script intégré dans les pages | ✔ 0 violation |
| Fichier `Ardoise.html` d'un client modifié à son insu | CSP avec empreintes SHA-256 : un script modifié est refusé par le navigateur | ✔ |
| Formule piégée dans un export Excel (« =HYPERLINK… ») | Les cellules commençant par `=`, `+`, `-` ou `@` sont neutralisées | ✔ |
| Site affiché dans un cadre piégé (clickjacking) | `frame-ancestors 'none'` et `X-Frame-Options: DENY` | — |
| Connexion non chiffrée | HTTPS forcé (HSTS) | — |
| Accès au Google Drive du client | Autorisation `drive.file` : Ardoise ne voit **que ses propres fichiers**, jamais le reste du Drive. Jeton gardé en mémoire uniquement, expire en environ 1 h | ✔ |
| Fausses licences | Signature ECDSA P-256. La clé privée est chiffrée (AES-256-GCM, mot de passe dérivé par PBKDF2 avec 600 000 itérations) et ne quitte jamais le navigateur des admins | ✔ clé modifiée refusée |
| Espace admin attaqué en ligne | La clé de signature **n'est pas sur le site** : seulement dans le navigateur de chaque admin. Sans leur ordinateur et leur mot de passe, la page ne sert à rien | ✔ |
| Pistage des visiteurs | Aucun cookie, aucune statistique, aucun traceur | — |

## ⚠️ Le vrai point faible : vos comptes

La version en ligne est livrée par **GitHub → Vercel**. Quelqu'un qui prendrait le contrôle de votre GitHub ou de votre Vercel pourrait modifier le logiciel en ligne pour tous les clients. **C'est le risque n° 1 à verrouiller**, pour toi comme pour ton associé.

À faire **dès maintenant** :

- [ ] **GitHub** : activer la double authentification. *Settings → Password and authentication → Two-factor authentication*. Une application d'authentification ou une clé de sécurité vaut mieux qu'un SMS.
- [ ] **Vercel** : activer la double authentification (*Account Settings → Authentication*), ou se connecter via GitHub.
- [ ] **Google** (compte de Google Cloud et de la boîte mail) : activer la validation en deux étapes.
- [ ] **Boîte mail** (`louis.lanquet@gmail.com`) : double authentification. C'est elle qui permet de réinitialiser tous les autres comptes.
- [ ] **Accès au dépôt** : seules les personnes de confiance (toi et ton associé). GitHub → *Settings → Collaborators*.
- [ ] **Protection de la branche de production** : GitHub → *Settings → Branches → Add rule* → cocher « Require a pull request before merging ». Personne ne peut alors pousser du code en production sans relecture.
- [ ] **Mots de passe admin d'Ardoise** : une phrase longue, propre à Ardoise, jamais réutilisée ailleurs. Un gestionnaire de mots de passe (Bitwarden gratuit, 1Password…) est l'idéal.
- [ ] **Le fichier administrateur** (pour l'associé) : à envoyer séparément du mot de passe de transfert, puis à supprimer des e-mails une fois importé.

## Conseils à donner aux commerçants

Ardoise ne peut pas protéger un ordinateur déjà infecté ou laissé ouvert. À l'installation, rappelle-leur :

1. **Verrouiller la session** de l'ordinateur avec un mot de passe, surtout si d'autres personnes y ont accès (comptoir, employés).
2. **Activer la double authentification sur leur compte Google**, puisque leurs sauvegardes y sont.
3. **Mettre à jour** Windows ou macOS et le navigateur (Chrome ou Edge), et **ne pas installer d'extensions douteuses** : une extension malveillante peut lire tout ce qui s'affiche dans le navigateur.
4. **Activer la sauvegarde Google Drive**, ou faire une sauvegarde par semaine.

## Ce qu'on peut dire honnêtement aux clients

> « Vos données restent chez vous : sur votre ordinateur et dans votre propre Google Drive. Nous n'avons aucune copie de vos factures ni de vos clients, et nous ne pouvons pas y accéder. Il n'existe pas de base de données Ardoise qui pourrait être piratée. Le logiciel est protégé contre les injections de code et les fichiers piégés. »

Évite de dire « inviolable » ou « 100 % sécurisé » : aucun logiciel ne l'est. Ce discours exact et vérifiable inspire davantage confiance.

## Amélioration possible

- **Verrouillage par code d'accès** : les données enregistrées dans le navigateur seraient chiffrées et protégées par un code ou un mot de passe demandé à l'ouverture. Utile si plusieurs personnes utilisent l'ordinateur du commerce.
