# Revisione della consegna documentale

**Data:** 28 settembre 2026.

**Ambito:** README, roadmap e documenti Markdown in `docs/`.

**Esito:** controlli documentali completati; nessuna fase applicativa chiusa.

## Controlli effettuati

- Coerenza di perimetro: integrazioni native/API/locali, tre aree UI, batteria personale distinta dalla quota, contesto persistente e GitHub esplicito.
- Presenza delle 13 fasi P00–P12 e corrispondenza univoca di 88 requisiti con i rispettivi test di accettazione pianificati. Nessuna checkbox applicativa spuntata.
- Esistenza dei link locali e degli anchor Markdown; codice recintato correttamente; controllo degli spazi finali e del diff.
- Fonti scientifiche con versione/data ove identificabili, risultati e limiti; fonti dei produttori separate e data di consultazione indicata. Nessun benchmark attribuito a Lagoto.
- Diciotto controlli aritmetici tramite Python standard library: assegnazione, consumo, prenotazione e saldo effettivo; risparmio/eccedenza; ultimo giorno; budget nullo/riserva; D=0; riserva su un ciclo intero; reset a mezzanotte/mezzogiorno; ora legale primaverile/autunnale in Europe/Rome; mediana; baseline con riserva; plafond settimanale.

## Risultati numerici controllati

Con 30 € e riserva 3 € su trenta giorni: 0,90 €/giorno; consumo 0,36 € → 60%; prenotazione aggiuntiva 0,18 € → 40%. Chiudendo quella prenotazione a 0,12 €, il residuo risulta 46,6667%. Il giorno successivo al consumo di 0,36 € riceve circa 0,91862069 €; dopo un consumo di 1,10 €, circa 0,89310345 €.

Gli esempi usano decimali e date sintetiche. Il controllo è stato eseguito in memoria, senza aggiungere codice applicativo o una suite di test al repository. Le formule e gli input sono riproducibili dal documento [Batteria giornaliera](../daily-battery.md).

## Limiti del controllo

Nessuna app è stata costruita o eseguita. Nessuna installazione, autenticazione, chiamata di inferenza, lettura di consumi personali, creazione repository, commit o push è stata effettuata. Nessuna compatibilità runtime, prestazione di modello o applicazione di un limite è attestata.

Il controllo dei link locali non certifica disponibilità futura dei siti esterni. Gli smoke, i casi di concorrenza, la riconciliazione provider e i test GitHub restano requisiti da implementare secondo [Validazione](../validation.md). La scelta Qwen Code mantiene il gate sperimentale P00.
