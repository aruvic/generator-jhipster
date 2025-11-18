# AI Copilot Instructions for generator-jhipster

This document provides essential guidance for AI coding agents working on the JHipster generator.

## Project Overview

**generator-jhipster** is a Yeoman-based code generator that scaffolds full-stack Java/JavaScript applications with Spring Boot, Angular/React/Vue, and various cloud/deployment configurations. The project uses TypeScript and relies on a sophisticated priority-based generator architecture.

## Architecture & Core Concepts

### Yeoman Generator Pattern

JHipster wraps Yeoman with custom priority queues. All generators extend base classes from `generators/base-*`:
- **BaseGenerator** (`generators/base/`): Core blueprint support with state management
- **BaseApplicationGenerator** (`generators/base-application/`): Multi-priority lifecycle for complex apps
- **BaseSimpleApplicationGenerator** (`generators/base-simple-application/`): Simpler single-tier generators

### Generator Lifecycle Priorities

Generators execute in strict priority order. Use static constants like `BaseGenerator.INITIALIZING`:

```typescript
get [BaseGenerator.INITIALIZING]() {
  return this.asInitializingTaskGroup({
    taskName() { /* logic */ },
  });
}
```

**Key priorities** (in execution order):
1. `INITIALIZING`: Setup, validation, load constants
2. `PROMPTING`: User questions (via `asPromptingTaskGroup`)
3. `CONFIGURING`: Validate/adjust config (`asConfiguringTaskGroup`)
4. `COMPOSING`: Compose with other generators (`asComposingTaskGroup`)
5. `COMPOSING_COMPONENT`: Compose sub-generators (used in `spring-boot`, `app`)
6. `LOADING`: Load application state
7. `PREPARING`: Transform/normalize data for writing
8. `DEFAULT`: Default priority (rarely used)
9. `WRITING`: Write files (`asWritingTaskGroup` + `this.writeFiles()`)
10. `INSTALL`: Run npm/maven installs

See `generators/base-core/priorities.ts` for complete list.

### Blueprint Pattern

Blueprints allow customization by extending generators. Always:
1. Call `this.composeWithBlueprints()` in `beforeQueue()` if `!this.fromBlueprint`
2. Delegate priorities to blueprints: `this.delegateTasksToBlueprint(() => this.priorityName)`
3. Use `this.composeWithJHipster()` to compose generators within same priority

Example from `generators/app/generator.ts`:

```typescript
async beforeQueue() {
  if (!this.fromBlueprint) await this.composeWithBlueprints();
  if (!this.delegateToBlueprint) await this.dependsOnBootstrap('app');
}

get [BaseApplicationGenerator.COMPOSING_COMPONENT]() {
  return this.asComposingComponentTaskGroup({
    async composeCommon() { await this.composeWithJHipster('common'); },
    async composeServer() { await this.composeWithJHipster('server'); },
  });
}
```

## Generator File Structure

Each generator follows this pattern:

```
generators/{name}/
  command.ts          // CLI options/args definition
  config.ts          // Default config
  generator.ts       // Main generator class
  generator.spec.ts  // Tests
  index.ts           // Export default + command
  types.d.ts         // TypeScript types
  files.ts           // Template metadata
  templates/         // EJS template files
  support/           // (Optional) helper functions
```

**files.ts** defines what templates to write:

```typescript
export const files = {
  git: [{ templates: ['.gitignore.jhi', '.gitattributes.jhi'] }],
  global: [{ templates: ['.editorconfig.jhi'] }],
};
```

## Writing Files

Use `this.writeFiles()` in the WRITING priority with file metadata + context:

```typescript
get writing() {
  return this.asWritingTaskGroup({
    async writeFiles({ application }) {
      await this.writeFiles({ sections: files, context: application });
    },
  });
}
```

Templates use EJS syntax. File names ending in `.jhi` are renamed (e.g., `.gitignore.jhi` → `.gitignore`).

## Testing Patterns

Tests use **esmocha** + **yeoman-test** helpers. Key imports:

```typescript
import { describe, it, expect, before } from 'esmocha';
import { defaultHelpers as helpers } from '../../lib/testing/index.ts';

describe('generator - name', () => {
  before(async () => {
    await helpers.run(GeneratorClass)
      .withJHipsterGenerators({ useDefaultMocks: true });
  });
  
  it('should have generated file', () => {
    expect(helpers.getFiles()).toContain('path/to/file');
  });
});
```

**Snapshot testing** is used extensively. Update snapshots with:
```bash
npm run update-snapshots  # All snapshots
npm run update-snapshot -- generators/name  # Specific
```

## Build & Development Workflow

### Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile TS → JS, copy files, generate types |
| `npm test` | Lint + type-check + run all tests |
| `npm run lint-fix` | Fix ESLint + format with Prettier |
| `npm run update-snapshots` | Update test snapshots |

### Running Development Generator

1. Link package: `npm link` in generator-jhipster root
2. Run generator with JIT: `./bin/jhipster.cjs` or alias to `jhipster`
3. Test on generated app: `cd generated-app && npm link generator-jhipster`

### Testing Samples

```bash
jhipster generate-sample ng-default  # Generate default Angular sample
npm ci:backend:test  # CI test backend
npm ci:frontend:test  # CI test frontend
```

## Project Conventions

### Configuration Management

- **jhipsterConfig**: User-provided config, persists via `.yo-rc.json`
- **jhipsterConfigWithDefaults**: Config merged with defaults from `config.ts`
- **Config.defaults()**: Set defaults once before prompting
- **entity**: Entity metadata object containing fields, relationships

### Type System

Strict typing via TypeScript generics in base classes:

```typescript
export class MyGenerator extends BaseApplicationGenerator<
  MyEntity,    // Entity type
  MyApplication, // Application config type
  MyConfig,    // Config type
  MyOptions,   // CLI options type
  MySource     // Data source type
> {}
```

### Logging

Use `this.log` (injected logger):

```typescript
this.log.info('message');
this.log.warn('warning');
this.log.error('error');
```

### State Control

Priority execution can be skipped via `skipPriorities` option:

```typescript
await this.composeWithJHipster('entity', {
  generatorOptions: { skipPriorities: ['writing', 'postWriting'] },
});
```

## Code Style & Standards

- **TypeScript**: Strict mode, no `any`
- **Linting**: ESLint config in `eslint.config.ts`, max 5 warnings allowed
- **Formatting**: Prettier (auto-fix with `lint-fix`)
- **EJS templates**: Validated with `ejslint`
- **Tests**: Required for all features; use snapshots for output validation

## Common Patterns

### Conditional File Writing

```typescript
get writing() {
  return this.asWritingTaskGroup({
    async writeServerFiles({ application }) {
      if (application.skipServer) return;
      await this.writeFiles({ sections: serverFiles, context: application });
    },
  });
}
```

### Entity Iteration

BaseApplicationGenerator provides entity priorities:
- `PREPARING_EACH_ENTITY`: Prepare entity for templates
- `POST_PREPARING_EACH_ENTITY`: Post-process entity

### Composing Sub-generators

Always use `composeWithJHipster()` with qualified names:

```typescript
await this.composeWithJHipster('jhipster:java:server');  // Compose by namespace
await this.composeWithJHipster('spring-boot');          // Shorthand (auto-prefixed)
```

## Where to Find Things

- **Generator lifecycle**: `generators/base-core/priorities.ts` and `ARCHITECTURE.md`
- **Test helpers**: `lib/testing/index.ts`
- **CLI argument parsing**: `cli/program.ts`
- **Type definitions**: `generators/base-application/types.ts`, `generators/common/types.ts`
- **Blueprint system**: `generators/base/blueprints.spec.ts` has extensive examples
- **Example generators**: `generators/app/`, `generators/init/`, `generators/spring-boot/`

## When Making Changes

1. **Generator logic**: Update `generator.ts`, test in `generator.spec.ts`
2. **New priority**: Add to base class, delegate in implementations, document in priorities.ts
3. **Template changes**: Update `templates/` files and regenerate samples with `generate-sample`
4. **Type changes**: Update `types.d.ts`, regenerate types with `npm run build`
5. **Configuration**: Extend `config.ts`, add prompts in `command.ts`, validate in CONFIGURING

Always run `npm test` before submitting changes to catch lint/type errors early.
