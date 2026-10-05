# ADR 0001 — Coordinatore locale e harness sostituibili

**Data:** 28 settembre 2026.
**Stato:** scelta progettuale accettata nel piano; fattibilità tecnica da verificare in P00.
**Ambito:** primo prodotto personale macOS. Nessuna implementazione attestata.

Aggiornamento del 5 ottobre 2026: [ADR 0002](0002-native-macos.md) sostituisce lo stack desktop Tauri/React/Prisma e rende Cursor obbligatorio. La scelta degli harness e i confini di responsabilità di questo documento restano validi.

## Contesto

Servono login nativi dei servizi, Qwen/Kimi cloud e modelli locali, con budget condivisi e continuità del lavoro. Un solo protocollo non uniforma autenticazione, quote, strumenti e memoria. Ricostruire un agente completo aumenterebbe il lavoro prima di dimostrare che il cambio modello conserva file e prove.

## Decisione

Lagoto conserva lo stato del task e coordina autorizzazioni, budget, processi, checkpoint e handoff. Il loop di inferenza/strumenti resta all’harness. Per Codex e Claude Code si integrano percorsi ufficiali; per Qwen cloud, Kimi API e Ollama si sceglie **Qwen Code SDK TypeScript**, incapsulato in un `AgentRuntimeAdapter` sostituibile.

La scelta si basa su provider configurabili e controllo programmatico coerente con il backend TypeScript. Lo SDK è sperimentale: documentazione e API non costituiscono una prova di stabilità. [SDK](https://qwenlm.github.io/qwen-code-docs/en/developers/sdk-typescript/) e [provider](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/model-providers/), consultati il 28 settembre 2026.

Si conserva Tauri/React/TypeScript/SQLite; packaging Node e Prisma rimangono gate. Il primo percorso Qwen usa il processo gestito dallo SDK, senza dipendenza dal daemon HTTP condiviso. Anche un daemon su loopback richiede un confine di autorità esplicito; non è un isolamento multiutente. [Qwen serve](https://qwenlm.github.io/qwen-code-docs/en/users/qwen-serve/), consultato il 28 settembre 2026.

## Alternative considerate

| Alternativa | Vantaggio potenziale | Motivo della scelta iniziale |
| --- | --- | --- |
| Loop proprietario su API compatibili | Controllo pieno del prompt e dei tool | Richiederebbe costruire e verificare planning, permessi, tool, recupero e compatibilità prima del prodotto |
| OpenCode SDK | Client TypeScript, sessioni e molti provider documentati | Alternativa plausibile; il percorso SDK documentato introduce client/server locale. Qwen è la scelta iniziale, non un vincitore dimostrato da benchmark |
| CLI nativo separato per ogni modello, incluso Kimi | Esperienza e login specifici del fornitore | Utile per subscription native, ma moltiplica gli adapter; iniziare Kimi via API riduce i percorsi da mantenere |
| Solo Codex/Claude Code | Meno integrazioni iniziali | Non copre l’obiettivo cloud API eterogeneo e locale del piano |
| Framework generale di orchestrazione o swarm | Workflow e delega estendibili | Non risolve da solo stato dei file, login e quota; aggiunge coordinamento senza una necessità MVP |
| Servizio multi-agent remoto, per esempio Grok | Delega interna al servizio | Visibilità e controllo limitati dalla superficie esposta; non sostituisce il registro locale di task ed effetti |

Fonti delle alternative: [OpenCode SDK](https://opencode.ai/docs/sdk/), [provider OpenCode](https://opencode.ai/docs/providers/), [Kimi CLI](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html), [Grok multi-agent](https://docs.x.ai/developers/model-capabilities/text/multi-agent), consultate il 28 settembre 2026. Le valutazioni della tabella sono decisioni di progetto, non prestazioni misurate.

## Condizioni obbligatorie

P00 deve provare eventi, permessi, interrupt/close, usage, isolamento di configurazione e credenziali, ripresa dopo errore e processo figlio sopravvissuto. Le prove coprono separatamente Qwen cloud, Kimi API e almeno un modello Ollama. Un successo su uno non certifica gli altri.

Una capability assente è un limite visibile. Se manca un requisito essenziale di accesso, controllo delle scritture o isolamento, quel percorso resta bloccato. Si documenta il fallimento e si revisiona questo ADR prima di adottare un’alternativa; nessuna sostituzione silenziosa. Telemetria di quota non disponibile, invece, è compatibile con un budget personale dichiaratamente stimato.

## Conseguenze

Il formato persistente del task non dipende dallo SDK. La sessione nativa può essere ripresa soltanto nel proprio runtime; il cambio harness crea una nuova run con un Context Pack. Gli aggiornamenti dei runtime richiedono contratti e prove versionate. Hook di contesto non esposti impediscono alcune ottimizzazioni durante la run: si parte da contesto iniziale e handoff, senza un secondo loop di compattazione concorrente.

L’MVP ha un solo writer per insieme di worktree. Subagent interni osservabili possono comparire più avanti, ma Lagoto non avvia uno swarm scrivente. Il costo totale e la correttezza del task guideranno evoluzioni successive, secondo la [ricerca](../research.md) e il [protocollo di valutazione](../validation.md).
