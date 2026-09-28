# Lagoto — Roadmap di sviluppo dell'MVP

> Un'unica interfaccia per lavorare su progetti multi-repository con agenti diversi, mantenendo uno stato di lavoro persistente e verificabile anche quando un agente si interrompe.

**Versione documento:** 0.1 — 28 settembre 2026  
**Destinazione iniziale:** applicazione desktop macOS, local-first, uso personale.  
**Repository:** `francemazzi/lagoto`  
**Stato:** pianificazione. Le checkbox descrivono lavoro da implementare; nessun test di sviluppo è dichiarato già eseguito.  
**Riferimento visivo:** screenshot della finestra agenti di Cursor condiviso il 28 settembre 2026. Il riferimento viene tradotto nei requisiti seguenti; non occorre pubblicare lo screenshot con i nomi dei progetti personali.

## 1. Obiettivo e confini del prodotto

Il caso d'uso principale è questo: creo **Strata**, collego `strata-backend`, `strata-frontend` e `strata-desktop`, avvio un lavoro con Claude Code e, dopo un'interruzione o un limite di utilizzo, continuo con Codex o Cursor. Non devo ricostruire a mano requisiti, modifiche, decisioni, test e problemi ancora aperti.

Lagoto non deve ricreare gli agenti, diventare un nuovo IDE completo o promettere di trasferire lo stato mentale di un modello. Deve conservare **lo stato osservabile del lavoro** e preparare il passaggio al successore, dichiarando ciò che manca o non è verificato.

### 1.1 Principi non negoziabili

1. **Solo Progetti nella navigazione.** Nessun livello aggiuntivo chiamato workspace, organization, space o environment.
2. Un progetto contiene **uno o più repository**. Può essere creato vuoto, ma l'esecuzione richiede almeno un repository pronto.
3. Il **task** è persistente; una **run** è un'esecuzione di un agente. Nuova chat sullo stesso task e nuovo task sono azioni diverse.
4. Chat, codice, roadmap, decisioni e test appartengono al progetto/task, non al provider.
5. Il cambio agente crea una nuova run sullo stesso task e sullo stesso insieme di directory di lavoro, salvo recupero esplicito.
6. Le funzionalità visibili dipendono dalle capacità effettive dell'adapter. Nessun selettore fittizio di modello, modalità o reasoning effort.
7. Quote account, spesa API, finestra di contesto e avanzamento sono misure differenti. Non si sommano e non si sostituiscono tra loro.
8. **Nessuna percentuale inventata.** Un dato assente è `non disponibile`; un dato vecchio è `non aggiornato`; una stima è etichettata come tale.
9. Un solo agente scrivente per insieme di worktree del task nel primo MVP. Il passaggio richiede la cessazione verificata del precedente scrittore.
10. Nessun push, merge, acquisto di crediti, utilizzo extra a pagamento o cambio account automatico senza autorizzazione.

### 1.2 Promessa verificabile

**Promessa:** dopo un'interruzione posso recuperare i file salvati e lo stato registrato, vedere quali verifiche sono ancora valide e affidare il lavoro a un altro agente.

**Non promessa:** recuperare testo mai ricevuto, ragionamento interno, scritture non arrivate su disco, processi nascosti o una sessione proprietaria trasferibile tra provider. Un comando interrotto può dover essere eseguito nuovamente, dopo averne controllato gli effetti.

## 2. Specifica UI: semplice come il riferimento, non una dashboard

### 2.1 Struttura della finestra

```text
┌──────────────────────┬───────────────────────────────────────────────────┐
│ LAGOTO               │ Strata / Login e refresh token                   │
│ + Nuovo lavoro       │ 3 repository · branch per repository       Stato │
│ Cerca                ├───────────────────────────────────────────────────┤
│                      │                                                   │
│ PROGETTI           + │ Conversazione del task                            │
│ ▾ Strata             │                                                   │
│   ● Login e refresh  │ Claude Code · run precedente · interrotta         │
│   ○ Sync desktop     │ Checkpoint disponibile                            │
│   ✓ Impostazioni     │                                                   │
│ ▸ Progetto demo      │ Codex · run corrente                              │
│                      │ Sto verificando il contratto dell'API…            │
│                      │                                                   │
│                      │ [In verifica] [4/6 criteri] [Salvato 12 s fa]      │
│                      │ ┌───────────────────────────────────────────────┐ │
│                      │ │ Scrivi un messaggio o descrivi il lavoro…     │ │
│                      │ │ +  Agente ▾  Modello ▾  Plan/Build ▾     Invia│ │
│                      │ └───────────────────────────────────────────────┘ │
│                      │ Contesto agente: 38% · Dettagli                    │
│ ──────────────────── │                                                   │
│ Claude: 12% residuo* │                       Terminale · Diff · Verifiche │
│ Codex: dato assente  │                                                   │
│ Cursor: 68% residuo* │                                                   │
│ Account / Impostaz.  │                                                   │
└──────────────────────┴───────────────────────────────────────────────────┘
```

I valori sopra sono **esempi di interfaccia**, non misurazioni reali. Ogni percentuale di quota deve indicare la finestra cui si riferisce; l'asterisco nello schema rappresenta tale dettaglio, non un'etichetta da usare in produzione.

**Sidebar:** progetti espandibili, lavori recenti, ricerca e stato sintetico. I repository non devono occupare un secondo albero permanente: si gestiscono nell'intestazione del progetto e nel relativo pannello. Azioni esplicite: `Nuovo progetto`, `Collega repository`, `Nuovo lavoro`.

**Area centrale:** nello stato vuoto, composer centrato come nel riferimento; durante una conversazione, timeline e composer in basso. Le diverse run sono separatori nella stessa timeline, non nuove finestre obbligatorie.

**Inspector:** pannello destro chiuso di default, aperto da `Stato`, con sezioni Agente, Lavoro, Contesto e Repository. Terminale, diff e output dettagliati sono pannelli richiamabili, non colonne sempre visibili.

### 2.2 Specifiche visive di partenza

Questi sono token proposti da affinare confrontando la UI con il riferimento, non asset estratti da Cursor.

| Elemento | Specifica iniziale |
| --- | --- |
| Tema | Scuro, neutro, senza gradienti o grandi superfici sature |
| Sidebar | 244 px iniziali, ridimensionabile; righe compatte di 30–34 px |
| Area principale | Sfondo vicino a `#181917`; sidebar leggermente più chiara |
| Composer | Larghezza massima circa 740 px; bordo sottile; raggio 16 px |
| Tipografia | Font di sistema macOS; 13–14 px per controlli, 14–15 px per messaggi |
| Spaziatura | Scala 4/8/12/16/24; separatori discreti; icone coerenti |
| Indicatori | Icona più testo; colore come rinforzo, mai unico significato |
| Stato normale | Nessun banner; massimo tre chip operativi sopra il composer |
| Stato critico | Un solo avviso prioritario, con causa e azione concreta |

Supportare almeno 1280×800 e 1568×984 senza sovrapposizioni. Su finestre più strette, chiudere l'inspector prima di comprimere il composer. Focus visibile, navigazione da tastiera e contrasto leggibile sono requisiti, non rifiniture opzionali.

### 2.3 Che cosa mostrare, e dove

| Informazione | Vista sintetica | Dettaglio su richiesta |
| --- | --- | --- |
| Stato agente | In esecuzione / In attesa / Interrotto / Non raggiungibile | Ultimo evento, comando, motivo dell'interruzione, run e adapter |
| Quota account | Residuo e finestra, oppure dato assente | Tutte le finestre, reset, fonte, timestamp, account mascherato |
| Contesto agente | Percentuale solo se disponibile e semanticamente valida | Token/capacità dichiarati, compattazioni osservate, fonte |
| Memoria persistente | Checkpoint salvato / Da verificare / Salvataggio fallito | Versione, repository inclusi, elementi esclusi, fatti e decisioni |
| Avanzamento | Fase attuale e criteri verificati, ad esempio 4/6 | Criteri mancanti, test, blocchi e dipendenze |
| Subagent | Conteggio e stato solo se osservabili | Albero dei figli esposti dal provider e relative evidenze |

La quota è dell'**account**, non della singola chat: utilizzi esterni a Lagoto possono cambiarla. La RAM del Mac non è la memoria del modello; resta eventualmente in Diagnostica, fuori dalla vista principale.

### 2.4 Flussi UX obbligatori

**Creare un progetto:** nome → `Collega repository` → cartella locale oppure URL Git da clonare → riepilogo delle directory autorizzate. Collegare un repository non significa caricarlo su un server Lagoto.

**Iniziare un lavoro:** scegliere progetto e repository coinvolti → messaggio iniziale → agente/modello/modalità → nuova run. Il task può essere rinominato in seguito.

**Aprire un'altra chat:** dalla conversazione, `Continua questo lavoro in una nuova chat` mantiene task, piano e worktree; `Nuovo lavoro` crea un task indipendente. La distinzione deve essere esplicita.

**Cambiare agente:** `Continua con…` → stato del checkpoint, modifiche, verifiche e lacune → nuovo agente → anteprima del contesto inviato → conferma. Non copiare silenziosamente tutti i dati del progetto a un nuovo provider.

**Rientrare dopo un crash:** task recuperato, stato dei processi riconciliato, ultimo checkpoint verificabile, eventuali file successivi al checkpoint e azioni necessarie prima di continuare.

## 3. Architettura proposta

### 3.1 Stack e separazione delle responsabilità

| Livello | Scelta iniziale |
| --- | --- |
| Desktop | Tauri 2; Rust limitato a lifecycle, IPC e integrazione OS |
| Frontend | React + TypeScript + Vite; componenti accessibili e token CSS |
| Backend locale | TypeScript su runtime Node.js incluso come sidecar |
| Contratti | Tipi condivisi e validazione runtime con Zod |
| Persistenza | SQLite locale; Prisma come accesso dati, da validare nel packaging |
| Artefatti | Blob locali indirizzati per hash; manifest versionati |
| Processi | Supervisor locale; stdio strutturato; Git tramite argomenti separati |
| Adapter | Claude Code CLI, Codex App Server, Cursor ACP |
| Test | Vitest per contratti/integrations; WebdriverIO per UI/Tauri; smoke live separati |

Tauri documenta sidecar e integrazione Node.js; il packaging effettivo di runtime e dipendenze va provato in P00, non rinviato alla fine. [S6][S7]

Nessun backend cloud, account Lagoto, PostgreSQL, Redis, vector database o LangChain/LangGraph nell'MVP. Il problema è persistenza e controllo delle esecuzioni, non un nuovo loop agentico.

```text
lagoto/
  frontend/                 # UI React; nessun accesso diretto a credenziali o shell
  backend/
    src/
      projects/
      tasks/
      runtime/              # supervisor, processi, permessi, journal
      adapters/
        claude-code/
        codex/
        cursor/
        fake/
      git/
      checkpoints/
      context/
      usage/
      verification/
      storage/
    prisma/
  shared/                   # contratti, eventi e validatori
  src-tauri/                # shell nativa e bridge ristretto
  tests/
    integration/
    e2e/
    fixtures/
    live/
  scripts/
  docs/
    adr/
    evidence/
  ROADMAP.md
```

Le cartelle sopra sono deliverable da creare, non codice già presente.

### 3.2 Comunicazione e lifecycle

```text
React UI
  ↕ IPC tipizzato e autorizzato
Tauri shell
  ↕ stdio incorniciato / request ID / eventi
Backend locale TypeScript
  ├── SQLite + artefatti
  ├── supervisor + Git + verifiche
  └── adapter → processi CLI ufficiali
```

Il frontend non può eseguire comandi arbitrari, leggere il filesystem liberamente o invocare direttamente provider. I comandi IPC sono allowlistati, validati e limitati al progetto/task autorizzato. In produzione non serve un server HTTP in ascolto. Le capability Tauri sono parte della difesa, non una sandbox automatica per qualsiasi CLI figlio. [S9]

Una sola istanza scrivente del backend sul database. Chiudere la finestra non deve uccidere di nascosto una run: distinguere nascondi finestra da esci dall'app, e chiedere se interrompere in sicurezza. Non promettere che gli agenti continuino mentre il Mac è spento o sospeso.

### 3.3 Adapter: niente promessa di uniformità universale

| Agente | Percorso iniziale | Vincoli da verificare |
| --- | --- | --- |
| Claude Code | Binario ufficiale non modificato, output strutturato della CLI | Login nativo, permessi, resume, eventi e limiti disponibili nella versione installata |
| Codex | App Server locale su stdio | Versione del protocollo, thread/turn, approvazioni, dati account e telemetria |
| Cursor | CLI ufficiale in modalità ACP | Handshake, modalità/modelli esposti, permessi ed estensioni effettivamente supportate |

Claude Code documenta l'esecuzione non interattiva e lo streaming JSON. Codex documenta l'App Server e metodi account, incluso `account/rateLimits/read`. Cursor documenta `agent acp`. Questi sono punti di integrazione distinti, non lo stesso protocollo. [S1][S2][S3]

ACP prevede negoziazione delle capability e funzionalità opzionali: non garantisce da solo quote, controllo dei figli o migrazione della memoria tra provider. [S4]

**Autenticazione:** usare i flussi nativi consentiti. Non estrarre cookie o token dai profili dei provider, non duplicarli in SQLite e non riutilizzarli per endpoint non documentati. La documentazione Anthropic distingue l'uso del binario ufficiale con login dell'utente dall'offrire un login Claude dentro applicazioni proprie o instradare credenziali degli utenti: P00 deve verificare il percorso scelto e i termini applicabili prima della distribuzione. Non assumere che una subscription sia intercambiabile con l'accesso API. [S5]

**Decisione di scope:** le quote Claude/Cursor senza fonte documentata utilizzabile restano indisponibili, con collegamento alla gestione account. Questo non blocca checkpoint e handoff. Librerie che leggono endpoint privati non sono una dipendenza obbligatoria del prodotto.

## 4. Modello persistente e regole di verità

### 4.1 Entità minime

| Entità | Responsabilità |
| --- | --- |
| Project | Nome, descrizione, preferenze e regole condivise |
| Repository | Percorso canonico, remote, ruolo e relazione al progetto |
| Task | Obiettivo, repository coinvolti, criteri di accettazione e stato |
| TaskRepository | Worktree, branch, base e configurazione test per quel task |
| Run | Agente, modello, sessione nativa, modalità, stato e run precedente |
| RunEvent | Evento osservato, sorgente, ordinamento e idempotency key |
| Checkpoint | Manifest multi-repository e riferimenti ad artefatti persistiti |
| ContextPack | Contesto effettivamente consegnato a una specifica run |
| Decision | Decisione, autore, motivazione sintetica e fonti |
| Verification | Comando/verifica, esito e fingerprint del codice verificato |
| AcceptanceCriterion | Requisito verificabile, stato ed evidenze associate |
| UsageSnapshot | Misura account/run con unità, finestra, fonte e freschezza |
| Approval | Richiesta, scope, risposta e validità dell'autorizzazione |

Lo stato del task non coincide con quello della run. Una run può terminare perché ha risposto al messaggio, mentre il task resta incompleto o in attesa di revisione.

### 4.2 Fatti, dichiarazioni e ipotesi

Ogni informazione condivisa deve indicare provenienza e validità. Esempi:

- **Osservato:** il runner ha eseguito un comando con exit code 1.
- **Dichiarato dall'agente:** «ho completato il refactor»; non è una verifica.
- **Confermato dall'utente:** requisito o scelta architetturale approvata.
- **Ipotesi:** possibile causa del problema, ancora da verificare.

Non promuovere automaticamente un riassunto del modello a fatto o requisito. Una decisione sostituita resta nello storico e non viene reinserita come vigente.

### 4.3 Contratto delle misure

```ts
type ObservationStatus =
  | "reported"
  | "estimated"
  | "manual"
  | "unavailable"
  | "stale";

interface UsageObservation {
  provider: string;
  accountRef: string; // riferimento locale, non un token
  scope: "account" | "run";
  metric: "quota" | "api_spend" | "context_window";
  status: ObservationStatus;
  source: string;
  observedAt: string;
  windowId?: string;
  resetsAt?: string;
  used?: number;
  limit?: number;
  unit?: "percent" | "tokens" | "requests" | "currency";
  currency?: string;
}
```

È un contratto di progetto da completare con validatori, non un SDK di provider. Valori negativi, percentuali fuori intervallo, finestre mancanti o dati incompatibili devono fallire la validazione. `unavailable` non equivale a zero.

Non dedurre il contesto attuale sommando tutti i token fatturati della sessione. Non dedurre un saldo subscription dalla spesa API. Una misura account non va attribuita a una run senza una fonte che consenta tale attribuzione.

## 5. Continuità del lavoro e passaggio agente

### 5.1 Un insieme di worktree per task

Per Strata si creano tre worktree, uno in ciascun repository coinvolto, associati allo stesso task. Ogni repository mantiene il proprio branch e la propria base: non esiste un singolo commit Git che rappresenti atomicamente tutti e tre. Git documenta worktree distinti per uno stesso repository. [S10]

```text
Task: login-refresh
  backend  → worktree A → branch lagoto/<task-id>
  frontend → worktree B → branch lagoto/<task-id>
  desktop  → worktree C → branch lagoto/<task-id>

Checkpoint → manifest di A + B + C
```

Le directory originali dell'utente non vengono modificate per preparare il task. Se contengono lavoro non committato, Lagoto chiede se partire dall'ultimo commit oppure importare una copia delle modifiche selezionate; non le ignora silenziosamente.

Un lock applicativo evita due run scriventi avviate da Lagoto. **Non impedisce a un editor esterno o a un processo non controllato di scrivere.** Per questo servono controllo dei processi, scansioni Git e rilevamento di modifiche esterne. `git worktree lock` non viene usato come mutex di scrittura.

### 5.2 Contenuto minimo del checkpoint

Il checkpoint deve conservare obiettivo, criteri, piano corrente, decisioni confermate, run/evento di origine, stato dei comandi e manifest per ogni repository. Il manifest include base/HEAD, stato dell'indice, modifiche staged/unstaged, file untracked consentiti, hash degli artefatti, esclusioni e fingerprint delle verifiche.

Conservare i byte necessari al recupero, non soltanto i nomi dei file o un diff visuale. Preservare gli oggetti Git referenziati tramite riferimenti privati o bundle quando necessario. Trattare correttamente file binari, cancellazioni e permessi supportati.

Gli artefatti vengono scritti e verificati prima di rendere completo il manifest nel database. Un errore di disco o un crash non può produrre un checkpoint marcato completo che punta a blob inesistenti.

Gli snapshot durante una run attiva sono **best effort** finché non è stabilita una condizione stabile. Un checkpoint pronto per il passaggio richiede il fermo dei processi scriventi controllati e la verifica dei file. Watcher e debounce aiutano, ma non costituiscono prova di consistenza.

Segreti, file ignorati, dipendenze rigenerabili e file esclusi non vengono esportati automaticamente. Le esclusioni sono visibili: un checkpoint non è una promessa di backup completo dell'intero computer.

### 5.3 Context Pack indipendente dall'agente

Ordine iniziale del pacchetto:

```text
1. Obiettivo e criteri di accettazione
2. Mappa dei repository autorizzati
3. Istruzioni dell'utente e decisioni confermate
4. Piano vigente e passaggi ancora aperti
5. Ultimo checkpoint e modifiche successive note
6. Verifiche valide, fallite, interrotte o da ripetere
7. File e diff pertinenti
8. Rischi, ipotesi e azioni consigliate
9. Riferimenti ad altri artefatti, con accesso su richiesta
```

Il pacchetto viene versionato e mostrato all'utente prima del cambio provider. Non contiene tutta la cronologia per default. Il budget dipende dal modello, se noto; altrimenti si applica un limite conservativo dichiarato. Una stima del pacchetto non viene presentata come occupazione effettiva della finestra del provider.

La generazione minima del pacchetto deve funzionare **senza chiamare un modello**. Un riassunto opzionale può migliorarlo, ma non può essere necessario per recuperare il task quando la quota è finita.

Il successore deve poter consultare file ed evidenze aggiuntive. Le istruzioni fidate sono separate da contenuti di repository, log e output non fidati. Non trasferire catene di ragionamento interne né inventare ragionamenti mancanti.

### 5.4 Procedura sicura di handoff

```text
requested
  → stopping
  → reconciling
  → checkpointing
  → context_ready
  → awaiting_confirmation
  → starting_successor
  → completed

Qualsiasi fase può entrare in blocked / failed con causa e recupero espliciti.
```

1. Registrare la richiesta con chiave idempotente; sospendere nuovi comandi del task.
2. Chiedere l'interruzione al provider e attendere. Se necessario, terminare il gruppo dei processi controllati dopo conferma.
3. Verificare l'uscita dei processi scriventi noti, inclusi figli osservabili. Un timeout o la scadenza del lock non prova che siano terminati.
4. Riconciliare eventi, file e comandi. Un comando iniziato senza esito resta `unknown/interrupted`, non `passed`.
5. Acquisire il checkpoint stabile multi-repository e generare il Context Pack.
6. Mostrare lacune, dati inviati e permessi richiesti. Non ereditare approvazioni pericolose da una run all'altra.
7. Creare una sola nuova run, trasferire l'ownership applicativa e avviare il successore.
8. Richiedere al successore una verifica iniziale dello stato e la prosecuzione dei passi aperti.

Il fencing token invalida vecchi eventi e richieste nel backend; **non ferma da solo un CLI che scrive direttamente sul filesystem**. In presenza di uno scrittore non controllabile, bloccare il passaggio sullo stesso worktree e proporre un recupero isolato, non una finta continuazione sicura.

## 6. Come leggere ed eseguire la roadmap

Le fasi vanno implementate in ordine, salvo parallelizzare la UI con adapter finti. Ogni checkbox ha un identificativo e una verifica di integrazione associata. Una fase è conclusa solo quando tutti i suoi gate risultano soddisfatti.

Gli script elencati sotto sono **interfacce da creare**, non comandi già presenti nel repository:

```bash
pnpm verify:phase -- P03
pnpm test:integration
pnpm test:e2e
pnpm test:live -- --provider codex
pnpm test:handoff -- --scenario abrupt-stop
pnpm build:desktop
```

P00 usa inizialmente script di spike; P01 li integra nel runner comune. `verify:phase` deve fallire se manca un test obbligatorio, non trova test, incontra skip inattesi o usa mock al posto dello smoke live richiesto.

Per ogni fase produrre `docs/evidence/Pxx.md` con commit, versioni runtime/CLI, comandi, esiti, percorsi degli artefatti e limiti residui. Nessun token, transcript privato o percorso personale completo nei report pubblici. I risultati live sono separati dai test deterministici.

| Fase | Risultato |
| --- | --- |
| P00 | Fattibilità di integrazioni, autenticazione e packaging |
| P01 | Scheletro sicuro, contratti e infrastruttura di test |
| P02 | UI fedele al riferimento con tutti gli stati |
| P03 | Progetti, repository e task persistenti |
| P04 | Directory di lavoro multi-repository isolate |
| P05 | Runtime supervisionato e journal durevole |
| P06 | Claude Code e Codex utilizzabili nella stessa UI |
| P07 | Checkpoint, memoria e Context Pack |
| P08 | Passaggio Claude ↔ Codex e recupero da interruzione |
| P09 | Quote, contesto e avanzamento verificato |
| P10 | Cursor e visibilità dei subagent supportati |
| P11 | Revisione, consegna, export e backup |
| P12 | Affidabilità, packaging e validazione quotidiana |

**Prima versione personale utile:** P00–P09, con Claude Code e Codex.  
**MVP a tre agenti:** P00–P12, includendo Cursor. Nessuna promessa di copertura identica della telemetria.

## P00 — Spike tecnici e decisioni bloccanti

**Obiettivo:** verificare i rischi prima di costruire la UI intorno a capability inesistenti.

- [ ] **P00.1 — Inventario e compatibilità.** Rilevare Git, runtime e CLI installati; registrare versione, percorso e capacità in `docs/compatibility.md`, distinguendo documentato, verificato e non supportato. **Test `P00-I01`:** CLI assente, versione valida e versione non riconosciuta producono stati differenti senza crash.
- [ ] **P00.2 — Percorsi di autenticazione.** Provare login nativo e riutilizzo della sessione senza copiare credenziali nel database; documentare i vincoli dei provider. **Test `P00-I02`:** autenticazione assente, annullata e completata; scansione degli artefatti senza token; smoke manuale sul Mac.
- [ ] **P00.3 — Protocollo e controllo.** Provare per ogni agente messaggio, evento strutturato, interruzione, permesso e accesso ai repository autorizzati. **Test `P00-I03`:** report esplicito delle capability; un metodo non supportato non viene simulato come riuscito. Uno smoke senza credenziali non conta come integrazione riuscita.
- [ ] **P00.4 — Packaging anticipato.** Creare una piccola app Tauri che avvia il sidecar, legge/scrive SQLite tramite il percorso scelto e invoca Git da Finder. **Test `P00-I04`:** esecuzione su macOS senza dipendere dal terminale aperto o da un runtime Node di sistema. Se Prisma/runtime non sono impacchettabili in modo sostenibile, registrare un ADR e approvare un'alternativa prima di proseguire.
- [ ] **P00.5 — Test nativi.** Provare WebdriverIO/Tauri sul target macOS e definire gli smoke manuali necessari. **Test `P00-I05`:** apertura app, richiesta IPC e lettura risposta nel binario di test; nessun endpoint di automazione nel binario di distribuzione.

**Gate:** `docs/adr/0001-runtime-and-adapters.md` approvato; nessun blocker su avvio, auth consentita o isolamento minimo dei due agenti iniziali. I limiti di telemetria sono dichiarati. La documentazione Tauri descrive un percorso WebdriverIO con server embedded anche su macOS: verificarlo sulla versione scelta, senza confondere un test browser con un test nativo. [S8]

## P01 — Fondamenta, sicurezza del bridge e test harness

**Dipende da:** P00.

- [ ] **P01.1 — Struttura TypeScript e Rust.** Creare frontend, backend e shared separati, configurazione strict, lint, formattazione e lockfile. Conservare la licenza esistente. **Test `P01-I01`:** installazione pulita, typecheck, build e avvio della shell di prova.
- [ ] **P01.2 — Bridge tipizzato.** Implementare request ID, timeout, validazione Zod, eventi e allowlist IPC; nessuna shell generica esposta alla UI. **Test `P01-I02`:** payload invalido, metodo sconosciuto e accesso a task non autorizzato vengono rifiutati senza effetti.
- [ ] **P01.3 — Lifecycle sidecar.** Gestire health check, singola istanza, restart controllato e shutdown; vietare due writer del database. **Test `P01-I03`:** crash del backend e doppio avvio dell'app non duplicano run o corrompono lo storage.
- [ ] **P01.4 — Storage e migrazioni.** Definire schema iniziale, transazioni, politiche di journaling SQLite e directory applicativa con permessi restrittivi. **Test `P01-I04`:** migrazione da fixture precedente, rollback applicativo documentato e errore disco pieno senza falso salvataggio.
- [ ] **P01.5 — Runner dei gate.** Creare fixture Git, fake adapter, runner `verify:phase`, report e CI senza credenziali reali. **Test `P01-I05`:** test obbligatorio assente/skippato fa fallire il gate; un errore intenzionale viene rilevato dalla pipeline.
- [ ] **P01.6 — Protezione del renderer.** Disabilitare HTML attivo nei messaggi, restringere navigazione e apertura URL, introdurre CSP e redazione dei log. **Test `P01-I06`:** messaggio con script, link eseguibile o payload IPC ostile non accede a shell, filesystem o segreti.

**Gate:** la shell funziona con un backend reale e un agente finto, con errori comprensibili e report ripetibili.

## P02 — UI e interazioni fedeli al riferimento

**Dipende da:** P01. Può procedere con dati finti chiaramente identificati.

- [ ] **P02.1 — Layout e design token.** Implementare sidebar, stato vuoto, composer, timeline e inspector chiuso. **Test `P02-I01`:** screenshot e bounding box alle due risoluzioni target; nessun overflow; confronto visivo approvato dall'utente.
- [ ] **P02.2 — Navigazione solo per progetti.** Progetti espandibili e task recenti; repository nel pannello del progetto. **Test `P02-I02`:** creo/seleziono tre progetti e raggiungo un task; nessuna voce workspace o gerarchia alternativa nell'interfaccia.
- [ ] **P02.3 — Composer e capability.** Selettori agente, modello, modalità e, se supportato, effort. **Test `P02-I03`:** cambio adapter → controlli aggiornati; opzione assente disabilitata con motivo; nessun parametro non supportato viene inviato.
- [ ] **P02.4 — Stati sintetici.** Implementare in esecuzione, in verifica, in attesa di input, limite raggiunto, processo perso, checkpoint fallito e dati non aggiornati. **Test `P02-I04`:** tutte le fixture hanno testo/azione accessibili; stato normale senza banner; stato critico con un unico avviso prioritario.
- [ ] **P02.5 — Nuova chat versus nuovo lavoro.** Implementare entrambe le azioni e timeline con separatori tra run. **Test `P02-I05`:** la prima mantiene task e contesto; la seconda crea un task nuovo senza ereditare decisioni operative del precedente.
- [ ] **P02.6 — Tastiera e pannelli.** Ricerca rapida, focus, inspector e terminale richiudibili, scroll della chat stabile. **Test `P02-I06`:** navigazione completa da tastiera; nessun focus intrappolato; nuovo messaggio non sposta forzatamente chi sta leggendo lo storico.

**Gate:** tutte le schermate sono navigabili con fixture e l'utente approva il layout. La UI non viene considerata integrata con i provider finché P06 non è conclusa.

## P03 — Progetti, repository e task persistenti

**Dipende da:** P01–P02.

- [ ] **P03.1 — CRUD progetto.** Nome, descrizione, ordine sidebar e archiviazione non distruttiva. **Test `P03-I01`:** creo Strata, riavvio l'app e ritrovo configurazione e ordinamento; archiviare non cancella repository o file.
- [ ] **P03.2 — Collega cartella locale.** Validare repository Git, percorso canonico, disponibilità e alias; evitare duplicati tramite symlink. **Test `P03-I02`:** collego tre repo, rifiuto una cartella non valida, riconosco lo stesso repo attraverso due percorsi.
- [ ] **P03.3 — Collega URL Git.** Clonare solo dopo scelta della destinazione, con credenziali gestite da Git e progresso annullabile. **Test `P03-I03`:** clone da remote di fixture, errore auth e annullamento non sovrascrivono cartelle preesistenti; URL sensibili redatti.
- [ ] **P03.4 — Task e criteri.** Salvare obiettivo, messaggi, repository selezionati, piano versionato e criteri di accettazione confermati. **Test `P03-I04`:** restart preserva il task; modificare i criteri cambia versione e non mantiene indebitamente un completamento precedente.
- [ ] **P03.5 — Scope e repository mancanti.** Ogni task opera solo sui repo selezionati; scollegamento/movimento gestito senza cancellare il lavoro. **Test `P03-I05`:** repo rimosso o volume non montato → esecuzione bloccata e possibilità di ricollegamento, non nuova cartella vuota silenziosa.
- [ ] **P03.6 — Ricerca e lettura offline.** Ricercare progetti/task e aprire storico, checkpoint e decisioni senza rete. **Test `P03-I06`:** rete disattivata → lettura locale disponibile; avvio di un agente remoto mostra il limite appropriato.

**Gate:** Strata con tre repository e più task sopravvive al riavvio, senza un account Lagoto.

## P04 — Isolamento Git e ambiente multi-repository

**Dipende da:** P03.

- [ ] **P04.1 — Creazione coordinata worktree.** Creare un worktree per repo coinvolto, conservando base e branch nel task. **Test `P04-I01`:** fallimento sul terzo repo non lascia il task pronto con due repo soltanto; cleanup non distruttivo e retry idempotente.
- [ ] **P04.2 — Lavoro preesistente.** Rilevare staged, unstaged e untracked nelle directory originali; offrire importazione selettiva della copia. **Test `P04-I02`:** hash e indice delle directory originali restano invariati dopo importazione o annullamento.
- [ ] **P04.3 — Ownership scrivente.** Implementare lock applicativo per task/repository e controllo della sessione proprietaria. **Test `P04-I03`:** due richieste simultanee di run non ottengono entrambe accesso scrivente allo stesso insieme di worktree.
- [ ] **P04.4 — Accesso multi-root.** Passare ai CLI directory consentite e mappa dei ruoli; non concedere per comodità tutta la home. **Test `P04-I04`:** agente di fixture legge i tre repo consentiti; accesso a percorso fratello o symlink esterno viene negato dal livello di controllo disponibile. Dichiarare i limiti della sandbox reale.
- [ ] **P04.5 — Ambiente riproducibile.** Salvare comandi install/build/test per repository, ordine e prerequisiti; chiedere approvazione prima di eseguirli. **Test `P04-I05`:** setup di fixture multi-repo da directory pulite; errore dipendenza segnalato come setup fallito, non bug già diagnosticato.
- [ ] **P04.6 — Modifiche esterne e casi non supportati.** Rilevare file cambiati da editor esterno; gestire detached HEAD, conflitti, submodule e LFS con supporto esplicito o blocco motivato. **Test `P04-I06`:** cambiamento esterno invalida le evidenze interessate; repo non supportato non viene dichiarato protetto.

**Gate:** un task può coinvolgere tre repository senza alterare le directory originali e senza collisioni tra run gestite da Lagoto.

## P05 — Runtime supervisionato e journal durevole

**Dipende da:** P04.

- [ ] **P05.1 — Contratto AgentAdapter.** Definire discover, authenticate/status, start, send, interrupt, resume quando disponibile e stream eventi. **Test `P05-I01`:** fake adapter completo e adapter parziale superano lo stesso contratto senza fingere capability mancanti.
- [ ] **P05.2 — Event log persistente.** Salvare eventi osservati prima dell'aggiornamento durevole mostrato in UI; gestire ordine per run, duplicati e reconnect. **Test `P05-I02`:** replay di eventi duplicati e fuori ordine non duplica messaggi, tool o transizioni; restart ricostruisce la stessa proiezione.
- [ ] **P05.3 — Supervisor dei processi.** Tracciare identità del processo, start time, gruppo e figli controllati; timeout e stop graduato. **Test `P05-I03`:** interruzione di un fake agente con figlio lungo; nessun riutilizzo pericoloso del solo PID; un figlio non rintracciabile produce blocco esplicito.
- [ ] **P05.4 — Comandi e verifiche.** Registrare prima l'intenzione di un comando mediato, poi start/end, cwd, argomenti, output, exit code e fingerprint. **Test `P05-I04`:** crash tra start e risultato produce esito sconosciuto e nessun replay automatico di un comando con possibili effetti esterni.
- [ ] **P05.5 — Approvazioni e Plan.** Centralizzare richieste supportate dagli adapter; Plan non deve diventare scrivente per una semplice istruzione testuale. **Test `P05-I05`:** scrittura in modalità realmente read-only rifiutata; se l'adapter non può applicare il vincolo, il controllo Plan protetto non viene offerto.
- [ ] **P05.6 — Backpressure e dati incompleti.** Gestire frame spezzati, messaggi troppo grandi, stream non valido e log redatti. **Test `P05-I06`:** stream malformato o consumatore lento non blocca indefinitamente l'app e non marca come ricevuto ciò che non è stato persistito.

**Gate:** interrompendo il fake agente o il backend, lo stato osservato resta recuperabile e le incertezze rimangono visibili.

## P06 — Claude Code e Codex reali

**Dipende da:** P05.

- [ ] **P06.1 — Claude Code adapter.** Integrare il binario ufficiale e lo stream documentato, con session ID, errori e ripresa nativa quando supportata. **Test `P06-I01`:** fixture del protocollo più smoke live: lettura di un repo di prova, modifica autorizzata, output visibile e interruzione.
- [ ] **P06.2 — Codex adapter.** Integrare App Server su stdio, handshake, thread/turn, approvazioni e stato finale. **Test `P06-I02`:** fixture e smoke live equivalenti; errore di protocollo/versione non viene trasformato in risposta vuota riuscita.
- [ ] **P06.3 — Account e riconnessione.** UI `Collega account` che avvia il percorso nativo previsto, stato autenticazione e logout esplicito. **Test `P06-I03`:** credenziali scadute o logout interrompono l'avvio correttamente; nessun token entra in SQLite, log, Context Pack o export.
- [ ] **P06.4 — Modelli e modalità reali.** Popolare scelte da capability/catalogo supportato; registrare richiesta ed eventuale modello effettivo riportato. **Test `P06-I04`:** modello rimosso, effort non supportato e cambio durante una run sono gestiti senza fallback silenzioso.
- [ ] **P06.5 — Flusso completo in UI.** Messaggi, strumenti, richieste permesso e run multiple nello stesso task. **Test `P06-I05`:** avvio, richiesta input, risposta utente e fine turno con entrambi gli agenti; fine turno non equivale a task completato.
- [ ] **P06.6 — Classificazione degli errori.** Separare rate limit, credito esaurito dichiarato, rete, auth, processo morto ed errore tool. **Test `P06-I06`:** ogni fixture produce una causa e un'azione differenti, mantenendo il lavoro già salvato.

**Gate:** due smoke live riusciti e documentati sui repository di prova. I test non consumano intenzionalmente tutta la quota dell'utente: l'esaurimento è simulato a livello di adapter per la CI.

## P07 — Checkpoint, memoria e Context Pack

**Dipende da:** P05–P06.

- [ ] **P07.1 — Snapshot recuperabile.** Implementare artefatti per file/indice e manifest multi-repo, con checksum ed esclusioni. **Test `P07-I01`:** recupero in directory nuove di fixture con staged, unstaged, untracked, cancellazioni e binari; byte e stato Git coincidono per i contenuti inclusi.
- [ ] **P07.2 — Scrittura crash-safe.** Persistenza artefatti prima del manifest completo; verifica all'apertura; cleanup sicuro degli artefatti orfani. **Test `P07-I02`:** arresto a ogni punto critico e blob mancante → nessun checkpoint corrotto presentato come pronto.
- [ ] **P07.3 — Pianificazione dei salvataggi.** Checkpoint su fine turno, test, decisione e prima del passaggio; snapshot intermedi con etichetta di consistenza. **Test `P07-I03`:** continue scritture e filesystem watcher perso non producono un falso checkpoint stabile; scansione finale obbligatoria.
- [ ] **P07.4 — Memoria strutturata.** Overview, architettura, convenzioni, decisioni, roadmap e problemi, con autore, versione e fonti. **Test `P07-I04`:** decisione sostituita o ipotesi smentita non rientra nel contesto come fatto corrente.
- [ ] **P07.5 — Context Pack deterministico.** Generazione senza LLM, selezione pertinente, budget dichiarato, riferimenti per approfondire e anteprima. **Test `P07-I05`:** quota di tutti i provider indisponibile → pacchetto comunque generabile; un test interrotto resta interrotto; i segreti esclusi non compaiono.
- [ ] **P07.6 — Modifiche dopo il checkpoint.** Confrontare stato attuale e snapshot, distinguere salvato, successivo, escluso e non leggibile. **Test `P07-I06`:** modifica esterna dopo il checkpoint produce avviso e nuova verifica prima del passaggio, senza rollback automatico.

**Gate:** un task è ricostruibile senza il provider originario. Il recupero viene verificato su filesystem reale, non solo confrontando JSON.

## P08 — Handoff sicuro e recupero da crash

**Dipende da:** P07.

- [ ] **P08.1 — Macchina a stati del passaggio.** Implementare tutte le transizioni della sezione 5.4, con idempotenza e ripresa dopo restart. **Test `P08-I01`:** doppio click e retry dopo timeout creano una sola run successore.
- [ ] **P08.2 — Stop verificato.** Fermare provider e processi controllati, riconciliare output tardivi e trasferire ownership solo dopo i controlli. **Test `P08-I02`:** figlio che continua a scrivere blocca l'handoff sullo stesso worktree; nessun successore parte per la sola scadenza di un timer.
- [ ] **P08.3 — Passaggio volontario.** `Continua con Codex` da Claude e percorso inverso, con approvazione del contesto e permessi nuovi. **Test `P08-I03`:** successore legge obiettivo, piano, diff e test senza un messaggio aggiuntivo dell'utente; hash dei file invariati dal solo passaggio.
- [ ] **P08.4 — Rate limit o morte improvvisa.** Recuperare senza riassunto finale dell'agente precedente. **Test `P08-I04`:** fake adapter muore dopo una modifica e durante un test; task ripreso con esito test sconosciuto e verifica da ripetere, non completamento inventato.
- [ ] **P08.5 — Crash dell'app durante l'handoff.** Riavvio in ogni transizione, controllo processi e stato Git. **Test `P08-I05`:** fault injection non causa due writer, perdita di un checkpoint completo o ripetizione automatica di comandi esterni.
- [ ] **P08.6 — Prova reale a due agenti.** Eseguire la fixture Strata multi-repo con il primo agente, interromperlo e proseguire con il secondo. **Test `P08-I06`:** criteri della fixture superati dopo il passaggio; evidenze live registrate, senza fornire al successore un briefing manuale fuori da Lagoto.

**Gate centrale:** Claude Code → interruzione → Codex → verifiche completate nei tre repository. Ripetere anche il percorso inverso prima di dichiarare supporto bidirezionale.

## P09 — Quote, contesto e avanzamento verificato

**Dipende da:** P08. La UI predisposta in P02 viene ora collegata ai dati reali.

- [ ] **P09.1 — Provider di telemetria separati.** Implementare `UsageProvider` distinto da `AgentAdapter`; usare fonti documentate disponibili. Codex può partire dal metodo account documentato; gli altri restano capability-gated. **Test `P09-I01`:** dato presente, non supportato, auth scaduta e errore rete producono stati diversi senza interrompere il task.
- [ ] **P09.2 — Quote multi-finestra.** Mostrare finestra, residuo/usato non ambiguo, reset, fonte e timestamp; refresh con backoff e cache. **Test `P09-I02`:** dati assenti, stantii, reset cambiato, account cambiato e valori fuori intervallo non generano barre fuorvianti.
- [ ] **P09.3 — Contesto versus memoria persistente.** Indicatore contesto solo da misura valida; separato da checkpoint e dimensione stimata del pacchetto. **Test `P09-I03`:** alto numero di token cumulativi non implica contesto pieno; compattazione osservata aggiorna lo stato; dato non esposto resta assente.
- [ ] **P09.4 — Avanzamento basato su evidenze.** Contare criteri verificati sulla revisione corrente; distinguere piano dell'agente, test e approvazione umana. **Test `P09-I04`:** «ho finito» non chiude il task; modifica successiva invalida le verifiche pertinenti; criterio qualitativo richiede conferma umana.
- [ ] **P09.5 — Mancante alla consegna.** Mostrare fase corrente e prossimi passi: ad esempio `4/6 criteri; manca contratto API e revisione desktop`. Nessun countdown affidabile inventato. **Test `P09-I05`:** aggiunta di un requisito cambia il denominatore con spiegazione; test non eseguiti non appaiono superati.
- [ ] **P09.6 — Avvisi e scelta del successore.** Soglie configurabili solo su misure valide; avviso non invasivo e `Continua con…`. **Test `P09-I06`:** avviso una sola volta per soglia/finestra, nessun cambio automatico, nessun consumo extra o promessa che il successore abbia abbastanza quota per finire.

**Gate:** dalla vista principale si capiscono agente attivo, lavoro corrente e stato del salvataggio; quote e contesto sono accessibili senza aprire app esterne quando disponibili, e la loro assenza è esplicita.

## P10 — Cursor e subagent osservabili

**Dipende da:** P09.

- [ ] **P10.1 — Cursor ACP adapter.** Implementare handshake, sessione, aggiornamenti e richieste permesso della versione verificata. **Test `P10-I01`:** suite contrattuale e smoke live su repo di prova; capability assenti non diventano controlli funzionanti solo graficamente.
- [ ] **P10.2 — Passaggi con Cursor.** Riutilizzare la stessa macchina a stati e il Context Pack, senza percorso speciale che salta la sicurezza. **Test `P10-I02`:** fixture di handoff Claude→Cursor, Cursor→Codex e Codex→Cursor; smoke live per i percorsi dichiarati supportati.
- [ ] **P10.3 — Albero dei figli esposti.** Associare eventi parent/child quando il provider li fornisce; mostrare `visibilità parziale` quando necessario. **Test `P10-I03`:** child completato, attivo e senza esito; nessun figlio inventato a partire da frasi della chat.
- [ ] **P10.4 — Risultati dei subagent nel checkpoint.** Salvare deliverable osservati, riferimenti e verifiche, mantenendo provenienza e versione dei file. **Test `P10-I04`:** il parent muore dopo un risultato del figlio → il risultato persistito resta disponibile; un risultato non ricevuto viene segnalato come mancante.
- [ ] **P10.5 — Stop e limiti dei figli.** Consentire controllo individuale o limite di spawn solo se realmente applicabile; altrimenti stop globale o blocco motivato. **Test `P10-I05`:** capability assente → nessun bottone che dichiari di aver fermato un figlio; handoff bloccato se resta uno scrittore.
- [ ] **P10.6 — Consumi senza doppio conteggio.** Tenere separati dati aggregati e dettaglio dei figli, con unità e scope. **Test `P10-I06`:** consumo già incluso nel parent non viene sommato nuovamente; costo per figlio sconosciuto resta sconosciuto.

**Gate:** tre agenti selezionabili e handoff verificati per i percorsi dichiarati. Non è richiesta orchestrazione autonoma di gruppi di agenti.

## P11 — Revisione, consegna, export e backup

**Dipende da:** P10.

- [ ] **P11.1 — Diff multi-repository.** Pannello con file, staged/unstaged, binari, test associati e apertura nell'editor esterno. **Test `P11-I01`:** confronto con Git sulla fixture; nessun file modificato omesso silenziosamente.
- [ ] **P11.2 — Revisione finale.** Stato `pronto per revisione` distinto da `completato`; checklist finale approvata dall'utente. **Test `P11-I02`:** criterio non verificato o test obsoleto impedisce chiusura automatica; eventuale deroga umana è esplicita e tracciata.
- [ ] **P11.3 — Commit e consegna espliciti.** Preparare messaggio e riepilogo per repository; commit/push solo su azione dell'utente. **Test `P11-I03`:** errore sul secondo repository non viene presentato come consegna atomica dei tre; nessuna riscrittura di storia o force push automatici.
- [ ] **P11.4 — Export del lavoro.** Esportare Markdown/JSON di task, decisioni, piano, verifiche e manifest; anteprima e redazione. **Test `P11-I04`:** export reimportabile in istanza di prova, senza credenziali, account completi o segreti esclusi.
- [ ] **P11.5 — Backup consistente.** Salvare database e artefatti con manifest e checksum, usando un meccanismo SQLite consistente; ripristino in directory nuova. **Test `P11-I05`:** restore da backup durante attività controllata senza riferimenti mancanti; checksum errato impedisce un falso successo.
- [ ] **P11.6 — Retention e spazio disco.** Budget locale, cleanup selettivo e protezione dei checkpoint referenziati da task attivi; mai cancellazione di worktree sporchi in automatico. **Test `P11-I06`:** pressione disco e garbage collection non eliminano l'ultimo checkpoint recuperabile né file dell'utente.

**Gate:** il lavoro può essere revisionato, consegnato e recuperato senza dipendere da una chat o da un unico database non verificato.

## P12 — Affidabilità e validazione quotidiana

**Dipende da:** P11.

- [ ] **P12.1 — Pacchetto installabile.** Build macOS con runtime, migrazioni e asset necessari; CLI esterni rilevati e guidati, non scaricati/eseguiti di nascosto. **Test `P12-I01`:** avvio da Finder in ambiente pulito; percorsi con spazi; installazione aggiornata preserva dati e configurazione. Firma/notarizzazione previste prima della distribuzione esterna.
- [ ] **P12.2 — Crash, sleep e riconciliazione.** Gestire spegnimento backend, chiusura app, rete intermittente e riattivazione del Mac. **Test `P12-I02`:** stato processi riconciliato prima di nuova run; nessun badge `in esecuzione` mantenuto senza evidenza; nessuna auto-ripetizione pericolosa.
- [ ] **P12.3 — Test di carico locale.** Fixture con 50 progetti, 1.000 task e 100.000 eventi; virtualizzazione e caricamento incrementale. **Test `P12-I03`:** p95 di cambio task sotto 300 ms dopo avvio a caldo sul Mac di riferimento, esclusa inferenza; nessuna lettura integrale obbligatoria dei log. Registrare misura e macchina, non presentarla come benchmark universale.
- [ ] **P12.4 — Audit dei confini.** Verificare input non fidati, repo hook/config, MCP, percorsi, export e permessi OS; mostrare le concessioni dell'agente. **Test `P12-I04`:** fixture di prompt injection e traversal non ottengono azioni dal bridge senza autorizzazione; eventuali limiti del CLI o della sandbox sono documentati.
- [ ] **P12.5 — Matrice di regressione.** Eseguire tutti i gate, fixture di fault injection e smoke live per versioni dichiarate compatibili. **Test `P12-I05`:** modifica incompatibile di uno schema provider viene rilevata; nessun aggiornamento CLI viene dichiarato supportato senza verifica.
- [ ] **P12.6 — Uso personale controllato.** Usare Lagoto per cinque sessioni di lavoro, registrando almeno cinque passaggi agente, uno durante un test e uno dopo riavvio. **Test `P12-I06`:** nessuna perdita dei file inclusi nei checkpoint, nessun doppio writer avviato da Lagoto, nessuna quota inventata; registrare eventuale briefing manuale necessario e correggerne la causa prima del rilascio MVP.

**Gate:** MVP utilizzabile quotidianamente sul Mac di riferimento, con limitazioni note pubblicate e senza dipendere da funzionalità dimostrate soltanto con mock.

## 7. Fixture principale: Strata, tre repository

Creare tre piccoli repository Git di test indipendenti, non tre cartelle spacciate per repository. I dati sono sintetici.

**Backend:** endpoint che restituisce uno stato di sessione con un caso concorrente difettoso.  
**Frontend:** client che deve gestire la nuova risposta e l'errore senza loop.  
**Desktop:** client che condivide il contratto e deve mostrare correttamente lo stato.

I criteri di accettazione includono comportamento del backend, compatibilità del contratto, gestione frontend, gestione desktop, verifiche di regressione e revisione finale. Il task ha un piano confermato prima dell'esecuzione.

### Scenari obbligatori

| Scenario | Evidenza attesa |
| --- | --- |
| Interruzione dopo modifica, prima del test | Modifica recuperata; nessun test dichiarato eseguito |
| Interruzione durante il test | Output parziale conservato; esito sconosciuto; verifica da ripetere |
| Limite quota simulato senza summary finale | Context Pack generato localmente e handoff disponibile |
| Figlio ancora scrivente | Passaggio sullo stesso worktree bloccato |
| Crash durante salvataggio | Checkpoint precedente valido; nuovo incompleto non presentato come pronto |
| Modifica esterna dopo test riuscito | Verifica invalidata o richiede riconciliazione |
| Successore con modello/capability diversa | Selettori coerenti, permessi riesaminati, pacchetto adattato |
| Terzo repository non disponibile | Task bloccato con motivazione, non completamento parziale nascosto |
| Cambio provider con dati sensibili esclusi | Anteprima esplicita e nessun invio automatico degli esclusi |
| Ultimo task marcato completo dall'agente | Chiusura subordinata alle evidenze e alla revisione umana |

La prova live non garantisce che qualunque modello risolva qualunque task. Deve verificare che Lagoto trasferisca correttamente il lavoro e distingua errori dell'infrastruttura da difficoltà del modello.

## 8. Definition of Done generale

Una checkbox si può spuntare solo quando esistono implementazione, test associato, evidenza dell'esecuzione e gestione del caso di errore. Un test con mock non sostituisce lo smoke live dove richiesto. Un test UI nel browser non sostituisce il test del bridge o del pacchetto nativo.

Una fase richiede inoltre typecheck/lint/build verdi, regressioni precedenti verdi, documentazione aggiornata e nessun segreto negli artefatti. Una voce bloccata va lasciata aperta con motivo e dipendenza; non si elimina il test per chiudere la fase.

```markdown
# Evidence Pxx
- Commit verificato:
- Sistema operativo e architettura:
- Runtime / Git / versioni CLI:
- Test richiesti ed esiti:
- Comandi eseguiti:
- Artefatti sanitizzati:
- Smoke live / approvazione UX, quando richiesti:
- Casi di errore provati:
- Limitazioni residue:
- Esito gate: passed | blocked | failed
```

**Criterio finale di prodotto:** apro Strata, capisco chi sta lavorando, che cosa manca e che cosa è stato salvato; interrompo un agente e continuo con un altro senza ricostruire manualmente lo stato verificabile del task.

## 9. Cosa non costruire nel primo MVP

Escludere cloud sync, multiutenza, billing, marketplace, routing autonomo, swarm concorrenti scriventi, editor completo, schedulazioni remote, analytics invasivi e memorie vettoriali generiche. Non aggiungere workspace per accomodare dettagli interni.

Non importare automaticamente tutte le conversazioni storiche dei provider: iniziare dai task eseguiti in Lagoto. Non tentare di controllare agenti già avviati fuori dall'app come se fossero supervisionati. Un'importazione successiva deve distinguere dati recuperati e capacità di controllo effettive.

Sono estensioni possibili dopo l'uso reale: più provider, import guidato di cronologie, subtask paralleli su worktree separati, handoff automatico con consenso preventivo, ulteriori piattaforme desktop e ricerca semantica mirata. Nessuna è una dipendenza per dimostrare il caso centrale.

## 10. Rischi e decisioni operative

| Rischio | Decisione |
| --- | --- |
| Quote non esposte o endpoint instabili | Capability opzionale; dato assente e collegamento al provider; niente dipendenza obbligatoria da scraping privato |
| CLI o protocollo cambiano | Versioni rilevate, fixture versionate, smoke live e compatibilità dichiarata |
| Riassunto incompleto | Journal + file + verifiche + Context Pack deterministico; summary solo opzionale |
| Scrittore sopravvive al passaggio | Stop verificato; blocco o recupero isolato; nessun affidamento al solo lock |
| Test non più validi | Fingerprint del codice e invalidazione delle evidenze |
| Piano scambiato per progresso | Criteri confermati e prove; nessuna stima di tempo resa certa |
| Snapshot troppo grandi | Artefatti incrementali, esclusioni visibili, retention e budget disco |
| Segreti nel contesto o nei log | Minimizzazione, redazione, anteprima e scope del nuovo provider |
| Packaging rallenta il progetto | Spike P00 prima dello sviluppo; alternativa motivata con ADR, non cambio silenzioso dello stack |
| UI diventa rumorosa | Vista principale minima; dettagli nell'inspector; un solo avviso prioritario |

## 11. Fonti tecniche e verifica delle assunzioni

Documentazione primaria consultata il **28 settembre 2026**. Le fonti descrivono punti di integrazione e vincoli; le scelte architetturali e i gate sopra sono la specifica proposta per Lagoto. Le capability effettive vanno confermate sulle versioni installate durante P00/P06/P10.

- **[S1] Claude Code — esecuzione programmatica:** https://code.claude.com/docs/en/headless
- **[S2] OpenAI — Codex App Server:** https://developers.openai.com/codex/app-server/ — la documentazione consultata reindirizza a https://learn.chatgpt.com/docs/app-server
- **[S3] Cursor — ACP:** https://cursor.com/docs/cli/acp
- **[S4] Agent Client Protocol — overview e capability opzionali:** https://agentclientprotocol.com/protocol/v1/overview
- **[S5] Anthropic — autenticazione e condizioni d'uso di Claude Code:** https://code.claude.com/docs/en/legal-and-compliance — per l'SDK: https://code.claude.com/docs/en/agent-sdk/quickstart
- **[S6] Tauri — sidecar:** https://v2.tauri.app/develop/sidecar/
- **[S7] Tauri — Node.js come sidecar:** https://v2.tauri.app/learn/sidecar-nodejs/
- **[S8] Tauri — test WebDriver:** https://v2.tauri.app/develop/tests/webdriver/
- **[S9] Tauri — modello di sicurezza:** https://v2.tauri.app/security/
- **[S10] Git — worktree:** https://git-scm.com/docs/git-worktree

**Nota per l'agente che implementerà:** prima di aggiungere una dipendenza o dichiarare una capability, controllare documentazione e licenza correnti. Non implementare API dedotte dai nomi negli esempi e non spuntare questa roadmap sulla base di una spiegazione testuale del modello.
