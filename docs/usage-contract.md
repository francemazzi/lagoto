# Contratto delle misure di consumo

**Stato:** definito prima del registro P05 (requisito P00.8). Implementazione in `runtime/usage.ts`.

Ogni misura dichiara sorgente, metrica, unità, ambito, finestra, momento dell'osservazione e origine. Il valore assente non è zero.

| Sorgente | Significato |
| --- | --- |
| `measured` | Riportata dal provider o dall'harness |
| `manual` | Inserita dall'utente, con origine visibile |
| `estimated` | Calcolata da Lagoto, mai presentata come misura |
| `missing` | Non disponibile; `value` è `null` |
| `stale` | Misura più vecchia di 15 minuti; non vale come corrente |

Metriche distinte e non convertibili: token fatturati cumulativi, occupazione attuale del contesto, quota account in percentuale e quota account in unità. Nessuna conversione tra prezzo di abbonamento e token. Un adapter senza evento di consumo produce `missing`.

## Fonti documentate per integrazione (da confermare con login reali in P09-I01)

| Integrazione | Fonte nota | Stato |
| --- | --- | --- |
| Codex | `thread/tokenUsage/updated` (sessione); `account/rateLimits/read` (quota account) | token di sessione osservati; quota da provare |
| Claude Code | evento `result` con `usage` (sessione) | quota account non esposta |
| Qwen Code SDK / Ollama | evento `result` con `usage` | quota non esposta |
| Cursor ACP | nessun evento di consumo osservato | `missing` |
