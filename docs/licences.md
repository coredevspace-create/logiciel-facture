# Licences Ardoise : mode d'emploi

## Le principe

| | Sans licence (démo) | Avec licence |
|---|---|---|
| Essayer toutes les fonctions | ✅ | ✅ |
| PDF des devis et factures | ⚠️ Filigrane **« DÉMONSTRATION »** et mention « non valable » | ✅ Propres, avec le logo |
| Facture électronique Factur-X | ❌ | ✅ |
| Badge « Mode démo · Activer » en haut | affiché | masqué |

- Une **clé de licence** est un texte qui commence par `ARD1.`. Elle est **liée au SIREN** du commerçant : elle ne fonctionne pas pour une autre entreprise.
- Les clés sont **signées** avec une clé privée qui reste chiffrée dans le navigateur des administrateurs. Sans cette clé privée, personne ne peut fabriquer de licence.
- Pas de serveur, pas de compte client, pas d'abonnement : la licence fonctionne sur le site comme dans le fichier `Ardoise.html` installé chez le client.

## Première installation (une seule fois, par Louis)

1. Ouvre **`https://ton-site/admin.html`**. Cette page n'est liée nulle part et n'est pas indexée par Google.
2. Bloc **① Première installation** : choisis ton identifiant et un **mot de passe d'au moins 12 caractères** (une petite phrase, c'est l'idéal).
3. Clique sur **Créer la clé et mon compte**.
4. Un encadré orange affiche la **clé publique** (`{"kty":"EC",…}`). Copie-la et **envoie-la à Claude** : il l'ajoute dans `js/licence-config.js` et régénère `dist/Ardoise.html`. Cette clé est publique : elle peut circuler sans risque.
5. Une fois le site mis à jour, l'encadré devient vert : « Votre clé de signature est bien installée ».

> ⚠️ **Le mot de passe n'est pas récupérable.** Si tu l'oublies et que personne d'autre n'a de compte, il faudra créer une nouvelle clé. Les licences déjà vendues continueront de fonctionner, à condition de garder l'ancienne clé publique dans `js/licence-config.js`.

## Donner l'accès à ton associé

1. Dans l'espace admin : **Donner l'accès à un associé** → choisis un **mot de passe de transfert** → **Créer le fichier administrateur**.
2. Envoie-lui le fichier `.json` (e-mail, clé USB…) et donne-lui le mot de passe de transfert **de vive voix ou par SMS**, jamais dans le même message.
3. Il ouvre `https://ton-site/admin.html` → **② Rejoindre en tant qu'associé** → fichier + mot de passe de transfert → il choisit **son propre identifiant et son propre mot de passe**.

Vous avez ensuite chacun votre compte, et vous créez des licences reconnues par le même logiciel. Si vous utilisez le même ordinateur, l'écran de connexion permet aussi d'ajouter le compte de l'associé.

## Après une vente

1. **admin.html** → **Créer une licence** : nom du commerce, **SIRET** du client, e-mail, offre, note (par exemple « payé par chèque »).
2. **Générer la clé de licence**, puis :
   - **Préparer l'e-mail au client** : un message tout prêt s'ouvre dans ta messagerie, avec la clé et les instructions ;
   - ou **Copier la clé** pour la coller toi-même chez le client pendant l'installation.
3. Chez le client : Ardoise → **Mon entreprise** → vérifier le **SIRET** → carte **Licence** → coller la clé → **Activer la licence**.

Le client peut ensuite utiliser Ardoise :
- **en ligne**, sur `https://ton-site/app.html`, avec la sauvegarde Google Drive automatique ;
- ou **installé sur son ordinateur** avec le fichier `Ardoise.html`, qui fonctionne sans Internet.

La licence fait partie de ses données : elle est incluse dans ses sauvegardes et revient quand il les restaure sur un autre ordinateur.

## Suivi des licences

- La liste **Licences délivrées** est enregistrée dans le navigateur de chaque admin. Pour la partager :
  - l'un clique sur **Exporter pour mon associé** et envoie le fichier ;
  - l'autre clique sur **Importer la liste de mon associé**. Les doublons sont ignorés.
- **Exporter (Excel / CSV)** donne un tableau pour ta comptabilité.

## Questions fréquentes

**Le client change d'ordinateur ?** Il restaure sa sauvegarde, la licence revient avec. Sinon, recolle-lui sa clé, toujours visible dans ta liste.

**Le client change de SIRET (déménagement) ?** Le SIREN, c'est-à-dire les 9 premiers chiffres, ne change pas : la licence reste valable. S'il crée une nouvelle société (nouveau SIREN), il faut une nouvelle licence.

**Un client partage sa clé ?** Elle ne fonctionne que pour son SIREN : une autre entreprise resterait en mode démo.

**Peut-on contourner la protection ?** Un informaticien chevronné pourrait modifier le code du logiciel. Pour des commerçants, la protection est largement suffisante. Une protection impossible à contourner demanderait un serveur avec des comptes clients, donc des coûts d'hébergement.
