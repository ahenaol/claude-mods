# Changelog

Todos los cambios relevantes de `cache-guardian`. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [versionado semántico](https://semver.org/lang/es/).

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
