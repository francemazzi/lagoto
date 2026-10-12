# Distribuzione a costo zero

Decisione dell'8 ottobre 2026, da `gestione-firme-digitali-app-open-source.md`: Lagoto non richiede un account Apple Developer a pagamento per essere distribuito.

## Cosa significa per macOS

- La beta si pubblica come **DMG non firmato con Developer ID e non notarizzato** in una GitHub Release (prerelease), con file `.sha256` e note di rilascio che spiegano l'avviso di Gatekeeper.
- L'utente apre l'app con clic destro → Apri, oppure con Impostazioni di Sistema → Privacy e sicurezza → Apri comunque. Nessuna istruzione chiede di disattivare Gatekeeper per l'intero sistema.
- Il pacchetto resta firmato ad hoc (`codesign --sign -`), così bundle e runtime incluso sono sigillati e verificabili con `codesign --verify`.
- Comandi: `LAGOTO_UNSIGNED=1 pnpm build --release && pnpm package`. Il pacchetto non viene mai caricato né taggato dallo script.

## Percorso opzionale con Developer ID

Se esiste già un'iscrizione Apple Developer attiva, `LAGOTO_SIGN_IDENTITY` e `LAGOTO_NOTARY_PROFILE` selezionano firma, notarizzazione e staple, senza costi aggiuntivi. Non si rinnova né si acquista nulla per Lagoto.

## Regole comuni

- Nessuna chiave, certificato o token nel repository o nelle evidenze.
- Checksum SHA-256 e note per ogni rilascio; il file finale non si modifica dopo il checksum.
- L'evidenza di pacchetto registra `distribution` (`unsigned-zero-cost` o `developer-id-notarized`) e non lascia credere che una build non notarizzata lo sia.
- Altri sistemi (Windows, Linux) non sono nel perimetro di Lagoto.
