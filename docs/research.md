# Ricerca scientifica e decisioni per Lagoto

**Consultazione:** 28 settembre 2026. Questa raccolta porta nel repository la ricerca dell’analisi precedente; non richiede il documento interattivo esterno.

Le schede distinguono risultati degli autori, limiti e decisioni per Lagoto. “Preprint” non implica revisione tra pari; quando una sede è dichiarata, è specificata. Le versioni sono fissate ove disponibili: non mescolare numeri fra revisioni. Nessun benchmark citato è stato riprodotto in Lagoto. Documentazione commerciale e protocolli sono raccolti separatamente in [Fonti tecniche](sources.md).

## R01 — Agent Harness Engineering: A Survey

**Fonte e versione:** [pagina degli autori](https://picrew.github.io/LLM-Harness/), manoscritto 2026; [OpenReview](https://openreview.net/pdf?id=eONq7FdiHa). Versione numerata non identificata. **Tipo:** survey/manoscritto indicizzato come under review, non trattato come pubblicazione accettata. Pagina degli autori e testo indicizzato consultati; accesso diretto al PDF limitato da verifica browser.

**Risultato:** propone la tassonomia ETCLOVG: Execution, Tooling, Context, Lifecycle, Observability, Verification, Governance. Rende espliciti confini spesso mescolati negli agenti.

**Limiti:** una tassonomia e un catalogo non dimostrano superiorità empirica di uno stack. La copertura documentale di un progetto non certifica le sue garanzie operative.

**Decisione Lagoto:** separare runtime, memoria, osservabilità e policy; usare la tassonomia come controllo di completezza dell’ADR e degli adapter, senza ricostruire ogni componente. **Fasi:** P00, P05, P12.

## R02 — PACT

**Titolo:** What Should Agents Say? Action-state Communication for Efficient Multi-Agent Systems. **Fonte/versione:** [arXiv 2606.05304v1](https://arxiv.org/abs/2606.05304v1), 3 giugno 2026; [testo e tabelle](https://arxiv.org/html/2606.05304v1). **Tipo:** preprint empirico.

**Risultato:** comunicazione centrata su azione e stato; il proxy elimina deliberazione testuale dell’assistente preservando tool call e output. Con Qwen3-14B su 500 casi SWE-bench Verified, OpenHands passa da 97/500 (19,4%) a 115/500 (23,0%), con token per caso risolto da 3,82M a 3,43M. SWE-agent passa da 128/500 (25,6%) a 121/500 (24,2%), con input da 314,6M a 156,0M e token per caso risolto da 2,46M a 1,30M.

**Limiti:** ridurre comunicazione può ridurre anche successo; l’etichetta generale “performance neutral” non riassume ogni configurazione. Non autorizza a eliminare prove o applicare la stessa compressione a qualsiasi output.

**Decisione Lagoto:** passaggi con azione, stato, artefatti e prossimi passi, aggiungendo revisione e provenienza. Nessuna esportazione di ragionamento interno. **Fasi:** P07–P08, P10.

## R03 — The Complexity Trap

**Titolo:** The Complexity Trap: Simple Observation Masking Is as Efficient as LLM Summarization for Agent Context Management. **Fonte/versione:** [arXiv 2508.21433v3](https://arxiv.org/abs/2508.21433v3), 27 ottobre 2025; prima versione 29 agosto 2025. **Tipo:** studio empirico, versione camera-ready del workshop DL4C presso NeurIPS 2025, non main conference.

**Risultato:** negli esperimenti SWE-agent/SWE-bench, mascherare vecchie osservazioni dimezza il costo rispetto al contesto grezzo e compete con riassunti LLM nel solve rate. Include una prova iniziale su OpenHands e una variante ibrida.

**Limiti:** modelli, harness e benchmark specifici; non prova che qualunque riassunto sia inutile né che un’informazione possa essere cancellata dall’archivio.

**Decisione Lagoto:** conservare output originali, consegnare estratti e riferimenti, confrontare masking e summary su casi propri. Applicare solo ai confini controllabili dell’harness. **Fasi:** P07, P12.

## R04 — ACE

**Titolo:** Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models. **Fonte/versione:** [arXiv 2510.04618v3](https://arxiv.org/abs/2510.04618v3), 29 marzo 2026; prima versione 6 ottobre 2025. **Tipo:** paper con versione ICLR 2026 dichiarata nella scheda.

**Risultato:** contesti organizzati come playbook, con generazione, riflessione e aggiornamenti incrementali; contrasta la perdita di dettagli nelle riscritture monolitiche. Riporta miglioramenti su task agentici e finanza, inclusi esperimenti AppWorld.

**Limiti:** risultati in quei domini non validano una memoria per sviluppo multi-repository. Una lezione generata può comunque essere errata o non più attuale.

**Decisione Lagoto:** memorie atomiche con origine, revisione, sostituzioni e validità; conferma o prova prima di promuovere una lezione a regola. Nessuna policy di sicurezza modificata dall’agente. **Fasi:** P07–P08.

## R05 — Delivery, Not Storage

**Titolo:** Delivery, Not Storage: Cue-Anchored Working Memory as a Harness Property for Coding Agents. **Fonte/versione:** [arXiv 2607.20972v1](https://arxiv.org/abs/2607.20972v1), 23 luglio 2026; [testo completo](https://arxiv.org/html/2607.20972v1). **Tipo:** preprint esplorativo.

**Risultato:** memoria consegnata da trigger su file, simboli o eventi, senza dipendere dall’iniziativa del modello. Nel probe sintetico di compattazione dieci fatti restano assenti da 106/108 compattazioni senza il canale dedicato, mentre arrivano attraverso 138 riprese con iniezione.

**Limiti:** prova circoscritta; riporta anche circa +21% di turni e +36% di costo e derive dello stato del task. Conservare fatti seminati non dimostra maggiore correttezza del lavoro.

**Decisione Lagoto:** provare trigger deterministici per vincoli pertinenti e registrare la consegna; limitarne il budget e misurare riletture, falsi richiami e costo. **Fasi:** P07, P12.

## R06 — MemoHarness

**Titolo:** MemoHarness: Agent Harnesses That Learn from Experience. **Fonte/versione:** [arXiv 2607.14159v1](https://arxiv.org/abs/2607.14159v1), 14 luglio 2026; [testo completo](https://arxiv.org/html/2607.14159v1). **Tipo:** preprint esplorativo.

**Risultato:** adatta sei dimensioni dell’harness recuperando diagnosi di esecuzioni ed esperienze globali; riporta miglioramenti rispetto alle configurazioni fisse confrontate e trasferimento selettivo.

**Limiti:** la prova principale Terminal-Bench ha 18 task held-out; mancano intervalli di confidenza e attribuzione completa delle componenti, e non tutti i confronti sono a parità di sistema/modello. Il caching influenza l’economia del contesto aggiuntivo.

**Decisione Lagoto:** conservare diagnosi verificabili ora; eventuali suggerimenti di configurazione solo dopo valutazione offline e possibilità di rollback. Non auto-ottimizzare autorizzazioni o spesa. **Fasi:** P05/P12; adattamento autonomo fuori MVP.

## R07 — Agent Retrieval Bench

**Titolo:** Agent Retrieval Bench: Evaluating Repository Context Retrieval for Coding Agents. **Fonte/versione:** [arXiv 2607.24882v1](https://arxiv.org/abs/2607.24882v1), 27 luglio 2026. **Tipo:** preprint/benchmark.

**Risultato:** 427 esempi in 25 repository; valuta code2test, comment2context, trace2code, edit2ripple e recupero selettivo. Nessun metodo domina tutte le metriche: RepoMap ha il migliore rendimento del contesto nel budget 8K studiato, mentre embedding diversi prevalgono in altre metriche.

**Limiti:** recuperare file pertinenti non equivale a produrre una patch corretta. Il pilota di intervento sul contesto e i problemi di calibrazione non giustificano soglie universali.

**Decisione Lagoto:** partire da ricerca lessicale e simboli; confrontare retrieval su file da modificare, test e dipendenze. Aggiungere embedding solo dopo beneficio misurato. **Fasi:** P07, P12.

## R08 — Towards a Science of Scaling Agent Systems

**Fonte/versione:** [arXiv 2512.08296v3](https://arxiv.org/abs/2512.08296v3), 8 aprile 2026; prima versione 9 dicembre 2025. **Tipo:** preprint empirico.

**Risultato:** la v3 valuta 260 configurazioni su sei benchmark. L’allineamento fra architettura e struttura del task domina la scelta: variazioni relative da +80,8% su ragionamento finanziario decomponibile a −70,0% su pianificazione sequenziale. Il modello predittivo riporta R² cross-validato 0,373, oppure 0,413 con una metrica di capacità ancorata al task.

**Limiti:** niente soglia universale per decidere quando più agenti funzionino meglio. Le cifre della v1 sono differenti e non vanno mescolate a queste. La previsione non è una garanzia per un progetto nuovo.

**Decisione Lagoto:** baseline singolo agente, specialisti solo per attività separabili dopo misure di costo e qualità. **Fasi:** P10/P12; swarm scriventi esclusi.

## R09 — Why Do Multi-Agent LLM Systems Fail?

**Fonte/versione:** [arXiv 2503.13657v3](https://arxiv.org/abs/2503.13657v3), 26 ottobre 2025; prima versione 17 marzo 2025. **Tipo:** studio empirico e tassonomia; qui citato nella versione arXiv, senza attribuzione di una sede non verificata.

**Risultato:** MAST organizza 14 modi di fallimento in problemi di progettazione, disallineamento tra agenti e verifica del task. La versione consultata include MAST-Data con oltre 1.600 tracce da sette framework.

**Limiti:** una tassonomia osservazionale non garantisce che una modifica risolva il fallimento; accordo tra agenti e dichiarazioni di completamento non sostituiscono prove esterne.

**Decisione Lagoto:** testare cicli, perdita di requisiti, risultati non verificati, delega senza arresto e conclusioni premature; tenere evidenze e criteri fuori dalla sola chat. **Fasi:** P05, P08, P10, P12.

## R10 — Beyond tokens

**Titolo:** Beyond tokens: a unified framework for latent communication in LLM-based multi-agent systems. **Fonte/versione:** [arXiv 2606.05711v3](https://arxiv.org/abs/2606.05711v3), 15 luglio 2026; prima versione 4 giugno 2026. **Tipo:** survey/preprint.

**Risultato:** classifica 18 metodi per comunicazione con embedding, hidden state o KV-cache secondo contenuto, allineamento e fusione nel destinatario.

**Limiti:** accesso agli stati interni e allineamento fra architetture restano problemi aperti. Non è una soluzione utilizzabile indistintamente attraverso API cloud opache.

**Decisione Lagoto:** usare testo strutturato e artefatti con provenienza; non promettere trasferimento di stato mentale/cache fra Codex, Claude, Qwen e Kimi. **Fasi:** P07–P08; comunicazione latente fuori MVP.

## Letture aggiuntive esaminate

Queste fonti ampliano la ricerca; non sono dipendenze del prodotto.

| ID e fonte/versione | Tipo e contributo | Limite e decisione |
| --- | --- | --- |
| R11 · [OPENDEV — Building Effective AI Coding Agents for the Terminal](https://arxiv.org/abs/2603.05344v3), v3, 13 marzo 2026 | Preprint/work in progress; descrive tool discovery differita, compattazione e memoria in un agente CLI | Descrizione di sistema, non confronto risolutivo per Lagoto. Considerare caricamento selettivo degli strumenti; non adottare automaticamente il dual-agent loop |
| R12 · [Skill-as-API](https://arxiv.org/abs/2609.01677v1), v1, 1º settembre 2026 | Preprint; coordinamento con accesso controllato e implementazione Python/XMTP, caso di review con tre agenti | Caso circoscritto e nuova infrastruttura non necessaria al desktop personale. Conservare il principio di minimizzare informazioni e permessi esposti |
| R13 · [The Vision Wormhole](https://arxiv.org/abs/2602.15382v2), v2, 28 maggio 2026 | Preprint/work in progress; codec per comunicazione latente attraverso il canale visivo di VLM eterogenei | Richiede addestramento e interfacce specifiche; non costituisce handoff universale tra servizi chiusi. Ricerca futura |
| R14 · [Learning to Communicate — DiffMAS](https://arxiv.org/abs/2604.21794v1), v1, 23 aprile 2026 | Preprint indicato under review COLM 2026; apprendimento end-to-end della comunicazione latente | Richiede training e accesso alle rappresentazioni; miglioramenti sui benchmark studiati non validano il percorso desktop. Fuori MVP |

## Sintesi delle decisioni, da verificare sul prodotto

| Decisione di Lagoto | Evidenza che la motiva | Prova propria necessaria |
| --- | --- | --- |
| Coordinatore separato dall’harness | R01, R11 | Contratti, stop, permessi e packaging P00/P05 |
| Stato ed evidenze nel passaggio | R02, R09 | Handoff senza briefing manuale; esiti incerti conservati |
| Memoria incrementale e selettiva | R03–R05 | Conservazione vincoli, validità delle prove e costo totale |
| Retrieval semplice come baseline | R07 | Pertinenza dei file, patch corretta e regressioni |
| Singolo writer e delega successiva | R08–R09 | Nessun conflitto e beneficio netto rispetto al singolo agente |
| Nessuna migrazione di stati latenti | R10, R13–R14 | Continuità attraverso artefatti leggibili e versionati |

L’obiettivo di ottimizzazione è **costo complessivo per lavoro correttamente verificato**, insieme a latenza e interventi umani. Ridurre i token da solo non basta. Il protocollo comparativo e le prove di affidabilità sono in [Validazione](validation.md).
