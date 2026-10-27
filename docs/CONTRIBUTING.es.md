# Contribuir a KeyHalo

¡Gracias por ayudar! La mayoría de las contribuciones (un dispositivo nuevo, un perfil de
iluminación, un pack de atajos para tu aplicación favorita, un efecto o un pack de
mecanografía) son **JSON o un pequeño archivo JS**, sin necesidad de Rust.

> La versión completa y de referencia está en inglés: [CONTRIBUTING.md](../CONTRIBUTING.md).

Al participar aceptas el [Código de conducta](../CODE_OF_CONDUCT.md). Los problemas de
seguridad se reportan según [SECURITY.md](../SECURITY.md), nunca en issues públicos.

## Entorno de desarrollo

- **Node.js 22** y npm
- **Rust** estable con [rustup](https://rustup.rs) (solo para la app de escritorio)
- En Windows: **Microsoft C++ Build Tools** y **WebView2** (incluido en Windows 11)

```bash
git clone https://github.com/Brokenwatch24/keyhalo.git
cd keyhalo
npm install
npm run dev        # demo en el navegador con dispositivos simulados → http://localhost:1420
npm run app:dev    # app de escritorio (Tauri)
```

## Scripts útiles

| Comando | Qué hace |
|---|---|
| `npm run typecheck` | Comprobación de tipos |
| `npm test` | Tests (Vitest) |
| `npm run community:validate` | Valida todo `community/` contra los JSON Schemas |
| `npm run community:index` | Regenera `community/index.json` y la tabla de dispositivos del README |
| `npm run site:build` | Genera la web en `site/dist/` |
| `npm run screenshots` | Capturas de todas las páginas (requiere `npm run dev` y Microsoft Edge) |

## Contenido de la comunidad

Todo vive en [`community/`](../community/README.md). Reglas comunes:

- **El nombre del archivo debe ser igual al `id`** (`neon-focus.json` → `"id": "neon-focus"`).
- Imagen de vista previa opcional junto al archivo: `<id>.png` o `<id>.svg`.
- Ejecuta `npm run community:validate` antes de abrir el PR.
- O usa **Comunidad → Publicar** en la app: inicia sesión con GitHub y abre el PR por ti.

**Dispositivos** (`community/devices/<fabricante>/`): usa el **Asistente de dispositivos**
(Dispositivos → Añadir dispositivo) o copia una definición parecida. `match` en hexadecimal
(`"0x1532"`), `driver` `razer` / `lamparray` / `openrgb`, teclas con nombres
`KeyboardEvent.code` (`KeyA`, `ShiftLeft`…), `status` `community` hasta que se verifique.
Prueba primero en **Modo seguro**.

**Perfiles** (`community/profiles/`): créalos en la app y expórtalos con Iluminación → Compartir.

**Packs de atajos** (`community/keymaps/`): `apps` (procesos), `categories` (colores
`#rrggbb`), `legends` (atajos propios de la app) y `bindings` (reasignaciones y macros).
Las acciones `launch`, `text`, `macro` con texto y `http` se consideran **de riesgo**:
la CI las marca y el usuario debe confirmarlas al instalar.

**Efectos** (`community/effects/<id>.js`): módulo
`export default { meta, create(params) { return { frame(ctx) { … } } } }`. Se ejecutan
aislados en un Web Worker: sin red (`fetch`, `XMLHttpRequest`, `WebSocket`), sin
`importScripts`, `eval` ni `Function(`.

**Packs de mecanografía** (`community/typing/`): `language`, `kind` y `words` o `texts`.

## Commits y pull requests

- [Conventional Commits](https://www.conventionalcommits.org/es/): `feat(lighting): …`,
  `fix(razer): …`, `community(device): add Razer BlackWidow V4`.
- PRs pequeños y enfocados, con capturas si cambian la interfaz, y la plantilla completa.
- Tu contribución se publica bajo la [licencia MIT](../LICENSE).

## Estilo de código

- TypeScript estricto, React funcional, un store zustand por funcionalidad.
- Todos los textos de la interfaz en `src/i18n/en` **y** `src/i18n/es`.
- Interfaz en grises neutros; el color lo ponen la iluminación, los datos y los estados.
- Sin código GPL: la investigación de protocolos se acredita en `docs/protocols`.
- Rust mínimo, con `cargo fmt` y `cargo clippy` sin avisos.
