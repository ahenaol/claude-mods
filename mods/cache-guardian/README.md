# cache-guardian

Mod para Claude Code (CLI) que pone una franja encima del prompt con el modelo y el esfuerzo, el consumo de cuota (ventana de 5 horas y semanal) con su proyección al renovar, y el estado de la caché de prompts cuando el contexto es grande. Además escribe un resumen de la conversación (handoff) antes de que la caché venza y frena el regreso cuando retomar sería caro.

```text
5h ━━━●────── 28% → 82% · ↻ 3h 22m  │  sem ─●──────── 4% → 22% · ↻ 5d 17h
opus-5-5 · medium  │  118k/1M 12%  │  ● caché vence en 59m  │  ✓ handoff 12:53 +6      [ Actualizar handoff ]
```

| Función | Qué resuelve |
| --- | --- |
| Cuota con proyección | Ver de un vistazo con qué % llegarías a la renovación, en el límite de 5 h y en el semanal |
| Modelo y esfuerzo | Saber con qué modelo y nivel de esfuerzo gastas la cuota |
| Reloj de caché | Saber si la caché está tibia o fría, cuánto falta para que venza y cuántos tokens pesa la conversación |
| Handoff | Dejar escrito un resumen mientras releer el contexto todavía es barato |
| Guardián del regreso | Si vuelves con la caché fría y un contexto grande, retiene tu mensaje y te deja elegir cómo continuar |

La interfaz del mod está en español.

## Instalar

```text
/plugin install cache-guardian --marketplace ahenaol/claude-mods
```

Responde `y` para agregar el marketplace y elige el alcance de usuario para tenerlo en todas las sesiones. La franja aparece después de la primera respuesta; al escribir `/` deben aparecer `/guardian`, `/handoff` y `/retomar`.

Requiere Claude Code CLI 2.1.289 o superior. La línea de cuota solo sale con una suscripción: con API key `rateLimits` viene vacío y solo se ve el modelo.

## Por qué existe

Claude Code guarda la conversación en una caché de prompts durante un tiempo (TTL), de 1 hora o de 5 minutos. Mientras la caché está tibia, cada turno relee el contexto a una fracción del precio. Cuando vence, el siguiente mensaje vuelve a escribir **todo** el contexto en la caché, y eso es lo más caro.

| Situación | Qué pagas en el siguiente mensaje |
| --- | --- |
| Caché tibia | Lectura de caché (barata) de todo el contexto |
| Caché fría, sin hacer nada | Reescritura de caché (cara) de todo el contexto |
| Caché fría + **Retomar limpio** | Reescritura de solo el handoff (unos pocos miles de tokens) |

El truco es escribir el handoff **mientras la caché sigue tibia**, no después.

## Cómo leer la franja

La franja tiene dos zonas fijas: arriba la cuota (es de la cuenta y cambia despacio) y abajo la sesión (lo que decides antes de escribir).

### Cuota

| Elemento | Significado |
| --- | --- |
| Barra `━` y `─` | `━` es lo consumido, en el color del ritmo; `─` lo que falta |
| Punto `●` | Dónde deberías ir para llegar a la renovación justo en 100 % |
| `28%` | Consumo real de la ventana |
| `→ 82%` | Proyección: con qué % llegarías al reinicio si sigues a este ritmo |
| `↻ 3h 22m` | Tiempo para que la ventana se reinicie |
| `~19%` | Llevas más de 15 min sin respuestas: el dato es el de la última y puede estar por debajo del real |
| `5h renovada` | La ventana se reinició durante la pausa |

El color sigue la proyección: verde por debajo de 90 % (`quotaWarn`), amarillo de 90 a 100 % y rojo por encima de 100 %, que significa que a este ritmo te quedas sin cuota antes de renovar.

```text
ideal      = 100 × (1 − tiempo_que_falta / duración_de_la_ventana)
proyección = real / ideal × 100
```

El ideal semanal es 24/7, así que la proyección de la semana sale baja después de las noches y los fines de semana. La proyección supone ritmo constante: una ráfaga al inicio de la ventana la dispara.

### Sesión

El modelo y el contexto se ven siempre; la caché, el handoff y los botones aparecen cuando el contexto pasa de 40k tokens (`minTokens`).

| Lo que ves | Significado |
| --- | --- |
| `opus-5-5 · medium` | Modelo y esfuerzo. El esfuerzo sale en amarillo con `xhigh` o `max` |
| `221k/1M 22%` | Contexto frente a la ventana del modelo. Amarillo desde 100k (`softTokens`), rojo desde el 70 % de la ventana (`fullPercent`) |
| `● caché vence en 42m` | Caché vigente; el contador se reinicia con cada turno. El punto se pone amarillo a menos de 5 min |
| `● caché en uso` | Claude está respondiendo |
| `○ caché fría hace 2h 00m` | Venció: tu próximo mensaje reescribe todo el contexto |
| `✓ handoff 12:53 +14` | Hay un handoff, con su hora; `+14` son los turnos que no incluye |
| `◆ handoff de esta carpeta, de hace 3h 00m` | Conversación nueva con un handoff pendiente de esa carpeta |

Además sale un solo aviso de cierre de tarea, el primero que aplique: `compacta o retoma limpio` (ventana al 70 %), `¿tarea nueva? (commit hecho)` (Claude hizo un `git commit` con contexto grande) o `sesión larga (30 turnos)` (`longTurns`).

## Botones y comandos

| Botón | Tecla | Qué hace |
| --- | --- | --- |
| **Handoff ahora** / **Actualizar handoff** | `h` | Escribe ya el handoff |
| **Retomar limpio** | `r` | Actualiza el handoff si hace falta, hace `/clear` y lo adjunta a tu próximo mensaje |
| **Compactar** | `c` | Compacta la conversación (caché fría) |
| **Continuar desde ahí** | `r` | Adjunta el handoff pendiente a tu próximo mensaje |
| **Descartar** | `x` | Olvida el handoff pendiente |

Se pulsan con clic, o pasando el foco a la franja con `ctrl+x tab`, la tecla y `Esc` para volver al prompt.

| Comando | Qué hace |
| --- | --- |
| `/guardian` | Explica cómo leer la franja |
| `/handoff` | Escribe el handoff ahora y lo muestra en el chat |
| `/retomar` | Actualiza el handoff si hace falta, limpia la conversación y lo deja listo para tu próximo mensaje |

`/clear` escrito a mano, con más de 40k tokens, actualiza antes el handoff y después lo deja ofrecido.

## El handoff

Es una consulta aparte sobre la conversación que se sirve de la caché tibia (sale a precio de lectura) y no aparece en el chat. Pide un resumen de unas 400 palabras con Objetivo, Estado actual, Decisiones tomadas, Archivos y comandos clave, Siguiente paso, y Pendientes. Se guarda en el almacén del mod y, como respaldo legible, en `~/.claude/handoffs/<carpeta-con-guiones>.md`. Se ofrece durante 7 días y se usa una sola vez.

**Automático.** Si te alejas, el mod lo escribe solo unos 5 minutos antes de que venza la caché, siempre que haya turnos nuevos y el contexto pase de 40k tokens. El temporizador vive dentro de Claude Code: si cierras la terminal, no hay handoff automático.

**Guardián del regreso.** Si vuelves con la caché fría y más de 40k tokens, al pulsar Enter el mod retiene tu mensaje y abre un panel:

| Opción | Cuándo usarla |
| --- | --- |
| **1 Retomar limpio** | Casi siempre: `/clear`, adjunta el handoff y envía tu mensaje |
| **2 Compactar y enviar** | No hay handoff o necesitas más detalle |
| **3 Enviar igual** | Necesitas el contexto completo tal cual; pagas la reescritura |
| **4 Cancelar / Esc** | Tu mensaje vuelve al prompt intacto |

El guardián no actúa con mensajes que empiezan por `/` o `!`, con adjuntos ni con mensajes que no escribiste en el prompt. Al reanudar con `--resume`, `--continue` o `/resume`, el mod recupera el estado de esa conversación y avisa si la caché está fría.

## Configuración

Desde `/config` (filas del mod) o en `~/.claude/settings.json` bajo `pluginConfigs`.

| Opción | Por defecto | Qué controla |
| --- | --- | --- |
| `ttl` | `auto` | TTL de la caché. `auto` lo aprende de tus pausas (asume 1 h mientras tanto); `1h` o `5m` lo fijan. Con API key, probablemente `5m` |
| `minTokens` | 40000 | Por debajo no hay handoff automático, guardián ni botones |
| `softTokens` | 100000 | Desde aquí la franja marca contexto pesado y sale el primer aviso |
| `hardTokens` | 150000 | Segundo aviso |
| `autoHandoff` | `true` | Escribir el handoff solo, antes de que venza la caché |
| `showQuota` | `true` | Mostrar la cuota |
| `showModel` | `true` | Mostrar modelo y esfuerzo |
| `quotaWarn` | 90 | % proyectado desde el que la barra pasa a amarillo |
| `fullPercent` | 70 | % de la ventana desde el que se sugiere compactar o retomar limpio |
| `longTurns` | 30 | Turnos sin handoff nuevo desde los que se avisa de sesión larga |

## Solución de problemas

| Síntoma | Causa probable y solución |
| --- | --- |
| No veo la franja | Aparece tras la primera respuesta. Si no, busca en el chat una línea tenue `cache-guardian:` con el motivo, o abre `claude --debug` |
| No aparece la cuota | Sin suscripción, antes de la primera respuesta, o `showQuota` en `false` |
| Dice "tibia" pero la caché estaba fría | Tu TTL es de 5 min: fija `ttl` en `5m` |
| La tecla `h` no hace nada | La franja no tiene el foco: clic o `ctrl+x tab` primero |
| **Retomar limpio** deja el mensaje en el prompt | El motor no permitió reenviarlo: pulsa Enter y el handoff sale con él |
| Tras actualizar Claude Code el mod falla | La API de mods está en *early access*: actualiza el mod o abre un issue |

## Desarrollo

```text
cache-guardian/
├── .claude-plugin/plugin.json   ← manifiesto y opciones
├── hooks/
│   ├── hooks.json               ← apunta al módulo
│   ├── register.tsx             ← hooks y franja
│   └── logic.ts                 ← lógica pura (ideal, ritmo, barra, TTL, formatos)
├── types/index.d.ts             ← contrato del estado del mod
└── tests/                       ← 37 pruebas (lógica, franja y handoff sobre una sesión simulada)
```

```bash
claude --plugin-dir ./mods/cache-guardian      # una sesión con el mod desde la carpeta
claude plugin validate ./mods/cache-guardian
claude plugin test ./mods/cache-guardian       # en una terminal normal, no dentro de Claude Code
```

## Desinstalar

```bash
claude plugin uninstall cache-guardian
```

Si quieres, borra también los respaldos de handoff en `~/.claude/handoffs/`.
