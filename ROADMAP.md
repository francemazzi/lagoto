# Lagoto — Roadmap di sviluppo

> Collegare integrazioni → scegliere un modello disponibile → lavorare → cambiare modello conservando lo stato → consegnare su GitHub.

**Versione:** 0.4 — 6 ottobre 2026.
**Destinazione:** SwiftUI, macOS 15+, Apple Silicon; local-first. Beta prevista: v0.1.0, DMG firmato/notarizzato e prerelease GitHub. Seconda milestone v0.2.0 “Cowork”: squadre di agenti, registro ACP e messaggi fra conversazioni, con la stessa app nativa.
**Stato:** implementazione avviata. Spike nativo e prove parziali disponibili; nessuna fase chiusa. [Stato ed evidenze](docs/evidence/implementation-2026-10-05.md).
**Documentazione:** [indice](docs/README.md) · [ADR harness](docs/adr/0001-runtime-and-adapters.md) · [ADR app nativa](docs/adr/0002-native-macos.md) · [ADR Cowork](docs/adr/0003-cowork.md) · [ricerca](docs/research.md).

## 1. Risultato atteso

Configuro i miei provider e modelli, vedo il budget disponibile oggi, aggiungo le cartelle del progetto e inizio un task. Posso passare da un modello cloud a uno locale e tornare al cloud attraverso file, decisioni e verifiche salvati. Quando il lavoro è pronto, revisiono e consegno su GitHub con un’azione esplicita.

La batteria pianificata è il budget di oggi: il residuo del ciclo viene distribuito sui giorni fino al rinnovo, con riserva iniziale del 10%. Quote reali del provider e stime personali restano distinte. Non si garantisce una capacità mensile che il piano non espone. [Formula, esempi e casi limite](docs/daily-battery.md).

Con la milestone Cowork affido un task a una squadra: un Leader, Claude Code o Codex a mia scelta, propone i compagni, li creo dopo conferma, lavorano in parallelo su worktree separati e si coordinano con una mailbox e una lavagna dei task. Ogni modello mostra la propria batteria in percentuale e in alto nell’app compare la media delle batterie dei profili abilitati.

## 2. Decisioni di prodotto e architettura

- Tre aree: **Progetti**, **Integrazioni**, **Modelli disponibili**. Nessun livello workspace; ogni progetto contiene uno o più repository e task persistenti. [UX](docs/product-ux.md).
- Codex e Claude Code tramite percorsi ufficiali; Qwen cloud, Kimi API e Ollama tramite Qwen Code SDK dietro un adapter sostituibile. Cursor ACP è obbligatorio per la prima beta. Nessuna compatibilità universale presunta. [Integrazioni](docs/integrations.md).
- Lagoto possiede task, permessi, budget, checkpoint e passaggi. Il loop di inferenza resta all’harness; nessun planner interno di Lagoto. La squadra di [ADR 0003](docs/adr/0003-cowork.md) è coordinamento fra harness tramite strumenti di squadra con conferma umana: entra nella milestone v0.2.0 (P13–P16) e non modifica il perimetro della v0.1.0. [Architettura](docs/architecture.md).
- Architettura Cowork presa da AionUi e AionCore e realizzata in SwiftUI e TypeScript: organizzazione della UI (P02.7–P02.8), media della batteria (P09.10), registro ACP configurabile (P13), motore di squadra con Leader e massimo tre compagni (P14), messaggi fra conversazioni (P15), UI squadra (P16). Nessun Electron, nessun server HTTP di Lagoto: il server MCP di squadra ascolta su socket Unix privato. Riferimenti ai sorgenti in §6.
- Un solo writer per insieme di worktree, cessazione verificata prima del passaggio. Archivio e Context Pack sono distinti; il recupero minimo funziona senza LLM. [Memoria e handoff](docs/memory-handoff.md).
- Quote condivise per account/prodotto, registro idempotente e nessuna somma di unità incompatibili. Tutti i giorni, fuso iniziale Europe/Rome. Allo 0%: stop sicuro, checkpoint e scelta di altro modello o deroga; nessun cambio automatico.
- GitHub esistente riconosciuto quando univoco. In assenza, proposta privata pronta e clic “Crea e collega” per inizializzazione/commit selettivo/creazione/primo push. Consegne successive esplicite. [GitHub](docs/github.md).
- Credenziali gestite da Lagoto nel Keychain; login nativi nei tool ufficiali. Nessun segreto in SQLite, log o pacchetti di contesto. Nessun acquisto, fallback a pagamento, force push o cambio account implicito.

Stack approvato: Swift/SwiftUI con AppKit dove serve; coordinatore TypeScript su Node incluso; SQLite con better-sqlite3, writer unico e artefatti per hash. IPC JSON-RPC versionato su stdin/stdout privato; contratti Swift Codable e TypeScript sulle stesse fixture. Nessun server HTTP o account Lagoto. [ADR 0002](docs/adr/0002-native-macos.md) aggiorna lo stack e conserva la scelta degli adapter di ADR 0001. [ADR 0003](docs/adr/0003-cowork.md) conferma lo stack, esclude Electron e server HTTP, e aggiunge squadra, registro ACP e messaggi fra conversazioni.

## 3. Ordine, dipendenze e criteri di chiusura

Gli identificativi P00–P12 sono conservati. I requisiti Pxx.n rimandano a un test Pxx-Inn; ogni riga sotto include l’esito osservabile atteso. Le suite indicate sono da creare. [Validazione](docs/validation.md) specifica scenari trasversali, metriche e tracciabilità.

| Fase | Dipendenze | Risultato pianificato |
| --- | --- | --- |
| P00 | — | Fattibilità auth, protocollo, Qwen/Kimi/locale, usage, GitHub e packaging |
| P01 | P00, gate comuni risolti | Fondamenta, contratti, storage e test |
| P02 | P01 | Tre aree UX, navigabili con fixture |
| P03 | P01–P02, P00.7 | Progetti/task, rilevamento cartelle e collegamento iniziale GitHub |
| P04 | P03 | Worktree multi-repository e ownership |
| P05 | P04, contratti P00 | Supervisor, journal, registro consumi ed effetti esterni |
| P06 | P05, gate dei singoli percorsi P00 | Login nativi, Qwen/Kimi API e Ollama nella UI |
| P07 | P05; collaudo con P06 | Checkpoint, memoria e Context Pack |
| P08 | P06–P07 | Passaggi cloud ↔ locale e recupero |
| P09 | P05, P06, P08 | Batteria giornaliera, quote e avanzamento |
| P10 | P09 | Cursor ACP e figli osservabili; obbligatorio nella prima beta |
| P11 | P09, P03, P10 | Revisione, consegne GitHub, export e backup |
| P12 | P11 e P10 | Affidabilità e rilascio personale |
| P13 | P06, P10 | Registro ACP configurabile e adapter generico |
| P14 | P05, P08, P09, P13 | Motore di squadra: Leader, compagni, mailbox, lavagna, server MCP |
| P15 | P05, P13 | Messaggi fra conversazioni |
| P16 | P02, P11, P14, P15 | UI squadra, consumi di squadra e rilascio v0.2.0 |

La UI può procedere con fixture dopo P01; le prove pure di memoria possono procedere dopo P05. Un gate di integrazione fallito non diventa una capability simulata. Le parti indipendenti possono avanzare, ma il percorso bloccato non può essere dichiarato supportato.

**Prima beta completa:** tutti i gate P00–P12, con Codex, Claude Code, Qwen cloud, Kimi API, Ollama e Cursor verificati. Il collegamento iniziale GitHub arriva in P03, le consegne successive in P11. Un rilascio parziale deve dichiarare esplicitamente il perimetro ridotto, senza chiamarlo completamento di tutti gli obiettivi.

**Milestone Cowork v0.2.0:** gate P13–P16 dopo la v0.1.0. I requisiti P02.7, P02.8 e P09.10 appartengono alla v0.1.0 perché riguardano la UI e la batteria già in costruzione; squadra, registro ACP e messaggi fra conversazioni restano nella v0.2.0.

## P00 — Fattibilità e decisioni bloccanti

**Obiettivo:** provare i confini reali prima di costruire controlli o percentuali sulla sola documentazione.

- [ ] **P00.1 — Inventario.** Rilevare versioni Git, gh, runtime e harness senza installazioni implicite. **P00-I01:** binario assente, valido e non riconosciuto producono stati diversi; compilare la [matrice](docs/compatibility.md).
- [ ] **P00.2 — Accesso.** Provare login nativi, API separate, revoca e conservazione sicura. **P00-I02:** auth assente/annullata/scaduta/completata; nessun token negli artefatti e nessun fallback da subscription ad API.
- [ ] **P00.3 — Protocollo e permessi.** Provare messaggio, streaming, tool, rifiuto permesso, accesso multi-root, stop e resume ove documentato. **P00-I03:** capability registrate per combinazione esatta; metodo assente non simulato come riuscito; probe senza credenziali non equivale a smoke riuscito.
- [ ] **P00.4 — Packaging.** Spike SwiftUI che avvia Node incluso, SQLite e Git da Finder. **P00-I04:** nessuna dipendenza da Node di sistema o terminale aperto; better-sqlite3 e runtime provati con firma Developer ID e Hardened Runtime; accesso alla notarizzazione verificato.
- [ ] **P00.5 — Test nativi.** Provare XCUITest su macOS e documentare smoke manuali residui. **P00-I05:** apertura app e richiesta/risposta IPC nel binario nativo; nessun endpoint di automazione nel pacchetto di distribuzione.
- [ ] **P00.6 — Qwen Code SDK e locale.** Fissare una versione dello SDK sperimentale e provare separatamente Qwen cloud, Kimi API e un modello Ollama. **P00-I06:** eventi, tool, permessi, interrupt/close, usage, configurazione isolata e recupero; server locale spento, modello assente, coda e rete disattivata correttamente distinti. Nessun modello cloud etichettato locale.
- [ ] **P00.7 — GitHub.** Provare Git/gh, credential store, rilevamento remoto e creazione privata su fixture autorizzata. **P00-I07:** account senza permessi, auth annullata e creazione con push fallito sono recuperabili; nessun token estratto, remote sovrascritto o repo duplicato.
- [ ] **P00.8 — Telemetria e piani.** Identificare fonti documentate, scope, unità, quota/piano, finestre, freschezza e visibilità esterna. **P00-I08:** misure reali, manuali, stimate, mancanti e vecchie distinte; contratto di usage definito prima del registro P05; nessuna conversione prezzo subscription→token.

**Gate:** ADR con risultati e versioni, fattibilità dei confini comuni e stato esplicito di ciascun percorso. Un requisito essenziale fallito blocca l’integrazione corrispondente; niente sostituzione silenziosa dell’harness. Quota non esposta ammette budget personale stimato. Fonti: [registro tecnico](docs/sources.md).

## P01 — Fondamenta e sicurezza del bridge

**Dipende da:** P00 per le decisioni comuni.

- [ ] **P01.1 — Struttura.** UI Swift/runtime TypeScript/fixture condivise separati, TypeScript strict, Swift Codable, lockfile e licenza preservata. **P01-I01:** installazione pulita, typecheck, lint, build e avvio.
- [ ] **P01.2 — IPC.** Request ID, timeout, Zod, eventi e allowlist per scope. **P01-I02:** payload invalido, metodo ignoto e task non autorizzato rifiutati senza effetti.
- [ ] **P01.3 — Lifecycle.** Singola istanza backend/DB, health check, restart e shutdown. **P01-I03:** crash e doppio avvio non duplicano run né writer del database.
- [ ] **P01.4 — Storage.** Schema per task, profili, pool, policy, journal e artefatti; migrazioni e permessi locali. **P01-I04:** migrazione di fixture, errore disco pieno e recupero senza falso salvataggio.
- [ ] **P01.5 — Runner dei gate.** Fake adapter, fixture Git e CI senza segreti. **P01-I05:** test obbligatorio assente, skip inatteso o errore intenzionale fanno fallire il gate; mock e live distinti.
- [ ] **P01.6 — Renderer.** Rendering nativo senza HTML attivo, URL filtrati e log redatti. **P01-I06:** contenuto ostile non ottiene shell, filesystem o segreti attraverso il bridge.

**Gate:** shell reale con backend e adapter finto, contratti validati e report ripetibili.

## P02 — Tre aree e interazioni

**Dipende da:** P01. Fixture dichiarate come dati dimostrativi.

- [ ] **P02.1 — Layout.** Sidebar, composer, timeline e inspector chiuso di default. **P02-I01:** viste 1280×800 e 1568×984 senza overflow; revisione visiva del layout.
- [ ] **P02.2 — Navigazione.** Progetti, Integrazioni, Modelli disponibili; repo nel progetto, nessun workspace. **P02-I02:** configurazione provider→modello→task raggiungibile senza duplicare le gerarchie.
- [ ] **P02.3 — Composer e modelli.** Mostrare solo modelli abilitati e parametri supportati. **P02-I03:** profilo cambiato aggiorna modalità/effort e permessi senza inviare opzioni inesistenti.
- [ ] **P02.4 — Stati.** Batteria, disponibilità, calibrazione, locale, stale, limite, auth, processo perso e checkpoint fallito. **P02-I04:** testo/azione accessibili; budget positivo con provider bloccato non appare pronto.
- [ ] **P02.5 — Task e run.** Distinguere nuova chat sul task e nuovo lavoro. **P02-I05:** solo la prima mantiene stato e worktree; run separate nella timeline.
- [ ] **P02.6 — Accessibilità.** Tastiera, focus, ricerca, pannelli e scroll. **P02-I06:** flussi completi senza mouse e senza focus intrappolato; colore non unico indicatore.
- [ ] **P02.7 — Layout Cowork.** Organizzazione presa da AionUi e realizzata in SwiftUI: sidebar con progetti, task e conversazioni; conversazione al centro; colonna destra richiamabile con explorer dei repository del task, anteprima multi-tab di Markdown, codice, HTML, diff e immagini, e pannello delle modifiche per repository; larghezze persistite e collasso. **P02-I07:** le tre colonne stanno in 1280×800 senza overflow; colonna destra chiusa all’avvio; stato dei pannelli conservato al riavvio; HTML di anteprima senza accesso a shell o filesystem.
- [ ] **P02.8 — Messaggi e composer.** Tool call raggruppati con riepilogo, card di permesso con le scelte reali del backend, output terminale, reasoning esposto, piano fissato sopra il composer, card delle modifiche ai file, indicatore di contesto; coda dei messaggi modificabile con invio a fine turno; badge “in attesa dell’utente” in sidebar e notifica a fine turno. **P02-I08:** replay dei protocolli reali di Codex, Claude, Cursor e Qwen produce le card corrette; messaggi in coda modificabili ed eliminabili; nessun invio durante un turno senza passare dalla coda.

**Gate:** tutti gli stati navigabili con fixture; nessuna integrazione dichiarata pronta prima di P06/P09.

## P03 — Progetti, cartelle e GitHub iniziale

**Dipende da:** P01–P02 e P00.7.

- [ ] **P03.1 — Progetti.** CRUD, ordine e archiviazione non distruttiva. **P03-I01:** restart preserva progetti e configurazione; archiviare non cancella file.
- [ ] **P03.2 — Cartelle.** Percorso canonico, root Git/worktree, stato e remote; cartella non Git accettata come candidata. **P03-I02:** symlink/sottofolder deduplicati, cloni distinti conservati; esecuzione solo con repo pronto.
- [ ] **P03.3 — URL Git.** Clone con destinazione esplicita e progresso annullabile. **P03-I03:** auth/annullamento non sovrascrivono cartelle esistenti; URL sensibili redatti.
- [ ] **P03.4 — Task.** Obiettivo, repository selezionati, messaggi, piano e criteri versionati. **P03-I04:** restart preserva il lavoro; nuovi criteri invalidano un completamento precedente non più sufficiente.
- [ ] **P03.5 — Scope e percorsi.** Repo scollegati/mossi/volumi assenti. **P03-I05:** blocco motivato e ricollegamento, senza directory vuote create silenziosamente.
- [ ] **P03.6 — Lettura offline.** Ricerca e consultazione di task, checkpoint e decisioni. **P03-I06:** storico disponibile senza rete; collegamenti GitHub non verificabili segnalati come tali.
- [ ] **P03.7 — Riconoscimento GitHub.** Normalizzare SSH/HTTPS, identità/account e ambiguità. **P03-I07:** collegamento automatico solo univoco; più remote/account producono una scelta concreta, senza push.
- [ ] **P03.8 — Crea e collega.** Preview privata, file/cronologia, commit selettivo e operazione durevole. **P03-I08:** cartella non Git e repo esistente; indice e remote preservati, ignorati/segreti rilevati esclusi; creazione riuscita/push fallito ripresi senza duplicati. Cambiamenti dopo preview invalidano lo scope interessato.

**Gate:** progetto con tre repository e più task persistenti; collegamento iniziale conforme alla [specifica GitHub](docs/github.md). Nessun account Lagoto richiesto.

## P04 — Worktree e isolamento multi-repository

**Dipende da:** P03.

- [ ] **P04.1 — Worktree coordinati.** Uno per repository del task, con base e branch. **P04-I01:** fallimento del terzo repo non lascia il task pronto; retry e cleanup non distruttivi.
- [ ] **P04.2 — Lavoro esistente.** Rilevare staged/unstaged/untracked e offrire copia selettiva. **P04-I02:** byte e indice delle directory originali invariati dopo preparazione o annullamento.
- [ ] **P04.3 — Ownership.** Un writer gestito da Lagoto per insieme di worktree. **P04-I03:** richieste simultanee non ottengono entrambe ownership.
- [ ] **P04.4 — Multi-root.** Directory consentite e ruoli espliciti, senza concedere tutta la home. **P04-I04:** accesso a percorso fratello/symlink esterno verificato sul confine realmente applicabile; limiti della sandbox pubblicati.
- [ ] **P04.5 — Ambiente.** Comandi install/build/test e dipendenze per repository, con autorizzazioni pertinenti. **P04-I05:** setup riproducibile della fixture; errore ambiente distinto da bug del codice.
- [ ] **P04.6 — Modifiche esterne.** Rilevare editor esterno, conflitti, detached HEAD, submodule e LFS. **P04-I06:** evidenze interessate invalidate; casi non supportati bloccati senza false garanzie.

**Gate:** task a tre repository senza alterare le directory originali o confondere lock applicativo e controllo del filesystem.

## P05 — Supervisor, journal e registro consumi

**Dipende da:** P04 e contratti P00.

- [ ] **P05.1 — AgentRuntimeAdapter.** Discover, auth status, start/send, eventi, permessi, interrupt/close e resume opzionale. **P05-I01:** adapter completo e parziale superano lo stesso contratto senza capability inventate.
- [ ] **P05.2 — Journal.** Persistenza prima della proiezione durevole in UI, sequenza, replay e deduplica. **P05-I02:** duplicati/fuori ordine/reconnect non duplicano messaggi, tool o transizioni.
- [ ] **P05.3 — Processi.** Identità, start time, gruppo, figli e stop graduato. **P05-I03:** figlio sopravvissuto e PID riutilizzato non producono falso arresto.
- [ ] **P05.4 — Comandi ed effetti esterni.** Intenzione prima dell’avvio, output/esito/fingerprint dopo. **P05-I04:** crash tra start e risposta produce unknown, mai replay cieco o test passed.
- [ ] **P05.5 — Permessi.** Approval con scope; modalità Plan protetta solo se tecnicamente applicabile. **P05-I05:** tool non autorizzato rifiutato; controllo assente non mascherato da istruzione testuale.
- [ ] **P05.6 — Stream.** Backpressure, frame spezzati, dati grandi, log redatti e protocollo invalido. **P05-I06:** output parziale recuperabile, UI reattiva e errore esplicito senza perdere eventi già durevoli.
- [ ] **P05.7 — Ledger e prenotazioni.** Addebiti, rettifiche, impegni atomici, pool condivisi, scope e watermark. **P05-I07:** due run non impegnano due volte lo stesso saldo; snapshot account/eventi/figli non sono sommati due volte; crash e risultato tardivo conservano gli impegni incerti. La politica completa arriva in P09.

**Gate:** esecuzione e contabilità ricostruibili dal journal, anche quando l’harness termina senza risposta finale.

## P06 — Integrazioni cloud e locali nella UI

**Dipende da:** P05 e gate del percorso corrispondente in P00.

- [ ] **P06.1 — Claude Code.** Adapter del binario ufficiale, stream e sessione nativa. **P06-I01:** fixture più smoke su repo di prova con lettura, modifica autorizzata, permesso e interruzione.
- [ ] **P06.2 — Codex.** App Server stdio, handshake, thread/turn e approvazioni. **P06-I02:** smoke equivalente; schema/versione incompatibile non trasformato in successo vuoto.
- [ ] **P06.3 — Integrazioni e piani.** Onboarding, Keychain, login nativi, piano/rinnovo rilevati o manuali, logout. **P06-I03:** origine dei dati visibile, account scaduto blocca avvio, nessun segreto nel task; cambio endpoint non riusa ciecamente la chiave.
- [ ] **P06.4 — Catalogo e capacità.** Modelli abilitati, parametri supportati e identità richiesta/risolta. **P06-I04:** modello rimosso, effort assente o profilo mutato non causano fallback silenzioso.
- [ ] **P06.5 — Flusso UI.** Messaggi, strumenti, permessi e separatori di run. **P06-I05:** turno completo per ogni percorso; risposta finale non marca automaticamente completo il task.
- [ ] **P06.6 — Errori.** Distinguere quota, credito, auth, rete, processo e tool. **P06-I06:** causa/azione pertinenti e file conservati; nessuna spesa alternativa implicita.
- [ ] **P06.7 — Qwen e Kimi API.** Adapter SDK isolato, profili e credenziali distinti. **P06-I07:** smoke separati su entrambi, modello/tool/usage registrati e nessuna contaminazione di configurazione/account.
- [ ] **P06.8 — Ollama.** Profilo locale, contesto e risorse configurati, coda e cancellazione. **P06-I08:** inferenza locale con rete disabilitata nella fixture, server assente/coda/errore caricamento distinti; nessuna terminazione globale di un server esterno condiviso.

**Gate:** prove reali sanitizzate per i percorsi dichiarati; rate limit ed esaurimento simulati in CI senza consumare intenzionalmente l’intera quota. Nessuna estensione a tutti i modelli di un provider.

## P07 — Checkpoint, memoria e Context Pack

**Dipende da:** P05; collaudo con P06.

- [ ] **P07.1 — Snapshot.** Byte/indice e manifest multi-repo, binari, cancellazioni, esclusioni e checksum. **P07-I01:** restore in nuove directory coincide per tutti i contenuti inclusi.
- [ ] **P07.2 — Crash safety.** Blob prima del manifest completo, verifica e cleanup degli orfani. **P07-I02:** crash in ogni passaggio o blob assente non mostra un checkpoint pronto corrotto.
- [ ] **P07.3 — Salvataggi.** Fine turno, test, decisione e pre-handoff; snapshot attivi best effort. **P07-I03:** scritture continue/watcher perso non producono falsa stabilità; scansione finale obbligatoria.
- [ ] **P07.4 — Memoria.** Elementi atomici con fonte, revisione, validità e trigger. **P07-I04:** decisioni sostituite e ipotesi smentite non tornano come fatti; contenuti non fidati non diventano istruzioni confermate.
- [ ] **P07.5 — Context Pack.** Generazione locale deterministica, retrieval selettivo, budget destinatario e anteprima. **P07-I05:** funziona senza quota; finestra piccola conserva il nucleo obbligatorio o blocca esplicitamente; consegna ed esclusioni tracciate.
- [ ] **P07.6 — Stato successivo.** Differenze dopo checkpoint e invalidazione delle prove. **P07-I06:** modifica esterna richiede riconciliazione, senza rollback o test rimasti indebitamente validi.

**Gate:** task ricostruibile senza provider originario, provato sul filesystem. [Specifiche e limiti](docs/memory-handoff.md).

## P08 — Handoff e recupero

**Dipende da:** P06–P07.

- [ ] **P08.1 — Macchina a stati.** Intenzione, stop, riconciliazione, checkpoint, contesto, scelta, successore. **P08-I01:** doppio clic e retry dopo timeout creano una sola nuova run.
- [ ] **P08.2 — Stop verificato.** Verificare processi scriventi e output tardivi prima dell’ownership. **P08-I02:** figlio sopravvissuto blocca il passaggio sullo stesso worktree, anche a lock scaduto.
- [ ] **P08.3 — Passaggio volontario.** Anteprima, destinatario, capacità e permessi. **P08-I03:** obiettivo/file/prove arrivano al successore senza briefing manuale; il solo passaggio non modifica i file.
- [ ] **P08.4 — Limite/crash durante test.** Recuperare senza summary finale. **P08-I04:** modifica salvata e test unknown conservati; nessuna ripetizione di azione esterna incerta.
- [ ] **P08.5 — Crash nell’handoff.** Ripartenza da ogni stato intermedio. **P08-I05:** nessun doppio writer, checkpoint completo perso o autorizzazione ampliata.
- [ ] **P08.6 — Percorsi eterogenei.** Claude↔Codex e cloud→Ollama→cloud, includendo profili Qwen/Kimi dichiarati. **P08-I06:** vincoli e prove conservati anche con contesto ridotto; smoke per le direzioni dichiarate, senza attribuire al prodotto il successo garantito di qualsiasi modello.

**Gate centrale:** fixture a tre repository interrotta e continuata attraverso modelli diversi, con evidenze valide e incertezze esplicite.

## P09 — Batteria giornaliera e stato verificato

**Dipende da:** P05, P06 e P08.

- [ ] **P09.1 — UsageProvider.** Collegare le fonti documentate censite in P00 al ledger P05. **P09-I01:** misure presenti, assenti, auth scaduta, errore rete e stale distinti, senza impedire recupero del task.
- [ ] **P09.2 — Pool e finestre.** Identità condivisa, reset, freschezza e vincoli simultanei. **P09-I02:** cambiare modello non ricarica il pool; limiti brevi/rolling non diventano plafond mensili; niente somma di unità diverse.
- [ ] **P09.3 — Contesto e memoria.** Separare finestra misurata, stima del pacchetto e checkpoint. **P09-I03:** token cumulativi non diventano occupazione; compattazione e misura mancante rappresentate correttamente.
- [ ] **P09.4 — Avanzamento.** Criteri verificati sulla revisione corrente. **P09-I04:** “ho finito” non chiude il task; codice cambiato invalida prove pertinenti, criteri qualitativi richiedono revisione umana.
- [ ] **P09.5 — Prossimi passi.** Fase, criteri mancanti e blocchi concreti. **P09-I05:** nuovo requisito cambia il totale con motivo; nessun countdown o test superato inventato.
- [ ] **P09.6 — Soglie e pausa.** 20%, 10%, 0%, stop sicuro e alternative/deroga. **P09-I06:** niente nuove partenze allo zero preciso, avvisi deduplicati, deroga tracciata e nessun cambio automatico o superamento presunto del limite provider.
- [ ] **P09.7 — Assegnazione numerica.** Residuo meno riserva diviso giorni, denominatore congelato, U/P distinti. **P09-I07:** esempi verificati, risparmio/eccedenza, budget nullo, D=0, rinnovo a metà giornata e ora legale; riavvio non ricarica la giornata.
- [ ] **P09.8 — Stime e locale.** Baseline mediana di sette giorni attivi completi, budget iniziale manuale e badge locale. **P09-I08:** meno dati→In calibrazione, nessuna conversione subscription→token; baseline e copertura dichiarate; locale senza plafond non mostra 100% inventato.
- [ ] **P09.9 — Riconciliazione.** Consumi esterni, correzioni, prezzi/piani cambiati, prenotazioni a cavallo di giorni/cicli. **P09-I09:** nessun doppio conteggio account/run/figli, impegni incerti conservati e riassegnazione esplicita; previsioni mensili non presentate come garanzie.
- [ ] **P09.10 — Media in alto.** Nell’intestazione dell’app una percentuale media delle batterie di oggi dei profili abilitati con budget numerico o stimato, etichettata “media”, con elenco per modello e profilo più basso evidenziato. Esclusi i profili in calibrazione e i modelli locali senza plafond; nessuna somma di unità o valute. **P09-I10:** media ricalcolata a ogni cambio di assegnazione; un profilo allo 0% resta visibile nell’elenco anche con media alta; media assente quando nessun profilo ha budget.

**Gate:** [specifica batteria](docs/daily-battery.md) rispettata, contabilità riproducibile e disponibilità separata dalla percentuale.

## P10 — Cursor e figli osservabili

**Dipende da:** P09. Requisito obbligatorio della prima beta.

- [ ] **P10.1 — Cursor ACP.** Handshake, sessioni, aggiornamenti e permessi della versione verificata. **P10-I01:** contratto e smoke live; capability assenti non diventano controlli funzionanti solo graficamente.
- [ ] **P10.2 — Handoff Cursor.** Stessa macchina a stati e Context Pack. **P10-I02:** smoke nelle direzioni dichiarate con Codex/Claude; nessuna scorciatoia sui writer.
- [ ] **P10.3 — Figli.** Parent/child soltanto da eventi osservabili. **P10-I03:** stato parziale esplicito e nessun albero dedotto dalle frasi della chat.
- [ ] **P10.4 — Risultati.** Artefatti e verifiche dei figli nel checkpoint. **P10-I04:** risultato persistito sopravvive al parent; risultato non ricevuto resta mancante.
- [ ] **P10.5 — Controllo.** Stop individuale o limite spawn solo se applicabile. **P10-I05:** figlio non controllabile non dichiarato fermato; handoff bloccato se scrive ancora.
- [ ] **P10.6 — Consumi.** Totali parent e dettagli inclusi dei figli distinti. **P10-I06:** nessuna somma duplicata; costo figlio ignoto resta ignoto.

**Gate:** Cursor e visibilità dei figli limitati alle capacità provate. Nessuna orchestrazione autonoma di swarm richiesta.

## P11 — Revisione, consegna e backup

**Dipende da:** P09, P10 e collegamento P03.

- [ ] **P11.1 — Diff.** Vista multi-repository, staged/unstaged, binari e test associati. **P11-I01:** confronto con Git della fixture senza omissioni silenziose.
- [ ] **P11.2 — Revisione.** Pronto per revisione distinto da completo. **P11-I02:** test obsoleti/criteri mancanti impediscono chiusura automatica; deroghe umane visibili.
- [ ] **P11.3 — Consegna GitHub.** Commit e push espliciti per repo, destinazione e contenuti. **P11-I03:** errore sul secondo repo mostra esiti parziali e retry sicuro; niente force push o sincronizzazione continua implicita.
- [ ] **P11.4 — Export.** Task, decisioni, piano, prove e manifest in formati leggibili. **P11-I04:** anteprima, redazione e reimport di prova senza credenziali o segreti esclusi.
- [ ] **P11.5 — Backup.** Snapshot consistente di DB e artefatti, checksum e restore. **P11-I05:** recupero in nuova directory durante attività controllata; corruzione non dichiarata successo.
- [ ] **P11.6 — Retention.** Budget disco e cleanup selettivo. **P11-I06:** mai eliminare ultimo checkpoint referenziato o worktree sporchi per liberare spazio automaticamente.

**Gate:** lavoro revisionabile, consegnabile e recuperabile senza dipendere dalla sessione di un provider.

## P12 — Affidabilità e prima beta macOS

**Dipende da:** P11 e regressioni P00–P10, incluso Cursor.

- [ ] **P12.1 — Pacchetto.** Runtime, migrazioni e asset inclusi; dipendenze esterne rilevate e guidate. **P12-I01:** avvio Finder in ambiente pulito e percorsi con spazi; aggiornamento preserva dati. Firma/notarizzazione prima di distribuzione esterna.
- [ ] **P12.2 — Crash/sleep/rete.** Riconciliazione prima di nuove run. **P12-I02:** nessuno stato “in esecuzione” privo di evidenza o replay pericoloso; budget corretto dopo cambio giorno/ciclo.
- [ ] **P12.3 — Carico e costo.** Fixture 50 progetti, 1.000 task, 100.000 eventi; prove comparative di contesto. **P12-I03:** obiettivo p95 cambio task <300 ms a caldo sul Mac registrato, inferenza esclusa; qualità/costo per task risolto e interventi umani misurati separatamente.
- [ ] **P12.4 — Confini.** Input non fidati, memoria, hook Git, MCP, percorsi, export e OS. **P12-I04:** fixture injection/traversal non ottengono azioni dal bridge senza autorizzazione; limiti reali dei CLI documentati.
- [ ] **P12.5 — Regressioni.** Gate deterministici e smoke sulle versioni dichiarate. **P12-I05:** schema provider incompatibile rilevato; fonte o versione cambiata non equivale a supporto automatico.
- [ ] **P12.6 — Uso personale.** Cinque sessioni, almeno cinque handoff, uno durante test e uno dopo restart; percorso cloud→locale→cloud. **P12-I06:** nessuna perdita dei contenuti inclusi, doppio writer o quota inventata; briefing manuali necessari registrati e cause corrette prima di chiudere il gate.

**Gate:** limitazioni pubblicate, prove di affidabilità e costi distinguibili dagli errori del modello; nessuna funzionalità sostenuta solo da mock dichiarata collaudata dal vivo. Collaudo su macOS 15 Apple Silicon e sul Mac di sviluppo. Bundle `org.frasma.lagoto`, runtime e licenze inclusi; firma Developer ID, Hardened Runtime, notarizzazione/ticket e Gatekeeper verificati. Solo dopo tutti i gate: `Lagoto-0.1.0-macos-arm64.dmg`, SHA-256, note, tag `v0.1.0`, prerelease GitHub e smoke dal DMG riscaricato. Aggiornamento manuale; niente Intel, iOS/iPadOS o cloud sync.

## P13 — Registro ACP e adapter generico

**Dipende da:** P06 e P10. Milestone v0.2.0. Generalizza il percorso Cursor di P10 secondo il registro di AionCore.

- [ ] **P13.1 — Registro.** Tabella `agent_backends` popolata da `runtime/acp-registry.json`: identificativo, nome, comando, argomenti, identificativi di modalità per backend, capacità MCP dichiarate, versione minima verificata. Voci iniziali: Gemini CLI `--experimental-acp`, Qwen Code `--acp`, Goose `acp`, Kimi `acp`, OpenCode `acp`, Copilot `--acp --stdio`, Droid `exec --output-format acp`, Hermes `acp`; bridge npm bloccati in un lockfile. **P13-I01:** le differenze fra backend sono righe di configurazione; aggiungere una voce non richiede codice, a eccezione dei tre trasporti nativi.
- [ ] **P13.2 — Adapter generico.** `runtime/adapters/acp.ts` generalizza l’adapter Cursor: initialize, authenticate, `session/new` con `mcpServers`, `session/set_mode`, `session/prompt`, `session/update`, `session/request_permission`, cancel. Regole: il turno termina con la risposta a `session/prompt`; ogni richiesta `fs/*` e `terminal/*` riceve -32601; le varianti di update si confrontano come stringhe; output con base64 inline spogliato prima della persistenza; sessione non autorizzata rifiutata. **P13-I02:** fixture ACP finta copre ogni regola; replay reale di Cursor invariato.
- [ ] **P13.3 — Rilevamento e isolamento.** `doctor`, gate di versione, ambiente filtrato e `sandbox-exec` applicati a ogni CLI ACP. **P13-I03:** binario assente, versione non verificata e versione verificata producono stati diversi; scrittura fuori worktree negata per ogni backend.
- [ ] **P13.4 — UI.** Scheda del backend in Integrazioni con stato, versione, riparazione guidata e variabili d’ambiente; selettore di modalità per backend (`agent` per Cursor, `bypassPermissions` per Claude, `agent-full-access` per Codex, `yolo` altrove) e di modello dalle opzioni ACP. **P13-I04:** un backend compare nel composer solo dopo verifica riuscita; modalità non esposta dal backend non selezionabile.
- [ ] **P13.5 — Qwen Code via ACP.** Voce del registro verificata separatamente. Lo SDK resta il percorso di Qwen cloud, Kimi API e Ollama finché l’ACP non supera lo stesso smoke. **P13-I05:** i due percorsi non condividono configurazione né credenziali.

**Gate:** regressione P10 invariata; almeno due backend ACP aggiuntivi verificati su fixture; `docs/compatibility.md` aggiornata con versioni e limiti.

## P14 — Motore di squadra

**Dipende da:** P05, P08, P09 e P13. Port in TypeScript del crate `aionui-team` di AionCore, con i vincoli di ADR 0003.

- [ ] **P14.1 — Modello dati.** Tabelle `teams`, `team_agents` (slot, run e conversazione collegate, ruolo, backend, profilo, stato), `team_mailbox`, `team_tasks` (oggetto, descrizione, owner, stato, `blocked_by`), `team_runs`. Una squadra appartiene a un task; ogni slot è una run su un profilo verificato. **P14-I01:** migrazione su fixture; restart conserva squadra, mailbox e lavagna.
- [ ] **P14.2 — Leader e compagni.** Leader Claude Code o Codex scelto dall’utente; massimo tre compagni fra i profili verificati, Cursor incluso; un modello locale è ammesso come compagno solo se riceve gli strumenti di squadra e lo prova. **P14-I02:** quarto compagno rifiutato; Leader su profilo non ammesso rifiutato.
- [ ] **P14.3 — Workspace.** Modalità `isolated` predefinita: un worktree per slot dalla base del task, Leader integra con revisione; modalità `shared` solo esplicita, con il lock di scrittura in capo alla squadra. **P14-I03:** due slot in `isolated` non scrivono lo stesso worktree; seconda squadra sullo stesso task in `shared` rifiutata.
- [ ] **P14.4 — Server MCP di squadra.** JSON-RPC su socket Unix privato con permessi 0600 per squadra, token per slot, `tools/list` filtrato per ruolo, tredici strumenti: `team_members`, `team_read_messages`, `team_send_message`, `team_interrupt_agent`, `team_task_create`, `team_task_update`, `team_task_list`, `team_list_assistants`, `team_describe_assistant`, `team_spawn_agent`, `team_rename_agent`, `team_clear_agent_context`, `team_shutdown_agent`; spawn, rename, shutdown e reset riservati al Leader. Nessuna porta TCP. **P14-I04:** compagno che chiama uno strumento riservato riceve `permission_denied`; token errato chiude la connessione; socket non raggiungibile da altri utenti.
- [ ] **P14.5 — Iniezione.** ACP tramite `session/new.mcpServers` con `lagoto-runtime mcp-team-stdio` e variabili `TEAM_MCP_SOCKET`, `TEAM_MCP_TOKEN`, `TEAM_AGENT_SLOT_ID`; Claude tramite configurazione MCP; Codex tramite la configurazione MCP dell’app-server; fallback CLI `"$LAGOTO_HELPER_BIN" team …` per backend senza trasporto MCP dichiarato, come Cursor. **P14-I05:** ogni backend verificato riceve gli strumenti nel trasporto corretto; nessun backend dichiara MCP senza averlo.
- [ ] **P14.6 — Prompt di ruolo.** Leader e compagno adattati da `role_prompt.rs` e `governance.rs`: proposta della formazione e conferma umana prima dello spawn, sequenziamento dei task dipendenti, idle non è errore, shutdown formale. Aggiunte Lagoto: ogni slot rispetta i permessi del proprio profilo, lo 0% del budget ferma lo slot, nessun push o effetto esterno dalla squadra. **P14-I06:** il Leader non crea compagni senza conferma; un compagno non può chiedere push.
- [ ] **P14.7 — Scheduler.** Risveglio su assegnazione di task o messaggio, lock di risveglio per slot, timeout 60 s, notifica di idle al Leader, deduplica dei completamenti, rilevamento crash con riavvio che conserva la mailbox, escalation degli slot silenziosi. **P14-I07:** compagno in attesa non resta appeso oltre il timeout; crash di uno slot non perde messaggi non letti.
- [ ] **P14.8 — Comandi ed eventi.** Metodi JSON-RPC `team/*` ed eventi `team.*`: creazione, rimozione, spawn, stato, runtime, mailbox, task, run, turni figli, lavoro per slot. **P14-I08:** ogni transizione ha un evento; nessun polling nella UI.
- [ ] **P14.9 — Budget e credenziali.** Ogni slot prenota dal pool del proprio profilo; allo 0% lo slot va in pausa e il Leader è avvisato; avviso al 50% del budget aggregato della squadra; il segreto arriva per run dal Keychain gestito in Swift, come oggi. **P14-I09:** squadra con un profilo esaurito continua sugli altri slot; nessun segreto nella mailbox o nei prompt.
- [ ] **P14.10 — Sicurezza.** Contenuto della mailbox trattato come non fidato, marcatori espliciti, rate limit fra slot; richieste di permesso per slot portate all’utente. **P14-I10:** istruzione ostile in un messaggio non ottiene shell, filesystem o segreti.
- [ ] **P14.11 — Handoff nella squadra.** Uno slot cambia modello con il flusso P08 conservando slot, mailbox e task assegnati. **P14-I11:** handoff di un compagno non interrompe gli altri.

**Gate:** squadra con Leader Claude, compagno Codex e compagno Cursor sulla fixture a tre repository: proposta, conferma, spawn, due task sequenziali, messaggi, idle, shutdown; nessuna scrittura fuori dai worktree; budget rispettato; zero push.

## P15 — Messaggi fra conversazioni

**Dipende da:** P05 e P13. Port di `aionui-session-message`.

- [ ] **P15.1 — Menzione.** `@@` nel composer aggiunge il blocco delle conversazioni raggiungibili; skill auto-iniettata; sottocomandi `session list`, `session send-message`, `session capabilities` del runtime. **P15-I01:** l’agente consegna solo a identificativi presenti nel blocco.
- [ ] **P15.2 — Consegna.** Consegnare equivale a un invio dell’utente nella conversazione destinataria; coda con TTL; rate limit anti-ciclo; stati `accepted`, `queued`, `rate_limited`; conversazioni di squadra rifiutate. **P15-I02:** due conversazioni che rimbalzano vengono fermate; `queued` non viene mai riportato come letto.
- [ ] **P15.3 — UI.** Blocchi tecnici rimossi dalle bolle, etichetta di provenienza, azione di risposta, avviso quando la funzione è disattivata. **P15-I03:** il testo dei marcatori non appare mai all’utente.

**Gate:** due conversazioni su task diversi si scambiano messaggi con workspace differenti senza percorsi relativi errati.

## P16 — UI squadra e rilascio v0.2.0

**Dipende da:** P02, P11, P14 e P15.

- [ ] **P16.1 — Creazione.** Foglio con nome, Leader (Claude Code o Codex), modalità workspace e task collegato. **P16-I01:** squadra creata compare in sidebar e apre la conversazione del Leader.
- [ ] **P16.2 — Pagina squadra.** Capsule dei membri con colori di identità stabili per slot, vista parallela e singola persistite per squadra, selezione condivisa, Leader selezionato di default. **P16-I02:** aggiungere o rimuovere membri non cambia i colori degli altri.
- [ ] **P16.3 — Warmup.** Overlay chiuso al pronto del Leader, fallimenti per slot con riprova, timeout con errore. **P16-I03:** un compagno che non parte non blocca il Leader.
- [ ] **P16.4 — Lavagna.** Vista attività con card dei task e dei messaggi, filtri, risoluzione dei blocchi. **P16-I04:** ogni card corrisponde a una riga in `team_tasks` o `team_mailbox`.
- [ ] **P16.5 — Controllo.** Permessi per slot con badge in sidebar, interruzione, rinomina, rimozione, “chiedi al Leader” con testo precompilato non inviato; modello e modalità per slot. **P16-I05:** permesso negato da UI arriva allo slot corretto; cambio di modalità su uno slot non tocca gli altri.
- [ ] **P16.6 — Consumi di squadra.** La media in alto include gli slot attivi; il dettaglio mostra il consumo aggregato della squadra e per slot. **P16-I06:** avviso al 50% aggregato una sola volta per giornata.
- [ ] **P16.7 — Rilascio.** Backup e restore estesi a squadre e mailbox; regressioni P12; `Lagoto-0.2.0-macos-arm64.dmg`, SHA-256, note, tag `v0.2.0`. **P16-I07:** archivio v0.1.0 ripristinato nella v0.2.0 senza perdita.

**Gate:** scenario P14 eseguito interamente da UI con XCUITest; accessibilità P02.6 rispettata; DMG firmato e notarizzato.

## 4. Definition of Done e tracciabilità

Una checkbox richiede implementazione, test associato eseguito, caso di errore e report sanitizzato. Le fasi includono typecheck/lint/build, regressioni pertinenti e documentazione aggiornata. Un test browser non sostituisce bridge/pacchetto nativo; un mock non sostituisce smoke obbligatorio. Il gate fallisce anche se i test richiesti mancano o sono skippati.

I report futuri seguiranno [il modello delle evidenze](docs/evidence/README.md): commit, macchina, versioni, comandi, esiti, artefatti, limiti e stato passed/blocked/failed. Non creare report “passed” sulla base di una spiegazione dell’agente. Il [registro di validazione](docs/validation.md) collega requisiti e scenari.

La fixture principale resta un progetto sintetico con tre repository indipendenti, backend/frontend/desktop, e un contratto da aggiornare. Verifica recupero e continuità, non la promessa che ogni modello risolva ogni task. Piani personali, cifre e date reali saranno configurati nell’onboarding futuro.

## 5. Fuori dal primo MVP

Cloud sync, multiutenza, billing di Lagoto, marketplace, IDE completo, scheduler remoto, routing autonomo a pagamento, importazione indiscriminata delle chat storiche, squadre senza conferma umana o oltre tre compagni e memorie vettoriali generiche. Nessun controllo presunto di agenti avviati fuori dall’app. Di AionUi non si riprendono hub delle estensioni, canali chat, cron, pet, assistenti Office, WebUI remota, app mobile, motore interno `aionrs`, Electron e server HTTP.

Possibili estensioni dopo misure reali: Kimi Code nativo, Grok multi-agent, altri server locali, GitHub Enterprise, recupero semantico mirato, squadre più ampie e ulteriori sistemi operativi. Richiedono decisione e prove proprie. [Paper e limiti sperimentali](docs/research.md) guidano gli esperimenti, non certificano il prodotto.

## 6. Riferimenti AionUi e AionCore

AionUi 2.2.2 e AionCore 0.2.2 (`iOfficeAI/AionUi`, `iOfficeAI/AionCore`, Apache-2.0), analizzati il 6 ottobre 2026. La UI è riferimento di organizzazione e viene realizzata in SwiftUI; il motore è portato in TypeScript. Nessun file React o Rust entra nel repository. Percorsi AionUi relativi a `packages/desktop/src/`, AionCore a `crates/`.

| Requisito | Sorgente di riferimento | Uso |
| --- | --- | --- |
| P02.7 | AionUi `renderer/components/layout/`, `pages/conversation/components/ChatLayout/`, `explorer/`, `Preview/`, `SourceControl/` | Organizzazione e comportamenti |
| P02.8 | AionUi `pages/conversation/Messages/`, `PlanBar/`, `components/chat/SendBox/`, `CommandQueuePanel.tsx`; AionCore `ARCHITECTURE.md` §ACP Tool Output Sanitization | Tassonomia dei messaggi e coda |
| P13.1 | AionCore `aionui-db/migrations/*acp_registry*.sql`, `aionui-common/src/enums.rs`, `aionui-runtime/resources/acp-registry-npx-lock.json` | Port a configurazione |
| P13.2 | AionCore `aionui-session/src/backend/acp_conn.rs` | Port in TypeScript |
| P13.4 | AionUi `pages/settings/AgentSettings/`, `components/agent/` | Organizzazione |
| P14 | AionCore `aionui-team/src/` (`mailbox.rs`, `task_board.rs`, `scheduler/`, `mcp/`, `provisioning.rs`, `events.rs`, `work_coordinator/`, `crash_detection.rs`), `aionui-api-types/src/team_tools.rs`, `team_mcp.rs`, `aionui-team-prompts/src/`, `aionui-app/src/commands/cmd_team_stdio.rs` | Port in TypeScript con socket Unix al posto di TCP |
| P15 | AionCore `aionui-session-message/src/`, `aionui-api-types/src/session_tools.rs`, skill `aionui-app/assets/builtin-skills/auto-inject/session-message/` | Port in TypeScript |
| P16 | AionUi `pages/team/`, `docs/prds/teams/team-runtime-experience.md` | Organizzazione e criteri |

