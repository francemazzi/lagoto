# Lagoto
<p align="center">
  <img src="assets/lagoto-banner.jpg" alt="Lagoto: una persona e il suo cane lungo un sentiero tra le colline" width="100%">
</p>


**Gli agenti cambiano. Il lavoro resta.**

Lagoto è un progetto open source per un’app desktop local-first che riunisce agenti di coding, modelli cloud e modelli locali in un’unica interfaccia. L’obiettivo è scegliere come lavorare e conservare lo stato verificabile del task quando si cambia modello.

## La visione

**Collega le integrazioni.** Un’area dedicata a login nativi, provider API, piano, rinnovo e modelli abilitati. Sono pianificati Codex e Claude Code tramite i percorsi ufficiali, Qwen cloud e Kimi API tramite Qwen Code, e modelli locali tramite Ollama. Cursor ACP è incluso nei requisiti della prima beta. Ogni combinazione richiede una verifica di compatibilità.

**Scegli un modello disponibile.** La “batteria” prevista indica quanto budget personale resta oggi, dal 100% allo 0%, distribuendo il residuo fino al rinnovo. Quote condivise restano condivise anche cambiando modello. Dati del provider e stime sono distinti; senza dati sufficienti comparirà “In calibrazione”. Il budget aiuta a pianificare il mese, senza garantire la capacità degli abbonamenti.

**Un progetto, uno o più repository.** Backend, frontend e desktop nello stesso progetto, senza un livello workspace. Aggiungendo una cartella, Lagoto dovrà riconoscere Git e il collegamento GitHub esistente. Se manca, proporrà la creazione di un repository privato con anteprima dei contenuti e un clic su “Crea e collega”.

**Il task resta quando cambia il modello.** Obiettivo, istruzioni, decisioni, file, verifiche e azioni aperte saranno persistenti. Il passaggio userà stop verificato, checkpoint e un contesto adatto al destinatario. Allo 0% verranno proposti pausa, altro modello o deroga per oggi: nessun cambio automatico.

**Consegna consapevole.** Modifiche e verifiche saranno revisionabili per repository; commit e push successivi saranno azioni esplicite. Un modello locale senza plafond apparirà come “Locale · disponibile”, con i propri limiti di risorse e capacità.

Lagoto non vuole essere un altro IDE né un nuovo agente: vuole conservare lo stato verificabile del lavoro e rendere semplice affidarlo all’agente successivo.

## Stato

Sviluppo avviato per macOS 15+ su Apple Silicon, con SwiftUI e Node incluso. Sono presenti uno spike nativo, persistenza, adapter e prove reali parziali. **La beta v0.1.0 non è ancora rilasciabile:** i gate P00–P12 restano aperti e il percorso completo nella UI non è implementato. [Stato preciso, comandi ed evidenze](docs/evidence/implementation-2026-10-05.md). Non serve un account Lagoto.

[Roadmap di sviluppo](ROADMAP.md) · [Documentazione e ricerca](docs/README.md) · [Calcolo della batteria](docs/daily-battery.md) · [Licenza](LICENSE)

## Sviluppo locale

Richiede Xcode, XcodeGen, Node 22.23.1 e pnpm 10.33.3 sulla macchina di sviluppo. Il bundle risultante include Node; gli utenti finali non dovranno installarlo.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm gate P00
pnpm gate all
```

I gate restituiscono un errore finché mancano le prove obbligatorie. `build/Xcode/Build/Products/Debug/Lagoto.app` è uno spike locale, non la beta. Gli smoke reali e il packaging Developer ID sono documentati nel report; nessuna chiave è richiesta per i test deterministici.
