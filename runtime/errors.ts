/** Failure causes shown to the user; each maps to a concrete next action. A cause is never guessed from silence. */
export type FailureCause = 'server_unavailable' | 'model_missing' | 'model_load' | 'queue_busy' | 'network_denied' | 'network' | 'quota' | 'credit' | 'auth' | 'process' | 'tool' | 'capability_missing' | 'unknown';
export type Failure = { cause: FailureCause; action: string };

const rules: { cause: FailureCause; pattern: RegExp; action: string }[] = [
  { cause: 'capability_missing', pattern: /capability not available|method not found|-32601|non supportat[oa]/i, action: 'Il provider non espone questa funzione: nessuna capacità viene simulata.' },
  { cause: 'credit', pattern: /insufficient[_ ](credit|funds|balance)|payment required|\b402\b|billing|out of credits|credit balance/i, action: 'Ricarica il credito del provider o scegli un altro profilo; nessuna spesa alternativa viene avviata.' },
  { cause: 'quota', pattern: /rate[_ -]?limit|quota|usage limit|too many requests|limit reached|\b429\b(?!.*queue)/i, action: 'Attendi il reset del limite o scegli un altro modello; il lavoro è salvato.' },
  { cause: 'auth', pattern: /\b401\b|\b403\b|unauthori[sz]ed|invalid (api )?key|authenticat|oauth|session (has )?expired|not logged in|accesso .* non utilizzabile|chiave api richiesta/i, action: 'Rinnova l’accesso in Integrazioni.' },
  { cause: 'model_load', pattern: /error loading model|failed to load model|llama runner (process )?(has )?terminated|out of memory|insufficient (system )?memory|unable to allocate/i, action: 'Il modello non si è caricato: libera memoria o scegli un modello più piccolo.' },
  { cause: 'model_missing', pattern: /model .*(not found|does not exist|not available)|no such model|\b404\b.*model|model.*\b404\b|unknown model|pull the model/i, action: 'Il modello non è disponibile sul server: scaricalo o scegline un altro.' },
  { cause: 'server_unavailable', pattern: /ECONNREFUSED|connection refused|fetch failed|server .*(not running|non disponibile|spento)|connect ECONNREFUSED/i, action: 'Avvia il server locale (per esempio Ollama) e riprova.' },
  { cause: 'queue_busy', pattern: /\bbusy\b|queue(d)? full|server is (busy|overloaded)|\b503\b|\b529\b|overloaded|retry after/i, action: 'Il server è occupato: attendi o riprova più tardi.' },
  { cause: 'network_denied', pattern: /\bEPERM\b|operation not permitted|ENETUNREACH|EHOSTUNREACH|network (is )?(unreachable|disabled|denied)/i, action: 'La rete è bloccata dalla policy della run; consenti l’accesso o usa un profilo locale.' },
  { cause: 'network', pattern: /ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|timed? ?out|network error/i, action: 'Controlla la connessione e riprova.' },
  { cause: 'tool', pattern: /tool (call )?(failed|error)|strumento|command failed|exit code [1-9]|permesso rifiutato|operazione rifiutata/i, action: 'Uno strumento ha fallito: apri la run per i dettagli.' },
  { cause: 'process', pattern: /terminato senza|process (exited|terminated)|killed|signal|segmentation|crash/i, action: 'Il processo dell’agente si è chiuso: riconcilia la run e riprova.' },
];

export function classifyFailure(message: string | undefined | null): Failure {
  const text = String(message ?? '');
  for (const rule of rules) if (rule.pattern.test(text)) return { cause: rule.cause, action: rule.action };
  return { cause: 'unknown', action: 'Causa non riconosciuta: apri i dettagli della run.' };
}
