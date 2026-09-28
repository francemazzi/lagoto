# Validazione e criteri di completamento

**Stato:** specifica delle prove future · **Aggiornamento:** 28 settembre 2026.

Il controllo di questa consegna riguarda soltanto la documentazione. Nessuna prova applicativa sotto è dichiarata eseguita. I risultati reali richiederanno implementazione, ambiente e report secondo [Evidenze](evidence/README.md).

## Tracciabilità

Ogni checkbox della [roadmap](../ROADMAP.md) ha un test di accettazione `Pxx-Inn` corrispondente al requisito `Pxx.n`. La sua descrizione è l’esito minimo; le tabelle seguenti aggiungono scenari trasversali obbligatori. Il runner futuro deve fallire su test mancanti, zero test eseguiti, skip inattesi o mock usati al posto di smoke richiesti.

| Area | Requisiti di riferimento | Prova di completamento |
| --- | --- | --- |
| Autenticazione e capacità | P00.1–P00.3, P00.6, P06.1–P06.8 | Versioni/percorsi dichiarati e smoke per combinazione |
| Tre aree e onboarding | P02.1–P02.6, P06.3–P06.4 | Flussi accessibili e stati reali distinti dalle fixture |
| GitHub e cartelle | P00.7, P03.1–P03.8, P11.3 | Rilevamento, proposta e retry senza perdita di lavoro |
| Bridge e processi | P01.1–P01.6, P04.1–P04.6, P05.1–P05.6 | Confini applicati, journal e singolo writer |
| Budget | P00.8, P05.7, P09.1–P09.2, P09.6–P09.9 | Calcoli deterministici e riconciliazione senza duplicati |
| Memoria e handoff | P07.1–P07.6, P08.1–P08.6 | Recupero byte/stato e continuità eterogenea |
| Contesto e completamento | P09.3–P09.5, P11.1–P11.2 | Misure semantiche e prove valide sulla revisione corrente |
| Estensioni | P10.1–P10.6 | Cursor/figli osservabili solo sui percorsi verificati |
| Rilascio e recupero | P00.4–P00.5, P11.4–P11.6, P12.1–P12.6 | Pacchetto nativo, backup, fault injection e uso personale |

## Batteria e contabilità

Usare orologio controllabile, decimali ripetibili e fonti sintetiche. Valori attesi nella [specifica](daily-battery.md). Distinguere i test dell’algoritmo dai test della semantica delle fonti reali.

| Scenario | Dati/azione | Risultato atteso |
| --- | --- | --- |
| BAT-01 | 30 €, riserva 3 €, D=30, U=0,36 | A=0,90 €, batteria 60% |
| BAT-02 | Risparmio giorno 1 e apertura giorno 2 | A=0,91862069 €, nessun ricalcolo di A durante giorno 1 |
| BAT-03 | Eccedenza 1,10 € e giorno seguente | 0% poi A=0,89310345 €; debito conservato |
| BAT-04 | C=0, R≤S, ultimo giorno, D=0 | Zero senza divisioni invalide; reset riconciliato prima di nuova disponibilità |
| BAT-05 | Riserva su trenta assegnazioni | S protetta una volta come soglia; nessuna transazione ripetuta di riserva |
| BAT-06 | Stesso pool in due modelli e due task | Unica assegnazione, consumo e prenotazioni atomiche |
| BAT-07 | Account/valute/unità incompatibili | Nessuna somma né conversione arbitraria |
| BAT-08 | Usage locale e snapshot account sullo stesso intervallo | Una sola spesa nel saldo riconciliato |
| BAT-09 | Consumo esterno oggi/prima di oggi | Attribuzione solo se provabile; altrimenti differenza non attribuibile e copertura parziale |
| BAT-10 | Snapshot vecchio/assente/invalido | Stale/unavailable/rifiutato; nessuna barra provider 0% o 100% inventata |
| BAT-11 | Plafond settimanale più limite breve | Batteria pianificata e vincoli distinti; anche con batteria positiva l’avvio può essere bloccato |
| BAT-12 | Reset a mezzanotte/a mezzogiorno, mese breve, ora legale | Conteggio date locali in intervallo semiaperto; segmento di ciclo esplicito |
| BAT-13 | Riavvio app o doppia apertura nello stesso giorno | Stessa assegnazione congelata; nessuna ricarica |
| BAT-14 | Prenotazione 0,18, costo effettivo 0,12 | Prenotazione sostituita, non sommata; rialzo motivato della barra |
| BAT-15 | Operazione attraversa giorno/reset e risposta tarda | Impegno trattenuto; nessuna capacità assegnata due volte; rettifica atomica |
| BAT-16 | Parent include figli | Dettaglio figli non aggiunto al totale già aggregato |
| BAT-17 | Meno di sette giorni validi / sette giorni completi | In calibrazione / mediana nella stessa unità e pool, marcata come stima |
| BAT-18 | Giorni inattivi, incompleti o cambio metrica | Esclusi dalla baseline; tutti i giorni restano nel piano; nuova metrica ricalibrata |
| BAT-19 | Profilo locale senza/con budget | Locale · disponibile / percentuale personale; risorse separate |
| BAT-20 | Soglie e 0% preciso o soltanto arrotondato | Avvisi una volta; stop/nuove partenze sul valore preciso; <1% se positivo |
| BAT-21 | Deroga oggi, piano o tariffa cambiati | Versione/motivo espliciti, storico intatto, futuro ricalcolato; nessun acquisto implicito |
| BAT-22 | Prima configurazione a metà giornata | Saldo già consumato non sottratto ancora; segmento dichiarato |

## Memoria, sviluppo codice e handoff

Fixture principale: tre repository Git sintetici indipendenti, **backend**, **frontend**, **desktop**. Il task modifica un contratto API e i due client, con criteri di regressione e revisione. Nessun dato o piano personale.

| Scenario | Guasto o variazione | Evidenza attesa |
| --- | --- | --- |
| MEM-01 | Restore con staged, unstaged, untracked, binari e cancellazioni | Byte, indice e manifest corrispondono per tutti i contenuti inclusi |
| MEM-02 | Crash a ogni passaggio blob/manifest, disco pieno o blob perso | Checkpoint incompleto non pronto; ultimo completo recuperabile |
| MEM-03 | Decisione sostituita, simbolo rinominato, prova su vecchio codice | Elementi invalidati o da verificare, non reinseriti come fatti vigenti |
| MEM-04 | Log/repository con istruzioni ostili | Provenienza non fidata conservata; nessuna autorizzazione ottenuta tramite riassunto |
| MEM-05 | Tutte le quote esaurite, tokenizer ignoto, finestra più piccola | Pacchetto generato localmente; stima dichiarata, nucleo preservato o blocco esplicito |
| MEM-06 | Output mascherato o memoria a trigger | Originale recuperabile e consegna tracciata; costo/beneficio misurati |
| HAND-01 | Interruzione dopo modifica, prima del test | File conservati, test non eseguito |
| HAND-02 | Crash durante test | Output parziale, esito unknown e verifica da ripetere |
| HAND-03 | Figlio ancora scrivente o processo non rintracciabile | Nessun successore sullo stesso worktree; recupero isolato proposto |
| HAND-04 | Doppio clic, timeout e restart in ogni transizione | Un solo successore e nessuna ownership trasferita prima del fermo |
| HAND-05 | Cloud→locale→cloud con finestra ridotta | Requisiti/decisioni/file/prove continuano senza briefing esterno |
| HAND-06 | Tool esterno avviato senza risposta | Registro unknown; verifica remota o decisione, nessun replay cieco |
| HAND-07 | Modifica da editor esterno e terzo repo mancante | Riconciliazione e blocco motivato, non task parzialmente pronto nascosto |
| HAND-08 | Successore senza tool o permesso necessario | Capacità mancante esplicita, niente fallback non autorizzato |
| HAND-09 | Cambio provider e dati esclusi | Anteprima del destinatario e nessun segreto/contenuto escluso inviato |

I test infrastrutturali usano fake adapter deterministici. Gli smoke cloud/locali verificano anche i percorsi reali, su versioni registrate e fixture autorizzate; non devono esaurire intenzionalmente le quote. L’eventuale incapacità del modello di risolvere la fixture va distinta da perdita di stato, errore di adapter o tool.

## GitHub e filesystem

| Scenario | Stato iniziale | Risultato atteso |
| --- | --- | --- |
| GH-01 | Cartella non Git | Candidata accettata; preview prima di init/commit/creazione/push |
| GH-02 | Repo GitHub già collegato, URL SSH e HTTPS equivalenti | Identità unica e collegamento senza scritture remote |
| GH-03 | Due remote diversi o account ambigui | Scelta concreta, preservando configurazione |
| GH-04 | Symlink, sottofolder o secondo clone | Canonicalizzazione senza duplicare identità o fondere checkout distinti |
| GH-05 | Account senza permessi / auth annullata / credential store non sicuro | Stato non pronto, nessun cambio account o visibilità pubblica impliciti |
| GH-06 | Remote creato, push fallito o risposta persa | ID/commit conservati, riconciliazione e retry senza doppio repository |
| GH-07 | File ignorati, staged fuori selezione, segreti in file o storia | Preview corretta; esclusioni e blocchi pertinenti; indice/lavoro preservati |
| GH-08 | File cambiati dopo preview | Proposta interessata invalidata; nessun contenuto aggiunto all’autorizzazione |
| GH-09 | Remote non GitHub, nome già occupato o hook locale | Nessun remote sovrascritto, duplicato o script eseguito implicitamente |
| GH-10 | Push successivo o consegna multi-repo parziale | Azioni esplicite e risultati per repo; niente force push o sincronizzazione implicita |

GitHub reale si usa soltanto nello smoke futuro dedicato. CI usa fixture e risposte registrate/sintetiche, non account personali. Gli esiti di reti e permessi non sono attestabili con soli mock.

## Valutare l’ottimizzazione del contesto

Partire da baseline singolo agente. Confrontare, a parità delle condizioni pertinenti: contesto iniziale semplice, output selettivi/masking, memoria incrementale, trigger e, solo in seguito, retrieval semantico o specialisti separabili. La [ricerca](research.md) motiva questi esperimenti ma non ne predice il risultato.

Registrare task/commit, modello e versione, harness, prompt/policy, strumenti, finestra, tokenizer/quantizzazione, ambiente e stato delle cache. Separare casi di taratura e casi di valutazione. Ripetere i confronti quando la variabilità lo richiede, riportando campione, dispersione e limiti; non pubblicare solo il miglior tentativo.

Metriche: criteri corretti e regressioni; costo totale per task risolto (tentativi falliti inclusi); token input/cache/output/comunicazione ove osservabili; latenza p50/p95; riletture; interventi umani; recuperi riusciti; azioni con esito incerto e errori infrastrutturali. Se una metrica non è osservabile, non sostituirla con zero. Una riduzione dei token con peggioramento della correttezza è un tradeoff, non un miglioramento incondizionato.

## Definition of Done documentale

Per questa consegna verificare: README/roadmap/docs coerenti, P00–P12 presenti, ogni requisito con criterio, link locali e anchor validi, fonti datate, formule/esempi aritmetici coerenti, nessuna checkbox applicativa spuntata e diff limitato a Markdown. La verifica matematica degli esempi non prova la telemetria di un provider o l’applicazione dei limiti durante una run.

Il controllo eseguito e le sue limitazioni saranno registrati in [Revisione documentale](evidence/documentation-review.md). Le prove P00–P12 resteranno future.
