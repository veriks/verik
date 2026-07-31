# Contributing

## Development setup

```sh
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## Running in dev mode

```sh
pnpm dev -- run -- <command>
```

## Code style

- TypeScript strict mode
- ESLint + Prettier
- No `any` unless unavoidable at an external boundary
- Validate all external inputs with Zod
- No comments unless the WHY is non-obvious

## Adding a deterministic rule

1. Create a file in `src/stages/reviewer/deterministic-rules/`
2. Implement `DeterministicRule` interface
3. Export the class
4. Register it in `src/stages/reviewer/deterministic-rules/index.ts`

## Adding a provider

1. Implement `LlmProvider` from `src/providers/llm-provider.ts`
2. Register it in `src/providers/provider-factory.ts`

## Testing

Unit tests live alongside source files as `*.test.ts`.
Integration tests should use fixture repositories in temp directories.
Use the `FakeProvider` for tests — no real API calls in the default suite.

## Filing issues

Please include:
- The command you ran
- The relevant part of `.crosscheck/runs/<id>/report.md`
- The error message or unexpected behavior
