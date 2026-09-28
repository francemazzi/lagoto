# Batteria giornaliera

**Stato:** algoritmo e comportamento da implementare · **Aggiornamento:** 28 settembre 2026.

La percentuale principale risponde a **“quanto del budget di oggi mi resta?”**. Non misura l’energia del Mac, l’intelligenza del modello o la percentuale di un abbonamento mensile quando il provider non la espone. Il calcolo è una politica di Lagoto, non una formula dei provider.

## 1. Pool e unità

Ogni plafond è un `QuotaPool` identificato almeno da servizio, account opaco, prodotto, metrica e regola di reset. La singola finestra ha un ID distinto. Modelli e run che attingono allo stesso pool condividono consumo, prenotazioni e batteria. Duplicare un’integrazione o cambiare modello non crea un nuovo saldo.

Le unità possono essere valuta, crediti, richieste o token definiti dal piano. Non si sommano valute differenti, token di provider differenti o quote API e subscription. Il costo in valuta è derivato solo da tariffe pertinenti e versionate, comprendendo le componenti applicabili: input, cache, output e strumenti. In assenza di tariffa o usage sufficiente rimane una stima incompleta, senza assumere costo zero.

Per una quota percentuale documentata si può usare un pool di 100 **punti percentuali di quella finestra**, senza trasformarlo in token. Se la disponibilità non è un plafond ripartibile, resta un vincolo separato.

Ogni scheda modello ha una `BudgetPolicy` principale: prima un budget personale esplicito; in assenza, il plafond numerico ripartibile con la finestra più lunga applicabile. Se non esiste, si usa la calibrazione. Gli altri limiti sono vincoli, non addendi della batteria. Un limite specifico del modello può bloccarlo anche quando la batteria condivisa resta positiva.

## 2. Formula per un budget numerico

| Simbolo | Definizione nella stessa unità |
| --- | --- |
| `C` | Budget assegnato al ciclo, non necessariamente l’intero saldo del conto API |
| `R` | Residuo riconciliato fotografato all’apertura dell’assegnazione di oggi |
| `S` | Riserva protetta del ciclo: inizialmente `0,10 × C`, registrata una volta |
| `D` | Giorni di calendario utilizzabili fino al reset, incluso oggi |
| `A` | Assegnazione fissata per oggi: `max(0, R − S) / D` |
| `U` | Consumo già contabilizzato contro questa assegnazione |
| `P` | Prenotazioni ancora non contabilizzate contro questa assegnazione |

```text
se D > 0:
    A = max(0, R − S) / D
se A > 0:
    batteria = clamp(100 × (A − U − P) / A, 0, 100)
altrimenti:
    batteria = 0
```

`R` nella formula è uno **snapshot all’apertura**, non un saldo da aggiornare continuamente nel denominatore. Durante la giornata cambiano `U` e `P`, mentre `A` resta fisso. Il saldo corrente del ciclo viene aggiornato nel registro per calcolare i giorni seguenti. Sottrarre nuovamente `U` da `R` e ricalcolare `A` a ogni evento sarebbe un doppio trattamento dello stesso consumo.

`S` è una soglia protetta sul residuo, non una transazione ripetuta ogni giorno. La riserva non si riduce automaticamente dopo ogni spesa. Non si usa senza una modifica esplicita della politica. Se `R ≤ S`, l’assegnazione ordinaria è zero. Un residuo negativo per eccedenza resta visibile nel registro; soltanto la percentuale viene limitata a zero.

Al primo avvio giornaliero si acquisisce lo snapshot anche se l’app non era aperta a mezzanotte. Dopo un riavvio nello stesso giorno si riusa l’assegnazione persistita. Se si configura a metà giornata, il primo segmento parte dal residuo di quel momento: il consumo precedente già incluso nel saldo non viene addebitato di nuovo a `U`. La UI indica “dalla configurazione delle …”; dai giorni seguenti il periodo coincide con la giornata.

### Esempi sintetici verificabili

Calcoli interni con decimali a precisione adeguata o interi di unità minime; arrotondare solo la visualizzazione. Per plafond indivisibili mantenere il resto nel piano dei giorni successivi. Una percentuale arrotondata a 0 non deve innescare lo stop se il residuo preciso è positivo: visualizzare `<1%`.

| Caso | Dati | Risultato |
| --- | --- | --- |
| Inizio ciclo | `C=30 €`, `R=30`, `S=3`, `D=30`, `U=P=0` | `A=0,90 €`, batteria `100%` |
| Consumo di oggi | Come sopra, `U=0,36`, `P=0` | Residuo `0,54 €`, batteria `60%` |
| Operazione in corso | `A=0,90`, `U=0,36`, `P=0,18` | Libero `0,36 €`, batteria `40%` |
| Chiusura prenotazione | Il precedente `P=0,18` si chiude con costo reale `0,12` | `U=0,48`, `P=0`, batteria `46,6667%`; recupero della sola prenotazione eccedente |
| Risparmio | Giorno 1 consuma `0,36`; giorno 2 `R=29,64`, `S=3`, `D=29` | `A=26,64/29=0,91862069 €` |
| Eccedenza | Giorno 1 consuma `1,10`; giorno 2 `R=28,90`, `S=3`, `D=29` | Oggi `0%`; domani `A=25,90/29=0,89310345 €` |
| Ultimo giorno | `R=3,90`, `S=3`, `D=1` | `A=0,90 €`; la riserva resta protetta |
| Budget nullo | `C=R=S=0`, `D=30` | `A=0`, batteria `0%`, nessuna divisione per zero |
| Solo riserva o debito | `R≤S`, `D>0` | `A=0`, batteria `0%` |
| Rinnovo confermato | Nuovo ciclo `C=R=30`, nuova `S=3`, `D=30` | Nuova assegnazione `0,90 €`; vecchio ciclo resta nello storico |
| Finestra scaduta | `D=0` oppure `ora ≥ reset` | Non dividere: riconciliare/reset; non assumere nuova quota senza fonte o ciclo personale configurato |

Il rilascio di una prenotazione, un rimborso o una rettifica esplicita può far risalire la barra: deve esserci una causa visibile. Il normale consumo non la fa risalire attraverso un ricalcolo del denominatore.

## 3. Giorni, finestre e rinnovi

Default: tutti i giorni e fuso `Europe/Rome`. Ogni integrazione conserva il proprio rinnovo; nessun “mese” universale di 30 giorni. Un budget API personale senza rinnovo del provider usa un ciclo scelto dall’utente, marcato come tale.

Il ciclo è l’intervallo `[inizio, reset)`. `D` conta le date locali che intersecano l’intervallo da ora al reset escluso; oggi conta una volta. Un reset a mezzanotte esclude la nuova data, uno a metà giornata la include. Non usare ore residue divise per 24: i cambi di ora legale non creano o cancellano un giorno di budget.

Esempi: dal 28 settembre al 1º ottobre alle 00:00, `D=3` (28, 29, 30); dal 28 settembre al 1º ottobre alle 12:00, `D=4`. Un rinnovo a mezzogiorno apre un nuovo segmento di ciclo nello stesso giorno, etichettato “dopo il rinnovo”; non viene confuso con una ricarica arbitraria. Per ricorrenze personali al giorno 31 si usa l’ultimo giorno del mese breve, conservando il giorno 31 come ancoraggio per i mesi successivi. Reset provider espliciti prevalgono su questa regola personale.

Un plafond su più giorni si divide fino al suo reset reale: per esempio, residuo settimanale `70` unità, riserva `7`, sette giorni → `9` unità/giorno. Non viene trasformato in credito mensile. Finestre brevi o rolling, limiti di frequenza/concorrenza e reset non prevedibili vincolano l’avvio; senza una fine ciclo certa non alimentano quella formula. Più finestre possono bloccare contemporaneamente lo stesso modello.

L’orizzonte mensile proietta spesa configurata e continuità tra cicli noti. Per piani opachi mostra capacità futura non determinabile; non promette che un abbonamento permetta trenta giorni di lavoro costante. Una previsione può cambiare con uso esterno, disponibilità o tariffe.

## 4. Piani opachi e calibrazione

Quando manca un plafond numerico, creare una politica personale **stimata**. Scegliere una metrica effettivamente osservabile: per esempio token di usage riportati per quel pool, oppure turni Lagoto chiaramente indicati come proxy. Non ricavare token dal prezzo dell’abbonamento e non confrontare turni o token di runtime diversi come equivalenti.

La baseline automatica è la mediana del consumo degli **ultimi sette giorni attivi completi**, sullo stesso pool e nella stessa unità. “Attivo” significa almeno un consumo osservato positivo; “completo” significa giornata chiusa con registro riconciliato per la copertura dichiarata, senza intervalli ignoti. Servono sette giorni validi. I giorni inattivi non entrano nella mediana ma continuano a contare nella pianificazione su tutti i giorni.

Esempio sintetico nella medesima unità: `80, 100, 120, 90, 110, 70, 130` → mediana `100`. Questa è una stima del ritmo personale, **non** un limite del provider. La baseline viene congelata quando attivata e revisionata al ciclo personale successivo o con modifica esplicita, senza rincorrere automaticamente ogni eccedenza. Se la metrica cambia si riparte dalla calibrazione.

Per applicare lo stesso pianificatore, con baseline giornaliera `m`, `D0` giorni nel nuovo ciclo personale e riserva `r=0,10`, il plafond personale sintetico sarà `C=m×D0/(1−r)` e `S=r×C`; l’assegnazione iniziale risulterà `m`. Questo plafond è soltanto un limite autoimposto; non viene mostrato come credito acquistato. Un budget numerico personale esplicito ha priorità sulla baseline automatica e usa direttamente la formula della sezione 2.

Con meno di sette giorni validi e senza budget personale: **“In calibrazione”**, contatore `n/7`, consumo osservato e possibilità di impostare il budget iniziale. Nessuna percentuale 100% simulata. Se persino il proxy non è osservabile, indicare dato non disponibile. Una baseline basata sui soli consumi Lagoto mostra “copertura: solo Lagoto”, anche dopo la calibrazione.

Per il locale senza budget: **“Locale · disponibile”** quando il runtime è pronto. Una percentuale richiede un limite personale in una metrica misurabile, per esempio minuti di inferenza o token locali. RAM, temperatura, coda e contesto sono vincoli di disponibilità separati. Non attribuire un rinnovo provider a una risorsa locale.

## 5. Registro, prenotazioni e riconciliazione

P05 introduce il registro; P09 completa la politica. La contabilizzazione precede la grafica.

- Ogni addebito ha ID, pool, run/operazione se attribuibile, unità, ciclo, istante effettivo, fonte e stato. Rettifiche append-only fanno riferimento alla voce sostituita; non cancellano la provenienza.
- Prima di avviare operazioni concorrenti, prenotare atomicamente nel pool. Il risultato sostituisce la prenotazione con il consumo, non si somma a essa. Se il costo è incerto si usa una stima dichiarata; senza un tetto applicabile non esiste garanzia contro l’eccedenza.
- Snapshot account e usage delle run sono due viste dello stesso consumo. Dopo riconciliazione il residuo autorevole sostituisce la stima sull’intervallo coperto; non viene sottratto ancora tutto l’usage locale. Gli intervalli e i watermark devono impedire sovrapposizioni.
- L’incremento account non spiegato da eventi locali è consumo esterno solo se metrica e finestra sono comparabili; altrimenti resta “differenza non attribuibile”. Non inventare la run responsabile. Se attribuibile a oggi aumenta `U`; per periodi anteriori corregge il residuo futuro, senza riscrivere silenziosamente `A`.
- Se si scopre un saldo effettivo inferiore a quello pianificato, la disponibilità reale limita subito nuove partenze. Il budget di oggi resta tracciabile; un’eventuale riassegnazione richiede un evento di riconciliazione con prima/dopo e motivo.
- Se un’operazione attraversa mezzanotte o reset, le prenotazioni pendenti continuano a gravare sul saldo utilizzabile finché non sono risolte. All’apertura del giorno seguente `R` è al netto degli impegni precedenti ancora non contabilizzati; questi non vanno anche sottratti nel nuovo `P`. Una prenotazione conserva il riferimento all’assegnazione d’origine.
- Al risultato tardivo, liberazione dell’impegno e registrazione del costo sono atomiche. Usare l’istante di consumo del provider quando disponibile, mantenendo distinta la data contabile dalla riserva di origine. Una correzione su un’assegnazione chiusa influenza il saldo futuro; non crea retroattivamente credito spendibile oggi. Se il ciclo di addebito è incerto, mantenere l’impegno e richiedere riconciliazione.
- Se il parent contiene già il consumo dei figli, i figli sono dettaglio incluso. Non sommarli al totale. Sorgenti cumulative e incrementali devono dichiarare la loro semantica.

I timestamp del provider non autorizzano a sommare contatori con unità o scope diversi. Osservazioni fuori intervallo, reset incoerenti e valori invalidi vengono rifiutati. `stale` e `unavailable` non equivalgono a esaurito o illimitato. P00 determina la freschezza sostenibile per ogni fonte; P09 configura TTL, backoff e aggiornamento prima dell’avvio quando supportato. Un budget locale può restare leggibile con quota provider vecchia, mostrando disponibilità da verificare.

## 6. Soglie, pausa e deroghe

Avvisi alle soglie 20% e 10%, persistiti per assegnazione. Allo 0% bloccare nuovi turni; chiedere all’harness uno stop al primo punto sicuro, riconciliare e fare checkpoint. Se lo 0% deriva soltanto da prenotazioni, impedire nuove partenze e mostrare budget impegnato; l’operazione già coperta dalla prenotazione può raggiungere il proprio punto sicuro. Non revocare ciecamente un tool con effetti esterni a metà operazione.

Poi proporre un altro modello con budget/disponibilità distinti oppure `Deroga per oggi`. La deroga richiede quantità extra nella stessa unità, motivazione opzionale e riepilogo dell’effetto sui giorni successivi. Crea una revisione esplicita dell’assegnazione, scade a fine giornata o ciclo e non azzera il consumo. Non attinge alla riserva senza indicazione esplicita, non acquista crediti e non può superare un blocco del provider. Cambiare account o usare API a pagamento richiede una scelta distinta.

Un’interruzione client non prova che una richiesta remota abbia smesso di consumare. Le schede distinguono `limite applicabile` da `stima/controllo all’avvio`; gli impegni incerti restano visibili. Il sistema punta a distribuire il budget, non a garantire spesa esatta quando il servizio non offre controllo sufficiente.

Accettazione: [P05 e P09 nella roadmap](../ROADMAP.md), scenari `BAT-*` in [Validazione](validation.md). I calcoli sopra sono esempi documentali; non derivano da test live o consumi personali.
