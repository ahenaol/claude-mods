# Mods de ahenaol para Claude Code

Mods públicos para [Claude Code](https://claude.com/claude-code). Un mod es un plugin que cambia la interfaz o el comportamiento de Claude Code con hooks: franjas encima del prompt, paneles, comandos y reacciones a eventos de la sesión.

Este repositorio es un marketplace de Claude Code: el archivo [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) lista los mods y cada uno vive en su carpeta dentro de [`mods/`](mods/).

## Mods

| Mod | Qué hace | Versión |
| --- | --- | --- |
| [`cache-guardian`](mods/cache-guardian/) | Muestra la cuota (ventana de 5 h y semanal) frente al ritmo ideal, el reloj de la caché de prompts, y escribe un handoff antes de que la caché venza para no re-cachear contextos grandes | 3.3.0 |

## Instalar

En una sesión de Claude Code en la terminal:

```text
/plugin install cache-guardian --marketplace ahenaol/claude-mods
```

Responde `y` para agregar el marketplace y elige el alcance (el de usuario carga el mod en todas tus sesiones). Si el mod tiene opciones, aparece una pantalla para fijarlas; después se cambian con `/config`.

Para recibir versiones nuevas:

```bash
claude plugin marketplace update ahenaol-mods
claude plugin update cache-guardian
```

Y luego `/reload-plugins` en la sesión abierta.

## Requisitos

Claude Code CLI 2.1.289 o superior. Los mods (*function hooks*) están en *early access*: si una versión de Claude Code cambia la API, puede que un mod deje de cargar hasta su siguiente versión.

## Licencia

[MIT](LICENSE).
