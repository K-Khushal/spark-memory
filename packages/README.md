# Packages are deep modules

Each folder here is one package: a lot of behaviour behind a small interface.

```
packages/<name>/
  index.ts      ← an entry point (public). Import this from outside.
  client.ts     ← another entry point, if the package needs several.
  lib/          ← implementation: private, free to import each other.
  tests/        ← tests and fixtures (private).
```

`@spark/core` is the copy-me example.

1. **Entry-point boundary**: code outside a package (apps or other packages) imports only its root files, never anything in its subfolders.
2. **Intra-package freedom**: a package's own files import each other freely.
3. **Tests through the entry points**: `tests/` may import any package's entry points and its own fixtures, never internals (not even its own).
4. **No cycles.**

**No barrel files.** Don't re-export a whole subtree through one giant `index.ts`; expose several small entry points instead, and keep implementation in `lib/`.

Run `pnpm lint:boundaries` (dependency-cruiser) to check; it is part of `pnpm check` and CI.
