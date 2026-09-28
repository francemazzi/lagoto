# Fonti tecniche

**Data di consultazione di tutte le voci:** 28 settembre 2026, durante l’analisi e la preparazione di questa documentazione. Sono fonti primarie dei produttori o dei protocolli. Sono pagine vive, non versioni software certificate. Prima dell’implementazione, fissare versione, licenza e capacità nella [matrice](compatibility.md).

Le fonti scientifiche hanno schede e versioni separate in [Ricerca](research.md). Le valutazioni di architettura e i parametri della batteria sono scelte di Lagoto, non risultati attribuiti ai produttori.

## Harness, autenticazione e inferenza

| ID | Fonte | Che cosa sostiene |
| --- | --- | --- |
| T01 | [Codex App Server](https://learn.chatgpt.com/docs/app-server) · [URL ufficiale di ingresso](https://developers.openai.com/codex/app-server/) | Sessioni, eventi, account e rate limits; la documentazione d’ingresso consultata reindirizza alla prima pagina |
| T02 | [Claude Code programmatico](https://code.claude.com/docs/en/headless) | Percorso CLI ed eventi strutturati |
| T03 | [Claude Code: legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) | Distinzioni d’uso per binario ufficiale e credenziali; da ricontrollare prima della distribuzione |
| T04 | [Claude Agent SDK quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart) | Percorso SDK distinto, non autorizzazione a riusare indistintamente credenziali subscription |
| T05 | [Qwen Code SDK TypeScript](https://qwenlm.github.io/qwen-code-docs/en/developers/sdk-typescript/) | SDK sperimentale, processo incluso, requisiti e superfici di controllo |
| T06 | [Qwen Code auth](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/) | Percorsi attuali e cessazione del free tier OAuth indicata dalla pagina |
| T07 | [Qwen Code model providers](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/model-providers/) | Configurazione dei provider e server locali; non certifica tutte le combinazioni |
| T08 | [Qwen serve](https://qwenlm.github.io/qwen-code-docs/en/users/qwen-serve/) | Daemon e confine di autorità del servizio locale |
| T09 | [Kimi: variabili](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/env-vars.html) | Destinazioni distinte di Kimi Code gestito e API Moonshot |
| T10 | [Kimi CLI reference](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html) | Modalità del CLI, incluso percorso ACP |
| T11 | [Ollama: compatibilità OpenAI](https://docs.ollama.com/api/openai-compatibility) | Compatibilità parziale e differenza fra server locale e inferenza locale |
| T12 | [Ollama FAQ](https://docs.ollama.com/faq) | Risorse, concorrenza, coda e caricamento dei modelli |
| T13 | [OpenCode SDK](https://opencode.ai/docs/sdk/) | Alternativa TypeScript con client/server e sessioni |
| T14 | [OpenCode providers](https://opencode.ai/docs/providers/) | Provider configurabili nell’alternativa confrontata |
| T15 | [Cursor ACP](https://cursor.com/docs/cli/acp) | Percorso candidato per l’adapter successivo |

## Protocolli e servizi multi-agent

| ID | Fonte | Implicazione per la specifica |
| --- | --- | --- |
| T16 | [Agent Client Protocol v1](https://agentclientprotocol.com/protocol/v1/overview) | Capability negoziabili al confine client–agente; nessuna uniformità implicita di quota o memoria |
| T17 | [A2A specification](https://a2a-protocol.org/latest/specification/) | Interoperabilità tramite task e artefatti; Lagoto deve comunque definire prove, revisioni e permessi |
| T18 | [Grok: multi-agent](https://docs.x.ai/developers/model-capabilities/text/multi-agent) | Il servizio orchestra internamente; leader e stato cifrato dei figli hanno visibilità diversa |

### Grok: ciò che il client può osservare

La guida multi-agent consultata restituisce tool call e risposta del leader; lo stato degli altri agenti è cifrato e disponibile tramite l’opzione indicata dal servizio. Descrive strumenti server/built-in e remote MCP, limitazioni sui tool client personalizzati e incompatibilità con Chat Completions per quel percorso; i consumi degli agenti e degli strumenti concorrono al costo. Queste proprietà non vanno estese automaticamente a ogni modello Grok.

La guida specifica e le schede generali possono presentare capability differenti: una futura integrazione deve fissare variante/API e verificarle, senza costruire un albero dei figli da testo della risposta o considerare esportabile lo stato cifrato. Grok resta ricerca e possibile estensione, non un harness selezionato per l’MVP. Fonte T18, consultata il 28 settembre 2026; non è un paper scientifico.

## Desktop e Git

| ID | Fonte | Ambito |
| --- | --- | --- |
| T19 | [Tauri sidecar](https://v2.tauri.app/develop/sidecar/) | Avvio di processi esterni nel pacchetto |
| T20 | [Tauri Node.js sidecar](https://v2.tauri.app/learn/sidecar-nodejs/) | Percorso da provare per il backend TypeScript |
| T21 | [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/) | Percorso di test da validare sulla versione e sul target macOS; test browser e nativo restano distinti |
| T22 | [Tauri security](https://v2.tauri.app/security/) | Modello di sicurezza e capability del bridge |
| T23 | [Git worktree](https://git-scm.com/docs/git-worktree) | Directory di lavoro distinte; il lock di Git non è un mutex generale delle scritture |
| T24 | [GitHub CLI auth login](https://cli.github.com/manual/gh_auth_login) | Login ufficiale, credential store e possibile fallback in chiaro |
| T25 | [GitHub CLI repo view](https://cli.github.com/manual/gh_repo_view) | Identificazione del repository remoto |
| T26 | [GitHub CLI repo create](https://cli.github.com/manual/gh_repo_create) | Creazione privata da sorgente locale e primo push |

## Regola per aggiornare le fonti

Una pagina aggiornata non rende automaticamente compatibile Lagoto. Annotare nuova consultazione, versione interessata, differenza osservata e test necessario. Se un documento contraddice un altro, preferire la specifica del percorso esatto e mantenere la capability non verificata fino al probe. Non dedurre supporto da esempi legacy o usare endpoint privati per riempire lacune di telemetria.
