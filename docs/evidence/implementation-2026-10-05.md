# Implementazione e prove — 5 ottobre 2026

**Esito: sviluppo parziale, beta non rilasciata. Nessuna fase P00–P12 è chiusa.**

Branch: `codex/lagoto-native-beta`, base `30c5b59af57a3b6fd3462b179d5168f36b71a518`. I probe iniziali sono stati eseguiti con working tree modificato; quelli più recenti riportano anche fingerprint delle sorgenti. I report finali dei gate registrano il commit effettivamente provato. Non interpretare la base Git come se contenesse l’implementazione successiva.

Mac di prova: Mac16,5 / MacBook Pro, Apple Silicon arm64, macOS 26.6.2 (25G83), 64 GB RAM; Xcode 27.0, Swift 6.4, XcodeGen 2.44.1. **macOS 15 non ancora collaudato.** Node 22.23.1 e pnpm 10.33.3; Qwen SDK 0.1.17, better-sqlite3 13.0.3 / SQLite 3.53.4. Git 2.39.1, gh 2.87.3. Nessun account Lagoto.

## Codice presente e limiti

| Area | Implementato | Rimane necessario |
| --- | --- | --- |
| P00 | Discovery, handshake, probe reali, bundle Node/SQLite, firma Developer ID | Controllo Cursor, test nativi e notarizzazione; tutti i casi di autenticazione e isolamento |
| P01 | App SwiftUI, JSON-RPC privato, validazione, SQLite con migrazioni SQL, writer DB unico, journal, fixture Swift/TS, runner | Keychain applicativo, lifecycle completo, renderer e tutti i fault case; CI e fake adapter completo |
| P02 | Sidebar progetti/task, creazione progetto, selezione cartelle, creazione task | Conversazione/composer, onboarding, controlli per modello, Markdown/tabelle, permessi UI, accessibilità e revisione visiva |
| P03 | Persistenza di progetti/repository/task, riconoscimento Git/GitHub, archivio | Clone, cartelle spostate, flusso applicativo “Crea e collega”, retry durevole |
| P04 | Preparazione di tre worktree senza cambiare byte o staging degli originali | Ripresa delle preparazioni parziali, copia selettiva WIP, controllo completo di ownership/modifiche esterne |
| P05 | Adapter, eventi originali redatti, journal, richieste idempotenti, permessi, stop verificato per processi osservati | Steering/coda messaggi, proiezione fedele completa, riconciliazione dopo crash/PID riusati/figli detached, effetti esterni |
| P06 | Adapter Codex/Claude/Qwen SDK e probe reali | Onboarding e profili verificati nella UI; le capability dei profili creati restano vuote e impediscono le run |
| P07 | Blob SHA-256, manifest, esclusioni, export isolato dei file, Context Pack deterministico | Restore Git completo, indice utilizzabile e oggetti; decisioni versionate, crash safety completa e invalidazione delle prove |
| P08 | Non implementato | Macchina a stati dell’handoff, ripresa e cinque passaggi reali |
| P09 | Formule in micro-unità intere, giorni Europe/Rome, mediana, prenotazioni e settlement idempotente | Collegamento alle run/provider e intera matrice BAT, rinnovi, correzioni, deroghe e stop allo zero |
| P10 | ACP, negoziazione, modello esplicito, cancellazione e handler dei permessi | Controllo delle scritture fallito; handoff e figli osservabili non collaudati |
| P11 | Diff Git semplice e primitive di export | Diff completo, verifiche, consegna applicativa, backup/restore e retention |
| P12 | Build Developer ID con runtime/licenze inclusi, script DMG dello spike | Notarizzazione, regressioni, carico, sessioni reali, due OS, icona, install/update e release pubblicata/riscaricata |

Il restore in `runtime/checkpoint.ts` è deliberatamente un export di file con copia dell’indice: restituisce `gitRestored: false`. Non ricostruisce un repository utilizzabile e non soddisfa P07-I01. Le primitive del budget non sono un limite di spesa applicato alle run.

## Test deterministici e nativi

`pnpm test`: **25 test passati**, senza skip. Coprono, in parte, persistenza/foreign key, migrazioni da v1, disco SQLite pieno, writer esclusivo, crash del processo DB, request fingerprint, finalizzazione concorrente, frammentazione UTF-8, redazione, worktree, checkpoint binari/corruzione, budget, confini dei metodi filesystem ACP e semantica del gate. Un figlio sopravvissuto non osservato rimane incerto; un figlio identificato prima dello stop viene terminato e verificato.

`xcodebuild test … -only-testing:LagotoTests`: **3 test passati**, inclusa la fixture `fixtures/protocol-v1.json` usata anche da TypeScript. È una prova dei contratti, non un test del flusso utente.

XCUITest è presente per creazione progetto e riapertura. Gli ultimi tentativi non hanno potuto attivare l’app; il controllo nativo ha confermato che **il Mac era bloccato**. Mancano verifica visiva, tastiera, VoiceOver, streaming e prove nei due temi/risoluzioni. Nessun test nativo obbligatorio è stato marcato passato a partire dai test Swift.

`pnpm gate all`: **exit 1**, come richiesto per copertura incompleta. Typecheck, build nativa, test TypeScript e contratti Swift passano; il runner elenca tutti i requisiti privi di copertura completa. Gli scenari parziali non chiudono Pxx-Inn. I report JSON includono comandi, versioni, macchina, commit/fingerprint, conteggi e limitazioni; nessuno è un’approvazione documentale del rilascio.

## Probe reali dei modelli

Fixture sintetica: tre cartelle `backend`, `frontend`, `desktop`, ciascuna con un marcatore. Il test legge tutte e tre e confronta i byte scritti in `result.txt`; il testo del modello da solo non decide l’esito. Questi probe non aggiornano ancora un contratto condiviso in tre repository con test dei client: quella fixture completa resta da costruire.

| Percorso | Versione / modello provato | Lettura + scrittura | Rifiuto permesso | Cancellazione |
| --- | --- | --- | --- | --- |
| Codex App Server | 0.159.2 / `gpt-6.1-sol` | passed | passed, `item/fileChange/requestApproval` | passed |
| Claude Code ufficiale | 2.1.283 / alias `sonnet` (runtime: `claude-sonnet-5`) | passed | passed, `Write` | passed |
| Qwen SDK → OpenRouter | 0.1.17 / `qwen/qwen3-coder-next` | passed | passed, `write_file` | passed |
| Qwen SDK → OpenRouter | 0.1.17 / `moonshotai/kimi-k2.5` | passed | passed dopo correzione stop e retry | passed |
| Qwen SDK → Ollama | 0.34.4 / `qwen3.5:4b` | passed | passed, `write_file` | passed |
| Cursor ACP | 2026.10.01-e373342 / `composer-2.5[fast=true]`; controlli con `default` | passed | **failed: scrittura fuori scope senza callback** | passed |

Dettagli e hash degli artefatti: [riepilogo sanitizzato](p00-smoke-summary.json). Gli eventi grezzi redatti, relativi solo alla fixture, sono conservati localmente in `build/evidence/`; i nuovi run dei probe conservano anche uno storico senza sovrascrivere le evidenze precedenti.

Cursor è stato aggiornato tramite `cursor-agent update`, dopo aver comunicato l’operazione, dalla versione 2026.01.23-916f423 a 2026.10.01-e373342. La vecchia versione esponeva modelli nel campo ACP `modes`; la nuova distingue Agent/Plan/Ask e modelli. Non confondere le due superfici. Il login è stato completato nel flusso ufficiale, senza estrarre token.

La scrittura fuori scope è stata riprodotta su entrambe le versioni, anche richiedendo `--sandbox enabled`. Non è stata risolta annunciando i metodi filesystem del client, usando una configurazione isolata tramite `CURSOR_CONFIG_DIR` o introducendo deny relativi. Il test controlla il file sintetico sul disco e osserva zero callback di permesso. **L’adapter rimane sperimentale e non può essere abilitato come integrazione conforme.** Il successo dello smoke positivo non compensa questo errore. [ACP ufficiale](https://cursor.com/docs/cli/acp), [configurazione CLI](https://cursor.com/docs/cli/reference/configuration), [filesystem ACP](https://agentclientprotocol.com/protocol/v1/file-system), consultati il 5 ottobre 2026.

Qwen e Kimi sono stati provati tramite OpenRouter su autorizzazione esplicita dell’utente, usando una credenziale di test conservata nel Keychain, mai nel repository. La console Qwen aperta aveva un login Google ma nessuna API key. Non è stato verificato l’accesso diretto a QwenCloud o Moonshot. Nessun acquisto o cambio di fatturazione implicito.

Il modello locale `qwen3:8b` ha fallito per tool call prive del campo richiesto `name`; `qwen3.5:4b` ha superato il test. Non viene dichiarato supporto per tutti i modelli Ollama. La rete non è stata disabilitata: il gate offline rimane aperto.

Una prova Kimi negativa ha superato il tempo massimo e lasciato un figlio Qwen attivo; lo stop è stato correttamente dichiarato incerto. Il supervisor ora identifica i figli prima dello stop e segnala solo quelli ancora riconoscibili, senza usare un vecchio PID come prova di ownership. Il nuovo test di rifiuto Kimi è passato. Rimangono da collaudare le famiglie detached e la riconciliazione dopo crash del coordinatore.

## GitHub

Autenticazione gh e accesso a `francemazzi/lagoto` verificati. Il probe ha creato **un repository privato sintetico**, provocato un fallimento del trasporto Git locale, riprovato il push sul repository già creato e confrontato SHA remoto e byte dell’indice. Il repository di prova `francemazzi/lagoto-integration-abaac9d9` è stato archiviato, non cancellato; rimane privato e recuperabile.

Questo prova strumenti e credenziali. Non prova ancora il flusso applicativo durevole P03/P11, un rifiuto dei permessi GitHub o un crash durante la creazione. Nessun push applicativo, tag `v0.1.0` o release Lagoto è stato pubblicato.

## Packaging e notarizzazione

Build Debug ad-hoc e Release Developer ID riuscite. Node è nel bundle; il test con `PATH=/usr/bin:/bin` ha avviato il coordinatore e scritto/riletto SQLite. Il build script conserva i symlink relativi pnpm, include le migrazioni, raccoglie licenze/notice e firma anche gli eseguibili ausiliari Mach-O di Qwen e TypeScript. Il runtime deve essere Node 22.23.1 arm64; una versione diversa interrompe il packaging.

Il certificato Developer ID esistente funziona. La build Release usa Hardened Runtime; solo Node riceve `allow-jit`, senza disabilitare la library validation. Il modulo SQLite firmato viene caricato. La verifica della firma non equivale a notarizzazione o accettazione Gatekeeper.

È stato generato `build/spike-2026-10-05T00-05-41.034Z/Lagoto-P00-spike-macos-arm64.dmg`, **non pubblicato e non notarizzato**. `notarytool submit` e `notarytool history` con il profilo storico `strata-release-local` restituiscono exit 69, “No Keychain password item found”, anche indicando esplicitamente il Keychain login. I report Strata documentano che il profilo aveva funzionato; l’esito attuale è invece indisponibile. Il login nel portale Developer e il certificato non sostituiscono la credenziale del servizio di notarizzazione.

Mancano avvio Finder verificato, installazione pulita, update, ticket, Gatekeeper, collaudo macOS 15, regressioni complete, sessioni/handoff e download dalla release. Il DMG dello spike non deve essere presentato come Lagoto v0.1.0 pronta all’uso.

## Riprodurre le prove

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm gate P00
pnpm gate all
pnpm smoke:provider codex gpt-6.1-sol
pnpm smoke:provider claude sonnet
pnpm smoke:provider cursor 'composer-2.5[fast=true]'
pnpm smoke:provider ollama qwen3.5:4b http://localhost:11434/v1
pnpm smoke:controls codex gpt-6.1-sol deny
pnpm smoke:controls cursor default deny
```

Gli smoke cloud effettuano richieste reali. Quelli OpenRouter leggono la credenziale di test dal Keychain, servizio `org.frasma.lagoto.openrouter.test`, account `lagoto-probe`; non ne stampano il valore. Non usare `tsx` direttamente per gli smoke Qwen: il worker isolato deve essere compilato; i comandi `pnpm smoke:*` lo fanno automaticamente.

`scripts/smoke-github.ts` crea un nuovo repository privato sintetico per ogni esecuzione e lo archivia al successo: non è una regressione da avviare indiscriminatamente. `scripts/package-spike.ts` richiede `LAGOTO_SIGN_IDENTITY` e `LAGOTO_NOTARY_PROFILE`; non crea mai tag o release GitHub.

Prossimo requisito bloccante: rendere applicabile il confine delle scritture Cursor e ripetere la suite. Servono inoltre il Mac sbloccato per le prove native e un profilo notarizzazione utilizzabile. Dopo P00 restano da implementare e chiudere le fasi P01–P12 secondo la roadmap, senza equiparare queste primitive al prodotto completo.
