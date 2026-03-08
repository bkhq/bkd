# PLAN-006 Migrate from Biome to ESLint + Prettier

- **task**: LINT-001
- **status**: completed
- **owner**: claude

## Context

Biome (Rust binary) frequently core dumps during lint runs. The `ulimit -c 0` workaround only suppresses the dump file but the process still crashes. Migration to ESLint + Prettier eliminates this instability.

## Steps

1. Install ESLint + Prettier packages at root
2. Create `eslint.config.js` (flat config) mapping all Biome rules
3. Create `.prettierrc` + `.prettierignore`
4. Update root `package.json` scripts, remove `@biomejs/biome`
5. Convert `biome-ignore` comments → `eslint-disable` equivalents
6. Delete `biome.json`
7. Update docs (CLAUDE.md, AGENTS.md, development.md, architecture.md, frontend README)
8. Run format + lint + tests to verify

## Rule Mapping

| Biome Rule                      | ESLint Equivalent                                           |
| ------------------------------- | ----------------------------------------------------------- |
| `noRestrictedImports` (zod)     | `no-restricted-imports`                                     |
| `useImportType` (separatedType) | `@typescript-eslint/consistent-type-imports`                |
| `useNodejsImportProtocol`       | `@typescript-eslint/no-require-imports` + manual            |
| `useConst`                      | `prefer-const`                                              |
| `noImplicitAnyLet`              | `@typescript-eslint/no-inferrable-types` (partial)          |
| `noDuplicateObjectKeys`         | `no-dupe-keys`                                              |
| `noTsIgnore`                    | `@typescript-eslint/ban-ts-comment`                         |
| `noDebugger`                    | `no-debugger`                                               |
| `noDelete`                      | `no-restricted-syntax` (UnaryExpression[operator='delete']) |
| `useDateNow`                    | — (no direct equivalent, skip)                              |
| `noUselessSwitchCase`           | `no-fallthrough` (partial)                                  |
| `noUnusedImports`               | `@typescript-eslint/no-unused-vars`                         |
| `noMisusedPromises`             | `@typescript-eslint/no-misused-promises`                    |
| `noFloatingPromises`            | `@typescript-eslint/no-floating-promises`                   |
| React recommended               | `eslint-plugin-react-hooks`                                 |

## Formatter Config (Prettier)

- `semi: false` (matches `semicolons: "asNeeded"` with no-semi convention)
- `singleQuote: true`
- `tabWidth: 2`
- `trailingComma: "all"`
- `printWidth: 100`
