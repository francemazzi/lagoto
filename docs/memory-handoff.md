# Memoria, contesto e passaggio fra modelli

**Stato:** specifica da implementare · **Aggiornamento:** 28 settembre 2026.

La continuità significa recuperare file e stato osservabile: obiettivo, istruzioni confermate, decisioni, repository, verifiche e azioni aperte. Non significa trasferire ragionamento interno, KV-cache o una sessione proprietaria fra provider.

## Quattro livelli

| Livello | Contenuti | Regola |
| --- | --- | --- |
| Archivio | Eventi ricevuti, file, diff e output completi consentiti | Recuperabile localmente; non inserito integralmente nel prompt |
| Stato del task | Obiettivo, criteri, piano vigente, decisioni, prove e azioni | Versionato e distinto dalle dichiarazioni dell’agente |
| Memoria operativa | Convenzioni, fatti e problemi pertinenti al repository | Elementi atomici con origine, revisione e validità |
| Context Pack | Informazioni consegnate a una specifica run/modello | Deterministico, selettivo, adattato al destinatario e registrato |

Ogni `MemoryItem` include ID, contenuto, autore/sorgente, evidenze, scope progetto/task/repository, revisione di riferimento, stato attivo/sostituito/da verificare, data e possibili trigger. I trigger iniziali sono percorsi, simboli ed eventi espliciti; recupero semantico è successivo e richiede una misura del beneficio.

Un log o un testo del repository resta non fidato anche dopo un riassunto. Non può diventare istruzione confermata solo perché un modello lo ha citato. Le correzioni sono incrementali e conservano ciò che sostituiscono. Un file rinominato, un contratto cambiato o una prova su una vecchia revisione invalidano gli elementi dipendenti.

## Checkpoint recuperabile

Ogni task ha un worktree per repository coinvolto. Il manifest multi-repository conserva base/HEAD, branch, stato dell’indice, staged/unstaged, untracked consentiti, cancellazioni, permessi supportati, binari, hash dei blob, esclusioni e fingerprint delle verifiche. Servono i byte per il recupero, non soltanto un diff visuale. Oggetti Git necessari vanno mantenuti raggiungibili tramite riferimenti privati o bundle quando opportuno. [Git worktree](https://git-scm.com/docs/git-worktree), consultato il 28 settembre 2026.

Gli artefatti vengono scritti e verificati prima della transazione che marca il manifest completo. Un errore disco/crash non deve lasciare un salvataggio completo con blob mancanti. Il manifest non è un commit Git atomico fra repository: elenca lo stato verificato di ciascuno e gli eventuali problemi.

Snapshot durante scritture attive sono best effort; checkpoint di handoff richiede stabilità dei writer controllati e scansione finale. Watcher, debounce e scadenza di un lock non dimostrano consistenza. Le modifiche successive al checkpoint vengono mostrate e riconciliate, senza rollback automatico.

File ignorati, segreti rilevati, dipendenze rigenerabili ed esclusioni configurate non vengono esportati automaticamente. L’utente vede cosa è incluso e cosa non è recuperabile. Checkpoint ed export non sono un backup integrale del Mac. Testare restore in una nuova directory con confronto byte e indice, compresi file binari.

## Costruzione del Context Pack

Ordine prioritario:

1. Obiettivo, criteri di accettazione e istruzioni confermate vigenti.
2. Repository autorizzati, ruoli e capacità richieste al successore.
3. Decisioni correnti, piano e azioni ancora aperte.
4. Checkpoint, revisione dei file e modifiche successive note.
5. Verifiche valide, fallite, interrotte o da ripetere; effetti esterni incerti.
6. File/diff pertinenti e memorie attivate dal lavoro corrente.
7. Ipotesi, rischi e riferimenti agli artefatti consultabili su richiesta.

Il nucleo deve essere costruibile senza inferenza, anche con quota cloud esaurita. Un riassunto opzionale non sostituisce istruzioni, prove o file. La scelta dei contenuti e l’ordinamento devono essere ripetibili a parità di stato, policy e profilo destinatario.

Il budget del pacchetto è la finestra effettiva del destinatario meno istruzioni del runtime, schemi dei tool, spazio per output/reasoning secondo il protocollo e margine operativo. Una finestra nominale non è interamente disponibile. Tokenizer ignoto → stima conservativa dichiarata; non percentuale di occupazione effettiva. Se il nucleo obbligatorio non entra, bloccare la partenza e proporre riduzione del perimetro, senza troncarlo silenziosamente.

Ottimizzare in questo ordine: riferimenti a output completi con estratti pertinenti, deduplicazione, ricerca lessicale/simboli, selezione per task, mascheramento di osservazioni vecchie, trigger mirati, riassunti facoltativi. Vecchi output restano nell’archivio; errori attivi e verifiche necessarie rimangono accessibili. Prompt caching è un’ottimizzazione eventuale del runtime, non memoria portabile.

Il pacchetto registra contenuto effettivamente consegnato, esclusioni, budget stimato, versione, destinatario ed evidenze. Dopo compattazione, reinserire vincoli solo attraverso hook documentati; se assenti, dichiarare visibilità parziale e usare il prossimo confine controllabile. Lagoto non riscrive il contesto interno di un harness opaco.

Queste scelte sono ispirate a [PACT](research.md#r02--pact), [ACE](research.md#r04--ace) e [observation masking](research.md#r03--the-complexity-trap). Non costituiscono una replica dei loro sistemi o risultati.

## Protocollo di handoff

```text
requested → stopping → reconciling → checkpointing
          → context_ready → awaiting_confirmation
          → starting_successor → completed

Qualsiasi fase: blocked / failed, con causa e percorso di recupero.
```

1. Persistire l’intenzione con chiave idempotente e bloccare nuove partenze sul task.
2. Interrompere il turno, poi chiudere la sessione quando richiesto; seguire il percorso documentato del runtime. Se occorre terminare forzatamente processi, presentare il motivo e gli effetti possibili.
3. Verificare cessazione dei writer noti, inclusi figli. Non basta un timeout, un PID senza start time o un flag `stopped` nella UI.
4. Riconciliare eventi tardivi, file, usage e azioni esterne. Un test iniziato senza risultato resta interrotto/incerto, mai superato.
5. Acquisire un checkpoint stabile e costruire il pacchetto per le capacità del successore.
6. Mostrare contenuti, lacune e destinatario; riesaminare i permessi. Le autorizzazioni restano valide solo entro il loro scope, senza ereditarne di più ampie.
7. Creare una sola nuova run, trasferire l’ownership applicativa e chiedere al successore di verificare lo stato iniziale.

Se sopravvive un writer non controllabile, bloccare lo stesso worktree e offrire recupero isolato da checkpoint. Il fencing blocca eventi vecchi nel backend, non scritture dirette sul disco. Un editor esterno può comunque modificare i file: riconciliare e invalidare le prove interessate.

## Effetti esterni

Un checkpoint non annulla una migrazione, un job remoto, una pubblicazione o un push. `ExternalAction` registra destinazione, request ID/idempotency key se supportata, intenzione/input redatto, autorizzazione, stato `prepared/started/confirmed/failed/unknown` e prova dell’esito.

Se manca la risposta, controllare lo stato remoto con un’operazione di lettura appropriata. Ripetere automaticamente soltanto se l’operazione è dimostrabilmente idempotente e ancora autorizzata; altrimenti mantenere `unknown` e richiedere una decisione. Il successore riceve l’incertezza, non un invito a eseguire di nuovo tutto. Il registro copre gli strumenti osservabili/mediati; eventuali azioni opache sono indicate come limite di visibilità.

## Comunicazione tra agenti

L’MVP non richiede una rete di agenti. Per handoff e futuri sottotask usare messaggi con azione richiesta, stato osservato, risultato/riferimenti, revisione, criteri, budget e vincoli. Separare un’affermazione da una verifica. Evitare il broadcast dell’intera conversazione e cicli di delega senza criterio di arresto.

ACP è un confine client–agente; A2A riguarda agenti, task e artefatti. Nessuno dei due garantisce da solo memoria condivisa, verità delle prove o semantica di quota. [Fonti dei protocolli](sources.md#protocolli-e-servizi-multi-agent). Eventuali specialisti futuri lavoreranno su sottotask separabili e worktree separati, con integrazione verificata da un unico responsabile.

Accettazione: P07–P08 e scenari `MEM-*`/`HAND-*` in [Validazione](validation.md), inclusi cloud → locale → cloud e riduzione della finestra.
