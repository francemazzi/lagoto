# ADR 0003 — Architettura Cowork: squadra di agenti, registro ACP e UI organizzata come AionUi

**Data:** 6 ottobre 2026.
**Stato:** approvata dall’utente; requisiti in ROADMAP.md P02.7, P02.8, P09.10 e P13–P16; prove da produrre nei relativi gate.
**Ambito:** app personale macOS. Conferma ADR 0001 (harness sostituibili) e ADR 0002 (app nativa), che restano validi.

## Contesto

AionUi (`iOfficeAI/AionUi`, 2.2.2) e AionCore (`iOfficeAI/AionCore`, 0.2.2) sono stati analizzati il 6 ottobre 2026. La loro comunicazione non usa A2A: la UI parla con il core in HTTP e WebSocket; il core guida Claude Code con `stream-json`, Codex con `app-server` e ogni altro agente con ACP, Agent Client Protocol di Zed, su stdio; gli agenti di una squadra si coordinano tramite un server MCP interno con mailbox e lavagna dei task, più una CLI di fallback. Lagoto usa già gli stessi tre trasporti verso gli agenti.

L’utente ha chiesto di adottare l’architettura Cowork di AionUi, sia il motore di sinergia fra agenti sia l’organizzazione della UI, e ha risposto alle otto decisioni aperte il 6 ottobre 2026.

## Decisione

**Confermato.** SwiftUI e AppKit; coordinatore TypeScript su Node incluso; IPC JSON-RPC v1 su stdin/stdout privati; nessun server HTTP di Lagoto e nessun account; Keychain gestito in Swift con segreto consegnato al runtime per run; macOS 15+ Apple Silicon soltanto; ambiente filtrato e `sandbox-exec` per i CLI; un solo writer per insieme di worktree; nessun acquisto, fallback o cambio modello automatico.

**Escluso.** Electron e React; riscrittura o fork in Rust; server HTTP locale; Windows e Linux; hub delle estensioni, canali chat, cron, pet, assistenti Office, WebUI remota, app mobile, motore interno `aionrs` e agenti remoti OpenClaw.

**Adottato.**

1. **Organizzazione della UI** presa da AionUi e realizzata in SwiftUI: sidebar con progetti, task e conversazioni; conversazione al centro; colonna destra richiamabile con explorer, anteprima e modifiche; tassonomia dei messaggi con tool call raggruppati, card di permesso, terminale, piano, modifiche ai file e coda del composer (P02.7, P02.8). Nessun file React entra nel repository.
2. **Batteria per modello e media in alto.** Ogni profilo mostra la propria percentuale di oggi; l’intestazione mostra la media dei profili abilitati con budget numerico o stimato, etichettata “media”, con elenco per modello e profilo più basso evidenziato. È una media di percentuali, non una somma di unità o valute (P09.10).
3. **Registro ACP configurabile** sul modello di `agent_metadata` di AionCore: le differenze fra backend sono righe di configurazione; l’adapter generico nasce da quello di Cursor e applica le regole di `acp_conn.rs`. Qwen cloud, Kimi API e Ollama restano sul Qwen Code SDK finché l’ACP di Qwen Code non supera lo stesso smoke (P13).
4. **Motore di squadra** portato in TypeScript dal crate `aionui-team`: Leader Claude Code o Codex scelto dall’utente; massimo tre compagni fra i profili verificati, Cursor incluso; worktree isolato per slot con integrazione del Leader; tredici strumenti di squadra con permessi per ruolo; prompt di ruolo con conferma umana prima dello spawn; scheduler con timeout, idle e recupero da crash; budget prenotato per slot, 0% che ferma solo lo slot, avviso al 50% del budget aggregato; nessun push o effetto esterno dalla squadra (P14).
5. **Server MCP di squadra su socket Unix privato** con permessi 0600 e token per slot, invece della porta TCP di AionCore. Il bridge `lagoto-runtime mcp-team-stdio` viene iniettato in ACP tramite `mcpServers`, in Claude e Codex tramite la loro configurazione MCP, e sostituito da una CLI di fallback per i backend senza MCP dichiarato. Nessuna porta di rete in ascolto (P14.4, P14.5).
6. **Messaggi fra conversazioni** portati da `aionui-session-message`: consegna equivalente a un invio dell’utente, rate limit anti-ciclo, nessuna lettura presunta (P15).
7. **Milestone.** La v0.1.0 conserva il perimetro P00–P12 e assorbe solo P02.7, P02.8 e P09.10. Squadra, registro ACP e messaggi fra conversazioni formano la milestone v0.2.0 “Cowork” con i gate P13–P16.

## Conseguenze

- La frase di ADR 0002 “niente secondo planner autonomo o swarm scrivente nell’MVP” resta vera per la v0.1.0. Dalla v0.2.0 la squadra è coordinamento fra harness con conferma umana, non un planner interno di Lagoto; i limiti di tre compagni e di nessun effetto esterno sono vincoli di prodotto.
- La mailbox fra agenti è contenuto non fidato: marcatori espliciti, nessun segreto, rate limit e permessi per slot portati all’utente sono gate, non note.
- N compagni consumano N budget. La UI mostra consumo aggregato e per slot; la media in alto include gli slot attivi.
- Il codice portato da AionCore è riscritto in TypeScript; i contratti e i prompt derivati sono attribuiti in `docs/licenses.md`. Apache-2.0 è compatibile con la GPL-3.0-only di Lagoto conservando le note.
- `docs/product-ux.md`, `docs/architecture.md` e `docs/compatibility.md` vanno aggiornati nei gate P02, P13 e P14 con i comportamenti e le combinazioni effettivamente provate.

## Alternative scartate

- **Electron + React con server HTTP locale**, cioè copia diretta dello stack AionUi: scartata il 6 ottobre 2026 per restare su app nativa, Keychain in Swift e nessuna porta in ascolto.
- **Fork di AionUi e AionCore in Rust**: scartato per le 440.000 righe Rust da mantenere, le 3.700 righe TypeScript verificate da riscrivere e il prodotto Cowork generalista da spogliare.
- **Server MCP di squadra su TCP** come in AionCore: scartato a favore del socket Unix, equivalente per gli agenti e coerente con il divieto di server in ascolto.
