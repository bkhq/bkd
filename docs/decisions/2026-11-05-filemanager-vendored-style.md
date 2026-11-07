# Vendored filemanager sources keep upstream formatting

- **date**: 2026-11-05
- **sunset**: 2027-05-05 (revisit if the sources diverge from upstream)

`apps/{api,frontend}/src/fm/**` are copied from the `bkhq/filemanager` shadcn registry and
upgraded by re-copying and reviewing the diff. They keep upstream style (double quotes,
semicolons), so ESLint ignores `src/fm/**`; reformatting would bury every upgrade diff in
style noise. Local fixes go upstream first; BKD-specific behaviour lives outside `src/fm`.
