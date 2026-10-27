## Summary

<!-- What does this change and why? Link related issues (e.g. "Closes #123"). -->

## Type of change

- [ ] Code (feature / fix / refactor)
- [ ] Community content (device, profile, keymap pack, effect, typing pack)
- [ ] Documentation / website

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npx vitest run` passes
- [ ] `npm run community:validate` passes
- [ ] UI changes include a screenshot (dark and light if relevant)
- [ ] New UI strings are added to both `src/i18n/en` and `src/i18n/es`

## Community content checklist

<!-- Only for files under community/. Delete this section otherwise. -->

- [ ] The file name equals the `id` inside the file (`community/profiles/neon-focus.json` → `"id": "neon-focus"`)
- [ ] `$schema` points to the matching schema (e.g. `../schemas/profile.schema.json`)
- [ ] Tested on a real device. Which one(s)? <!-- model + firmware -->
- [ ] No risky actions, **or** they are explained below (`launch`, `macro` with text, `text`, `http`)
- [ ] Effects: no network access or dynamic code (`fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `eval`, `Function(`)
- [ ] Optional preview image added next to the file as `<id>.png` (or `.svg`)
- [ ] I agree that this contribution is released under the [MIT License](https://github.com/Brokenwatch24/keyhalo/blob/main/LICENSE)

### Risky actions explained

<!-- If your keymap pack launches programs, types text or makes HTTP requests, explain why here. -->
