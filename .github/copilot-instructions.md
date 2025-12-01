# AI Copilot Instructions for generator-jhipster

This document provides essential guidance for AI coding agents working on the JHipster generator.

## Project Overview

**generator-jhipster** is a Yeoman-based code generator that scaffolds full-stack Java/JavaScript applications. It uses a sophisticated priority-based architecture to manage complex generation flows.

## Architecture & Core Concepts

### Yeoman Generator Pattern

JHipster extends Yeoman with custom priority queues. All generators extend base classes:
- **BaseGenerator** (`generators/base/`): Core blueprint support, state management.
- **BaseApplicationGenerator** (`generators/base-application/`): Multi-priority lifecycle for complex apps.
- **BaseSimpleApplicationGenerator** (`generators/base-simple-application/`): Simpler single-tier generators.

### Generator Lifecycle Priorities

Generators execute in strict priority order. Use static constants from `generators/base-core/priorities.ts`.

**Key priorities** (in execution order):
1. `INITIALIZING`: Setup, validation, load constants.
2. `PROMPTING`: User questions.
3. `CONFIGURING`: Validate/adjust config.
4. `COMPOSING`: Compose with other generators.
5. `COMPOSING_COMPONENT`: Compose sub-generators (e.g., `spring-boot`, `client`).
6. `LOADING`: Load application state.
7. `PREPARING`: Transform/normalize data for writing.
8. `POST_PREPARING`: Post-process entity/application data.
9. `DEFAULT`: Default priority.
10. `WRITING`: Write files (`this.writeFiles()`).
11. `MULTISTEP_TRANSFORM`: Transform files after writing.
12. `POST_WRITING`: Post-writing tasks.
13. `INSTALL`: Run npm/maven installs.
14. `POST_INSTALL`: Post-install tasks.
15. `END`: Cleanup.

### Blueprint Pattern

Blueprints allow customization by extending generators.
- Call `this.composeWithBlueprints()` in `beforeQueue()` if `!this.fromBlueprint`.
- Delegate priorities: `this.delegateTasksToBlueprint(() => this.priorityName)`.
- Use `this.composeWithJHipster()` to compose generators within the same priority.

## Generator File Structure

Standard generator layout:
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
```

## Writing Files

Use `this.writeFiles()` in the `WRITING` priority.
- Define file mappings in `files.ts`.
- Templates use EJS syntax.
- Files ending in `.jhi` are renamed (e.g., `.gitignore.jhi` -> `.gitignore`).

```typescript
get [BaseApplicationGenerator.WRITING]() {
  return this.asWritingTaskGroup({
    async writeFiles({ application }) {
      await this.writeFiles({ sections: files, context: application });
    },
  });
}
```

## Testing Patterns

Tests use **esmocha** + **yeoman-test**.
- Use `helpers.run(GeneratorClass)` to simulate generator runs.
- Use `withJHipsterGenerators()` to mock dependent generators.
- **Snapshot testing** is standard.

```typescript
import { describe, it, expect, before } from 'esmocha';
import { defaultHelpers as helpers } from '../../lib/testing/index.ts';

describe('generator - name', () => {
  before(async () => {
    await helpers.run(GeneratorClass)
      .withJHipsterGenerators({ useDefaultMocks: true });
  });
  
  it('should match snapshot', () => {
    expect(helpers.getFiles()).toMatchSnapshot();
  });
});
```

## Build & Development Workflow

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile TS -> JS, copy files, generate types. |
| `npm test` | Run all tests (lint + check-types + esmocha). |
| `npm run lint-fix` | Fix ESLint + format with Prettier. |
| `npm run update-snapshots` | Update all test snapshots. |
| `npm run update-snapshot -- generators/name` | Update specific snapshots. |

### Running Locally
1. `npm link` in root.
2. `jhipster` (or `./bin/jhipster.cjs`) to run.
3. `npm link generator-jhipster` in a generated app to test changes.

## Project Conventions

- **Configuration**: `jhipsterConfig` (user config), `jhipsterConfigWithDefaults` (merged defaults).
- **Logging**: Use `this.log.info()`, `this.log.warn()`, `this.log.error()`. **No `console.log`**.
- **Type System**: Strict TypeScript. No `any`. Use generics in base classes.
- **Linting**: `eslint.config.ts` enforces rules. `import-x/extensions` requires extensions. `no-console` is error.

## Common Patterns

- **Conditional Writing**: Check flags in `application` context before writing sections.
- **Entity Iteration**: Use `PREPARING_EACH_ENTITY` and `POST_PREPARING_EACH_ENTITY`.
- **Composing**: Always use `composeWithJHipster('namespace')` or `composeWithJHipster('shortname')`.
