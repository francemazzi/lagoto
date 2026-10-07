# Matrice di compatibilità iniziale

**Data:** 5 ottobre 2026 · **Stato:** flusso nativo e handoff reali verificati parzialmente; nessun gate completo. [Versioni, esiti e limiti](evidence/progress-2026-10-05.md).

“Documentato” significa che esiste una superficie pubblica descritta dal produttore. “Verificato” richiederà una versione precisa e un report P00/P06/P10. Non dedurre supporto da un nome di modello o da compatibilità API dichiarata genericamente.

| Combinazione prevista | Base documentata | Stato Lagoto | Prova necessaria |
| --- | --- | --- | --- |
| Codex / App Server / login nativo | Protocollo, account e rate limits | Parziale: UI e handoff reali | Eventi, approvazioni, stop, login e semantica usage |
| Claude Code / CLI ufficiale / login nativo | Esecuzione programmatica e percorso di accesso | Parziale: UI e handoff reali | Stream, permessi, multi-root, stop e ripresa |
| Qwen Code SDK / Qwen cloud / piano o API | SDK sperimentale e provider | Da verificare | Endpoint/piano, tool call, isolamento e usage |
| Qwen Code SDK / Kimi / API Moonshot | Provider configurabili e API distinta dal servizio gestito | Da verificare | Modello esatto, streaming, tool, stop e costo |
| Qwen Code SDK / Ollama / qwen3.5:4b | Provider locale e compatibilità API parziale | Parziale: handoff e fixture offline con rete negata riusciti | Coda, risorse, finestra configurata e matrice fault |
| Cursor / ACP | Percorso ACP della CLI | Parziale: wrapper macOS, comandi ACP rifiutati e handoff reali | Handshake, capacità, login e handoff |
| Git / GitHub CLI / github.com | Auth, view e create ufficiali | Parziale: creazione privata e retry applicativo riusciti | Consegna multi-repo GitHub live e collaudo pannelli UI |
| Endpoint API personalizzato | Dipende dal servizio | Non supportato genericamente | Intera suite sulla combinazione richiesta |
| Kimi Code nativo, Grok multi-agent, GitHub Enterprise | Superfici distinte | Fuori scope iniziale | ADR e gate specifici prima di dichiarare supporto |

Fonti e data di consultazione: [registro tecnico](sources.md). I probe reali sono registrati separatamente. Le righe progettuali non attribuiscono automaticamente supporto alle versioni installate.

## Record da compilare durante P00

Per ciascuna combinazione registrare: sistema operativo/architettura, versione backend/SDK/CLI, origine del binario e licenza, provider/endpoint, ID modello/revisione, modalità auth, capacità documentate, capacità osservate, controllo applicabile dei permessi, possibilità di arresto dei figli, fonte/unità/scope usage, copertura dei consumi esterni, test e report sanitizzati.

Esiti ammessi: `da verificare`, `verificato per questa combinazione`, `parziale con limiti`, `bloccato`, `fuori scope`. Quota non esposta può produrre supporto parziale con budget stimato; impossibilità di controllare scritture/credenziali essenziali blocca la run. Non registrare token o trascrizioni personali.

## Combinazioni del probe P00

Codex 0.159.2 / gpt-6.1-sol; Claude 2.1.283 / sonnet; Qwen SDK 0.1.17 con OpenRouter qwen/qwen3-coder-next e moonshotai/kimi-k2.5; Ollama 0.34.4 / qwen3.5:4b: smoke positivi, stato **parziale con limiti**, abilitabili nella UI solo dopo verifica reale del singolo profilo. QwenCloud e Moonshot diretti non verificati.

Cursor 2026.10.01-e373342 / composer-2.5[fast=true]: smoke positivo e handoff bidirezionali Codex/Claude; stato **parziale con limiti**. Il fallimento fuori scope iniziale è conservato nel report storico; il wrapper macOS ora nega scritture esterne, figli e symlink nella fixture. Agent può modificare i worktree autorizzati senza callback; il rifiuto di un comando ACP è verificato separatamente. Le letture non sono globalmente confinate. Ollama qwen3:8b: tool call incompatibili nella fixture; **non verificato come funzionante**. Nessuna estensione di questi risultati agli altri modelli o a modalità non provate.

## Stati dell'inventario (P00-I01)

`integration/list` restituisce per ogni strumento uno stato: `absent` (binario non trovato), `unrecognized` (presente ma senza versione leggibile), `verified` (versione elencata in `runtime/compatibility.json`) e `unverified` (versione leggibile ma non provata). Solo `verified` corrisponde a combinazioni con smoke registrato; le versioni nuove restano `unverified` finché non vengono provate. L'accesso nativo è letto da `integration/auth-status` (`codex login status`, `claude auth status`, `cursor-agent status`) con stati `ok`, `absent`, `expired`, `cancelled` e `unknown`; `run/start` rifiuta qualsiasi stato diverso da `ok` prima di avviare processi.
