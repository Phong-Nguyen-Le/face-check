# Project Code Rules

## Folder structure

```
app/                        # Expo Router pages only — no business logic here
  (tabs)/                   # Tab screens (index, identify, explore)
components/
  view/                     # Screen-level UI components (tied to a specific screen)
    enroll/                 # Components used on the Enroll (Home) screen
  ui/                       # Generic reusable UI (buttons, inputs, etc.)
modules/
  expo-face-recognition/    # Custom native Expo module
    ios/                    # Swift source
    src/                    # JS/TS bindings
types/                      # Shared TypeScript types (no runtime code)
```

## Component rules

- Screen files in `app/` must be thin orchestrators: state + callbacks only, no JSX logic
- Put all non-trivial JSX into a component in `components/view/<screen>/`
- One component per file; filename = component name (PascalCase)
- Generic UI that is reused across screens goes in `components/ui/`

## TypeScript / types

- Shared types live in `types/` (e.g. `types/enroll.ts`) with a path alias `@/types/<name>`
- Do not inline types that are used in more than one file
- Prefer `type` over `interface` for plain data shapes

## Styling

- Use `StyleSheet.create` — no inline style objects except for dynamic values
- All style objects at the bottom of the file, after the component
- No hardcoded colours outside of a StyleSheet; keep them consistent with the existing palette (`#0a0a0a` bg, `#4ade80` accent, `#ff6b6b` destructive)

## Native module (expo-face-recognition)

- Swift changes require a clean rebuild — remind the user when Swift files are edited
- JS bindings live in `modules/expo-face-recognition/src/`; types in `ExpoFaceRecognition.types.ts`
- Do not call `ExpoFaceRecognitionModule` directly from JSX — call it only from callbacks or effects

## Imports

- Path alias `@/` maps to the project root — use it for all cross-directory imports
- Order: React/RN core → Expo packages → third-party → internal (`@/`) → relative (`./`)
- No default + named re-exports from the same barrel file

## Constants

- Every magic number or magic string must be extracted into a named constant
- Constants are `SCREAMING_SNAKE_CASE`
- Place constants at the top of the file they belong to, before functions
- If a constant is used in more than one file, move it to the relevant `constants.ts` in the same feature folder (e.g. `components/view/enroll/constants.ts`)
- Group related constants together and add a single-line comment explaining the unit or purpose (e.g. `// ratio relative to oval width`)
- String literals returned from pure logic functions (like error messages) must be exported as a `const` object so call-sites can reference the key instead of repeating the string

## Comments

- Write no comments by default
- Only add a comment when the WHY is non-obvious (hidden constraint, workaround, subtle invariant)

## Commits / PRs

- Do not commit unless explicitly asked
- Do not push unless explicitly asked
