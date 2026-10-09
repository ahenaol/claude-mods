# cache-guardian

[![Versión](https://img.shields.io/badge/versi%C3%B3n-3.5.0-6a4fd8.svg)](CHANGELOG.md)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-%E2%89%A5%202.1.289-d97757.svg)](https://claude.com/claude-code)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](../../LICENSE)

**Cuida tu cuota y tu caché de prompts en Claude Code.** El mod agrega encima del prompt una franja con tres cosas: tu consumo de cuota frente al ritmo ideal, el estado de la caché y una alerta que escala a medida que se acerca su vencimiento. También deja escrito un resumen de la conversación antes de que la caché venza, para que retomar no cueste re-leer todo el contexto.

```text
5h ━━━●─────── 28% → 82% · ↻ 3h 22m  │  sem ●━━──────── 4% → 22% · ↻ 5d 17h
opus-5-5 · medium  │  118k/1M 12%  │  ◕ caché vence en 42m  │  ✔︎ handoff 12:53 +6      [ Actualizar handoff ]
```

## Contenido

- [Por qué existe](#por-qué-existe)
- [Funciones](#funciones)
- [Instalación](#instalación)
- [Cómo leer la franja](#cómo-leer-la-franja)
- [Alertas de caché](#alertas-de-caché)
- [Botones y comandos](#botones-y-comandos)
- [El handoff](#el-handoff)
- [Configuración](#configuración)
- [Solución de problemas](#solución-de-problemas)
- [Desarrollo](#desarrollo)
- [Licencia](#licencia)

## Por qué existe

Claude Code guarda la conversación en una caché de prompts durante un tiempo (TTL) de 1 hora o de 5 minutos. Mientras la caché está tibia, cada turno re-lee el contexto a una fracción del precio. Cuando vence, el siguiente mensaje vuelve a escribir **todo** el contexto en la caché, y eso es lo más caro.

| Situación | Lo que pagas en el siguiente mensaje |
| --- | --- |
| Caché tibia | Lectura de caché (barata) de todo el contexto |
| Caché fría, sin hacer nada | Reescritura de caché (cara) de todo el contexto |
| Caché fría y **Retomar limpio** | Reescritura de solo el handoff, unos pocos miles de tokens |

La clave es escribir el handoff **mientras la caché sigue tibia**, no después. El mod lo hace por ti.

## Funciones

| Función | Qué resuelve |
| --- | --- |
| Cuota con proyección | Con qué % llegarías a la renovación, tanto en la ventana de 5 h como en la semanal |
| Modelo y esfuerzo | Con qué modelo y nivel de esfuerzo estás gastando la cuota |
| Reloj de caché | Si la caché está tibia o fría, cuánto le queda y cuánto pesa la conversación |
| Alertas que escalan | Avisos que suben de intensidad solo cuando hay costo real |
| Costo en % de la cuota | Con la caché fría, cuánto de tu ventana de 5 h te cuesta el próximo mensaje (`≈6%`), aprendido de tu propio consumo |
| Handoff | Un resumen escrito mientras releer el contexto todavía es barato |
| Guardián del regreso | Si vuelves con la caché fría y un contexto grande, retiene tu mensaje y te deja elegir cómo seguir |

## Instalación

```text
/plugin install cache-guardian --marketplace ahenaol/claude-mods
```

Acepta agregar el marketplace (`y`) y elige el alcance **usuario**. La franja aparece después de la primera respuesta, y al escribir `/` deben aparecer `/guardian`, `/handoff` y `/retomar`.

| Requisito | Detalle |
| --- | --- |
| Claude Code | CLI 2.1.289 o superior, en la terminal |
| Suscripción | La línea de cuota necesita una suscripción. Con API key no llega el dato de cuota y solo se muestra el modelo |

Para actualizar: `claude plugin marketplace update ahenaol-mods`, luego `claude plugin update cache-guardian@ahenaol-mods` y `/reload-plugins`.

## Cómo leer la franja

La franja tiene dos zonas fijas. Arriba va la cuota, que es de la cuenta y cambia despacio. Abajo va la sesión, con lo que decides antes de escribir.

### Cuota

| Elemento | Significado |
| --- | --- |
| `●` | Dónde vas: tu consumo real, en el color del ritmo. Dentro de la barra vas por debajo del ritmo ideal; más allá de su final, por encima |
| `━` y `─` | `━` es el tiempo transcurrido de la ventana, en neutro: dónde deberías ir para llegar a la renovación justo en 100 %; `─` es lo que falta |
| `28%` | Consumo real de la ventana |
| `→ 82%` | Proyección: con qué % llegarías al reinicio si sigues a este ritmo |
| `↻ 3h 22m` | Tiempo que falta para que la ventana se reinicie |
| `~19%` | Llevas más de 15 minutos sin respuestas: el dato es de la última y puede quedarse corto |
| `5h renovada` | La ventana se reinició durante la pausa |

El color sigue la proyección: verde por debajo del 90 % (opción `quotaWarn`), amarillo entre 90 y 100 % y rojo por encima de 100 %. En rojo, a este ritmo te quedas sin cuota antes de que la ventana se renueve.

```text
ideal      = 100 × (1 − tiempo_que_falta / duración_de_la_ventana)
proyección = real / ideal × 100
```

El ideal semanal corre 24/7, así que la proyección de la semana sale baja después de las noches y los fines de semana. La proyección supone un ritmo constante: una ráfaga al inicio de la ventana la dispara.

### Sesión

El modelo y el contexto se ven siempre. La caché, el handoff y los botones aparecen cuando el contexto pasa de 40k tokens (opción `minTokens`).

| Elemento | Significado |
| --- | --- |
| `opus-5-5 · medium` | Modelo y esfuerzo. El esfuerzo sale en amarillo con `xhigh` o `max`, que gastan más cuota por turno |
| `221k/1M 22%` | Contexto frente a la ventana del modelo. Amarillo desde 100k (`softTokens`) y rojo desde el 70 % de la ventana (`fullPercent`) |
| `◕ caché vence en 42m` | Estado de la caché (ver [Alertas de caché](#alertas-de-caché)) |
| `✔︎ handoff 12:53 +6` | Hora del handoff guardado; `+6` son los turnos que todavía no incluye |
| `◆ handoff de esta carpeta, de hace 3h` | Conversación nueva con un handoff pendiente de esa carpeta |

Además se muestra un solo aviso de cierre de tarea, el primero que aplique: `compacta o retoma limpio` (ventana al 70 %), `¿tarea nueva? (commit hecho)` o `sesión larga (30 turnos)`.

## Alertas de caché

La alerta sube de intensidad con la urgencia, y solo cuando el contexto supera `minTokens`. Con poco contexto, una caché fría cuesta poco y el mod no te interrumpe.

| Nivel | Cómo se ve | Cuándo |
| --- | --- | --- |
| Tibia | `● ◕ ◑ ◔ caché vence en 42m` en verde | El círculo se vacía con la vida de la caché |
| Por vencer | `◔ caché vence en 4m` en amarillo | Últimos 5 minutos (75 s con TTL de 5 min) |
| Último minuto | Pastilla amarilla `VENCE EN 0:48`, con **Actualizar handoff** destacado | Último minuto (37 s con TTL de 5 min) |
| Fría | Línea roja `▲ Tu próximo mensaje cuesta ≈6% de tu 5h: reescribe 221k tokens de contexto`, el resto de la sesión atenuado y **Retomar limpio** destacado | La caché ya venció |

### El costo en % de tu ventana de 5 h

La API no informa la cuota en tokens, solo el % usado. Por eso el mod aprende la equivalencia de tu propio consumo:

| Qué aprende | De dónde | Muestras para usarla |
| --- | --- | --- |
| Cuánto % de la ventana de 5 h cuesta cada dólar | Cuánto sube la ventana frente al costo de la sesión, cada vez que avanza un punto entero | 5 |
| Cuánto cuesta un token de entrada del modelo activo | El costo de un turno frente a sus tokens, solo en turnos de un único modelo | 3 por modelo |

```text
% de la reescritura = tokens del contexto × peso de escritura (2 con TTL de 1 h, 1,25 con 5 min) × precio por token × % por dólar
```

Mientras faltan muestras, la línea roja dice solo los tokens; `/guardian` muestra cuánto falta. Es una estimación: el consumo de otras sesiones de la misma cuenta (otro equipo, claude.ai) se mezcla con el de esta, y el mod descarta lo sospechoso (saltos de más de 10 puntos, lecturas a más de 30 minutos de distancia) y usa la mediana. Lo aprendido se guarda en tu equipo y caduca si pasan 30 días sin muestras nuevas. Con API key no hay dato de cuota y la línea sigue en tokens.

Cada color tiene un solo significado en toda la franja: el amarillo es "atención" y el rojo es "esto te cuesta cuota ahora", igual que en la cuota y en el contexto.

## Botones y comandos

| Botón | Tecla | Qué hace |
| --- | --- | --- |
| **Handoff ahora** / **Actualizar handoff** | `h` | Escribe el handoff en este momento |
| **Retomar limpio** | `r` | Actualiza el handoff si hace falta, hace `/clear` y lo adjunta a tu próximo mensaje |
| **Compactar** | `c` | Compacta la conversación (con la caché fría) |
| **Continuar desde ahí** | `r` | Adjunta el handoff pendiente a tu próximo mensaje |
| **Descartar** | `x` | Olvida el handoff pendiente |

Se pulsan con clic, o pasando el foco a la franja con `ctrl+x tab`, presionando la tecla y volviendo al prompt con `Esc`.

| Comando | Qué hace |
| --- | --- |
| `/guardian` | Explica cómo leer la franja |
| `/handoff` | Escribe el handoff ahora y lo muestra en el chat |
| `/retomar` | Actualiza el handoff si hace falta, limpia la conversación y lo deja listo para tu próximo mensaje |

Un `/clear` escrito a mano, con más de 40k tokens, actualiza el handoff antes de limpiar y después lo deja ofrecido.

## El handoff

El handoff se genera con una consulta aparte sobre la conversación. Esa consulta aprovecha la caché tibia (sale a precio de lectura) y no aparece en el chat. El resultado es un resumen de unas 400 palabras con Objetivo, Estado actual, Decisiones tomadas, Archivos y comandos clave, Siguiente paso, y Pendientes. Se guarda en el almacén del mod y, como respaldo legible, en `~/.claude/handoffs/<carpeta-con-guiones>.md`. Se ofrece durante 7 días y se usa una sola vez.

**Automático.** Si te alejas, el mod escribe el handoff unos 5 minutos antes de que venza la caché, siempre que haya turnos nuevos y el contexto supere `minTokens`. El temporizador corre dentro de Claude Code: si cierras la terminal, no hay handoff automático.

**Guardián del regreso.** Si vuelves con la caché fría y un contexto grande, al pulsar Enter el mod retiene tu mensaje y te ofrece cuatro opciones:

| Opción | Cuándo usarla |
| --- | --- |
| **1 Retomar limpio** | Casi siempre: `/clear`, adjunta el handoff y envía tu mensaje |
| **2 Compactar y enviar** | No hay handoff o necesitas más detalle del que cabe en él |
| **3 Enviar igual** | Necesitas el contexto completo tal cual; pagas la reescritura |
| **4 Cancelar / Esc** | Tu mensaje vuelve intacto al prompt |

El guardián no actúa con mensajes que empiezan por `/` o `!`, con adjuntos ni con mensajes que no escribiste en el prompt. Al reanudar con `--resume`, `--continue` o `/resume`, el mod recupera el estado de esa conversación.

## Configuración

Las opciones se cambian desde `/config` o en `~/.claude/settings.json`, bajo `pluginConfigs["cache-guardian@ahenaol-mods"]`.

| Opción | Por defecto | Qué controla |
| --- | --- | --- |
| `ttl` | `auto` | TTL de la caché. `auto` lo aprende de tus pausas (asume 1 h mientras tanto); `1h` o `5m` lo fijan. Con API key, probablemente sea `5m` |
| `minTokens` | 40000 | Por debajo no hay alertas de caché, handoff automático, guardián ni botones |
| `softTokens` | 100000 | Desde aquí la franja marca contexto pesado y sale el primer aviso |
| `hardTokens` | 150000 | Segundo aviso de contexto |
| `autoHandoff` | `true` | Escribir el handoff solo, antes de que venza la caché |
| `showQuota` | `true` | Mostrar la cuota |
| `showModel` | `true` | Mostrar el modelo y el esfuerzo |
| `quotaWarn` | 90 | % proyectado desde el que la barra de cuota pasa a amarillo |
| `fullPercent` | 70 | % de la ventana desde el que se sugiere compactar o retomar limpio |
| `longTurns` | 30 | Turnos sin un handoff nuevo desde los que se avisa de sesión larga |

## Privacidad

El mod no hace llamadas de red propias ni envía datos a terceros. La cuota y el costo de la sesión salen de los datos que Claude Code ya recibe en cada turno. El handoff se genera con tu misma sesión y se guarda solo en tu equipo.

## Solución de problemas

| Síntoma | Causa probable y solución |
| --- | --- |
| No veo la franja | Aparece después de la primera respuesta. Revisa `claude plugin list` y busca en el chat una línea tenue `cache-guardian:` con el motivo |
| No aparece la cuota | Sin suscripción, antes de la primera respuesta, o con `showQuota` en `false` |
| La línea roja no dice el % | El mod sigue aprendiendo: `/guardian` dice cuántas muestras faltan. Con API key no hay dato de cuota |
| Dice "tibia" pero la caché estaba fría | Tu TTL es de 5 minutos y el mod todavía no lo aprendió: fija `ttl` en `5m` |
| La tecla `h` no hace nada | La franja no tiene el foco: haz clic en ella o usa `ctrl+x tab` primero |
| **Retomar limpio** deja el mensaje en el prompt | El motor no permitió reenviarlo: pulsa Enter y el handoff sale con él |
| El mod falla tras actualizar Claude Code | La API de mods está en *early access*: actualiza el mod o abre un issue |

Para un diagnóstico detallado: `claude --debug`.

## Desarrollo

```text
cache-guardian/
├── .claude-plugin/plugin.json   manifiesto y opciones
├── hooks/
│   ├── hooks.json               apunta al módulo
│   ├── register.tsx             hooks y franja
│   └── logic.ts                 lógica pura: ideal, ritmo, barra, TTL, niveles de alerta, costo en % de 5 h, formatos
├── types/index.d.ts             contrato del estado del mod
├── tests/                       pruebas de la lógica, la franja, el handoff y el costo en % sobre una sesión simulada
├── CHANGELOG.md
└── README.md
```

```bash
claude --plugin-dir ./mods/cache-guardian      # una sesión con el mod cargado desde la carpeta
claude plugin validate ./mods/cache-guardian
claude plugin test ./mods/cache-guardian       # en una terminal normal, no dentro de una sesión de Claude Code
```

Si tienes instalada la versión del marketplace, deshabilítala mientras pruebas (`claude plugin disable cache-guardian@ahenaol-mods`) para que no carguen las dos.

Los cambios de cada versión están en el [CHANGELOG](CHANGELOG.md).

## Desinstalar

```bash
claude plugin uninstall cache-guardian@ahenaol-mods
```

Si quieres, borra también los respaldos de handoff en `~/.claude/handoffs/`.

## Licencia

Distribuido bajo la licencia [MIT](../../LICENSE).
