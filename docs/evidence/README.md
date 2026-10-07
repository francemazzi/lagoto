# Evidenze e stato delle prove

**Aggiornamento:** 7 ottobre 2026.

Questa cartella distingue controlli documentali da prove dell’app. [Revisione documentale](documentation-review.md) riguarda soltanto Markdown, tracciabilità e aritmetica degli esempi. Non chiude P00 o altre fasi.

Il [report aggiornato](progress-2026-10-07.md) registra lo stato corrente; il [report del 5 ottobre](progress-2026-10-05.md) resta come storia. La copertura richiesta per ogni requisito è in `scripts/gate-manifest.json` e le regole di freschezza in [Validazione](../validation.md). I riepiloghi [workflow nativo](native-workflow-summary.json), [GitHub e budget](repository-budget-summary.json) e [offline e CI nativa](offline-native-summary.json) conservano versioni, impronte e limiti delle prove. Il [report iniziale](implementation-2026-10-05.md) e i [probe P00](p00-smoke-summary.json) restano evidenze storiche, incluse le prove fallite. Nessuna fase P00–P12 è chiusa. I report macchina di `pnpm gate` rimangono in `build/evidence/gates/`; non popolare anticipatamente report “passed”. Le run reali di ogni giornata sono contate in `build/evidence/real-runs/`.

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
