import { expect, test } from 'claude-code/testing'

import {
  cacheGlyph,
  cacheLevel,
  cacheStatus,
  formatSeconds,
  contextHint,
  effectiveTtl,
  effortAfterCommand,
  formatModel,
  formatOutlook,
  dryMs,
  formatSpan,
  formatTokens,
  handoffFile,
  showResumeWarm,
  idealPercent,
  learnTtl,
  paceOf,
  quotaView,
  barRuns,
  formatShort,
  padPercent,
  projectedPercent,
  minIdealFor,
  WEEKLY_MIN_IDEAL,
  quotaBar,
  behindOf,
  formatClock,
  hasHistory,
  isCommandText,
} from '../hooks/logic'

const MIN = 60_000
const HOUR = 60 * MIN

test('el ideal avanza lineal con el tiempo transcurrido de la ventana', () => {
  const now = 1_000_000_000
  expect(idealPercent(now + 5 * HOUR, 5 * HOUR, now)).toBe(0)
  expect(idealPercent(now + 2.5 * HOUR, 5 * HOUR, now)).toBe(50)
  expect(idealPercent(now, 5 * HOUR, now)).toBe(100)
  // Fuera de la ventana se acota a 0..100.
  expect(idealPercent(now + 6 * HOUR, 5 * HOUR, now)).toBe(0)
  expect(idealPercent(now - HOUR, 5 * HOUR, now)).toBe(100)
})

test('la proyección al renovar sale del % real y del ideal', () => {
  expect(Math.round(projectedPercent(19, 24))).toBe(79)
  expect(projectedPercent(50, 50)).toBe(100)
  // En el primer 5 % de la ventana el denominador tiene piso: 3 % a 4 % del tiempo da 60 %, no 75 %.
  expect(projectedPercent(3, 4)).toBe(60)
  // La semanal tiene piso de 20 %: 11 % a 5 % del tiempo da 55 %, igual que a 20 %.
  expect(Math.round(projectedPercent(11, 5.1, WEEKLY_MIN_IDEAL))).toBe(55)
  expect(Math.round(projectedPercent(11, 20, WEEKLY_MIN_IDEAL))).toBe(55)
  // Recién renovada (ideal 0) no divide por cero.
  expect(projectedPercent(2, 0, WEEKLY_MIN_IDEAL)).toBe(10)
})

test('al inicio de la semana la proyección es una cota inferior, no un silencio', () => {
  const H = 3_600_000
  const WEEK = 7 * 24 * H
  const now = 1_000 * H
  // Ráfaga: 11 % a las 9 h de la semana da ≥55 %, en verde (antes de 3.9.0 daba −3d 18h).
  const rafaga = quotaView(11, now + WEEK - 9 * H, WEEK, now, now, 90)
  expect(rafaga.kind === 'live' && Math.round(rafaga.projected)).toBe(55)
  expect(rafaga.kind === 'live' && rafaga.isFloor).toBe(true)
  expect(rafaga.kind === 'live' && rafaga.tone).toBe('holgado')
  expect(rafaga.kind === 'live' && formatOutlook(rafaga.projected, rafaga.dryMs, rafaga.isFloor)).toBe('≥55%')
  // Consumo alto: 50 % a las 30 h de la semana. En 3.9.0 quedaba verde y sin flecha; ahora ≥250 %, rojo.
  const alto = quotaView(50, now + WEEK - 30 * H, WEEK, now, now, 90)
  expect(alto.kind === 'live' && alto.tone).toBe('excede')
  expect(alto.kind === 'live' && formatOutlook(alto.projected, alto.dryMs, alto.isFloor)).toBe('−4d 4h+')
  // Pasado el 20 %, la regla de tres es la de siempre: 11 % a 34 h da 54 %, sin piso.
  const firme = quotaView(11, now + WEEK - 34 * H, WEEK, now, now, 90)
  expect(firme.kind === 'live' && Math.round(firme.projected)).toBe(54)
  expect(firme.kind === 'live' && firme.isFloor).toBe(false)
  // Con 25 % a 34 h de la semana se proyecta 124 %: −1d 8h, en rojo.
  const alerta = quotaView(25, now + WEEK - 34 * H, WEEK, now, now, 90)
  expect(alerta.kind === 'live' && alerta.tone).toBe('excede')
  expect(alerta.kind === 'live' && formatShort(alerta.dryMs ?? 0)).toBe('1d 8h')
  expect(minIdealFor(5 * H)).toBe(5)
  expect(minIdealFor(WEEK)).toBe(20)
})

test('con déficit, la flecha dice cuánto tiempo quedarías sin cuota', () => {
  const H = 3_600_000
  const WEEK = 7 * 24 * H
  // 135 % en la semanal: te quedas ~1d 19h sin cuota (la del ejemplo de la ayuda).
  expect(formatShort(dryMs(135, WEEK))).toBe('1d 19h')
  expect(Math.round(dryMs(280, WEEK) / H)).toBe(108)
  expect(dryMs(100, WEEK)).toBe(0)
  expect(dryMs(40, WEEK)).toBe(0)
  expect(formatOutlook(79.2, null)).toBe('79%')
  expect(formatOutlook(135, dryMs(135, WEEK))).toBe('−1d 19h')
  // Sin tope: 450 % ya no es ">200", es tiempo.
  expect(formatOutlook(450, dryMs(450, 5 * H))).toBe('−3h 53m')
})

test('el déficit de ruido sigue en % y amarillo; agotada, el déficit es lo que falta', () => {
  const H = 3_600_000
  const now = 100 * H
  // 18 % a 54 min de una ventana de 5 h: 101 %, ~3 min secos, por debajo del umbral.
  const justo = quotaView(18, now + 5 * H - 54 * 60_000, 5 * H, now, now, 90)
  expect(justo.kind === 'live' && justo.dryMs).toBeNull()
  expect(justo.kind === 'live' && justo.tone).toBe('cerca')
  // 60 % a las 2 h: 150 %, 1h 40m sin cuota.
  const corto = quotaView(60, now + 3 * H, 5 * H, now, now, 90)
  expect(corto.kind === 'live' && corto.tone).toBe('excede')
  expect(corto.kind === 'live' && formatShort(corto.dryMs ?? 0)).toBe('1h 40m')
  // Agotada: coincide con el tiempo al reinicio, incluso antes de que haya proyección.
  const agotada = quotaView(100, now + 2 * H, 7 * 24 * H, now, now, 90)
  expect(agotada.kind === 'live' && agotada.dryMs).toBe(2 * H)
  const temprana = quotaView(100, now + 4.9 * H, 5 * H, now, now, 90)
  expect(temprana.kind === 'live' && temprana.isFloor).toBe(true)
  expect(temprana.kind === 'live' && temprana.dryMs).toBe(4.9 * H)
  expect(temprana.kind === 'live' && temprana.tone).toBe('excede')
})

test('el color sigue la proyección: holgura, cerca del límite o sin cuota', () => {
  expect(paceOf(19, 79, 80)).toBe('holgado')
  expect(paceOf(40, 80, 80)).toBe('cerca')
  expect(paceOf(60, 100, 80)).toBe('cerca')
  // Hasta un déficit del 5 % de la ventana (≈105 %) es ruido: amarillo, no rojo.
  expect(paceOf(60, 101, 80)).toBe('cerca')
  expect(paceOf(60, 105, 80)).toBe('cerca')
  expect(paceOf(60, 106, 80)).toBe('excede')
  // Sin proyección usa el % real.
  expect(paceOf(30, null, 80)).toBe('holgado')
  expect(paceOf(90, null, 80)).toBe('cerca')
})

test('la barra rellena hasta el ideal y el punto marca el real', () => {
  const bar = quotaBar(25, 50, 12)
  expect(bar.length).toBe(13)
  expect(bar[3]).toBe('●')
  expect(bar.startsWith('━━━')).toBe(true)
  expect(bar.endsWith('─')).toBe(true)
  // Al 100 % el punto queda al final, después de la última celda.
  expect(quotaBar(100, 0, 12)[12]).toBe('●')
  // El punto va entre celdas: una diferencia menor a una celda sigue viéndose.
  expect(quotaBar(23.8, 30, 10)).toBe('━━●━───────')
  // Vas adelantado: el punto queda más allá del final de la barra.
  expect(quotaBar(50, 20, 10)).toBe('━━───●─────')
})

test('el reloj de caché distingue tibia de fría', () => {
  expect(cacheStatus(null, '1h', 0)).toEqual({ kind: 'empty' })
  expect(cacheStatus(0, '1h', 10 * MIN)).toEqual({ kind: 'warm', leftMs: 50 * MIN })
  expect(cacheStatus(0, '5m', 2 * HOUR)).toEqual({ kind: 'cold', coldMs: 2 * HOUR - 5 * MIN })
})

test('el TTL en auto se aprende de la pausa y de lo re-escrito', () => {
  expect(effectiveTtl('auto', null)).toBe('1h')
  expect(effectiveTtl('auto', '5m')).toBe('5m')
  expect(effectiveTtl('1h', '5m')).toBe('1h')
  expect(learnTtl(20 * MIN, 50_000, 45_000, 50_000)).toBe('5m')
  expect(learnTtl(20 * MIN, 50_000, 10_000, 50_000)).toBe('1h')
  expect(learnTtl(20 * MIN, 50_000, 25_000, 50_000)).toBeNull()
  // Pausa fuera de 6 a 55 min o contexto chico: no aprende.
  expect(learnTtl(2 * MIN, 50_000, 45_000, 50_000)).toBeNull()
  expect(learnTtl(20 * MIN, 10_000, 9_000, 10_000)).toBeNull()
})

test('formatea tiempos y la ruta del handoff', () => {
  expect(padPercent(3)).toBe('  3')
  expect(padPercent(17.6)).toBe(' 18')
  expect(padPercent(100)).toBe('100')
  expect(formatSpan(42 * MIN)).toBe('42 min')
  expect(formatSpan(130 * MIN)).toBe('2 h 10 min')
  expect(formatSpan((3 * 24 + 4) * HOUR)).toBe('3 d 4 h')
  expect(handoffFile('/Users/ahenaol/Downloads')).toBe('Users-ahenaol-Downloads.md')
})

test('formatea tokens, ventana y modelo', () => {
  expect(formatTokens(221_000)).toBe('221k')
  expect(formatTokens(1_000_000)).toBe('1M')
  expect(formatTokens(1_500_000)).toBe('1.5M')
  expect(formatModel('claude-fable-5-1')).toBe('fable-5-1')
  expect(formatModel('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
})

test('el aviso de cierre de tarea funciona con y sin git', () => {
  const base = {
    tokens: 60_000,
    window: 1_000_000,
    soft: 100_000,
    fullPercent: 70,
    taskDone: false,
    turnsSinceHandoff: 0,
    longTurns: 30,
  }
  expect(contextHint(base)).toBeNull()
  // Ventana casi llena: prioridad máxima.
  expect(contextHint({ ...base, tokens: 720_000 })?.kind).toBe('full')
  expect(contextHint({ ...base, tokens: 120_000 })?.kind).toBe('heavy')
  // Un commit sugiere tarea nueva, pero no es necesario: sin git, las sesiones largas la sugieren.
  expect(contextHint({ ...base, taskDone: true })?.kind).toBe('task')
  expect(contextHint({ ...base, turnsSinceHandoff: 30 })?.kind).toBe('long')
  // Sin tamaño de ventana conocido no se evalúa el porcentaje.
  expect(contextHint({ ...base, window: 0, tokens: 720_000 })?.kind).toBe('heavy')
})

test('la cuota no muestra datos viejos: ventana renovada y lectura vieja', () => {
  const H = 3_600_000
  const now = 10 * H
  expect(quotaView(40, now - 1, 5 * H, now, now, 80)).toEqual({ kind: 'renewed' })
  const fresh = quotaView(40, now + 2.5 * H, 5 * H, now, now - 60_000, 80)
  expect(fresh.kind === 'live' && fresh.isStale).toBe(false)
  expect(fresh.kind === 'live' && Math.round(fresh.projected)).toBe(80)
  const old = quotaView(40, now + 2.5 * H, 5 * H, now, now - 20 * 60_000, 80)
  expect(old.kind === 'live' && old.isStale).toBe(true)
})

test('la barra se parte en tramos y el tiempo corto es compacto', () => {
  expect(barRuns(25, 50, 12).map(r => r.kind)).toEqual(['fill', 'mark', 'fill', 'rest'])
  expect(barRuns(0, 0, 4)).toEqual([{ kind: 'mark', text: '●' }, { kind: 'rest', text: '────' }])
  expect(formatShort(42 * 60_000)).toBe('42m')
  expect(formatShort(202 * 60_000)).toBe('3h 22m')
  expect(formatShort((5 * 24 + 17) * 3_600_000)).toBe('5d 17h')
})

test('Retomar limpio con caché tibia solo con algo que decidir', () => {
  const heavy = { kind: 'heavy' as const, text: '' }
  const task = { kind: 'task' as const, text: '' }
  expect(showResumeWarm(null, false, 0)).toBe(false)
  expect(showResumeWarm(task, false, 0)).toBe(true)
  expect(showResumeWarm(heavy, false, 0)).toBe(true)
  expect(showResumeWarm(heavy, true, 7)).toBe(true)
  expect(showResumeWarm(null, true, 0)).toBe(true)
  expect(showResumeWarm(null, true, 1)).toBe(false)
})

test('el esfuerzo se refleja apenas termina /effort o /model', () => {
  const settings = { effortLevel: 'medium', modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } }
  const base = { command: 'effort', args: '', model: 'claude-opus-5-5', settings }
  // Lo que respondió el comando manda sobre todo lo demás.
  expect(effortAfterCommand({ ...base, args: 'low', output: 'Set effort level to xhigh (saved as your default)' })).toBe('xhigh')
  // Sin respuesta, lo escrito tras /effort.
  expect(effortAfterCommand({ ...base, args: ' MAX ' })).toBe('max')
  // Sin ninguno de los dos (el selector), la configuración del modelo antes que la general.
  expect(effortAfterCommand(base)).toBe('high')
  expect(effortAfterCommand({ ...base, model: 'claude-sonnet-5-5' })).toBe('medium')
  // Tras /model, sus argumentos no son un nivel.
  expect(effortAfterCommand({ ...base, command: 'model', args: 'high', model: 'otro', settings: null })).toBe(null)
  expect(effortAfterCommand({ ...base, args: 'auto', settings: { effortLevel: 'turbo' } })).toBe(null)
})

test('handoff: hora con fecha si no es de hoy, atraso y comandos frente a mensajes', () => {
  const now = new Date(2026, 9, 8, 15, 40).getTime()
  expect(formatClock(new Date(2026, 9, 8, 9, 5).getTime(), now)).toBe('09:05')
  expect(formatClock(new Date(2026, 9, 6, 15, 36).getTime(), now)).toBe('06/10 15:36')
  expect(behindOf(7, 4)).toBe(3)
  expect(behindOf(7, 7)).toBe(0)
  // Conteo por debajo del del handoff: no se da por al día.
  expect(behindOf(3, 20)).toBe(3)
  expect(behindOf(0, 5)).toBe(1)
  expect(isCommandText('/model opus')).toBe(true)
  expect(isCommandText('/plugin:cmd')).toBe(true)
  expect(isCommandText('!ls -la')).toBe(true)
  expect(isCommandText('/Users/yo/notas.md revisa')).toBe(false)
  expect(isCommandText('hola /model')).toBe(false)
  expect(hasHistory([{ role: 'user' }])).toBe(false)
  expect(hasHistory([{ role: 'user' }, { role: 'assistant' }])).toBe(true)
})

// La alerta escala con la urgencia; con TTL de 5 min los umbrales se acotan para no vivir en amarillo.
test('nivel de la caché, reloj que se vacía y cuenta regresiva', () => {
  const MIN = 60_000
  expect(cacheLevel(42 * MIN, '1h')).toBe('calm')
  expect(cacheLevel(5 * MIN, '1h')).toBe('soon')
  expect(cacheLevel(60_000, '1h')).toBe('last')
  expect(cacheLevel(3 * MIN, '5m')).toBe('calm')
  expect(cacheLevel(70_000, '5m')).toBe('soon')
  expect(cacheLevel(30_000, '5m')).toBe('last')
  expect([55, 40, 20, 5].map(m => cacheGlyph(m * MIN, '1h')).join('')).toBe('●◕◑◔')
  expect(formatSeconds(48_000)).toBe('0:48')
  expect(formatSeconds(60_000)).toBe('1:00')
  expect(formatSeconds(-5)).toBe('0:00')
})
