import type Database from 'better-sqlite3';

type JournalEvent = { seq: number; id: string; task_id: string; run_id: string | null; kind: string; payload: string };
/** Deterministic projection of the durable, redacted journal. Raw provider events stay in events. */
export function projectEvent(db: Database.Database, event: JournalEvent) {
  const p = JSON.parse(event.payload); const body = p.payload ?? p;
  const upsert = (id: string, kind: string, text: string, detail: unknown, append = false) => {
    db.prepare(`INSERT INTO transcript(id,task_id,run_id,kind,text,detail,first_seq,last_seq) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET text=${append ? 'transcript.text || excluded.text' : 'excluded.text'},detail=excluded.detail,last_seq=excluded.last_seq`)
      .run(id,event.task_id,event.run_id,kind,text,JSON.stringify(detail ?? {}),event.seq,event.seq);
  };
  if (event.kind === 'raw' || event.kind === 'usage') return;
  if (['text','text_snapshot','reasoning','reasoning_snapshot'].includes(event.kind)) {
    if (typeof p.text !== 'string') return;
    const last = db.prepare('SELECT id,kind FROM transcript WHERE run_id=? ORDER BY first_seq DESC LIMIT 1').get(event.run_id) as {id:string;kind:string}|undefined;
    // Providers without item IDs receive contiguous blocks, separated by tools and other messages.
    const snapshot=event.kind.endsWith('_snapshot');
    const kind=snapshot?event.kind.slice(0,-9):event.kind;
    const id = p.itemId ? `${event.run_id}:${kind}:${p.itemId}` : last?.kind === kind ? last.id : event.id;
    upsert(id,kind,p.text,{},!snapshot); return;
  }
  if (event.kind === 'result') {
    if (typeof p.text !== 'string' || !p.text) return;
    const rows = db.prepare("SELECT id,text FROM transcript WHERE run_id=? AND kind='text' ORDER BY first_seq").all(event.run_id) as {id:string;text:string}[];
    const last = rows.at(-1);
    if (rows.map(r=>r.text).join('') === p.text || last?.text === p.text) return;
    if (last && p.text.startsWith(last.text)) upsert(last.id,'text',p.text,{final:true});
    else upsert(event.id,'text',p.text,{final:true});
    return;
  }
  if (event.kind === 'permission_result') {
    const id = `${event.run_id}:permission:${p.id}`;
    const old = db.prepare('SELECT text,detail FROM transcript WHERE id=?').get(id) as {text:string;detail:string}|undefined;
    if (old) upsert(id,'permission',old.text,{...JSON.parse(old.detail),answered:true,allow:p.allow});
    return;
  }
  if (event.kind === 'child') {
    if (typeof body.childId !== 'string') return;
    const id = `${event.run_id}:child:${body.childId}`;
    const old = db.prepare('SELECT text,detail FROM transcript WHERE id=?').get(id) as {text:string;detail:string}|undefined;
    upsert(id,'child',body.title ?? old?.text ?? '',{...(old ? JSON.parse(old.detail) : {}),...body});return;
  }
  if (event.kind === 'plan') { if (Array.isArray(body.entries)) upsert(`${event.run_id}:plan`,'plan','',{entries:body.entries}); return; }
  if (event.kind === 'permission') { upsert(`${event.run_id}:permission:${p.id}`,'permission',p.tool,p); return; }
  if (event.kind === 'tool') {
    const toolId = body.id ?? body.toolCallId ?? body.tool_use_id;
    const id = toolId ? `${event.run_id}:tool:${toolId}` : event.id;
    const old = db.prepare('SELECT detail FROM transcript WHERE id=?').get(id) as {detail:string}|undefined;
    const detail = {...(old ? JSON.parse(old.detail) : {}),...body,...(typeof p.category==='string'?{category:p.category}:{})};
    upsert(id,'tool',detail.title ?? detail.name ?? detail.type ?? 'Strumento',detail); return;
  }
  if (['user','error','run_state','checkpoint','handoff','queue','verification'].includes(event.kind))
    upsert(event.id,event.kind,p.text ?? p.message ?? '',body);
}

export function transcript(db: Database.Database, taskId: string, before?: number) {
  // Read a bounded page of projected blocks, never replay 100,000 raw events on a task switch.
  const rows = db.prepare('SELECT * FROM transcript WHERE task_id=? AND first_seq<? ORDER BY first_seq DESC LIMIT 200').all(taskId,before ?? Number.MAX_SAFE_INTEGER) as { detail:string; first_seq:number }[];
  return { blocks: rows.reverse().map(row=>({...row,detail:JSON.parse(row.detail)})), hasEarlier: rows.length === 200,
    cursor: rows[0]?.first_seq ?? 0 };
}
