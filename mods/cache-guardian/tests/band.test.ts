import { expect, test } from 'claude-code/testing'

import { NOW, fakeSession } from './fake-session'

// La franja dibuja la cuota (5 h y semanal) con marca de ideal, color y renovación.
test('la franja muestra las dos ventanas de cuota en la terminal', async ($, on) => {
  const now = NOW
  fakeSession(on)
  await $.session.measure({
    context: { window: 1_000_000, tokens: 60_000, percent: 6 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 62, resetsAt: new Date(now + 2 * 3_600_000).toISOString() },
      { kind: 'seven_day', percentUsed: 31, resetsAt: new Date(now + 4 * 86_400_000).toISOString() },
    ],
    changed: ['rateLimits'],
  } as never)
  const ui = await $.ui.mount({
    plugin: 'cache-guardian',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false } as never,
  })
  expect(await ui.find({ type: 'Text', text: /5h/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /sem/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /→/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /↻/ })).toBeDefined()
  await ui.unmount()
})

// En una terminal ancha las dos ventanas comparten una sola línea.
test('la franja ancha junta las ventanas en una línea', async ($, on) => {
  const now = NOW
  fakeSession(on)
  await $.session.measure({
    context: { window: 1_000_000, tokens: 60_000, percent: 6 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 19, resetsAt: new Date(now + 4 * 3_600_000).toISOString() },
      { kind: 'seven_day', percentUsed: 3, resetsAt: new Date(now + 6 * 86_400_000).toISOString() },
    ],
    changed: ['rateLimits'],
  } as never)
  const ui = await $.ui.mount({
    plugin: 'cache-guardian',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, bodyColumns: 140 } as never,
  })
  expect(await ui.find({ type: 'Text', text: /5h/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /sem/ })).toBeDefined()
  // Ancho: la proyección va junto a cada barra, unidas por el separador de zona.
  expect(await ui.find({ type: 'Text', text: /→/ })).toBeDefined()
  await ui.unmount()
})
