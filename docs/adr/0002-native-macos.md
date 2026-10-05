# ADR 0002 — App nativa e prima beta macOS

Data: 5 ottobre 2026. Decisione approvata dall’utente; gate di fattibilità ancora aperto.

Il desktop usa SwiftUI e AppKit, con identificativo `org.frasma.lagoto`, destinazione macOS 15+ su Apple Silicon. Questa decisione sostituisce Tauri/React/Rust e l’ipotesi Prisma di ADR 0001; conserva task persistenti, adapter distinti, un writer per worktree e nessun secondo planner.

Il coordinatore TypeScript usa Node 22.23.1 incluso nel bundle, better-sqlite3 13.0.3 e Qwen SDK 0.1.17. Il client nativo avvia il coordinatore mediante stdin/stdout privati, JSON-RPC v1, identificativi, validazione e timeout. Nessun server HTTP di Lagoto. Git, gh, CLI native e Ollama sono esterni e rilevati senza installazioni o aggiornamenti silenziosi.

La UI resta organizzata per progetti espandibili e task. Composer essenziale, inspector chiuso all’avvio, controlli subordinati alle capacità provate. Swift Codable e TypeScript devono essere verificati sulle stesse fixture; XCTest e XCUITest sostituiscono il percorso WebDriver inizialmente ipotizzato.

Cursor ACP è obbligatorio nella v0.1.0: il gate P10 e le sue regressioni bloccano la release. La distribuzione richiede tutti i gate P00–P12, firma Developer ID con Hardened Runtime, notarizzazione, ticket validati, DMG arm64, licenze, checksum, tag e prerelease GitHub. Non è sufficiente una build compilata o firmata.

Lo spike ha provato Node incluso → IPC → SQLite senza Node nel PATH. Con firma ad-hoc il modulo SQLite non può essere caricato mantenendo la library validation di Hardened Runtime; Debug usa firma ad-hoc senza Hardened Runtime. Release firma Node e componenti Mach-O con lo stesso Developer ID e mantiene Hardened Runtime. Node riceve soltanto `com.apple.security.cs.allow-jit`; il test SQLite della build firmata è riuscito. Il collaudo completo di tutti gli adapter nel bundle firmato resta obbligatorio.

Per Qwen e Kimi l’utente ha autorizzato OpenRouter come percorso di prova. Questi smoke sono registrati con endpoint e modelli distinti; non provano l’accesso diretto QwenCloud/Moonshot e non abilitano un fallback implicito nel prodotto.

Risultati, versioni, limiti e impedimenti effettivi: [report di implementazione](../evidence/implementation-2026-10-05.md). Le checkbox rimangono aperte finché ogni criterio del relativo test non è soddisfatto.
