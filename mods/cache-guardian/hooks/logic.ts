// Lógica pura del mod: sin acceso a `$`, para poder probarla aislada.

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export const WINDOWS: Record<string, { label: string; ms: number }> = {
  five_hour: { label: '5h ', ms: 5 * HOUR },
  seven_day: { label: 'sem', ms: 7 * 24 * HOUR },
}

// ✔ forzado a texto (U+FE0E): una columna y sin versión emoji en ninguna terminal.
export const CHECK = '\u2714\uFE0E'

export type Ttl = '1h' | '5m'

export const ttlMs = (ttl: Ttl): number => (ttl === '5m' ? 5 * MINUTE : HOUR)

// TTL efectivo: lo fijado en la opción o, en `auto`, lo aprendido (1 h mientras no haya dato).
export const effectiveTtl = (option: string, learned: Ttl | null): Ttl =>
  option === '5m' || option === '1h' ? option : (learned ?? '1h')

// Aprende el TTL de una pausa de 6 a 55 min con más de 20k tokens: si la caché re-escribió
// el 80 % o más del contexto, venció (5m); si escribió el 30 % o menos, seguía tibia (1h).
export const learnTtl = (
  gapMs: number,
  contextTokens: number,
  written: number,
  total: number,
): Ttl | null => {
  if (gapMs < 6 * MINUTE || gapMs > 55 * MINUTE || contextTokens < 20_000 || total <= 0) {
    return null
  }
  const ratio = written / total
  if (ratio >= 0.8) return '5m'
  if (ratio <= 0.3) return '1h'

  return null
}

export type CacheStatus =
  | { kind: 'empty' }
  | { kind: 'warm'; leftMs: number }
  | { kind: 'cold'; coldMs: number }

export const cacheStatus = (lastEnd: number | null, ttl: Ttl, now: number): CacheStatus => {
  if (lastEnd === null) return { kind: 'empty' }
  const left = lastEnd + ttlMs(ttl) - now

  return left > 0 ? { kind: 'warm', leftMs: left } : { kind: 'cold', coldMs: -left }
}

// Urgencia de la caché tibia, para escalar la alerta solo cuando importa. Los umbrales se acotan
// al TTL para que con 5 min no esté siempre "por vencer": 1 h → 5 min y 1 min; 5 min → 75 s y 37 s.
export type CacheLevel = 'calm' | 'soon' | 'last'

export const cacheLevel = (leftMs: number, ttl: Ttl): CacheLevel => {
  const total = ttlMs(ttl)
  if (leftMs <= Math.min(MINUTE, total / 8)) return 'last'
  if (leftMs <= Math.min(5 * MINUTE, total / 4)) return 'soon'

  return 'calm'
}

// Reloj que se vacía con la vida de la caché: ● ◕ ◑ ◔ (y ○ cuando ya está fría).
export const cacheGlyph = (leftMs: number, ttl: Ttl): string => {
  const f = leftMs / ttlMs(ttl)

  return f > 0.75 ? '●' : f > 0.5 ? '◕' : f > 0.25 ? '◑' : '◔'
}

// Cuenta regresiva del último minuto: "0:48".
export const formatSeconds = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000))

  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// % entero con ancho fijo ("  3", " 18", "100") para que las columnas de la franja queden alineadas.
export const padPercent = (n: number): string => String(Math.round(n)).padStart(3)

export const formatTokens = (n: number): string =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

// "42 min", "2 h 10 min", "3 d 4 h": los dos órdenes de magnitud mayores.
export const formatSpan = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / MINUTE))
  const d = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  if (d > 0) return `${d} d ${h} h`
  if (h > 0) return `${h} h ${m} min`

  return `${m} min`
}

// Consumo ideal: el % que deberías llevar para llegar a la renovación justo en 100 %.
export const idealPercent = (resetsAtMs: number, windowMs: number, now: number): number => {
  const elapsed = 1 - (resetsAtMs - now) / windowMs

  return Math.min(100, Math.max(0, elapsed * 100))
}

export type Pace = 'holgado' | 'cerca' | 'excede'

// Un solo mapa de color por ritmo: cámbialo aquí si prefieres otra semántica.
export const PACE_COLOR: Record<Pace, string> = {
  holgado: 'green',
  cerca: 'yellow',
  excede: 'red',
}

// Barra de `width` celdas: `━` hasta el % ideal (el tiempo transcurrido de la ventana) y `─`
// el resto, con un punto `●` en el % real: la barra es el reloj y el punto eres tú.
// Va al revés de lo habitual a propósito: el punto aislado es lo primero que mira el ojo, así que
// lleva el dato que importa (el consumo) y la referencia queda en la barra, neutra.
// El punto va *entre* celdas (la barra mide `width + 1`): si tapara una celda, una diferencia menor
// a una celda (p. ej. 30 % real contra 24 % ideal en 10 celdas) quedaría oculta bajo la marca.
// Sin trazo vertical: en la terminal `│`, `┼` y `╋` ocupan todo el alto de la línea y se
// confunden con el `│` que separa las zonas de la franja.
// Trazos de línea (misma línea base): `█` sale como bloque suelto y `░`/`▓` como trama densa.
export const quotaBar = (real: number, ideal: number, width = 12): string => {
  const filled = Math.round((Math.min(100, Math.max(0, ideal)) / 100) * width)
  const mark = Math.round((Math.min(100, Math.max(0, real)) / 100) * width)
  let out = ''
  for (let i = 0; i <= width; i += 1) {
    if (i === mark) out += '●'
    if (i < width) out += i < filled ? '━' : '─'
  }

  return out
}

// La barra en tramos para colorearlos por separado: el tiempo transcurrido en neutro, el
// restante atenuado y el punto del consumo en el color del ritmo.
export type BarRun = { kind: 'fill' | 'rest' | 'mark'; text: string }

export const barRuns = (real: number, ideal: number, width = 12): BarRun[] => {
  const runs: BarRun[] = []
  for (const ch of quotaBar(real, ideal, width)) {
    const kind = ch === '●' ? 'mark' : ch === '━' ? 'fill' : 'rest'
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) last.text += ch
    else runs.push({ kind, text: ch })
  }

  return runs
}

// Versión compacta para la franja: "42m", "3h 22m", "5d 17h".
export const formatShort = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / MINUTE))
  const d = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`

  return `${m}m`
}

// Hora de un handoff en la franja: "15:36" si es de hoy, "07/10 15:36" si no, para que uno de otro
// día no pase por reciente.
export const formatClock = (at: number, now: number): string => {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`

  return d.toDateString() === new Date(now).toDateString() ? time : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${time}`
}

// Turnos que el handoff no incluye. Si el conteo actual quedó por debajo del suyo, el handoff no se
// mide con esta cuenta: se da por atrasado en vez de por al día.
export const behindOf = (turnsNow: number, handoffTurns: number): number =>
  turnsNow >= handoffTurns ? turnsNow - handoffTurns : Math.max(1, turnsNow)

// Un comando (/model, /plugin:cmd, !ls), no un mensaje: "/Users/yo/x.md" es una ruta, no un comando.
export const isCommandText = (text: string): boolean => /^\/[\w:.-]+(\s|$)/.test(text) || text.startsWith('!')

// Una conversación tiene historia cuando el modelo ya respondió. Tras /clear el transcript no queda
// vacío: guarda el propio /clear (y otros comandos) como filas del usuario.
export const hasHistory = (messages: readonly { role: string }[]): boolean => messages.some(m => m.role === 'assistant')

// <ruta> de handoffs: la carpeta con `/` cambiado por `-` (Users-ahenaol-Downloads.md).
export const handoffFile = (cwd: string): string => `${cwd.replace(/^\/+/, '').replace(/[\\/]+/g, '-')}.md`

export const HANDOFF_TTL_MS = 7 * 24 * HOUR
export const AUTO_LEAD_MS = 5 * MINUTE

// Cuánto antes de que venza se escribe el handoff automático.
export const autoLeadMs = (ttl: Ttl): number => (ttl === '5m' ? 75_000 : AUTO_LEAD_MS)

export const HANDOFF_PROMPT = [
  'Escribe un handoff de esta conversación para retomarla en una sesión nueva sin perder el hilo.',
  'Máximo 400 palabras, en español, con estas secciones (omite las vacías):',
  '## Objetivo, ## Estado actual, ## Decisiones tomadas, ## Archivos y comandos clave,',
  '## Siguiente paso, ## Pendientes y dudas abiertas.',
  'Responde solo con el handoff, sin preámbulo ni cierre.',
].join('\n')

// Proyección al cierre de la ventana: a este ritmo, ¿con qué % llegas a la renovación?
// No se calcula en el primer 5 % de la ventana (el cociente se dispara).
export const projectedPercent = (real: number, ideal: number): number | null =>
  ideal < 5 ? null : (real / ideal) * 100

// Color por proyección, como las herramientas de la comunidad: verde con holgura,
// amarillo cerca del límite (desde `warn` %), rojo si te quedarías sin cuota antes de renovar.
export const paceOf = (real: number, projected: number | null, warn: number): Pace => {
  const p = projected ?? real

  return p > 100 ? 'excede' : p >= warn ? 'cerca' : 'holgado'
}

// Pasados estos minutos sin una respuesta nueva, el % real es la última lectura, no el actual.
export const QUOTA_STALE_MS = 15 * MINUTE

export type QuotaView =
  | { kind: 'renewed' }
  | {
      kind: 'live'
      real: number
      ideal: number
      projected: number | null
      tone: Pace
      leftMs: number
      isStale: boolean
    }

// Todo lo que la franja muestra de una ventana. Si la renovación ya pasó sin una lectura nueva
// (pausa larga), el % guardado es de la ventana anterior: se muestra "renovada" en vez de datos viejos.
export const quotaView = (
  percentUsed: number,
  resetsAtMs: number,
  windowMs: number,
  now: number,
  measuredAt: number,
  warn: number,
): QuotaView => {
  if (now >= resetsAtMs) return { kind: 'renewed' }
  const ideal = idealPercent(resetsAtMs, windowMs, now)
  const projected = projectedPercent(percentUsed, ideal)

  return {
    kind: 'live',
    real: percentUsed,
    ideal,
    projected,
    tone: paceOf(percentUsed, projected, warn),
    leftMs: resetsAtMs - now,
    isStale: now - measuredAt > QUOTA_STALE_MS,
  }
}

export const formatProjection = (p: number): string => (p > 199 ? '>200' : padPercent(p).trim())

// "claude-fable-5-1" -> "fable-5-1"; "claude-haiku-4-5-20251001" -> "haiku-4-5".
export const formatModel = (id: string): string => id.replace(/^claude-/, '').replace(/-\d{8}$/, '')

// ── Reescritura en % de la ventana de 5 h ──
// La API no da la cuota en tokens, solo el % usado. El mod aprende dos cosas de tu propio consumo:
//   1. cuánto % de la ventana de 5 h cuesta cada dólar (del costo de la sesión frente al % que sube);
//   2. cuánto cuesta un token de entrada de cada modelo (del costo de un turno frente a sus tokens).
// Con eso, reescribir N tokens cuesta N × peso de escritura × precio × % por dólar.

// Pesos de precio frente a un token de entrada, los mismos en todos los modelos: la salida vale 5,
// leer de la caché 0,1 y escribir en ella 1,25 (TTL de 5 min) o 2 (TTL de 1 h).
export const writeWeight = (ttl: Ttl): number => (ttl === '5m' ? 1.25 : 2)

export type TokenUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// Una respuesta en "tokens de entrada equivalentes".
export const usageUnits = (u: TokenUsage, ttl: Ttl): number =>
  u.input_tokens + 5 * u.output_tokens + 0.1 * u.cache_read_input_tokens + writeWeight(ttl) * u.cache_creation_input_tokens

// Clave del precio por modelo: sin prefijo, fecha ni sufijo de ventana ("opus-5-5[1m]" -> "opus-5-5").
export const modelKey = (id: string): string => formatModel(id).replace(/\[[^\]]*\]$/, '')

export const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)

  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

// Muestras guardadas en $.store, con la fecha de la última para caducarlas como el resto.
export type Samples = { samples: number[]; at: number }

export const addSample = (prev: Samples | null, value: number, at: number, keep: number): Samples => ({
  samples: [...(prev?.samples ?? []), value].slice(-keep),
  at,
})

// Muestras mínimas antes de mostrar el %: mientras tanto la franja dice solo los tokens. El precio
// es exacto por turno y basta con menos; el % por dólar se ensucia con otras sesiones y pide más.
export const RATE_MIN_SAMPLES = 5
export const PRICE_MIN_SAMPLES = 3
export const RATE_KEEP = 20
export const PRICE_KEEP = 10

// El valor aprendido, o null si todavía no hay muestras suficientes.
export const learned = (s: Samples | null, min: number): number | null =>
  s && s.samples.length >= min ? median(s.samples) : null

// Lectura de la ventana de 5 h junto con el costo de la sesión en ese momento.
export type QuotaMark = { percent: number; usd: number; at: number; resetsAt: string }

// Más de este tiempo entre dos lecturas y otra sesión (otro equipo, claude.ai, el celular) tiene
// demasiado margen para mover la cuota: la muestra se descarta.
export const QUOTA_SAMPLE_MAX_MS = 30 * MINUTE

// Una muestra de "% de la ventana por dólar": cuánto subió la cuota frente a lo que gastó esta sesión.
// Se toma cuando la cuota subió al menos un punto entero, para que el redondeo a un decimal pese
// poco. Se descarta (y se empieza de nuevo desde la lectura actual) si la ventana se renovó, si el
// % o el costo bajaron (otra conversación) o si pasó demasiado tiempo. Un salto de más de 10 puntos
// es casi seguro de otra sesión.
export const quotaSample = (base: QuotaMark | null, cur: QuotaMark): { sample: number | null; base: QuotaMark } => {
  if (
    !base ||
    cur.resetsAt !== base.resetsAt ||
    cur.percent < base.percent ||
    cur.usd < base.usd ||
    cur.at - base.at > QUOTA_SAMPLE_MAX_MS
  ) {
    return { sample: null, base: cur }
  }
  const dp = cur.percent - base.percent
  if (dp < 1) return { sample: null, base }
  const du = cur.usd - base.usd
  if (du <= 0 || dp > 10) return { sample: null, base: cur }

  return { sample: dp / du, base: cur }
}

// Una muestra de "dólares por token de entrada" de un turno de un solo modelo. Con muy pocos tokens
// el costo redondeado domina y la muestra no sirve.
export const priceSample = (usdDelta: number, units: number): number | null =>
  units >= 1000 && usdDelta > 0 ? usdDelta / units : null

// Cuánto de la ventana de 5 h cuesta reescribir `tokens` en la caché.
export const rewriteShare = (tokens: number, ttl: Ttl, price: number | null, rate: number | null): number | null =>
  price === null || rate === null || tokens <= 0 ? null : tokens * writeWeight(ttl) * price * rate

// "≈6%", "<1%": siempre aproximado, sin decimales.
export const formatShare = (p: number): string => (p < 1 ? '<1%' : `≈${Math.round(p)}%`)

export const isHighEffort = (effort: string): boolean => effort === 'xhigh' || effort === 'max'

export type ContextHint = { kind: 'full' | 'heavy' | 'task' | 'long'; text: string }

// Por qué conviene cerrar la tarea y empezar limpio. Orden de prioridad: ventana casi llena
// (la práctica común es compactar hacia el 70 %), contexto pesado (cuesta re-leerlo cada turno),
// commit reciente (proxy de "tarea terminada", solo hay en repos git) y sesión larga (sin git).
export const contextHint = (a: {
  tokens: number
  window: number
  soft: number
  fullPercent: number
  taskDone: boolean
  turnsSinceHandoff: number
  longTurns: number
}): ContextHint | null => {
  const pct = a.window > 0 ? (a.tokens / a.window) * 100 : 0
  if (a.window > 0 && pct >= a.fullPercent) {
    return { kind: 'full', text: 'compacta o retoma limpio' }
  }
  if (a.tokens > a.soft) {
    return { kind: 'heavy', text: 'contexto pesado: cada turno lo relee' }
  }
  if (a.taskDone) return { kind: 'task', text: '¿tarea nueva? (commit hecho)' }
  if (a.turnsSinceHandoff >= a.longTurns) {
    return { kind: 'long', text: `sesión larga (${a.turnsSinceHandoff} turnos)` }
  }

  return null
}

// Cuándo mostrar "Retomar limpio" con la caché tibia. Solo con algo que decidir:
// - cualquier aviso, también contexto pesado: es la razón principal para retomar limpio, y el botón
//   escribe el handoff si hace falta (sin él, la franja ya ofrece "Handoff ahora", no agrega ruido);
// - un handoff recién escrito (sin turnos detrás): acaba de pedirlo, la siguiente decisión es retomar.
export const showResumeWarm = (hint: ContextHint | null, hasHandoff: boolean, behind: number): boolean =>
  hint !== null || (hasHandoff && behind === 0)

// Esfuerzo que deja un /effort o un /model, para mostrarlo sin esperar al próximo turno. Primero
// lo que respondió el comando ("Set effort level to high"), luego lo escrito tras /effort y por
// último la configuración (la del modelo antes que la general). El primer turno lo confirma.
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
type EffortSettings = { effortLevel?: unknown; modelSettings?: Record<string, { effortLevel?: unknown } | undefined> }
export const effortAfterCommand = (a: {
  command: string
  args: string
  output?: string
  model: string
  settings: EffortSettings | null
}): string | null => {
  const said = /effort(?: level)? to (low|medium|high|xhigh|max)\b/i.exec(a.output ?? '')
  if (said) return said[1]!.toLowerCase()
  const typed = a.args.trim().toLowerCase()
  if (a.command === 'effort' && LEVELS.includes(typed)) return typed
  const level = String(a.settings?.modelSettings?.[a.model]?.effortLevel ?? a.settings?.effortLevel ?? '').toLowerCase()

  return LEVELS.includes(level) ? level : null
}

// Ayuda de /guardian, con los umbrales configurados.
export const legend = (c: { minTokens: number; softTokens: number; fullPercent: number; quotaWarn: number }): string =>
  [
    'cache-guardian: cómo leer la franja',
    '',
    'Dos zonas fijas. Arriba la cuenta (cuota), abajo esta sesión, pegada al prompt y con los botones.',
    '',
    'Cuota:  5h ━━━●────── 28% → 82% · ↻ 3h 22m',
    '  ● dónde vas (color del ritmo) · ━ dónde deberías ir para llegar justo a 100 % (tiempo transcurrido) · ─ lo que falta.',
    '  28% usado → 82% proyectado: con cuánto llegarías al reinicio a este ritmo · ↻ cuánto falta para el reinicio.',
    `  Verde: llegas con holgura · amarillo: ${c.quotaWarn} % o más · rojo: te quedarías sin cuota antes de renovar.`,
    '  Punto dentro de la barra: vas por debajo del ritmo ideal; más allá de su final, por encima.',
    '  "~28%": más de 15 min sin respuestas, el dato es el de la última. "renovada": la ventana ya se reinició.',
    '',
    `Sesión:  opus-5-5 · medium  │  118k/1M 12%  │  ● caché vence en 59m  │  ${CHECK} handoff 12:53 +3`,
    '  Modelo y esfuerzo: xhigh y max en amarillo (gastan más cuota por turno).',
    `  Contexto: amarillo desde ${formatTokens(c.softTokens)} (cada turno lo relee), rojo desde el ${c.fullPercent} % de la ventana.`,
    `  Caché (desde ${formatTokens(c.minTokens)}): el círculo se vacía con su vida (● ◕ ◑ ◔) · ● cian, respondiendo.`,
    '    Amarillo en los últimos 5 min · pastilla "VENCE EN 0:48" en el último minuto, con la acción principal destacada.',
    '    Fría (○): una línea roja dice cuánto reescribe tu próximo mensaje, y el resto de la sesión se atenúa.',
    '    Cuando el mod ya aprendió tu consumo, la línea lo dice en % de tu ventana de 5 h (≈6%), además de los tokens.',
    '  Handoff: hora del resumen guardado (con la fecha si no es de hoy); +3 son los turnos que no incluye.',
    `  Avisos en amarillo: compacta o retoma limpio (${c.fullPercent} %) · ¿tarea nueva? (tras un commit) · sesión larga.`,
    '',
    'Botones: h handoff (aparece apenas el handoff se queda atrás) · r retomar limpio (actualiza el handoff si la caché',
    '  está tibia, /clear y lo adjunta) · c compactar. Un /clear escrito a mano deja el handoff ofrecido:',
    '  viaja solo si eliges Continuar desde ahí; si escribes sin elegir, no se adjunta.',
    '  Se presionan con la franja enfocada (ctrl+x tab o clic).',
    '',
    'Al volver: abre claude en la misma carpeta. Una conversación nueva ofrece el último handoff de la carpeta (una vez);',
    '  --continue o --resume retoman la conversación y, si la caché está fría, el guardián te deja elegir antes de enviar.',
  ].join('\n')

// Línea de /guardian con el avance del aprendizaje del % de la ventana de 5 h.
export const shareStatus = (a: { rateSamples: number; priceSamples: number; model: string }): string => {
  const rate = Math.min(a.rateSamples, RATE_MIN_SAMPLES)
  const price = Math.min(a.priceSamples, PRICE_MIN_SAMPLES)
  if (rate >= RATE_MIN_SAMPLES && price >= PRICE_MIN_SAMPLES) {
    return `Reescritura en % de la ventana de 5 h: lista para ${a.model || 'este modelo'}.`
  }

  return (
    `Reescritura en % de la ventana de 5 h: aprendiendo (cuota ${rate}/${RATE_MIN_SAMPLES}, ` +
    `precio de ${a.model || 'este modelo'} ${price}/${PRICE_MIN_SAMPLES}). Mientras tanto la franja muestra solo los tokens.`
  )
}
