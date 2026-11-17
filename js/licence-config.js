/*
 * Clés PUBLIQUES qui vérifient les licences Ardoise.
 *
 * Une clé publique permet seulement de VÉRIFIER une licence, pas d'en fabriquer :
 * elle peut être publiée sans risque. La clé privée correspondante reste chiffrée
 * dans le navigateur des administrateurs (page admin.html).
 *
 * Ne jamais retirer une clé de cette liste : les licences déjà vendues avec elle
 * cesseraient de fonctionner. Voir docs/licences.md.
 */
window.ARDOISE_LICENCE = {
  publicKeys: [
    // Clé de Louis — installée le 17/11/2026 — empreinte 51:D1:A1:64:F0:8C
    { kty: 'EC', crv: 'P-256', x: 'KMlYeFuU8XNMTPnhNekxz0kXql9B9D9IwnIfWiZckQE', y: 'WkeX-frLNL7rvmuw2FX3NUbQO46L2ZOBSuwo9vj9rNE' },
  ],
};
