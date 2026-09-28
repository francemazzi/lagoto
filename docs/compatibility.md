# Matrice di compatibilità iniziale

**Data:** 28 settembre 2026 · **Stato:** inventario progettuale. Nessuna riga indica un’integrazione Lagoto verificata.

“Documentato” significa che esiste una superficie pubblica descritta dal produttore. “Verificato” richiederà una versione precisa e un report P00/P06/P10. Non dedurre supporto da un nome di modello o da compatibilità API dichiarata genericamente.

| Combinazione prevista | Base documentata | Stato Lagoto | Prova necessaria |
| --- | --- | --- | --- |
| Codex / App Server / login nativo | Protocollo, account e rate limits | Da verificare | Eventi, approvazioni, stop, login e semantica usage |
| Claude Code / CLI ufficiale / login nativo | Esecuzione programmatica e percorso di accesso | Da verificare | Stream, permessi, multi-root, stop e ripresa |
| Qwen Code SDK / Qwen cloud / piano o API | SDK sperimentale e provider | Da verificare | Endpoint/piano, tool call, isolamento e usage |
| Qwen Code SDK / Kimi / API Moonshot | Provider configurabili e API distinta dal servizio gestito | Da verificare | Modello esatto, streaming, tool, stop e costo |
| Qwen Code SDK / Ollama / modello locale scelto | Provider locale e compatibilità API parziale | Da verificare | Tool, finestra configurata, offline, coda e risorse |
| Cursor / ACP | Percorso ACP della CLI | Pianificato P10, non verificato | Handshake, capacità, login e handoff |
| Git / GitHub CLI / github.com | Auth, view e create ufficiali | Da verificare | Credential store, permessi, remote e retry di push |
| Endpoint API personalizzato | Dipende dal servizio | Non supportato genericamente | Intera suite sulla combinazione richiesta |
| Kimi Code nativo, Grok multi-agent, GitHub Enterprise | Superfici distinte | Fuori scope iniziale | ADR e gate specifici prima di dichiarare supporto |

Fonti e data di consultazione: [registro tecnico](sources.md). Nessun login, probe live o inventario di credenziali personali è parte di questa documentazione.

## Record da compilare durante P00

Per ciascuna combinazione registrare: sistema operativo/architettura, versione backend/SDK/CLI, origine del binario e licenza, provider/endpoint, ID modello/revisione, modalità auth, capacità documentate, capacità osservate, controllo applicabile dei permessi, possibilità di arresto dei figli, fonte/unità/scope usage, copertura dei consumi esterni, test e report sanitizzati.

Esiti ammessi: `da verificare`, `verificato per questa combinazione`, `parziale con limiti`, `bloccato`, `fuori scope`. Quota non esposta può produrre supporto parziale con budget stimato; impossibilità di controllare scritture/credenziali essenziali blocca la run. Non registrare token o trascrizioni personali.
