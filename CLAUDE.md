# Working in this repository

F.O.R.G.E. is configuration plus a small deterministic kernel. Almost every change belongs in
`charter/` or `registry/`, not in `scripts/`.

## Before you change anything

```bash
node scripts/forge.mjs doctor    # must be clean before and after
node --test tests/
```

## The rules that will bite you

1. **`agents/*.md` and `CHARTER.md` are build output.** Edit `registry/` or
   `charter/constitution.yaml`, then run `forge build --apply` and `forge charter --apply`.
   CI fails on a stale build with `git diff --exit-code`.

2. **A field declared and rendered nowhere is a comment.** If you add something to the
   registry, add the line in `scripts/render.mjs` that emits it *and* the assertion in
   `tests/render.test.mjs` that it reaches the prompt. This is the single most common way an
   agent system becomes decorative.

3. **A rule must name a check that exists.** `core.load()` refuses to start otherwise, so the
   constitution and `scripts/doctor.mjs` cannot drift apart.

4. **Test doctor by breaking the organization.** Every check gets a test that plants its
   specific violation and asserts the failure. Asserting a healthy org passes proves nothing —
   an empty function passes too.

5. **No dependencies.** Not "few". None. `forge doctor` has to run on a machine that has never
   run `npm install`, because that is the machine where a violation matters most.

6. **No domain.** No framework, vendor or product name in `charter/` or `registry/`.
   `no_domain_leaked_in` fails the build. Domain knowledge is learned per workspace into
   `.forge/`.

7. **Both directions on every matcher.** A gate needs a test that it fires and a test that it
   stays silent. The false-positive test is the one that keeps it worth reading.

## Style

- 2-space indentation, `const`/`let`, ES modules.
- Comments explain *why*, and especially why an obvious simpler approach was rejected. Several
  in this codebase record a defect that was actually hit; keep those.
- `fileURLToPath`, never `new URL(import.meta.url).pathname` — the latter yields `/D:/a/repo`
  on Windows and every path built from it silently misses.
