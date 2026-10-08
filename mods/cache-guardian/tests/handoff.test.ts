import { expect, test } from 'claude-code/testing'

import {
  CWD,
  HOUR,
  NOW,
  captureSubmit,
  command,
  engineClear,
  fakeSession,
  history,
  mountBand,
  start,
  turn,
} from './fake-session'

const folderKey = `cg.handoff.${CWD}`

// Contexto pesado es la razón principal para retomar limpio: el botón tiene que estar.
test('con contexto pesado y caché tibia la franja ofrece retomar limpio', async ($, on) => {
  const { f } = fakeSession(on)
  await start($)
  await turn($, f, 300_000)
  const ui = await mountBand($)
  expect(await ui.find({ key: 'clean' })).toBeDefined()
  expect(await ui.find({ key: 'handoff' })).toBeDefined()
  await ui.unmount()
})

// Un turno sin handoff basta para ofrecer actualizarlo.
test('el handoff con un turno de atraso muestra +1 y ofrece actualizarse', async ($, on) => {
  const { f } = fakeSession(on)
  await start($)
  await turn($, f, 300_000)
  await command($, 'handoff')
  let ui = await mountBand($)
  expect(await ui.find({ key: 'handoff' })).toBeUndefined()
  await ui.unmount()
  await turn($, f, 310_000)
  ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /\+1/ })).toBeDefined()
  expect(await ui.find({ key: 'handoff' })).toBeDefined()
  await ui.unmount()
})

// Un /clear escrito a mano no pierde el handoff: lo actualiza y lo deja ofrecido.
test('un /clear escrito a mano actualiza el handoff y lo deja ofrecido', async ($, on) => {
  let engine: any
  const { f } = fakeSession(on)
  engineClear(on, () => engine, f)
  engine = $
  await start($)
  await turn($, f, 300_000)
  await command($, 'handoff')
  await turn($, f, 310_000)
  await command($, 'clear')
  // Se reescribió antes de limpiar: el ofrecido incluye el último turno.
  expect(f.forks).toBe(2)
  const ui = await mountBand($)
  expect(await ui.find({ key: 'resume' })).toBeDefined()
  expect(await ui.find({ key: 'drop' })).toBeDefined()
  await ui.unmount()
})

// Tras /clear, con Continuar desde ahí el primer mensaje lleva el handoff y lo gasta.
test('tras /clear y Continuar, el primer mensaje lleva el handoff y lo gasta', async ($, on) => {
  let engine: any
  const { f } = fakeSession(on)
  engineClear(on, () => engine, f)
  const sent = captureSubmit(on)
  engine = $
  await start($)
  await turn($, f, 300_000)
  await command($, 'clear')
  const ui = await mountBand($)
  await ui.press({ key: 'resume' })
  await ui.unmount()
  await $.prompt.submit({ text: 'sigamos', origin: { kind: 'composer' } } as never)
  expect(sent[0].context.join('\n')).toContain('Probar el handoff.')
  expect(((f.store.get(folderKey)) as any).isConsumed).toBe(true)
})

// Ofrecido y no elegido, no entra contexto que no se pidió, y no se vuelve a ofrecer.
test('tras /clear, escribir sin elegir no adjunta el handoff y lo da por visto', async ($, on) => {
  let engine: any
  const { f } = fakeSession(on)
  engineClear(on, () => engine, f)
  const sent = captureSubmit(on)
  engine = $
  await start($)
  await turn($, f, 300_000)
  await command($, 'clear')
  await $.prompt.submit({ text: 'otra tarea', origin: { kind: 'composer' } } as never)
  expect(sent[0].context ?? []).toHaveLength(0)
  expect(((f.store.get(folderKey)) as any).isConsumed).toBe(true)
  const ui = await mountBand($)
  expect(await ui.find({ key: 'resume' })).toBeUndefined()
  await ui.unmount()
})

// Un comando o una ruta: el comando no gasta el handoff elegido, la ruta es un mensaje y lo lleva.
test('un comando no gasta el handoff elegido; un mensaje que empieza por una ruta sí lo lleva', async ($, on) => {
  let engine: any
  const { f } = fakeSession(on)
  engineClear(on, () => engine, f)
  const sent = captureSubmit(on)
  engine = $
  await start($)
  await turn($, f, 300_000)
  await command($, 'clear')
  const ui = await mountBand($)
  await ui.press({ key: 'resume' })
  await ui.unmount()
  await $.prompt.submit({ text: '/model', origin: { kind: 'composer' } } as never)
  expect(sent[0].context ?? []).toHaveLength(0)
  await $.prompt.submit({ text: '/Users/yo/notas.md revisa esto', origin: { kind: 'composer' } } as never)
  expect(sent[1].context.join('\n')).toContain('Probar el handoff.')
})

// Retomar limpio adjunta el handoff sin preguntar: ya se eligió al pulsarlo.
test('Retomar limpio actualiza el handoff, limpia y lo adjunta al próximo mensaje', async ($, on) => {
  let engine: any
  const { f } = fakeSession(on)
  engineClear(on, () => engine, f)
  const sent = captureSubmit(on)
  engine = $
  await start($)
  await turn($, f, 300_000)
  let ui = await mountBand($)
  await ui.press({ key: 'clean' })
  await ui.unmount()
  expect(f.forks).toBe(1)
  expect(f.id).toBe('s1-clear')
  ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /irá con tu próximo mensaje/ })).toBeDefined()
  await ui.unmount()
  await $.prompt.submit({ text: 'sigamos', origin: { kind: 'composer' } } as never)
  expect(sent[0].context.join('\n')).toContain('Probar el handoff.')
})

// Si no pudo poner el handoff al día, Retomar limpio no limpia: no se pierden turnos en silencio.
test('Retomar limpio no limpia si no pudo actualizar el handoff', async ($, on) => {
  let engine: any
  const { f } = fakeSession(on)
  engineClear(on, () => engine, f)
  engine = $
  await start($)
  await turn($, f, 300_000)
  await command($, 'handoff')
  await turn($, f, 310_000)
  // Hay un handoff, pero un turno atrás: limpiar con él perdería ese turno.
  f.fork = { isAnswered: false, reason: 'api-error', status: 529 }
  const ui = await mountBand($)
  await ui.press({ key: 'clean' })
  await ui.unmount()
  expect(f.id).toBe('s1')
  expect(f.toasts.join('\n')).toContain('la API devolvió un error (529)')
})

// /handoff y otros comandos no cuentan como turnos: tras /handoff y un turno, el atraso es 1.
test('los comandos no inflan los turnos que el handoff no incluye', async ($, on) => {
  const { f } = fakeSession(on)
  await start($)
  await turn($, f, 300_000)
  await command($, 'handoff')
  // El motor cuenta las filas de /handoff y /effort como turnos del usuario.
  f.turns += 2
  await turn($, f, 310_000)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /\+1$/ })).toBeDefined()
  await ui.unmount()
})

// Un handoff de otro día muestra la fecha: con solo la hora pasaba por reciente.
test('un handoff de otro día muestra la fecha en la franja', async ($, on) => {
  const { f } = fakeSession(on, {
    'cg.last.s1': { at: NOW - 10 * 60_000, tokens: 300_000, n: 4 },
    'cg.ho.s1': { text: 'mío', at: NOW - 3 * 24 * HOUR, turns: 4, cwd: CWD, sessionId: 's1', isConsumed: false },
  })
  f.messages = history()
  f.tokens = 300_000
  await start($)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /handoff \d\d\/\d\d \d\d:\d\d/ })).toBeDefined()
  await ui.unmount()
})

// --continue: el proceso arranca con una conversación con historia y la caché vencida.
test('al retomar una conversación con la caché fría el guardián retiene el mensaje', async ($, on) => {
  const { f } = fakeSession(on, {
    'cg.last.s1': { at: NOW - 2 * HOUR, tokens: 400_000 },
    'cg.ho.s1': { text: 'mío', at: NOW - 2 * HOUR, turns: 8, cwd: CWD, sessionId: 's1', isConsumed: false },
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  f.turns = 10
  f.messages = history()
  f.tokens = 400_000
  await start($)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /caché fría hace 1h/ })).toBeDefined()
  // Los turnos salen del transcript: el handoff va 2 atrás, no 0.
  expect(await ui.find({ type: 'Text', text: /\+2/ })).toBeDefined()
  expect(await ui.find({ key: 'clean' })).toBeDefined()
  await ui.unmount()
  const r: any = await $.prompt.submit({ text: 'hola', origin: { kind: 'composer' } } as never)
  expect(r.drop).toBeDefined()
})

// Sin registro de la última respuesta (conversación vieja o de antes de esta versión), la caché se da por fría.
test('una conversación retomada sin registro se trata como fría', async ($, on) => {
  const { f } = fakeSession(on)
  f.turns = 3
  f.messages = history()
  f.tokens = 200_000
  await start($)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /caché fría$/ })).toBeDefined()
  await ui.unmount()
})

// El handoff de carpeta escrito por otra conversación no se muestra como propio al retomar.
test('al retomar no se usa el handoff que escribió otra conversación', async ($, on) => {
  const { f } = fakeSession(on, {
    [folderKey]: { text: 'de otra', at: NOW - HOUR, turns: 4, cwd: CWD, sessionId: 'otra', isConsumed: false },
    'cg.last.s1': { at: NOW - 10 * 60_000, tokens: 300_000 },
    [`cg.last.${CWD}`]: { at: NOW - 10 * 60_000, tokens: 300_000 },
  })
  f.turns = 5
  f.messages = history()
  f.tokens = 300_000
  await start($)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /handoff \d/ })).toBeUndefined()
  await ui.unmount()
})

// El handoff de carpeta sin conversación (versión anterior) puede ser de otra: no se adopta al retomar,
// y la franja ofrece escribir uno propio en vez de darlo por al día.
test('al retomar no se adopta el handoff de la versión anterior', async ($, on) => {
  const { f } = fakeSession(on, {
    [folderKey]: { text: 'viejo', at: NOW - HOUR, turns: 20, cwd: CWD, isConsumed: false },
    'cg.last.s1': { at: NOW - 10 * 60_000, tokens: 300_000 },
  })
  f.turns = 7
  f.messages = history()
  f.tokens = 300_000
  await start($)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /handoff \d/ })).toBeUndefined()
  expect(await ui.find({ key: 'handoff' })).toBeDefined()
  await ui.unmount()
})

// /resume dentro de la sesión cambia de conversación sin session.start: el estado se rehace.
test('un /resume dentro de la sesión rehace el estado de la conversación', async ($, on) => {
  const { f, clock } = fakeSession(on, { 'cg.last.s2': { at: NOW - 3 * HOUR, tokens: 250_000 } })
  await start($)
  await turn($, f, 300_000)
  await command($, 'handoff')
  await $.session.end({ reason: 'resume', sessionId: 's1' } as never)
  f.id = 's2'
  f.turns = 20
  f.tokens = 250_000
  // Mientras el estado no se rehace, la franja no muestra datos de la conversación anterior.
  let ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /300k/ })).toBeUndefined()
  await ui.unmount()
  await clock.advance(1)
  ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /caché fría hace 2h/ })).toBeDefined()
  // El handoff de s1 no es de s2.
  expect(await ui.find({ type: 'Text', text: /handoff \d/ })).toBeUndefined()
  await ui.unmount()
})

// Una conversación nueva en la carpeta ofrece el último handoff, una sola vez.
test('una conversación nueva ofrece el handoff de la carpeta', async ($, on) => {
  const { f } = fakeSession(on, {
    [folderKey]: { text: 'anterior', at: NOW - HOUR, turns: 4, cwd: CWD, sessionId: 'otra', isConsumed: false },
  })
  await start($)
  const ui = await mountBand($)
  expect(await ui.find({ key: 'resume' })).toBeDefined()
  await ui.press({ key: 'drop' })
  expect(await ui.find({ key: 'resume' })).toBeUndefined()
  expect(((f.store.get(folderKey)) as any).isConsumed).toBe(true)
  await ui.unmount()
})

// Si la consulta falla, /handoff dice por qué en vez de un mensaje genérico.
test('/handoff explica por qué no pudo escribir', async ($, on) => {
  const { f } = fakeSession(on)
  await start($)
  await turn($, f, 300_000)
  f.fork = { isAnswered: false, reason: 'api-error', status: 529 }
  const r: any = await command($, 'handoff')
  expect(r.text).toContain('la API devolvió un error (529)')
})

// El handoff automático se escribe poco antes de que venza la caché.
test('el handoff automático se escribe antes de que venza la caché', async ($, on) => {
  const { f, clock } = fakeSession(on)
  await start($)
  await turn($, f, 300_000)
  await clock.advance(56 * 60_000)
  expect(f.forks).toBe(1)
  expect(f.store.get('cg.ho.s1')).toBeDefined()
})

// Lo guardado por conversación caduca; las claves por carpeta de la versión anterior se borran.
test('al arrancar se limpia lo guardado que ya caducó', async ($, on) => {
  const { f } = fakeSession(on, {
    'cg.last.vieja': { at: NOW - 40 * 24 * HOUR, tokens: 1 },
    'cg.last.reciente': { at: NOW - HOUR, tokens: 1 },
    [`cg.last.${CWD}`]: { at: NOW - HOUR, tokens: 1 },
    [`handoff:${CWD}`]: { at: NOW - HOUR, path: '/x.md', isConsumed: false },
    'cg.handoff./vieja': { text: 'x', at: NOW - 40 * 24 * HOUR, turns: 1, cwd: '/vieja', isConsumed: false },
  })
  await start($)
  expect(f.store.get(`handoff:${CWD}`)).toBeUndefined()
  expect(f.store.get('cg.handoff./vieja')).toBeUndefined()
  expect(f.store.get('cg.last.vieja')).toBeUndefined()
  expect(f.store.get(`cg.last.${CWD}`)).toBeUndefined()
  expect(f.store.get('cg.last.reciente')).toBeDefined()
})

// Tras recargar la mod o retomar con la caché tibia, el handoff automático sigue programado.
test('tras una recarga con la caché tibia, el handoff automático sigue en pie', async ($, on) => {
  const { f, clock } = fakeSession(on, { 'cg.last.s1': { at: NOW - 50 * 60_000, tokens: 300_000, n: 4 } })
  f.messages = history()
  f.tokens = 300_000
  await start($)
  await clock.advance(6 * 60_000)
  expect(f.forks).toBe(1)
})

// Un turno que murió en un error de la API sin ninguna respuesta no renueva la caché.
test('un turno fallido sin respuesta no da la caché por renovada', async ($, on) => {
  const { f } = fakeSession(on, { 'cg.last.s1': { at: NOW - 2 * HOUR, tokens: 300_000, n: 4 } })
  f.messages = history()
  f.tokens = 300_000
  await start($)
  await $.turn.start({ text: 'hola', turnId: 't5' } as never)
  await $.turn.complete({ reason: 'error', answer: '', durationMs: 1, isAborted: false, turnId: 't5' } as never)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /caché fría hace/ })).toBeDefined()
  await ui.unmount()
  expect((f.store.get('cg.last.s1') as any).n).toBe(5)
})

// Último minuto: la caché sale como pastilla con segundos y el handoff atrasado es la acción principal.
test('en el último minuto la franja muestra la cuenta regresiva y destaca el handoff', async ($, on) => {
  const { f } = fakeSession(on, {
    'cg.last.s1': { at: NOW - HOUR + 48_000, tokens: 300_000, n: 6 },
    'cg.ho.s1': { text: 'mío', at: NOW - 2 * HOUR, turns: 4, cwd: CWD, sessionId: 's1', isConsumed: false },
  })
  f.turns = 6
  f.messages = history()
  f.tokens = 300_000
  await start($)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /VENCE EN 0:48/ })).toBeDefined()
  expect((await ui.find({ key: 'handoff' }))?.props.variant).toBe('primary')
  expect(await ui.find({ type: 'Text', text: /reescribe/ })).toBeUndefined()
  await ui.unmount()
})

// Caché fría con contexto grande: línea propia con el costo y Retomar limpio como acción principal.
test('con la caché fría la franja dice el costo y destaca retomar limpio', async ($, on) => {
  const { f } = fakeSession(on, {
    'cg.last.s1': { at: NOW - 2 * HOUR, tokens: 300_000, n: 6 },
    'cg.ho.s1': { text: 'mío', at: NOW - 2 * HOUR, turns: 6, cwd: CWD, sessionId: 's1', isConsumed: false },
  })
  f.turns = 6
  f.messages = history()
  f.tokens = 300_000
  await start($)
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /reescribe 300k tokens/ })).toBeDefined()
  expect((await ui.find({ key: 'clean' }))?.props.variant).toBe('primary')
  expect((await ui.find({ key: 'compact' }))?.props.variant).toBeUndefined()
  await ui.unmount()
})
