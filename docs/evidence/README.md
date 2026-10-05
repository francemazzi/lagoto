# Evidenze e stato delle prove

**Aggiornamento:** 5 ottobre 2026.

Questa cartella distingue controlli documentali da prove dell’app. [Revisione documentale](documentation-review.md) riguarda soltanto Markdown, tracciabilità e aritmetica degli esempi. Non chiude P00 o altre fasi.

Il [report di implementazione](implementation-2026-10-05.md) e il [riepilogo dei probe reali](p00-smoke-summary.json) registrano prove parziali riuscite e fallite. Nessuna fase P00–P12 è chiusa. I report macchina di `pnpm gate` rimangono in `build/evidence/gates/`; non popolare anticipatamente report “passed”.

## Modello per un report futuro

```markdown
# Evidenza Pxx — titolo

- Data e commit verificato:
- Sistema operativo, architettura e macchina:
- Versioni runtime, SDK, CLI, Git e gh:
- Combinazione provider/endpoint/modello, account anonimizzato:
- Requisiti e test richiesti:
- Comandi eseguiti ed exit code:
- Test deterministici: passed / failed / missing / skipped, con motivi:
- Smoke live: eseguito / non eseguito, risultati e limiti:
- Artefatti sanitizzati e fingerprint:
- Casi di errore e recupero provati:
- Costi/consumi osservati e copertura, se pertinenti:
- Limitazioni residue e capability non verificate:
- Esito del gate: passed / blocked / failed
```

Rimuovere credenziali, contenuti privati e percorsi personali non necessari dagli artefatti pubblici. Un test con mock non sostituisce uno smoke richiesto; un output dell’agente che afferma successo non equivale a risultato verificato. Una modifica di codice, runtime o schema invalida le evidenze pertinenti fino a nuova verifica.
