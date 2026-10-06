# Cartelle, Git e GitHub

**Stato:** implementazione e prove applicative parziali · **Aggiornamento:** 5 ottobre 2026. Il testo seguente conserva il contratto completo previsto; non tutti i casi sono accettati. [Avanzamento e limiti attuali](evidence/progress-2026-10-05.md).

Sono disponibili clone annullabile, collegamento della cartella, scelta del remote, ricollegamento dopo spostamento sullo stesso volume, inizializzazione Git locale selettiva e creazione privata del repository con ripresa del push. Il flusso iniziale attuale pubblica il branch già committato, preservando il WIP; per una cartella non Git si prepara prima il commit locale con anteprima e autore esplicito. La UI dei nuovi pannelli resta da collaudare sul Mac sbloccato.

Il servizio applicativo è stato provato su GitHub reale sia da repository esistente sia da cartella non Git, con errore di trasporto iniettato, riavvio e retry. Gli ID remoti restano gli stessi, indice e file locali restano invariati. I repository sintetici sono conservati privati e archiviati; non costituiscono il rilascio di Lagoto.

## Decisione iniziale

Per macOS personale usare Git e GitHub CLI attraverso il backend locale, con argomenti separati e output strutturato dove disponibile. GitHub compare in Integrazioni. L’autenticazione segue `gh auth login` e il credential store ufficiale; Lagoto non legge/esporta il token per riutilizzarlo altrove. La CLI può ricadere su un file in chiaro se il credential store non funziona: rilevare tale condizione senza stampare il segreto e richiedere riparazione del percorso sicuro prima di considerare pronta l’integrazione. [Manuale auth](https://cli.github.com/manual/gh_auth_login), consultato il 28 settembre 2026.

L’aggiunta di una cartella autorizza l’ispezione e il collegamento locale. La pubblicazione richiede la proposta concreta descritta sotto. Non installare Git/gh, fare login o creare risorse automaticamente durante il semplice rilevamento.

## Rilevamento della cartella

1. Risolvere il percorso canonico e controllare esistenza/accessibilità. Alias e symlink della stessa directory non creano duplicati.
2. Rilevare root Git, worktree e common Git directory, branch/HEAD, indice, modifiche e remote. Un sottofolder non è un nuovo repository; mostrare la root individuata.
3. Normalizzare remote GitHub SSH, forma SCP e HTTPS, rimuovendo `.git` e differenze sintattiche. Non esporre credenziali eventualmente presenti nell’URL. Il primo target è `github.com`; host Enterprise richiedono un profilo esplicito e un gate dedicato.
4. Risolvere identità e accessibilità del repository remoto con il percorso documentato, registrando host e ID stabile quando disponibili. Un remote rilevato offline è “collegamento da verificare”, non prova di accesso. [Manuale repo view](https://cli.github.com/manual/gh_repo_view), consultato il 28 settembre 2026.
5. Collegare automaticamente se i candidati convergono sullo stesso repository/account autorizzato. `origin` e `upstream` diversi non autorizzano una scelta arbitraria: presentare i candidati. Account multipli richiedono scelta soltanto se non già risolta dal profilo.

Deduplicare l’identità del repository mantenendo checkout/worktree distinti. Due cloni dello stesso remote non sono due provider né un unico percorso locale da sovrascrivere. Registrare origine e destinazione dei collegamenti; rinomina o spostamento della cartella richiedono ricollegamento, non creazione di una directory vuota.

## Casi iniziali

| Cartella | Comportamento previsto |
| --- | --- |
| Git con un remote GitHub univoco | Collegamento automatico, nessun commit/push |
| Git con due remote GitHub diversi | Scelta del repository da collegare; preservare entrambi |
| Git con remote non GitHub | Proposta di nuovo remote GitHub con nome libero, senza sostituire quello esistente |
| Git senza remote | Proposta di creazione privata e primo push |
| Non Git | Accettata come candidata; proposta GitHub o inizializzazione solo locale |
| Directory non valida, volume assente | Stato bloccato con possibilità di correggere il percorso |
| Detached HEAD, conflitti, submodule, LFS | Diagnosi e supporto esplicito o blocco motivato; nessuna conversione silenziosa |

Un repository locale pronto può essere usato senza GitHub. Una cartella non Git richiede almeno l’inizializzazione locale esplicita per partecipare ai task con worktree.

## Proposta “Crea e collega”

La proposta deve essere già completa prima del clic: cartella/root, account e proprietario, nome repo, visibilità **privata**, branch da inviare, remote che verrà aggiunto, file selezionati e ignorati, messaggio del commit necessario e cronologia già esistente che sarà pubblicata. Le impostazioni del proprietario possono vietare la creazione privata: segnalare il blocco senza passare a pubblico.

Prima della proposta, applicare `.gitignore`, esclusioni configurate e controllo di segreti nei contenuti destinati al caricamento. Un file ignorato ma già tracciato o un segreto nella cronologia richiede attenzione: escludere un file dal nuovo commit non lo rimuove dai commit precedenti. La scansione non è una garanzia di assenza di segreti; la preview deve rendere visibili storia e contenuti inclusi. Non riscrivere la storia automaticamente per correggerli.

Il clic autorizza soltanto l’operazione riepilogata:

1. Persistire intenzione e fingerprint di cartella, stato Git, selezione, destinazione e autorizzazione.
2. Inizializzare Git se necessario; richiedere identità autore se manca, senza inventarla né cambiare configurazioni globali.
3. Creare il commit dei soli contenuti approvati quando necessario. Con repository esistente non fare `git add -A` indiscriminato: preservare indice e modifiche fuori selezione, anche staged. Se non è possibile garantire la selezione, fermare la preparazione con motivo.
4. Creare il repository privato e aggiungere il remote scelto. Non sovrascrivere un `origin` già configurato.
5. Fare il primo push del branch approvato e verificare destinazione e commit remoto prima di dichiarare concluso il collegamento.

`gh repo create` documenta sorgente locale, visibilità privata e push. La sequenza sarà gestita come passi durevoli separati per rendere recuperabili gli errori. [Manuale creazione](https://cli.github.com/manual/gh_repo_create), consultato il 28 settembre 2026.

Se i file, l’indice o la destinazione cambiano dopo la preview, invalidare la parte interessata della proposta e rigenerarla. Hook Git che possono eseguire codice devono essere dichiarati e gestiti nel confine di autorizzazione; la selezione del folder non autorizza installazioni o script arbitrari.

## Errori parziali e idempotenza

`GitHubLinkOperation` registra gli stati `prepared`, `local_ready`, `commit_ready`, `remote_created`, `remote_linked`, `pushed`, `verified`, oltre a `failed/unknown`. Un doppio clic non crea due operazioni.

| Errore | Ripresa prevista |
| --- | --- |
| Login annullato o account senza permessi | Conservare la proposta, mostrare causa e azione di accesso; nessun fallback ad altro account |
| Nome già occupato | Verificare se è il repo dell’operazione precedente; altrimenti proporre altro nome |
| Repo remoto creato, push fallito | Conservare ID/URL e commit locale; verificare stato remoto e ritentare soltanto il push autorizzato |
| Timeout dopo creazione o push | Stato incerto; query di riconciliazione prima di ripetere |
| Errore dopo commit locale | Conservare commit e lavoro; nessun reset o cancellazione automatica |
| Nuovi cambiamenti prima del retry | Nuova preview se cambiano contenuti/branch/destinazione; non ampliare l’autorizzazione precedente |

Non eliminare automaticamente un repository remoto per “ripulire” un errore. Nessun force push, merge o riscrittura di cronologia impliciti. Conservare i remoti e le modifiche preesistenti; un successo parziale non viene mostrato come completamento totale.

## Consegne successive

Commit e push successivi sono azioni esplicite per repository, con diff e verifica della destinazione. La creazione iniziale non attiva sincronizzazione continua. Nei task multi-repository la consegna può riuscire soltanto su alcuni repo: indicare l’esito di ciascuno e consentire ripresa idempotente, senza fingere una transazione Git atomica.

Accettazione: P00.7 fattibilità, P03 rilevamento/proposta/primo collegamento, P11 consegna. Scenari `GH-*` in [Validazione](validation.md). La copertura parziale sopra descritta non chiude questi gate.
