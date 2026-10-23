# Changelog

Todos los cambios relevantes de `cache-guardian`. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [versionado semántico](https://semver.org/lang/es/).

## [3.10.1] - 23/10/2026

### Corregido

- Los colores de la franja eran nombres fijos de terminal (`yellow`, `red`, `green`, `cyan`, `gray`) y no seguían el tema: con el tema claro de la app el amarillo de contexto pesado (`153k/1M 15%`), del esfuerzo alto o del ritmo de cuota casi no se leía. Ahora usan las claves del tema (`warning`, `error`, `success`, `suggestion`, `inactive`), que cada tema pinta con buen contraste. Las etiquetas con fondo (texto negro sobre amarillo o rojo) se quedan igual porque ya contrastan en los dos temas.

## [3.10.0] - 21/10/2026

### Corregido

- La ventana semanal se quedaba en verde y sin flecha durante su primer 20 % (~1d 10h) aunque el consumo fuera alto: 50 % al día siguiente del reinicio no avisaba nada, porque sin proyección el color salía del % real contra el umbral de 90 %.

### Cambiado

- La proyección ya no se apaga al inicio de la ventana. Es la misma regla de tres, con un piso en el denominador: antes del 5 % (5 h) o del 20 % (semanal) del tiempo, divide como si ya hubiera pasado ese tramo. El resultado es una cota inferior, marcada `≥55%` o `−4d 4h+`: una ráfaga inicial no se exagera (11 % en 9 h da `≥55%`, verde) y un consumo alto sí se ve (50 % en 30 h da `−4d 4h+`, rojo). No supone horario laboral ni ningún patrón de uso.
- `/guardian` explica el `≥` y el `+`.

## [3.9.0] - 20/10/2026

### Cambiado

- La ventana semanal no proyecta hasta que pase el 20 % de la semana (~1d 10h). Antes lo hacía desde el 5 % (~8 h), y 11 % usado en las primeras 9 h daba `→ −3d 18h` en rojo: una ráfaga inicial extrapolada a toda la semana. Mientras no hay proyección, la franja muestra solo el %, el punto en verde y el `↻`, sin flecha.
- La ventana de 5 h mantiene su umbral de 5 % (15 min).
- `/guardian` explica por qué a veces no hay flecha.

## [3.8.0] - 18/10/2026

### Cambiado

- Cuando a este ritmo la cuota se acaba antes del reinicio, la flecha dice cuánto tiempo quedarías sin ella en vez del % proyectado: `sem ━━━━━──●─── 71% → −1d 19h · ↻ 3d 7h`. Un 135 % no decía mucho y por encima de 200 % se quedaba fijo en `>200%`; el tiempo sigue siendo útil a cualquier ritmo. Con holgura la flecha sigue con el %.
- Un déficit menor al 5 % de la ventana (15 min en la de 5 h, unas 8 h en la semanal) se toma como ruido de la proyección: queda en amarillo y con el % (`→ 103%`), no en rojo.
- `/guardian` explica el nuevo caso con un ejemplo de la ventana semanal.

## [3.7.0] - 16/10/2026

### Cambiado

- La cuota se comparte entre tus sesiones. Solo llega con las respuestas de la API, así que una sesión quieta se quedaba con el % de su última respuesta y mostraba otro número que la sesión activa. Ahora cada sesión publica lo que mide y las demás lo toman en menos de un minuto. La marca `~` sale solo cuando ninguna sesión ha recibido respuestas en 15 minutos.

### Agregado

- La franja dice cuándo la caché la renovó el handoff: `◑ caché vence en 24m · renovada por el handoff`. Escribir el handoff lee la caché y eso la renueva. Sin la etiqueta, el plazo parecía saltar hacia atrás con la sesión quieta, como si el indicador estuviera congelado.

## [3.6.0] - 08/10/2026

### Cambiado

- La barra de cuota invierte sus significados: la barra `━` es ahora el tiempo transcurrido de la ventana (el ritmo ideal), en neutro, y el punto `●` es tu consumo real, en el color del ritmo. El punto aislado es lo primero que mira el ojo, así que ahora lleva el dato que importa. Dentro de la barra vas por debajo del ritmo; más allá de su final, por encima.

## [3.5.0] - 08/10/2026

### Agregado

- Con la caché fría, la línea roja dice cuánto de tu ventana de 5 h cuesta el próximo mensaje: `▲ Tu próximo mensaje cuesta ≈6% de tu 5h: reescribe 221k tokens de contexto`. El mismo dato sale en el panel del guardián y en los avisos de caché fría.
- El mod lo aprende de tu propio consumo, sin llamadas de red: compara cuánto sube la ventana de 5 h con el costo de la sesión y, por modelo, el costo de cada turno con sus tokens. Mientras no tiene 5 muestras de cuota y 3 de precio del modelo activo, la línea dice solo los tokens, como antes.
- `/guardian` dice cuánto le falta al aprendizaje (`aprendiendo (cuota 2/5, precio de opus-5-5 3/3)`).

## [3.4.1] - 08/10/2026

### Cambiado

- El chulo del handoff pasa de `✓` (U+2713) a `✔︎` (U+2714 con el selector de texto U+FE0E). Se ve igual en cualquier fuente y nunca se dibuja como emoji de doble ancho.

## [3.4.0] - 08/10/2026

### Agregado

- La alerta de caché escala con la urgencia, y solo cuando hay contexto grande:
  - El círculo se vacía con la vida de la caché (`● ◕ ◑ ◔`).
  - Pasa a amarillo en los últimos 5 minutos.
  - En el último minuto, la caché se muestra como pastilla con cuenta regresiva en segundos (`VENCE EN 0:48`).
- Con la caché fría aparece una línea roja con el costo del próximo mensaje (`▲ Tu próximo mensaje reescribe 221k tokens…`). El resto de la línea de sesión se atenúa para que no compita con la alerta.
- La acción recomendada se destaca como botón principal: **Actualizar handoff** en el último minuto y **Retomar limpio** (o **Compactar**, si no hay handoff) con la caché fría.

### Cambiado

- La caché fría pasa de amarillo a rojo. El amarillo queda para "por vencer" y el rojo para "te cuesta cuota ahora", el mismo significado que tiene en la cuota y en el contexto.
- Con un TTL de 5 minutos, los umbrales de "por vencer" y "último minuto" se acotan a 75 y 37 segundos.

## [3.3.0] - 08/10/2026

### Corregido

- El handoff pendiente ya no se pierde tras `/clear`: la conversación nueva conserva la fila del comando y antes se confundía con una conversación con historia.
- El atraso del handoff (`+N`) cuenta solo los turnos respondidos, no las filas de los comandos.

## [3.2.2] - 08/10/2026

### Corregido

- Al retomar una conversación ya no se adopta el handoff de carpeta de la versión anterior.

## [3.2.1] - 08/10/2026

### Agregado

- El modelo y el esfuerzo se actualizan en la franja apenas termina `/effort` o `/model`.

## [3.1.0] - 07/10/2026

### Agregado

- Primera versión pública del diseño actual: franja de dos zonas (cuota y sesión), cuota de 5 h y semanal con proyección al renovar, reloj de caché, handoff preventivo y guardián del regreso.

[3.5.0]: https://github.com/ahenaol/claude-mods/releases/tag/cache-guardian-v3.5.0
[3.4.1]: https://github.com/ahenaol/claude-mods/releases/tag/cache-guardian-v3.4.1
[3.4.0]: https://github.com/ahenaol/claude-mods/releases/tag/cache-guardian-v3.4.0
[3.3.0]: https://github.com/ahenaol/claude-mods/tree/2dd3f54/mods/cache-guardian
