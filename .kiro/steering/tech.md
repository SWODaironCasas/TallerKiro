# TallerKiro - Technology Stack

## Core Technologies
- **Language**: TypeScript with ES modules
- **Runtime**: Node.js 20+
- **Package Manager**: pnpm (version 12.22.0)
- **Web Framework**: Express.js 5+
- **Validation**: Zod schemas
- **Testing**: Vitest for unit tests, Playwright for browser tests

## Architecture
The project follows a clean architecture/hexagonal pattern with clear separation:
1. **Domain Layer**: Core business logic, entities, and rules
2. **Application Layer**: Use cases and orchestration
3. **Infrastructure Layer**: External integrations and implementations
4. **HTTP Layer**: API routes, middleware, and error handling
5. **Panel Layer**: Frontend UI for ticket management

## Build System
- **Compiler**: TypeScript configured for ES2022, NodeNext module resolution
- **Linting**: ESLint with TypeScript rules
- **Formatting**: (Not configured - consider adding Prettier)

## Development Commands

### Core Development
```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Start the server (after building)
pnpm start
```

### Testing
```bash
# Run all unit tests
pnpm test

# Run browser tests (requires built app)
pnpm test:browser

# Run linter
pnpm lint
```

### TypeScript Configuration
- Target: ES2022
- Module: NodeNext
- Strict mode enabled
- Root directory: `./src`
- Output directory: `./dist`
- Source maps: Not configured

### Testing Configuration
- **Vitest**: Unit tests in `src/**/*.test.ts` and `src/**/*.property.test.ts`
- **Playwright**: Browser tests in `tests/browser/*.spec.ts`
- Property-based testing with fast-check library

## Dependencies Philosophy
- **express**: Web server framework
- **zod**: Runtime validation and type inference
- **fast-check**: Property-based testing
- **supertest**: HTTP integration testing
- **@playwright/test**: Browser automation and testing

## Development Guidelines
1. All TypeScript source files are in `src/`
2. Test files should be co-located with source files
3. Property tests use `.property.test.ts` suffix
4. Integration tests use `.integration.test.ts` suffix
5. Use ES module imports exclusively (no CommonJS)
6. Follow clean architecture boundaries between layers