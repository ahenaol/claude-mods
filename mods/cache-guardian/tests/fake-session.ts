import { mock } from 'claude-code/testing'

// Una sesión de Claude Code simulada por debajo de la mod: conversación, turnos, contexto, /clear y
// /resume. Los hooks se registran antes de la primera llamada a `$`, como pide el kit.

export const NOW = 1_800_000_000_000
export const CWD = '/proj'
export const HOUR = 3_600_000

export type Fake = {
  id: string
  turns: number
  messages: { role: 'user' | 'assistant'; text: string; toolUses: [] }[]
  tokens: number | undefined
  window: number
  fork: { isAnswered: true; text: string; usage: object } | { isAnswered: false; reason: string; status?: number }
  forks: number
  toasts: string[]
  // Lo que la mod guarda en $.store, para leerlo desde la prueba.
  store: Map<string, unknown>
}

export function fakeSession(on: any, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/test' })
  const f: Fake = {
    id: 's1',
    turns: 0,
    messages: [],
    tokens: undefined,
    window: 1_000_000,
    fork: { isAnswered: true, text: '## Objetivo\nProbar el handoff.', usage: {} },
    forks: 0,
    toasts: [],
    store: new Map(Object.entries(store)),
  }
  on('store.get', (_$: any, e: any) => ({ value: f.store.get(e.key) }) as never)
  on('store.set', (_$: any, e: any) => {
    f.store.set(e.key, e.value)
    return { value: undefined } as never
  })
  on('store.delete', (_$: any, e: any) => {
    f.store.delete(e.key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...f.store.keys()] }) as never)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }) as never)
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }) as never)
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }) as never)
  on('session.id', () => ({ value: f.id }) as never)
  on('session.cwd', () => ({ value: CWD }) as never)
  on('session.turns', () => ({ value: f.turns }) as never)
  on('session.messages', () => ({ value: f.messages }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.usage', () =>
    ({ value: { startedAt: NOW, context: { tokens: f.tokens, window: f.window }, rateLimits: [] } }) as never,
  )
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('model.fork', () => {
    f.forks += 1
    return { value: f.fork } as never
  })
  on('fs.write', () => ({ value: undefined }) as never)
  on('ui.toast', (_$: any, e: any) => {
    f.toasts.push(String(e.text ?? e.message ?? e))
    return { value: undefined } as never
  })
  on('command.register', () => ({ value: undefined }) as never)

  return { f, clock }
}

// Arranca el proceso: session.start como lo dispara el motor.
export const start = ($: any) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)

// Un turno completo de la conversación, con el contexto que deja.
export async function turn($: any, f: Fake, tokens: number) {
  f.turns += 1
  f.messages.push({ role: 'user', text: `mensaje ${f.turns}`, toolUses: [] })
  f.messages.push({ role: 'assistant', text: 'respuesta', toolUses: [] })
  f.tokens = tokens
  await $.session.measure({
    context: { window: f.window, tokens, percent: (tokens / f.window) * 100 },
    rateLimits: [],
    changed: ['context'],
  } as never)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: `t${f.turns}` } as never)
}

// El /clear del motor: termina la conversación y sigue con otra, sin session.start. Como en el motor
// real, la nueva no queda vacía: el propio /clear queda como fila del usuario y cuenta en turns().
export function engineClear(on: any, $: () => any, f: Fake) {
  on('command.run', { command: 'clear' }, async () => {
    await $().session.end({ reason: 'clear', sessionId: f.id } as never)
    f.id = `${f.id}-clear`
    f.turns = 1
    f.messages = [{ role: 'user', text: '<command-name>/clear</command-name>', toolUses: [] }]
    f.tokens = undefined
    return { text: '' }
  })
}

// Una conversación con historia, como la encuentra un --continue o un /resume.
export const history = (): Fake['messages'] => [
  { role: 'user', text: 'x', toolUses: [] },
  { role: 'assistant', text: 'y', toolUses: [] },
]

// Captura lo que llega al modelo en cada mensaje.
export function captureSubmit(on: any) {
  const sent: any[] = []
  on('prompt.submit', (_$: any, e: any) => {
    sent.push(e)
    return { text: e.text } as never
  })
  return sent
}

export const mountBand = ($: any) =>
  $.ui.mount({
    plugin: 'cache-guardian',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, bodyColumns: 160 } as never,
  })

export const command = ($: any, name: string) =>
  $.command.run({ command: name, args: '', origin: { kind: 'composer' } } as never)
