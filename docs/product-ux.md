# Prodotto e UX

**Stato:** comportamento pianificato · **Aggiornamento:** 28 settembre 2026.

## Un percorso semplice

Lagoto dovrà permettere di aggiungere i propri servizi, capire quali modelli sono utilizzabili oggi, lavorare su uno o più repository e continuare con un altro modello dal lavoro salvato. La prima destinazione è macOS personale. La sidebar avrà **Progetti**, **Integrazioni** e **Modelli disponibili**: nessun livello aggiuntivo workspace o organization.

| Area | Vista principale | Dettagli su richiesta |
| --- | --- | --- |
| Progetti | Progetti espandibili, task, conversazione, modifiche e verifiche | Repository, worktree, checkpoint, run, decisioni e prove |
| Integrazioni | Aggiungi servizio; stato account; modelli abilitati | Login/API key, endpoint, piano, rinnovo, budget, fonte e freschezza delle misure; GitHub |
| Modelli disponibili | Nome, cloud/locale, batteria di oggi, disponibilità e prossimo reset pertinente | Pool condivisi, quota del provider, contesto, runtime, costo e capacità realmente esposte |

Il modello è la scelta comprensibile all’utente; il runtime che lo esegue appare nei dettagli e quando serve disambiguare due percorsi. Due accessi allo stesso modello con account o prezzi differenti rimangono due profili distinguibili. I nomi commerciali non identificano da soli la quota.

## 1. Collegare integrazioni

`Aggiungi integrazione` → provider o runtime locale → percorso di accesso supportato → verifica dello stato → piano e rinnovo → budget → modelli abilitati.

Per il login nativo si apre il flusso ufficiale; per API si inserisce una chiave vincolata al relativo endpoint; per Ollama si configura un server locale. Il piano si rileva automaticamente solo quando esiste una fonte documentata. Altrimenti si chiede una volta e si conserva l’origine manuale. Prezzo della subscription e crediti API sono campi distinti.

Il budget numerico abilita il calcolo fino al rinnovo. Se il piano è opaco, l’utente può impostare un budget personale iniziale nella metrica osservabile oppure attendere la calibrazione. La configurazione iniziale deve spiegare cosa verrà misurato, senza chiedere di convertire un prezzo in token. [Regole della batteria](daily-battery.md).

GitHub compare nella stessa area come integrazione per i repository. Non riceve una batteria per inferenza e non richiede un account Lagoto. Credenziali e stato di accesso sono gestiti secondo [Integrazioni](integrations.md) e [GitHub](github.md).

## 2. Scegliere un modello disponibile

Esempi puramente illustrativi di righe:

| Profilo | Indicatore principale | Disponibilità |
| --- | --- | --- |
| Modello cloud A | 60% oggi · budget personale | Disponibile · assegnazione domani |
| Modello cloud B, stesso pool | 60% oggi · condiviso con A | Disponibile |
| Modello cloud C | In calibrazione | Quota provider non disponibile |
| Modello locale D | Locale · disponibile | Server pronto |
| Modello cloud E | 80% oggi | Limite provider raggiunto · reset alle 17:00 |

La riga E chiarisce che budget personale e disponibilità effettiva sono dimensioni diverse. L’inspector distingue reset della quota, rinnovo del piano e nuova assegnazione giornaliera. Nessuna barra unica somma provider o valute differenti. Il termine “stimato” resta visibile anche nella vista compatta quando si applica.

Avvisi al 20% e al 10%, una sola volta per soglia e assegnazione. Allo 0% Lagoto impedirà nuovi turni, richiederà stop al primo punto sicuro e salverà il contesto. Le azioni saranno `Continua con…`, `Deroga per oggi` e `Resta in pausa`. Nessuna scelta predefinita avvierà una chiamata a pagamento o cambierà modello/account. Una deroga ha importo e scadenza espliciti e non supera i limiti reali del provider.

## 3. Aggiungere una cartella e lavorare

`Nuovo progetto` o `Aggiungi cartella` → rilevamento del percorso e di Git → collegamento GitHub univoco, oppure proposta pronta → scelta dei repository del task → messaggio iniziale → modello → nuova run.

Una cartella non Git è accettata come candidata. La UI propone la preparazione descritta in [GitHub](github.md), oppure l’inizializzazione solo locale: il task scrivente parte quando almeno un repository è pronto. Scegliere una cartella non autorizza da solo a caricarla in rete.

Un progetto può contenere backend, frontend e desktop come repository separati. Ogni task sceglie quelli coinvolti. Le directory originali restano protette dalla preparazione dei worktree; eventuali modifiche preesistenti vengono rilevate e possono essere copiate selettivamente.

`Continua questo lavoro in una nuova chat` mantiene task e worktree; `Nuovo lavoro` crea un task indipendente. La timeline separa le run, senza costringere a cambiare finestra. Fine turno, fine run e completamento del task sono stati distinti.

## 4. Cambiare modello

`Continua con…` → stop verificato → checkpoint → scelta del successore e anteprima dei dati da inviare → avvio di una nuova run sullo stesso task.

L’anteprima espone obiettivo, decisioni, stato dei file, verifiche valide, azioni incerte, lacune e permessi. Può mostrare che il nuovo modello ha meno contesto o strumenti differenti. Se mancano capacità obbligatorie, non propone una continuità fittizia: blocca l’avvio e spiega il requisito mancante. La conferma autorizza quel destinatario e quel contesto; non tutti i provider futuri.

Se un processo scrivente sopravvive, il passaggio sullo stesso worktree resta bloccato. Dopo un crash si mostrano stato riconciliato, ultimo checkpoint valido ed eventuali file successivi, senza rollback o ripetizioni automatiche di azioni esterne.

## 5. Revisionare e consegnare

Diff e verifiche per repository → contenuti selezionati → messaggio di commit → destinazione → azione esplicita di consegna. Creazione iniziale GitHub e consegne successive sono due flussi distinti. Uno stato “pronto per revisione” non equivale a “completato”; ogni criterio deve avere una prova valida o una deroga umana tracciata.

## Layout e accessibilità

Conservare il riferimento iniziale sobrio: sidebar circa 244 px ridimensionabile, composer massimo circa 740 px, font di sistema, spaziatura 4/8/12/16/24, bordi discreti. Sono scelte iniziali, non misure estratte da altri prodotti. Inspector destro chiuso di default; terminale, diff e prove sono pannelli richiamabili.

Verificare 1280×800 e 1568×984, tema leggibile, tastiera completa, focus visibile e stato espresso anche con testo. Massimo tre chip operativi sopra il composer e un solo avviso prioritario. Non forzare lo scroll mentre l’utente legge lo storico.

| Misura | Significato da comunicare |
| --- | --- |
| Batteria | Budget residuo di oggi; stimato o numerico secondo la fonte |
| Quota provider | Limite account e relativa finestra, se esposto |
| Contesto modello | Occupazione effettiva solo se misurata; altrimenti dato assente |
| Memoria persistente | Checkpoint salvato, lacune ed esclusioni |
| Avanzamento | Criteri verificati sulla revisione corrente, per esempio 4/6 |

Accettazione: P02 verifica navigazione e stati; P03 cartelle/task; P06 integrazioni; P08 passaggi; P09 batterie; P11 consegna. Gli scenari completi sono in [Validazione](validation.md).
