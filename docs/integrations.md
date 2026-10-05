# Integrazioni, modelli e accesso

**Stato:** specifica e adapter sperimentali; smoke positivi limitati alle combinazioni nel [report](evidence/implementation-2026-10-05.md). Nessun gate completo.

## Separare cinque dimensioni

Provider di inferenza, modello, harness, account e telemetria sono componenti diversi. “Qwen” può identificare un modello cloud, un modello locale o l’harness Qwen Code; la UI deve conservare questa distinzione nel profilo. “Kimi” non implica che una subscription Kimi Code possa pagare richieste API Moonshot.

Ogni run registra harness/versione, endpoint, profilo account opaco, modello richiesto e risolto, modalità, permessi, finestra configurata, tokenizer e quantizzazione se noti. Se il modello effettivo non è riportato, rimane non verificato. Non sostituirlo silenziosamente dopo un errore.

| Percorso pianificato | Accesso | Responsabile dell’esecuzione | Gate |
| --- | --- | --- | --- |
| Codex | Login/sessione nel percorso ufficiale; API separata se configurata | Codex App Server su stdio | P00, P06 |
| Claude Code | Binario ufficiale con login nativo dell’utente | CLI ufficiale e stream documentato | P00, P06 |
| Qwen cloud | Piano/endpoint ModelStudio compatibile o API configurata | Qwen Code SDK dietro adapter | P00, P06 |
| Kimi cloud | API Moonshot con credenziale e piano propri | Qwen Code SDK dietro adapter | P00, P06 |
| Modello locale | Server Ollama e modello disponibile sul Mac | Qwen Code SDK + Ollama | P00, P06 |
| Endpoint personalizzato | Configurazione avanzata, credenziale vincolata alla destinazione | Adapter Qwen, solo combinazioni provate | Dopo gate specifico, senza garanzia universale |
| Cursor | Autenticazione CLI e ACP documentati | Adapter ACP stdio obbligatorio nella beta | P00, P10 |
| Kimi Code nativo / Grok multi-agent | Percorsi distinti da studiare se richiesti | Eventuale adapter futuro | Fuori dall’MVP iniziale |

Le fonti per i percorsi sopra sono nel [registro tecnico](sources.md). La [matrice di compatibilità](compatibility.md) conserva lo stato non verificato finché manca evidenza sulla combinazione esatta.

## Autenticazione e credenziali

Lagoto avvia i flussi ufficiali senza estrarre cookie o token da altri client. Le API key gestite dall’app sono salvate nel Keychain; database, log, Context Pack ed export contengono soltanto riferimenti opachi. I segreti dei login nativi restano al tool ufficiale. Il flusso deve distinguere accesso assente, scaduto, annullato e revocato.

Non ereditare tutte le variabili d’ambiente nei processi figli. L’adapter deve filtrare l’ambiente e provare l’isolamento anche quando lo SDK unisce le opzioni all’ambiente del processo chiamante. Configurazioni personali, MCP, plugin, permessi permissivi e comunicazioni fra sessioni dell’harness non devono diventare attivi implicitamente nel profilo Lagoto.

Account, segreto ed endpoint sono un insieme vincolato. Modificare destinazione o regione invalida la precedente associazione finché non viene confermata la nuova. Login fallito non autorizza fallback da subscription ad API, cambio account o acquisto. Il refresh di una stessa identità è coordinato per evitare race; il logout blocca nuove run e gestisce quelle attive con stop dichiarato.

Per Claude Code, il percorso selezionato è il binario ufficiale con autenticazione propria dell’utente. La documentazione distingue questo utilizzo dalla raccolta o intermediazione di credenziali OAuth in applicazioni terze; verificare termini e distribuzione in P00, senza costruire un login alternativo. [Fonte Anthropic](https://code.claude.com/docs/en/legal-and-compliance), consultata il 28 settembre 2026.

## Vincoli specifici da verificare

**Qwen Code.** Lo SDK TypeScript è dichiarato sperimentale; documenta un CLI incluso e richiede Node.js almeno 22. Le superfici di interruzione, permessi, streaming e usage vanno provate nella versione fissata. Le modalità permissive e le allowlist di auto-approvazione non sono una sandbox. `interrupt` del turno e chiusura della sessione sono operazioni diverse. [SDK ufficiale](https://qwenlm.github.io/qwen-code-docs/en/developers/sdk-typescript/), consultato il 28 settembre 2026.

La pagina corrente di autenticazione segnala la fine del free tier Qwen OAuth dal 15 aprile 2026; alcune configurazioni/esempi conservano nomi OAuth. Per onboarding e piani prevale la pagina auth corrente, senza promettere un’offerta legacy. [Autenticazione](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/), consultata il 28 settembre 2026.

**Kimi.** Il servizio gestito Kimi Code usa un percorso distinto dall’API Moonshot: gli endpoint documentati includono `https://api.kimi.com/coding/v1` e `https://api.moonshot.ai/v1`. Credenziali, prodotto e quota non sono intercambiabili. La scelta iniziale di Lagoto riguarda Kimi tramite API; ACP del CLI nativo è un’alternativa futura. [Variabili di Kimi](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/env-vars.html) e [CLI](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html), consultati il 28 settembre 2026.

**Locale.** La compatibilità OpenAI di Ollama copre una parte dell’API. `localhost` non dimostra inferenza offline: il server può esporre anche modelli cloud. Il profilo “Locale” deve identificare modello e destinazione effettivi. Contesto e parallelismo aumentano l’uso di memoria; caricamento, coda e inferenza richiedono timeout distinti. [Compatibilità](https://docs.ollama.com/api/openai-compatibility) e [FAQ](https://docs.ollama.com/faq), consultate il 28 settembre 2026.

Default progettuale: una generazione locale attiva per profilo, senza scaricare modelli o avviare server installati altrove di nascosto. Se il server è esterno a Lagoto, non terminarlo globalmente per fermare una richiesta. Il test offline comprende inferenza, tool, embedding e telemetria; una tool call di rete resta un’operazione online anche con inferenza locale.

## Telemetria e batteria

`UsageProvider` è separato dall’esecuzione. L’assenza di una quota non deve impedire il recupero del task. I cataloghi modelli sono rilevati quando documentati, altrimenti configurati e validati; un nome inserito manualmente non certifica tool calling o dimensione del contesto.

Codex documenta `account/rateLimits/read`, con bucket in `rateLimitsByLimitId`, percentuale usata, durata della finestra e reset; `planType` può essere disponibile. Queste sono misure account. L’eventuale usage giornaliero non è un’entitlement di token. Login ChatGPT e API key non garantiscono la stessa telemetria. [App Server](https://learn.chatgpt.com/docs/app-server), consultato il 28 settembre 2026.

Per le altre integrazioni non si presume un endpoint quota utilizzabile: P00 verifica una fonte documentata. In assenza, la quota resta non disponibile e la batteria usa la politica personale descritta in [Batteria giornaliera](daily-battery.md). Nessuna dipendenza obbligatoria da scraping di dashboard o endpoint privati.

## Capability probe P00

Per ogni combinazione harness × versione × modello × endpoint, provare: autenticazione e revoca; messaggio/stream; lettura e modifica autorizzata della fixture; tool call e rifiuto permesso; cancellazione del turno e chiusura; figli osservabili; usage e semantica dei contatori; configurazione isolata; errore/restart e resume ove supportato; contesto ridotto e directory multiple. Un probe senza credenziali può provare l’errore di accesso, non l’integrazione riuscita.

Catalogo, piano o prezzo cambiati richiedono aggiornamento della fonte e riconciliazione esplicita. Le versioni non provate appaiono come tali. Il fallimento del gate Qwen blocca quel percorso e richiede revisione dell’ADR; non attiva un harness alternativo automaticamente.
