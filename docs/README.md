# Documentazione di Lagoto

**Versione:** 0.3 · **Data:** 5 ottobre 2026 · **Stato:** specifica approvata e implementazione parziale. [Report](evidence/implementation-2026-10-05.md).

Il percorso previsto è: **collegare integrazioni → scegliere un modello disponibile → lavorare → cambiare modello conservando lo stato → consegnare su GitHub**. Le funzionalità descritte costituiscono i requisiti; il report distingue le parti realizzate dalle prove ancora mancanti. Gli esempi sono sintetici; nessun importo o piano rappresenta i consumi personali dell’utente.

## Percorso di lettura

| Documento | Contenuto |
| --- | --- |
| [Roadmap P00–P12](../ROADMAP.md) | Ordine di sviluppo, dipendenze, requisiti e gate |
| [Prodotto e UX](product-ux.md) | Tre aree, onboarding, flussi e stati visibili |
| [Architettura](architecture.md) | Responsabilità, contratti, persistenza e confini |
| [ADR 0002](adr/0002-native-macos.md) | SwiftUI, Node incluso, better-sqlite3 e Cursor obbligatorio |
| [ADR 0001](adr/0001-runtime-and-adapters.md) | Scelta dell’harness, alternative e condizioni di validazione |
| [Integrazioni](integrations.md) | Login, API, cloud, locale, capacità e telemetria |
| [Compatibilità](compatibility.md) | Matrice iniziale: documentato, da provare, non verificato |
| [Batteria giornaliera](daily-battery.md) | Formula, cicli, quote condivise, stime ed esempi |
| [Memoria e handoff](memory-handoff.md) | Checkpoint, Context Pack, recupero ed effetti esterni |
| [GitHub e cartelle](github.md) | Riconoscimento, collegamento e pubblicazione esplicita |
| [Ricerca scientifica](research.md) | Paper e preprint: risultati, limiti e decisioni |
| [Fonti tecniche](sources.md) | Documentazione dei produttori e protocolli, consultata il 28 settembre 2026 |
| [Validazione](validation.md) | Scenari, metriche, tracciabilità e criteri di rilascio |
| [Evidenze](evidence/README.md) | Come registrare prove future e controlli documentali |

## Decisioni confermate

- Lagoto governerà task, permessi, budget e continuità; harness esistenti eseguiranno il lavoro. Nessun secondo ciclo autonomo di pianificazione.
- Codex e Claude Code useranno adapter ufficiali; Qwen Code SDK, dietro un adapter sostituibile, servirà Qwen cloud, Kimi API e Ollama. La fattibilità resta un gate P00.
- “Batteria” significa budget di oggi. La quota reale del provider è distinta. I piani opachi useranno un budget personale marcato come stimato.
- Distribuzione su tutti i giorni di calendario, fuso iniziale `Europe/Rome`, rinnovo proprio di ciascun piano. Allo 0%: pausa sicura e scelta dell’utente.
- Il task possiederà il contesto condiviso. Un solo writer per insieme di worktree; niente trasferimento presunto dello stato interno di un modello.
- GitHub esistente sarà riconosciuto automaticamente quando univoco. Un nuovo repository privato richiederà il clic sulla proposta pronta; le consegne successive resteranno esplicite.

## Come mantenere coerenti i documenti

La roadmap è la fonte per ordine e stato dei lavori. I documenti tematici definiscono il comportamento; l’ADR motiva la scelta tecnica. Le fonti esterne descrivono prodotti e studi, non attestano il funzionamento di Lagoto. Un cambiamento di scelta richiede aggiornamento dell’ADR e dei requisiti coinvolti, senza cancellare le evidenze precedenti.

`Pxx.n` identifica un requisito della roadmap; `Pxx-Inn` il suo controllo di accettazione futuro. Una checkbox aperta resta tale finché mancano implementazione e prove. I controlli dei link e degli esempi matematici non chiudono alcuna fase applicativa.
