import { expect, test } from 'claude-code/testing'

import { HOUR, NOW, command, fakeSession, mountBand, start, turn } from './fake-session'

const QUOTA_KEY = 'cg.quota'

const windows = (fiveHour: number, week: number) => [
  { kind: 'five_hour', percentUsed: fiveHour, resetsAt: new Date(NOW + 3 * HOUR).toISOString() },
  { kind: 'seven_day', percentUsed: week, resetsAt: new Date(NOW + 5 * 24 * HOUR).toISOString() },
]

const measure = ($: any, fiveHour: number, week: number) =>
  $.session.measure({
    context: { window: 1_000_000, tokens: 60_000, percent: 6 },
    rateLimits: windows(fiveHour, week),
    changed: ['rateLimits'],
  } as never)

// La cuota es de la cuenta: lo que mide una sesión queda para las demás.
test('la cuota medida se publica para las otras sesiones', async ($, on) => {
  const { f } = fakeSession(on)
  await start($)
  await measure($, 32, 18)
  const shared = f.store.get(QUOTA_KEY) as any
  expect(shared.at).toBe(NOW)
  expect(shared.windows[0].percentUsed).toBe(32)
})

// Una sesión quieta no recibe respuestas, pero toma al minuto la cuota que midió otra.
test('una sesión quieta adopta la cuota más reciente de otra sesión', async ($, on) => {
  const { f, clock } = fakeSession(on)
  await start($)
  await turn($, f, 300_000)
  await measure($, 18, 16)
  await clock.advance(90 * 60_000)
  f.store.set(QUOTA_KEY, { windows: windows(32, 18), at: NOW + 80 * 60_000 })
  await clock.advance(60_000)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /^32%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^18%$/ })).toBeDefined()
  // Medida hace 11 min por otra sesión: no lleva la marca de dato viejo.
  expect(await ui.find({ type: 'Text', text: /^~$/ })).toBeUndefined()
  await ui.unmount()
})

// Una cuota compartida más vieja que la propia no la pisa.
test('la cuota compartida más vieja que la propia no se adopta', async ($, on) => {
  const { f, clock } = fakeSession(on)
  f.store.set(QUOTA_KEY, { windows: windows(5, 2), at: NOW - HOUR })
  await start($)
  await measure($, 40, 20)
  f.store.set(QUOTA_KEY, { windows: windows(5, 2), at: NOW - HOUR })
  await clock.advance(60_000)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /^40%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5%$/ })).toBeUndefined()
  await ui.unmount()
})

// Escribir el handoff consulta la conversación y renueva la caché: la franja dice por qué el plazo volvió a empezar.
test('la franja dice cuando el handoff renovó la caché', async ($, on) => {
  const { f, clock } = fakeSession(on)
  await start($)
  await turn($, f, 300_000)
  await clock.advance(40 * 60_000)
  await command($, 'handoff')
  let ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /renovada por el handoff/ })).toBeDefined()
  await ui.unmount()
  // Un turno propio la renueva de nuevo: la etiqueta se va.
  await clock.advance(60_000)
  await turn($, f, 310_000)
  ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /renovada por el handoff/ })).toBeUndefined()
  await ui.unmount()
})
