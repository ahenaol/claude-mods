import { expect, test } from 'claude-code/testing'

import {
  addSample,
  formatShare,
  learned,
  median,
  modelKey,
  priceSample,
  quotaSample,
  rewriteShare,
  shareStatus,
  usageUnits,
} from '../hooks/logic'
import type { QuotaMark } from '../hooks/logic'
import { CWD, HOUR, NOW, command, fakeSession, history, mountBand, start } from './fake-session'

// Comparación de decimales: el kit no trae toBeCloseTo.
const near = (a: number | null | undefined, b: number): boolean => typeof a === 'number' && Math.abs(a - b) < 1e-9

// ── Lógica pura ──

test('una respuesta en tokens de entrada equivalentes, según el TTL', () => {
  const u = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 500 }
  // 1000 + 5·200 + 0,1·10 000 + 2·500 = 4000 con 1 h; con 5 min la escritura pesa 1,25.
  expect(usageUnits(u, '1h')).toBe(4000)
  expect(usageUnits(u, '5m')).toBe(3625)
})

test('la clave del modelo quita prefijo, fecha y sufijo de ventana', () => {
  expect(modelKey('claude-opus-5-5')).toBe('opus-5-5')
  expect(modelKey('claude-opus-5-5[1m]')).toBe('opus-5-5')
  expect(modelKey('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
})

test('mediana, muestras acotadas y mínimo de muestras', () => {
  expect(median([])).toBeNull()
  expect(median([3, 1, 2])).toBe(2)
  expect(median([4, 1, 3, 2])).toBe(2.5)
  let s = addSample(null, 1, 10, 3)
  for (const v of [2, 3, 4]) s = addSample(s, v, 20, 3)
  expect(s).toEqual({ samples: [2, 3, 4], at: 20 })
  expect(learned(s, 4)).toBeNull()
  expect(learned(s, 3)).toBe(3)
  expect(learned(null, 1)).toBeNull()
})

const mark = (percent: number, usd: number, at = NOW, resetsAt = 'r1'): QuotaMark => ({ percent, usd, at, resetsAt })

test('muestra de % por dólar: solo con un punto entero y sin señales de otra sesión', () => {
  // Sin base, la lectura queda como base.
  expect(quotaSample(null, mark(10, 1))).toEqual({ sample: null, base: mark(10, 1) })
  // Menos de un punto: se sigue acumulando desde la misma base.
  expect(quotaSample(mark(10, 1), mark(10.6, 1.2))).toEqual({ sample: null, base: mark(10, 1) })
  // Un punto con medio dólar: 2 % por dólar.
  expect(quotaSample(mark(10, 1), mark(11, 1.5))).toEqual({ sample: 2, base: mark(11, 1.5) })
  // Renovación, % o costo que bajan, o demasiado tiempo: se empieza de nuevo sin muestra.
  expect(quotaSample(mark(10, 1), mark(12, 2, NOW, 'r2')).sample).toBeNull()
  expect(quotaSample(mark(10, 1), mark(9, 2)).sample).toBeNull()
  expect(quotaSample(mark(10, 1), mark(12, 0.5)).sample).toBeNull()
  expect(quotaSample(mark(10, 1), mark(12, 2, NOW + 31 * 60_000)).sample).toBeNull()
  // La cuota sube sin gasto propio, o de un salto: otra sesión.
  expect(quotaSample(mark(10, 1), mark(12, 1))).toEqual({ sample: null, base: mark(12, 1) })
  expect(quotaSample(mark(10, 1), mark(25, 2)).sample).toBeNull()
})

test('muestra de precio por token: descarta turnos diminutos o sin costo', () => {
  expect(priceSample(0.005, 1000)).toBe(0.000005)
  expect(priceSample(0.001, 999)).toBeNull()
  expect(priceSample(0, 5000)).toBeNull()
})

test('la reescritura en % de la ventana y su formato', () => {
  // 300k tokens · 2 (escritura con TTL de 1 h) · 5 USD/M · 2 %/USD = 6 %.
  expect(near(rewriteShare(300_000, '1h', 0.000005, 2), 6)).toBe(true)
  expect(near(rewriteShare(300_000, '5m', 0.000005, 2), 3.75)).toBe(true)
  expect(rewriteShare(300_000, '1h', null, 2)).toBeNull()
  expect(rewriteShare(300_000, '1h', 0.000005, null)).toBeNull()
  expect(formatShare(6.4)).toBe('≈6%')
  expect(formatShare(0.4)).toBe('<1%')
})

test('/guardian dice cuánto falta para la estimación', () => {
  expect(shareStatus({ rateSamples: 2, priceSamples: 7, model: 'opus-5-5' })).toMatch(/aprendiendo \(cuota 2\/5, precio de opus-5-5 3\/3\)/)
  expect(shareStatus({ rateSamples: 9, priceSamples: 3, model: 'opus-5-5' })).toMatch(/lista para opus-5-5/)
})

// ── Con la sesión simulada ──

const learnedStore = () => ({
  'cg.qrate': { samples: [2, 2, 2, 2, 2], at: NOW },
  'cg.price.opus-5-5': { samples: [0.000005, 0.000005, 0.000005], at: NOW },
})

const coldSession = (extra: Record<string, unknown> = {}) => ({
  'cg.last.s1': { at: NOW - 2 * HOUR, tokens: 300_000, n: 6 },
  'cg.ho.s1': { text: 'mío', at: NOW - 2 * HOUR, turns: 6, cwd: CWD, sessionId: 's1', isConsumed: false },
  ...extra,
})

test('con lo aprendido, la caché fría dice el costo en % de la ventana de 5 h', async ($, on) => {
  const { f } = fakeSession(on, coldSession(learnedStore()))
  f.turns = 6
  f.messages = history()
  f.tokens = 300_000
  await start($)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /cuesta ≈6% de tu 5h: reescribe 300k tokens/ })).toBeDefined()
  await ui.unmount()
  // El aviso al retomar con la caché fría también lo dice.
  expect(f.toasts.some(t => t.includes('≈6% de tu ventana de 5 h'))).toBe(true)
})

test('sin muestras suficientes, la caché fría dice solo los tokens', async ($, on) => {
  const { f } = fakeSession(
    on,
    coldSession({
      'cg.qrate': { samples: [2, 2, 2, 2], at: NOW },
      'cg.price.opus-5-5': { samples: [0.000005, 0.000005, 0.000005], at: NOW },
    }),
  )
  f.turns = 6
  f.messages = history()
  f.tokens = 300_000
  await start($)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /reescribe 300k tokens de contexto a precio completo/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cuesta/ })).toBeUndefined()
  await ui.unmount()
})

test('lo aprendido caduca a los 30 días sin muestras nuevas', async ($, on) => {
  const old = NOW - 31 * 24 * HOUR
  const { f } = fakeSession(on, {
    'cg.qrate': { samples: [2, 2, 2, 2, 2], at: old },
    'cg.price.opus-5-5': { samples: [0.000005, 0.000005, 0.000005], at: NOW },
  })
  await start($)
  expect(f.store.has('cg.qrate')).toBe(false)
  expect(f.store.has('cg.price.opus-5-5')).toBe(true)
})

test('lo caducado no se usa ni siquiera en el aviso del arranque', async ($, on) => {
  const old = NOW - 31 * 24 * HOUR
  const { f } = fakeSession(
    on,
    coldSession({
      'cg.qrate': { samples: [2, 2, 2, 2, 2], at: old },
      'cg.price.opus-5-5': { samples: [0.000005, 0.000005, 0.000005], at: NOW },
    }),
  )
  f.turns = 6
  f.messages = history()
  f.tokens = 300_000
  await start($)
  expect(f.toasts.some(t => t.includes('re-cachear 300k tokens. '))).toBe(true)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /cuesta/ })).toBeUndefined()
  await ui.unmount()
})

const five = (percentUsed: number) => [
  { kind: 'five_hour', percentUsed, resetsAt: new Date(NOW + 3 * HOUR).toISOString() },
]

test('cada punto de la ventana de 5 h deja una muestra de % por dólar', async ($, on) => {
  const { f } = fakeSession(on)
  await start($)
  for (let i = 0; i <= 5; i += 1) {
    await $.session.measure({
      context: { window: 1_000_000, tokens: 50_000, percent: 5 },
      rateLimits: five(20 + i),
      cost: { usd: 1 + i * 0.5 },
      changed: ['rateLimits'],
    } as never)
  }
  // La primera lectura es la base: quedan cinco muestras de 1 punto por 0,50 USD.
  expect(f.store.get('cg.qrate')).toEqual({ samples: [2, 2, 2, 2, 2], at: NOW })
})

// Un turno con pasos simulados: cada paso cobra `usdPerStep` y responde con `model`.
async function pricedTurn($: any, f: any, model: string, usdPerStep: number, steps = 1) {
  await $.turn.start({ text: 'hola', turnId: 't1' } as never)
  for (let i = 0; i < steps; i += 1) {
    const s = $.turn.step({ turnId: 't1', index: i, model, messageCount: 2 } as never)
    for await (const _ of s) {
      // Solo se consume el stream.
    }
    f.usd += usdPerStep
  }
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1' } as never)
}

test('un turno de un solo modelo deja una muestra de precio por token', async ($, on) => {
  const { f } = fakeSession(on)
  f.usd = 0
  // Con `isMixed`, el segundo paso responde con otro modelo, como un subagente en Haiku.
  let isMixed = false
  // 1000 de entrada + 5·200 de salida = 2000 unidades por paso, a 0,01 USD: 5 USD por millón.
  on('turn.step', async function* (_$: any, e: any) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        model: isMixed && e.index > 0 ? 'claude-haiku-4-5' : e.model,
      },
    }
  } as never)
  await start($)
  await pricedTurn($, f, 'claude-opus-5-5', 0.01, 2)
  const s = f.store.get('cg.price.opus-5-5') as { samples: number[] }
  expect(s.samples.length).toBe(1)
  expect(near(s.samples[0], 0.000005)).toBe(true)
  // Un turno con dos modelos no sirve: el precio sería una mezcla.
  isMixed = true
  await pricedTurn($, f, 'claude-opus-5-5', 0.01, 2)
  expect((f.store.get('cg.price.opus-5-5') as { samples: number[] }).samples.length).toBe(1)
  expect(f.store.has('cg.price.haiku-4-5')).toBe(false)
})

test('/guardian informa el avance del aprendizaje', async ($, on) => {
  fakeSession(on, { 'cg.qrate': { samples: [2, 2], at: NOW } })
  await start($)
  const r = await command($, 'guardian')
  expect(r.text).toMatch(/aprendiendo \(cuota 2\/5, precio de opus-5-5 0\/3\)/)
})
