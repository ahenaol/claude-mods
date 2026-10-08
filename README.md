# Mods de ahenaol para Claude Code

[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-%E2%89%A5%202.1.289-d97757.svg)](https://claude.com/claude-code)
[![Marketplace](https://img.shields.io/badge/marketplace-ahenaol--mods-6a4fd8.svg)](.claude-plugin/marketplace.json)

Mods para [Claude Code](https://claude.com/claude-code). Un mod es un plugin que cambia la interfaz o el comportamiento de Claude Code con hooks: franjas encima del prompt, paneles, comandos y reacciones a los eventos de la sesión.

Este repositorio es a la vez el código fuente y un marketplace de Claude Code. El catálogo está en [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) y cada mod vive en su propia carpeta dentro de [`mods/`](mods/).

## Catálogo

| Mod | Descripción | Versión |
| --- | --- | --- |
| [**cache-guardian**](mods/cache-guardian/) | Cuota de 5 h y semanal frente al ritmo ideal, reloj de la caché de prompts con alertas que escalan y un handoff preventivo para no re-cachear contextos grandes | 3.5.0 |

## Instalación

Dentro de una sesión de Claude Code en la terminal:

```text
/plugin install cache-guardian --marketplace ahenaol/claude-mods
```

Acepta agregar el marketplace (`y`) y elige el alcance **usuario** para cargar el mod en todas tus sesiones. Si el mod tiene opciones, aparece una pantalla para fijarlas; después se cambian con `/config`.

También se puede hacer desde la línea de comandos:

```bash
claude plugin marketplace add ahenaol/claude-mods
claude plugin install cache-guardian@ahenaol-mods --scope user
```

## Actualización

```bash
claude plugin marketplace update ahenaol-mods
claude plugin update cache-guardian@ahenaol-mods
```

Luego ejecuta `/reload-plugins` en la sesión abierta o reinicia Claude Code.

## Compatibilidad

| Requisito | Detalle |
| --- | --- |
| Claude Code | CLI 2.1.289 o superior, en la terminal |
| API de mods | *Early access*: una versión nueva de Claude Code puede cambiarla. Si un mod deja de cargar, actualízalo o abre un issue |
| Idioma | La interfaz de los mods está en español |

## Estructura del repositorio

```text
.
├── .claude-plugin/
│   └── marketplace.json      catálogo del marketplace
├── mods/
│   └── cache-guardian/       un mod: manifiesto, hooks, contrato de estado, pruebas y documentación
├── LICENSE
└── README.md
```

## Reportar problemas

Abre un [issue](https://github.com/ahenaol/claude-mods/issues) con la versión de Claude Code (`claude --version`), la versión del mod (`claude plugin list`) y, si la hay, la línea que el motor muestra en el chat cuando un mod falla.

## Licencia

Distribuido bajo la licencia [MIT](LICENSE).
