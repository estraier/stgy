# Building and running STGY

**The repository root is the single build entry point.** Run these commands from the `stgy` directory after changing code in any `packages/*` workspace:

```sh
npm run build
```

The root build compiles `stgy-markdown`, `stgy-track`, `stgy-geocoder`, and the other workspaces in dependency order. `frontend` and `backend` import the compiled `dist` files of shared packages; restarting a dev server alone does **not** rebuild those packages. After a successful root build, a content fingerprint for every shared package is stored under `node_modules/.cache/`. Frontend and backend local start commands verify those fingerprints and the compiled outputs, independently of file modification times. On failure, run the root build; they deliberately do not rebuild an individual shared package automatically.

After the build, start local services as usual:

```sh
./scripts/run-local-frontend.sh
./scripts/run-local-backend.sh
```

`./scripts/run-local-frontend.sh --start` checks the shared packages, then rebuilds **only the frontend application** with the locally selected `NEXT_PUBLIC_*` URLs, as before. It does not rebuild any shared package.

`frontend` may still generate its **frontend-specific** browser assets and workers as part of `predev`/`prebuild`; those are not shared-package builds. `backend`'s development server uses `ts-node` for its own source, but still imports shared packages from their compiled outputs. Jest tests are independent of the workspace build fingerprint. They resolve shared workspace imports directly to TypeScript source, so `npm test`, `npm run backend:test`, and `npm run frontend:test` do not require a preceding root build and exercise current source changes. Running frontend/backend applications is different: their development and start commands continue to validate the latest root build before execution.

The Docker and deployment pipelines continue to build all required shared packages as part of creating their respective images/artifacts. They do not depend on a previously built developer workstation.
