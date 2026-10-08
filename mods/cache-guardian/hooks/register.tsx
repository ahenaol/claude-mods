import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Guardian, Handoff, QuotaWindow } from '../types'
import {
  HANDOFF_PROMPT,
  HANDOFF_TTL_MS,
  legend,
  PACE_COLOR,
  WINDOWS,
  autoLeadMs,
  behindOf,
  cacheStatus,
  formatClock,
  hasHistory,
  isCommandText,
  contextHint,
  effectiveTtl,
  effortAfterCommand,
  formatModel,
  formatProjection,
  formatSpan,
  formatTokens,
  handoffFile,
  showResumeWarm,
  isHighEffort,
  learnTtl,
  ttlMs,
  padPercent,
  barRuns,
  formatShort,
  quotaView,
} from './logic'
import type { Ttl } from './logic'

const lastEnd = atom({ plugin: 'cache-guardian', key: 'lastEnd' } as const, null as number | null)
const tokens = atom({ plugin: 'cache-guardian', key: 'tokens' } as const, 0)
const isBusy = atom({ plugin: 'cache-guardian', key: 'isBusy' } as const, false)
const turns = atom({ plugin: 'cache-guardian', key: 'turns' } as const, 0)
const tick = atom({ plugin: 'cache-guardian', key: 'tick' } as const, 0)
const quota = atom({ plugin: 'cache-guardian', key: 'quota' } as const, [] as QuotaWindow[])
const handoff = atom({ plugin: 'cache-guardian', key: 'handoff' } as const, null as Handoff | null)
const isWriting = atom({ plugin: 'cache-guardian', key: 'isWriting' } as const, false)
const isAttaching = atom({ plugin: 'cache-guardian', key: 'isAttaching' } as const, false)
const isTaskDone = atom({ plugin: 'cache-guardian', key: 'isTaskDone' } as const, false)
const pending = atom({ plugin: 'cache-guardian', key: 'pending' } as const, null as Handoff | null)
const guardian = atom({ plugin: 'cache-guardian', key: 'guardian' } as const, null as Guardian | null)
const windowSize = atom({ plugin: 'cache-guardian', key: 'windowSize' } as const, 0)
const modelName = atom({ plugin: 'cache-guardian', key: 'modelName' } as const, '')
const effortLevel = atom({ plugin: 'cache-guardian', key: 'effortLevel' } as const, '')
const quotaAt = atom({ plugin: 'cache-guardian', key: 'quotaAt' } as const, 0)
// Conversación a la que pertenece el estado: cambia con /clear y con /resume, que no disparan session.start.
const sessionKey = atom({ plugin: 'cache-guardian', key: 'sessionKey' } as const, '')
// Carga dueña de los temporizadores: los de una carga anterior (antes de recargar la mod) se apagan solos.
const owner = atom({ plugin: 'cache-guardian', key: 'owner' } as const, '')

const PANE = 'cg-guardian'
const LOAD = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
// Lo que se guarda por conversación caduca a los 30 días.
const KEEP_MS = 30 * 24 * 3_600_000

// Opciones y estado del módulo (se reinician en cada recarga; lo persistente vive en $.state y $.store).
let cfg = {
  minTokens: 40000,
  softTokens: 100000,
  hardTokens: 150000,
  quotaWarn: 90,
  fullPercent: 70,
  longTurns: 30,
  ttl: 'auto',
  autoHandoff: true,
  showQuota: true,
  showModel: true,
}
let probe: { gapMs: number; tokens: number } | null = null
let warned = 0
let bypass = false
let autoTimer: { cancel: () => void } | null = null
// Conversación que acaba de terminar (/clear, /resume): mientras el motor no pase a la siguiente,
// sync no la restaura de nuevo.
let endedId = ''
// Si algún paso del turno en curso llegó a la API (renovó la caché).
let isStepAnswered = false
// Retomar limpio en curso: dos clics seguidos no limpian dos veces.
let isResuming = false

const loadTtl = async ($: any): Promise<Ttl> =>
  effectiveTtl(String(cfg.ttl), ((await $.store.get('cg.ttl')) as Ttl | null) ?? null)

// Claves de $.store. La de carpeta guarda el último handoff para ofrecerlo al abrir una conversación
// nueva ahí; las de conversación guardan su propio handoff y cuándo respondió por última vez.
const folderKey = (cwd: string) => `cg.handoff.${cwd}`
const ownKey = (id: string) => `cg.ho.${id}`
const lastKey = (id: string) => `cg.last.${id}`

// `n`: turnos respondidos en la conversación, contados por la mod. `$.session.turns()` también cuenta
// las filas de los comandos (/clear, /effort, /handoff), así que no sirve para saber cuántos turnos
// no incluye un handoff. Falta en lo guardado antes de la versión 3.3.
type Last = { at: number; tokens: number; n?: number }

const asHandoff = (v: unknown): Handoff | null => (v && typeof v === 'object' ? (v as Handoff) : null)

// Un handoff vale 7 días. El de carpeta además se ofrece una sola vez.
const fresh = (h: Handoff | null, now: number): Handoff | null => (h && now - h.at < HANDOFF_TTL_MS ? h : null)
const offerable = (h: Handoff | null, now: number): Handoff | null => (h && !h.isConsumed ? fresh(h, now) : null)

// Guarda por conversación la última respuesta y los turnos, para que un --continue, un /resume o una
// recarga de la mod sepan si la caché sigue tibia y cuántos turnos lleva.
async function remember($: any) {
  const id = await read($, sessionKey)
  if (!id) return
  const last: Last = { at: (await read($, lastEnd)) ?? 0, tokens: await read($, tokens), n: await read($, turns) }
  await $.store.set(lastKey(id), last)
}

// La caché se renueva con cada solicitud que llega a la API.
async function touch($: any, at: number) {
  await update($, lastEnd, () => at)
  await remember($)
}

// Estado de la conversación activa, leído del motor y de $.store. Se llama al arrancar, al recargar
// y cuando la conversación cambia sin session.start (/clear, /resume dentro de la sesión).
async function restore($: any) {
  const id = String(await $.session.id())
  const cwd = await $.session.cwd()
  const now = await $.clock.now()
  const messages = await $.session.messages()
  await update($, sessionKey, () => id)
  await update($, turns, () => 0)
  await update($, isTaskDone, () => false)
  probe = null
  warned = 0
  endedId = ''
  autoTimer?.cancel()
  autoTimer = null

  if (!hasHistory(messages)) {
    // Conversación nueva (al abrir claude o tras /clear): se ofrece el handoff de la carpeta, si no
    // hay ya uno en camino (el de Retomar limpio o el de un /clear escrito a mano).
    await update($, lastEnd, () => null)
    await update($, tokens, () => 0)
    await update($, handoff, () => null)
    const offer = offerable(asHandoff(await $.store.get(folderKey(cwd))), now)
    if (offer && !(await read($, pending))) {
      await update($, pending, () => offer)
      await update($, isAttaching, () => false)
    }

    return
  }

  // Conversación con historia (--continue, --resume, /resume o recarga de la mod).
  await update($, pending, () => null)
  await update($, isAttaching, () => false)
  const last = (await $.store.get(lastKey(id))) as Last | null
  // Sin conteo propio (guardado antes de la 3.3) se parte del motor, la misma cuenta de esos handoffs.
  const legacy = Number(await $.session.turns().catch(() => NaN))
  await update($, turns, () =>
    typeof last?.n === 'number' ? last.n : Number.isFinite(legacy) ? legacy : messages.filter((m: any) => m.role === 'assistant').length,
  )
  const usage = await $.session.usage().catch(() => null)
  const tk =
    usage?.context?.tokens ??
    last?.tokens ??
    // Sin medición todavía: estimación gruesa (4 caracteres por token) para que el guardián actúe.
    Math.round(messages.reduce((sum: number, m: any) => sum + String(m.text ?? '').length, 0) / 4)
  await update($, tokens, () => tk)
  if (usage?.context?.window) await update($, windowSize, () => usage.context.window)
  // Sin registro de la última respuesta, la caché se da por fría: cuesta lo mismo equivocarse y no avisar.
  await update($, lastEnd, () => last?.at ?? 0)
  // Solo el handoff propio. El de carpeta sin conversación (versión anterior) no se adopta: puede ser
  // de otra, y sus turnos no se comparan con los de esta, así que la franja lo daba por al día.
  const own = fresh(asHandoff(await $.store.get(ownKey(id))), now)
  await update($, handoff, () => own)
  if (last) {
    const status = cacheStatus(last.at, await loadTtl($), now)
    if (status.kind === 'cold' && tk > cfg.minTokens) {
      $.ui.toast(
        `Caché fría: re-cachear ${formatTokens(tk)} tokens. ` + (own ? 'Tienes handoff: prueba /retomar.' : 'Considera compactar.'),
        { timeoutMs: 9000 },
      )
    }
  }
  // Tras recargar la mod o retomar con la caché tibia, el handoff automático sigue en pie.
  await scheduleAuto($)
}

// Si la conversación cambió sin session.start, rehace el estado antes de usarlo. Devuelve false si
// el motor todavía no pasó a la conversación siguiente (restaurar ahora traería la que terminó).
async function sync($: any): Promise<boolean> {
  try {
    const id = String(await $.session.id())
    if (id === (await read($, sessionKey))) return true
    if (id === endedId && hasHistory(await $.session.messages())) return false
    await restore($)
  } catch {
    // Sin poder leer la conversación se sigue con el estado que hay: la franja y los mensajes no se caen.
  }

  return true
}

// Desde el dibujo y tras /clear o /resume: la puesta al día corre aparte, una sola a la vez, y se
// reintenta hasta que el motor haya pasado a la conversación siguiente (como mucho unos 10 s).
let isSyncQueued = false
function queueSync($: any, tries = 0) {
  if (isSyncQueued) return
  isSyncQueued = true
  $.clock.after(tries === 0 ? 0 : 250, async () => {
    let isSettled = true
    try {
      isSettled = await sync($)
    } finally {
      isSyncQueued = false
    }
    if (!isSettled && tries < 40) queueSync($, tries + 1)
  })
}

// Borra lo guardado que ya caducó y las claves de versiones anteriores (`cg.last./ruta`, `handoff:ruta`).
async function prune($: any) {
  const now = await $.clock.now()
  for (const k of (await $.store.keys()) as string[]) {
    if (k.startsWith('cg.last./') || k.startsWith('handoff:')) {
      await $.store.delete(k)
    } else if (k.startsWith('cg.last.') || k.startsWith('cg.ho.') || k.startsWith('cg.handoff.')) {
      const v = (await $.store.get(k)) as { at?: number } | null
      if (!v || typeof v.at !== 'number' || now - v.at > KEEP_MS) await $.store.delete(k)
    }
  }
}

type Written = { ok: true; value: Handoff } | { ok: false; why: string }

const FORK_FAILURE: Record<string, string> = {
  'nothing-to-fork': 'la conversación todavía no tiene respuestas',
  'api-error': 'la API devolvió un error',
  'empty-reply': 'el modelo respondió vacío',
  aborted: 'se interrumpió',
}

// Escribe el handoff con una consulta aparte sobre la caché tibia y lo guarda en $.store y en disco.
async function writeHandoff($: any): Promise<Written> {
  // Un solo handoff a la vez: dos clics seguidos no lanzan dos consultas.
  // La marca se pone antes de cualquier espera, para que dos llamadas seguidas no pasen las dos.
  if (await read($, isWriting)) return { ok: false, why: 'ya se está escribiendo uno' }
  await update($, isWriting, () => true)
  try {
    // Se escribe para la conversación activa: si cambió sin que la mod se enterara, primero se rehace.
    await sync($)
    const id = await read($, sessionKey)
    if (!id) return { ok: false, why: 'la conversación está cambiando, prueba de nuevo en un momento' }
    // Los turnos se cuentan antes de la consulta: lo que llegue mientras tanto no queda incluido.
    const at = await read($, turns)
    const r = await $.model.fork({ prompt: HANDOFF_PROMPT })
    if (!r.isAnswered) {
      const status = r.reason === 'api-error' && r.status ? ` (${r.status})` : ''
      return { ok: false, why: `${FORK_FAILURE[r.reason] ?? r.reason}${status}` }
    }
    if (!r.text.trim()) return { ok: false, why: FORK_FAILURE['empty-reply']! }
    // La conversación cambió mientras se escribía (/clear, /resume): este handoff ya no es de la activa.
    if ((await read($, sessionKey)) !== id) return { ok: false, why: 'la conversación cambió mientras se escribía' }

    const cwd = await $.session.cwd()
    const now = await $.clock.now()
    const value: Handoff = { text: r.text.trim(), at: now, turns: at, cwd, sessionId: id, isConsumed: false }
    await $.store.set(ownKey(id), value)
    await $.store.set(folderKey(cwd), value)
    await update($, handoff, () => value)
    // La consulta leyó la caché: el reloj de vencimiento vuelve a empezar.
    await touch($, now)
    try {
      const home = await $.env.get('HOME')
      const stamp = new Date(now).toLocaleString('es-CO', { hour12: false })
      await $.fs.write(`${home}/.claude/handoffs/${handoffFile(cwd)}`, `<!-- handoff · ${stamp} · ${cwd} -->\n\n${value.text}\n`)
    } catch {
      // La copia en disco es para leerla a mano; el handoff ya quedó guardado.
      $.ui.toast('Handoff guardado, pero no se pudo escribir su copia en ~/.claude/handoffs', { timeoutMs: 6000 })
    }

    return { ok: true, value }
  } finally {
    await update($, isWriting, () => false)
  }
}

// Para los botones y el automático: si falla, lo dice.
async function writeOrWarn($: any): Promise<Handoff | null> {
  const r = await writeHandoff($)
  if (!r.ok) $.ui.toast(`No se escribió el handoff: ${r.why}.`, { timeoutMs: 6000 })

  return r.ok ? r.value : null
}

async function consume($: any, h: Handoff) {
  // Solo se marca el de carpeta si sigue siendo este: uno más nuevo de otra conversación se respeta.
  const stored = asHandoff(await $.store.get(folderKey(h.cwd)))
  if (stored && stored.at === h.at) await $.store.set(folderKey(h.cwd), { ...stored, isConsumed: true })
  await update($, pending, () => null)
  await update($, isAttaching, () => false)
}

// El handoff con el que se limpia: si la caché está tibia y el guardado se quedó atrás (o no
// existe), lo reescribe primero, porque ahí releer el contexto sale barato. `notice` se avisa solo
// cuando de verdad se va a escribir.
type Fresh = { handoff: Handoff | null; why?: string }
async function freshHandoff($: any, current: Handoff | null, notice?: string): Promise<Fresh> {
  const status = cacheStatus(await read($, lastEnd), await loadTtl($), await $.clock.now())
  const isBehind = !current || behindOf(await read($, turns), current.turns) > 0
  if (status.kind !== 'warm' || !isBehind) return { handoff: current }

  if (notice) $.ui.toast(notice, { timeoutMs: 4000 })
  const r = await writeHandoff($)

  return r.ok ? { handoff: r.value } : { handoff: current, why: r.why }
}

// /clear y deja el handoff listo para viajar con el próximo mensaje. Si no pudo ponerlo al día, no
// limpia: perder los últimos turnos no se decide en silencio.
async function resumeClean($: any, current: Handoff | null): Promise<{ ok: true } | { ok: false; text: string }> {
  if (isResuming) return { ok: false, text: 'Ya se está retomando.' }
  isResuming = true
  try {
    const f = await freshHandoff($, current)
    if (f.why) return { ok: false, text: `No se actualizó el handoff (${f.why}): la conversación sigue como estaba.` }
    const use = f.handoff
    if (!use) return { ok: false, text: 'No hay handoff y la caché está fría: usa Compactar.' }

    await $.command.run({ command: 'clear' })
    await update($, pending, () => use)
    await update($, isAttaching, () => true)

    return { ok: true }
  } finally {
    isResuming = false
  }
}

// Desde un botón: si no se pudo retomar, lo dice.
async function resumeOrWarn($: any, current: Handoff | null): Promise<boolean> {
  const r = await resumeClean($, current)
  if (!r.ok) $.ui.toast(r.text, { timeoutMs: 6000 })

  return r.ok
}

// Handoff automático: poco antes de que venza la caché, si hubo turnos nuevos. Se mide desde la
// última respuesta, no desde ahora: tras una recarga o un /resume la caché ya lleva rato corriendo.
async function scheduleAuto($: any) {
  // Un solo temporizador vivo: cada turno reemplaza el anterior.
  autoTimer?.cancel()
  autoTimer = null
  const end = await read($, lastEnd)
  if (!cfg.autoHandoff || end === null) return
  const ttl = await loadTtl($)
  const lead = autoLeadMs(ttl)
  const wait = Math.max(0, end + ttlMs(ttl) - lead - (await $.clock.now()))
  autoTimer = $.clock.after(wait, async () => {
    if ((await read($, owner)) !== LOAD) return
    const now = await $.clock.now()
    const status = cacheStatus(await read($, lastEnd), ttl, now)
    const h = await read($, handoff)
    const isNew = !h || behindOf(await read($, turns), h.turns) > 0
    if (
      status.kind === 'warm' &&
      status.leftMs <= lead + 5000 &&
      (await read($, tokens)) > cfg.minTokens &&
      isNew &&
      !(await read($, isBusy))
    ) {
      const done = await writeOrWarn($)
      if (done) $.ui.toast('Handoff guardado antes de que venciera la caché', { timeoutMs: 6000 })
    }
  })
}

// Modelo y esfuerzo tras /effort o /model. Devuelve si el nivel salió de la respuesta del comando.
async function refreshModel($: any, command: string, args: string, output?: string): Promise<boolean> {
  try {
    const fromSession = String(await $.session.model())
    // Tras /effort el modelo no cambia: vale el resuelto por el último turno, que es la clave de modelSettings.
    const model = command === 'model' ? fromSession : (await read($, modelName)) || fromSession
    if (command === 'model') await update($, modelName, () => model)
    const settings = await $.settings.read().catch(() => null)
    const level = effortAfterCommand({ command, args, output, model, settings })
    if (level) await update($, effortLevel, () => level)

    return Boolean(output && level)
  } catch {
    // Sin poder leerlo, el próximo turno lo corrige.
    return true
  }
}

// /effort y /model cambian lo que muestra la franja, pero turn.step no corre hasta el próximo
// mensaje: se refleja ya. Sin nivel en la respuesta (el selector de /effort puede no imprimir
// nada), la configuración puede guardarse un instante después: se vuelve a leer a los 3 s.
async function afterModelCommand($: any, e: { command: string; args: string }, output?: string) {
  const isSure = await refreshModel($, e.command, e.args, output)
  if (!isSure) $.clock.after(3000, () => refreshModel($, e.command, e.args))
}

async function resend($: any, text: string) {
  bypass = true
  await $.prompt.submit({ text, asUser: true })
}

async function closeGuardian($: any) {
  await update($, guardian, () => null)
  await $.ui.close({ id: PANE })
}

export const register: Register = (on, options) => {
  cfg = {
    minTokens: Number(options.minTokens),
    softTokens: Number(options.softTokens),
    hardTokens: Number(options.hardTokens),
    quotaWarn: Number(options.quotaWarn),
    fullPercent: Number(options.fullPercent),
    longTurns: Number(options.longTurns),
    ttl: String(options.ttl),
    autoHandoff: Boolean(options.autoHandoff),
    showQuota: Boolean(options.showQuota),
    showModel: Boolean(options.showModel),
  }

  // Una vez por proceso y en cada recarga de la mod; nunca tras /clear ni /resume (eso lo cubre sync).
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await update($, owner, () => LOAD)
    // Una recarga a mitad de un handoff deja la marca puesta y la carga anterior ya no la quita.
    await update($, isWriting, () => false)
    await restore($)
    await update($, modelName, () => '')
    try {
      const current = String(await $.session.model())
      await update($, modelName, () => current)
    } catch {
      // Sin modelo todavía: se completa en el primer turno.
    }
    await $.command.register({ name: 'guardian', description: 'Explica cómo leer la franja de caché, cuota y handoff' })
    await $.command.register({ name: 'handoff', description: 'Escribe el handoff de esta conversación ahora' })
    await $.command.register({
      name: 'retomar',
      description: 'Limpia la conversación y adjunta el handoff al próximo mensaje',
    })
    // Reloj: redibuja la franja cada minuto. El de una carga anterior se apaga al ver otro dueño.
    const clock = $.clock.every(60_000, async () => {
      if ((await read($, owner)) !== LOAD) return clock.cancel()
      await update($, tick, n => n + 1)
    })
    await prune($)

    return result
  })

  on('session.end', async ($, e, next) => {
    // La conversación cambia sin session.start: el estado se rehace con la siguiente (sync).
    if (e.reason === 'clear' || e.reason === 'resume') {
      endedId = String(e.sessionId ?? (await read($, sessionKey)))
      await update($, sessionKey, () => '')
      await update($, lastEnd, () => null)
      await update($, handoff, () => null)
      await update($, tokens, () => 0)
      await update($, turns, () => 0)
      await update($, isTaskDone, () => false)
      autoTimer?.cancel()
      autoTimer = null
      probe = null
      warned = 0
      // Se rehace apenas el motor pase a la conversación siguiente.
      queueSync($)
    }

    return next(e)
  })

  // turn.start es solo del hilo principal (no trae agentId).
  on('turn.start', async ($, e, next) => {
    isStepAnswered = false
    await update($, isBusy, () => true)
    await update($, isTaskDone, () => false)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result

    await sync($)
    const now = await $.clock.now()
    await update($, isBusy, () => false)
    // Conteo propio, guardado por conversación: sobrevive a --continue, /resume y recargas.
    await update($, turns, prev => prev + 1)
    probe = null
    // Un turno que murió en un error de la API sin ninguna respuesta no renovó la caché.
    if (e.reason !== 'error' || isStepAnswered) {
      await touch($, now)
      await scheduleAuto($)
    } else {
      await remember($)
    }

    return result
  })

  // Modelo y esfuerzo del turno en curso (el motor los resuelve en cada solicitud).
  // Aprende el TTL en el primer paso tras una pausa: es la única solicitud que mide la caché tal
  // como quedó. El uso del turno completo suma lecturas de los pasos siguientes y diluye la señal.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      await update($, modelName, () => e.model)
      await update($, effortLevel, () => (e.effort === undefined ? '' : String(e.effort)))
    }
    const result = yield* next(e)
    if (!e.agentId && result.usage) isStepAnswered = true
    if (!e.agentId && e.index === 0 && probe) {
      const u = result.usage
      if (u && String(cfg.ttl) === 'auto') {
        const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
        const learned = learnTtl(probe.gapMs, probe.tokens, u.cache_creation_input_tokens, total)
        if (learned) await $.store.set('cg.ttl', learned)
      }
      probe = null
    }

    return result
  })

  // Tokens y cuota llegan empujados por el motor.
  on('session.measure', async ($, e, next) => {
    const tk = e.context.tokens ?? 0
    await update($, tokens, () => tk)
    if (e.rateLimits.length > 0) {
      await update($, quota, () => e.rateLimits)
      const at = await $.clock.now()
      await update($, quotaAt, () => at)
    }
    await update($, windowSize, () => e.context.window)
    if (tk < cfg.softTokens) {
      // Tras compactar o limpiar, los avisos vuelven a estar disponibles.
      warned = 0
    } else if (tk >= cfg.hardTokens && warned < 2) {
      warned = 2
      $.ui.toast(
        `${formatTokens(cfg.hardTokens)}: cada turno re-lee todo. Al cambiar de tarea, /handoff y /retomar.`,
        { timeoutMs: 8000 },
      )
    } else if (warned < 1) {
      warned = 1
      $.ui.toast(`${formatTokens(cfg.softTokens)}: buen momento para un handoff si la tarea cambia.`, {
        timeoutMs: 8000,
      })
    }

    return next(e)
  })

  // Tras un git commit con éxito y contexto grande, sugiere empezar limpio.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    const command = String(e.command ?? '')
    if (/\bgit\s+commit\b/.test(command) && !result.isError && (await read($, tokens)) > cfg.minTokens) {
      await update($, isTaskDone, () => true)
    }

    return result
  })

  on('prompt.submit', async ($, e, next) => {
    await sync($)
    const now = await $.clock.now()
    const ttl = await loadTtl($)
    const end = await read($, lastEnd)
    const tk = await read($, tokens)
    const status = cacheStatus(end, ttl, now)

    const isCommand = isCommandText(e.text.trimStart())
    const isTyped = e.origin.kind === 'composer'

    // El handoff pendiente viaja con el próximo mensaje de verdad (un comando como /model o !ls no lo
    // gasta), pero solo si se eligió: Continuar desde ahí, Retomar limpio o /retomar. Ofrecido y no
    // elegido, el primer mensaje escrito lo da por visto: se ofrece una sola vez.
    const attach = async (event: typeof e) => {
      const h = await read($, pending)
      if (!h || isCommand) return event
      if (!(await read($, isAttaching))) {
        if (isTyped) await consume($, h)

        return event
      }

      await consume($, h)

      return {
        ...event,
        context: [
          ...(event.context ?? []),
          `Contexto de la sesión anterior (handoff, ${new Date(h.at).toLocaleString('es-CO', { hour12: false })}):\n\n${h.text}`,
        ],
      }
    }

    const isGuardable =
      isTyped &&
      !bypass &&
      !e.attachments?.length &&
      !isCommand &&
      status.kind === 'cold' &&
      tk > cfg.minTokens

    if (!isGuardable) {
      bypass = false
      // Sin guardián (adjuntos, comandos, caché tibia) igual se mide el re-cacheo para aprender el TTL.
      if (end !== null && isTyped && !isCommand) probe = { gapMs: now - end, tokens: tk }

      return next(await attach(e))
    }

    // Guardián del regreso: retiene el mensaje y deja elegir.
    const h = fresh(await read($, handoff), now)
    const missed = h ? behindOf(await read($, turns), h.turns) : 0
    await update($, guardian, () => ({
      text: e.text,
      coldMs: status.kind === 'cold' ? status.coldMs : 0,
      tokens: tk,
      hasHandoff: Boolean(h),
      missedTurns: missed,
    }))
    const placed = await $.ui.open({ id: PANE, title: 'Caché fría', focus: true, closeOnEscape: true, rows: 7 })
    if (!placed.isPlaced) {
      // Sin panel no hay forma de elegir: el mensaje sigue su curso y no se pierde.
      await update($, guardian, () => null)
      $.ui.toast(`Caché fría: este mensaje re-cachea ${formatTokens(tk)} tokens (sin panel para elegir).`, {
        timeoutMs: 8000,
      })

      return next(await attach(e))
    }

    return { drop: 'Caché fría: elige cómo continuar en el panel.' }
  })

  // Panel del guardián.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const g = await read($, guardian)
    if (!g) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const saved = fresh(await read($, handoff), await $.clock.now())

    return (
      <Box flexDirection="column">
        <Text color="gray">
          ○ {g.coldMs > KEEP_MS ? 'La caché está fría' : `La caché venció hace ${formatSpan(g.coldMs)}`}. Enviar así
          re-cachea {formatTokens(g.tokens)} tokens.
        </Text>
        <Text dimColor>
          {g.hasHandoff
            ? `Handoff listo: retomar limpio re-cachea solo unos pocos miles de tokens.` +
              (g.missedTurns > 0 ? ` No incluye los últimos ${g.missedTurns} turnos.` : '')
            : 'No hay handoff: compactar re-lee una vez y deja el contexto liviano.'}
        </Text>
        <Text dimColor>Tu mensaje: "{g.text.length > 60 ? `${g.text.slice(0, 60)}…` : g.text}"</Text>
        <Box>
          {saved ? (
            <Button
              key="clean"
              label="Retomar limpio"
              hotkey="1"
              variant="primary"
              onPress={async () => {
                await closeGuardian($)
                if (await resumeOrWarn($, saved)) await resend($, g.text)
                else await $.prompt.fill({ text: g.text })
              }}
            />
          ) : null}
          <Button
            key="compact"
            label="Compactar y enviar"
            hotkey="2"
            variant={saved ? undefined : 'primary'}
            onPress={async () => {
              await closeGuardian($)
              await $.session.compact()
              await resend($, g.text)
            }}
          />
          <Button
            key="send"
            label="Enviar igual"
            hotkey="3"
            onPress={async () => {
              await closeGuardian($)
              await resend($, g.text)
            }}
          />
          <Button
            key="cancel"
            label="Cancelar"
            hotkey="4"
            role="dismiss"
            onPress={async () => {
              await closeGuardian($)
              await $.prompt.fill({ text: g.text })
            }}
          />
        </Box>
      </Box>
    )
  })

  // Esc sobre el panel devuelve el mensaje al prompt, sin perderlo.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const g = await read($, guardian)
    if (g) {
      await update($, guardian, () => null)
      await $.prompt.fill({ text: g.text })
    }

    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($, e, next) => {
    await sync($)
    const ttl = await loadTtl($)
    const status = cacheStatus(await read($, lastEnd), ttl, await $.clock.now())
    const r = await writeHandoff($)
    if (!r.ok) return { text: `No se escribió el handoff: ${r.why}.` }

    const warn = status.kind === 'cold' ? '\n(La caché estaba fría: esta vez costó re-leer el contexto.)' : ''
    const at = new Date(r.value.at).toLocaleTimeString('es-CO', { hour12: false })

    return { text: `✓ handoff ${at}\n\n${r.value.text}${warn}` }
  })

  on('command.run', { command: 'retomar' }, async ($, e, next) => {
    await sync($)
    const saved = fresh(await read($, handoff), await $.clock.now())
    const r = await resumeClean($, saved)

    return { text: r.ok ? '✓ El handoff irá con tu próximo mensaje.' : r.text.replace('usa Compactar', 'usa /compact') }
  })

  // /clear escrito a mano: después no hay session.start que busque el handoff, así que se busca
  // aquí. Queda ofrecido como al abrir una sesión: viaja solo si se elige Continuar desde ahí. El
  // /clear de Retomar limpio viene de la mod y lo adjunta sin preguntar.
  on('command.run', { command: 'clear' }, async ($, e, next) => {
    if (e.origin?.kind === 'plugin') return next(e)

    await sync($)
    const current = fresh(await read($, handoff), await $.clock.now())
    let use = current
    if ((await read($, tokens)) > cfg.minTokens) {
      const f = await freshHandoff($, current, 'Actualizando el handoff antes de limpiar…')
      if (f.why) $.ui.toast(`No se actualizó el handoff: ${f.why}.`, { timeoutMs: 6000 })
      use = f.handoff
    }
    const result = await next(e)
    if (use) {
      await update($, pending, () => use)
      await update($, isAttaching, () => false)
    }

    return result
  })

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    await afterModelCommand($, e, result.text)

    return result
  })

  on('command.run', { command: 'model' }, async ($, e, next) => {
    const result = await next(e)
    await afterModelCommand($, e, result.text)

    return result
  })

  on('command.run', { command: 'guardian' }, () => ({ text: legend(cfg) }))

  // Franja sobre el prompt, en dos zonas de posición fija para que nada salte de lugar:
  //   1. Cuenta (arriba): cuota de 5 h y semanal. Es contexto ambiental, cambia despacio.
  //   2. Sesión (abajo, pegada al prompt): modelo, contexto, caché, handoff, aviso y botones.
  //      Es lo que se decide antes de escribir, por eso queda junto al cursor.
  // Una pieza, un color con un solo significado; la etiqueta y las unidades van atenuadas.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    await read($, tick) // suscribe al reloj de un minuto
    const { Box, Button, Text } = $.ui.resolve(e)
    // Conversación cambiada y estado aún sin rehacer: no se muestran datos de la anterior.
    const id = await $.session.id().catch(() => null)
    const isStale = id !== null && String(id) !== (await read($, sessionKey))
    if (isStale) queueSync($)
    const now = await $.clock.now()
    const ttl = await loadTtl($)
    const end = isStale ? null : await read($, lastEnd)
    const tk = isStale ? 0 : await read($, tokens)
    const win = await read($, windowSize)
    const busy = Boolean(e.props.isWorking) || (await read($, isBusy))
    const saved = isStale ? null : fresh(await read($, handoff), now)
    const savedAt = saved ? formatClock(saved.at, now) : ''
    const pend = await read($, pending)
    const writing = await read($, isWriting)
    const attaching = await read($, isAttaching)
    const taskDone = await read($, isTaskDone)
    const turnsNow = await read($, turns)
    const model = cfg.showModel ? await read($, modelName) : ''
    const effort = cfg.showModel ? await read($, effortLevel) : ''
    const status = cacheStatus(end, ttl, now)
    const big = tk > cfg.minTokens
    const behind = saved ? behindOf(turnsNow, saved.turns) : 0
    const isWide = Number(e.props.bodyColumns ?? 80) >= 100
    const hint = big
      ? contextHint({
          tokens: tk,
          window: win,
          soft: cfg.softTokens,
          fullPercent: cfg.fullPercent,
          taskDone,
          turnsSinceHandoff: saved ? behind : turnsNow,
          longTurns: cfg.longTurns,
        })
      : null

    // Separador de zonas y piezas: `│` atenuado. La marca de la barra es un triángulo para no competir con él.
    const sep = (k: string) => (
      <Text key={k} dimColor>
        {'  │  '}
      </Text>
    )

    // ── Zona 1: cuota ──
    // El % es el de la última respuesta: session.measure solo se dispara si una ventana se mueve un
    // punto entero, así que la frescura la da la última respuesta, no la última medición.
    const measuredAt = Math.max(await read($, quotaAt), end ?? 0)
    const windows = (cfg.showQuota ? await read($, quota) : []).filter(w => WINDOWS[w.kind] && w.resetsAt)
    const quotaPieces = windows.map(w => {
      const spec = WINDOWS[w.kind]!
      const label = isWide ? spec.label.trim() : spec.label
      const v = quotaView(w.percentUsed, Date.parse(w.resetsAt!), spec.ms, now, measuredAt, cfg.quotaWarn)
      if (v.kind === 'renewed') {
        return (
          <Text key={w.kind} dimColor>
            {label} renovada
          </Text>
        )
      }
      const tone = PACE_COLOR[v.tone]

      return (
        <Text key={w.kind}>
          <Text dimColor>{label} </Text>
          {barRuns(v.real, v.ideal, isWide ? 10 : 12).map((run, i) =>
            run.kind === 'fill' ? (
              <Text key={String(i)} color={tone}>
                {run.text}
              </Text>
            ) : run.kind === 'mark' ? (
              <Text key={String(i)} bold>
                {run.text}
              </Text>
            ) : (
              <Text key={String(i)} dimColor>
                {run.text}
              </Text>
            ),
          )}
          <Text> </Text>
          {v.isStale ? <Text dimColor>~</Text> : null}
          <Text>{padPercent(v.real).trim()}%</Text>
          {v.projected === null ? null : (
            <Text>
              <Text dimColor> → </Text>
              <Text color={tone}>{formatProjection(v.projected)}%</Text>
            </Text>
          )}
          <Text dimColor> · ↻ {formatShort(v.leftMs)}</Text>
        </Text>
      )
    })
    const quotaRows = isWide
      ? quotaPieces.length > 0
        ? [<Box key="quota">{quotaPieces.flatMap((p, i) => (i > 0 ? [sep(`qs${i}`), p] : [p]))}</Box>]
        : []
      : quotaPieces.map((p, i) => <Box key={`quota${i}`}>{p}</Box>)

    // ── Zona 2: sesión ──
    const info = []
    if (model || effort) {
      info.push(
        <Text key="model" dimColor={!isHighEffort(effort)}>
          <Text dimColor>{model ? formatModel(model) : ''}</Text>
          {model && effort ? <Text dimColor> · </Text> : null}
          {effort ? <Text color={isHighEffort(effort) ? 'yellow' : undefined} dimColor={!isHighEffort(effort)}>{effort}</Text> : null}
        </Text>,
      )
    }
    if (tk > 0) {
      const ctxColor = hint?.kind === 'full' ? 'red' : hint?.kind === 'heavy' ? 'yellow' : undefined
      info.push(
        <Text key="ctx">
          <Text color={ctxColor}>{win > 0 ? `${formatTokens(tk)}/${formatTokens(win)}` : formatTokens(tk)}</Text>
          {win > 0 ? <Text color={ctxColor} dimColor={!ctxColor}> {Math.round((tk / win) * 100)}%</Text> : null}
        </Text>,
      )
    }
    if (big) {
      const cache = busy
        ? { dot: '●', color: 'cyan', text: 'caché en uso' }
        : status.kind === 'warm'
          ? { dot: '●', color: status.leftMs < 5 * 60_000 ? 'yellow' : 'green', text: `caché vence en ${formatShort(status.leftMs)}` }
          : status.kind === 'cold'
            ? { dot: '○', color: 'yellow', text: status.coldMs > KEEP_MS ? 'caché fría' : `caché fría hace ${formatShort(status.coldMs)}` }
            : null
      if (cache) {
        info.push(
          <Text key="cache" color={cache.color}>
            {cache.dot} {cache.text}
          </Text>,
        )
      }
    }
    if (writing) {
      info.push(
        <Text key="ho" dimColor>
          ◌ escribiendo handoff…
        </Text>,
      )
    } else if (saved && big) {
      info.push(
        <Text key="ho">
          <Text color="green">✓</Text>
          <Text dimColor> handoff {savedAt}</Text>
          {behind > 0 ? <Text color="yellow"> +{behind}</Text> : null}
        </Text>,
      )
    }
    if (hint && hint.kind !== 'heavy') {
      info.push(
        <Text key="hint" color="yellow">
          {hint.text}
        </Text>,
      )
    }

    // Botones: solo con algo que decidir.
    const buttons = []
    if (!busy && big) {
      if (status.kind === 'warm') {
        // Handoff: sin uno, cuando hay un aviso; con uno, apenas le falte un turno. Ofrecerlo no
        // cuesta nada y con la caché tibia escribirlo es lo más barato que va a salir.
        const needsHandoff = saved ? behind > 0 : Boolean(hint)
        if (!writing && needsHandoff) {
          buttons.push(
            <Button
              key="handoff"
              label={saved ? 'Actualizar handoff' : 'Handoff ahora'}
              hotkey="h"
              onPress={() => void writeOrWarn($)}
            />,
          )
        }
      }
      // Una sola regla y un solo botón para los dos estados de la caché.
      const showClean = status.kind === 'warm' ? showResumeWarm(hint, Boolean(saved), behind) : status.kind === 'cold' && Boolean(saved)
      if (showClean) {
        buttons.push(
          <Button key="clean" label="Retomar limpio" hotkey="r" onPress={() => void resumeOrWarn($, saved)} />,
        )
      }
      if (status.kind === 'cold') {
        buttons.push(<Button key="compact" label="Compactar" hotkey="c" onPress={() => void $.session.compact()} />)
      }
    }

    // Conversación vacía con handoff pendiente: ocupa la zona de sesión, que aún no tiene datos.
    const offer = tk === 0 && pend && !attaching
    if (offer) {
      info.push(
        <Text key="offer" color="cyan">
          ◆ handoff de esta carpeta, de hace {formatShort(now - pend.at)}
        </Text>,
      )
      buttons.push(
        <Button key="resume" label="Continuar desde ahí" hotkey="r" onPress={() => update($, isAttaching, () => true)} />,
        <Button key="drop" label="Descartar" hotkey="x" onPress={() => consume($, pend)} />,
      )
    }
    if (attaching) {
      info.push(
        <Text key="attach" color="green">
          ✓ el handoff irá con tu próximo mensaje
        </Text>,
      )
    }

    if (quotaRows.length === 0 && info.length === 0 && buttons.length === 0) return next(e)

    // Una línea en blanco arriba separa la franja del transcript (respuestas, avisos del motor).
    return (
      <Box flexDirection="column" marginTop={1}>
        {quotaRows}
        {info.length > 0 || buttons.length > 0 ? (
          <Box key="session" justifyContent="space-between" columnGap={2}>
            <Box flexShrink={1}>
              <Text wrap="truncate-end">{info.flatMap((p, i) => (i > 0 ? [sep(`ss${i}`), p] : [p]))}</Text>
            </Box>
            {buttons.length > 0 ? (
              <Box flexShrink={0} columnGap={1}>
                {buttons}
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Box>
    )
  })
}
