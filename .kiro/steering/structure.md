# TallerKiro - Project Structure

## Overview
The project follows a clean architecture structure with clear separation of concerns. Source code is organized in the `src/` directory with domain-driven design principles.

## Directory Layout

### Core Source Structure
```
src/
├── domain/                    # Domain layer - business logic and entities
│   ├── types.ts              # Core domain types and interfaces
│   ├── errors.ts             # Domain-specific error classes
│   ├── transitions.ts        # State transition logic
│   ├── sla.ts               # Service Level Agreement calculations
│   ├── temporal.ts          # Temporal business rules
│   └── *.property.test.ts   # Property-based tests for domain logic
│
├── application/              # Application layer - use cases
│   ├── ticket-service.ts    # Main ticket orchestration service
│   ├── allowed-transitions.ts
│   └── *.property.test.ts   # Property tests for application logic
│
├── infrastructure/           # Infrastructure layer - external implementations
│   ├── in-memory-*.ts       # In-memory implementations for testing
│   ├── contracts.ts         # Interface definitions
│   ├── random-uuid-generator.ts
│   ├── system-clock.ts
│   └── *.test.ts           # Infrastructure tests
│
├── http/                     # HTTP layer - API and web interface
│   ├── ticket-routes.ts     # REST API routes
│   ├── schemas.ts           # Zod validation schemas
│   ├── mappers.ts           # Domain-to-API data mapping
│   ├── middleware.ts        # Express middleware
│   ├── error-handler.ts     # Error handling middleware
│   ├── *.integration.test.ts # HTTP integration tests
│   └── http-*.test.ts      # HTTP-specific tests
│
├── panel/                    # Frontend panel UI
│   └── *.property.test.ts   # Panel behavior tests
│
├── test-utils/              # Testing utilities
│   ├── setup.ts            # Test setup configuration
│   ├── ticket-catalog-validation.ts
│   └── ticket-text-validation.ts
│
├── app.ts                   # Express application configuration
├── server.ts               # Server startup
└── *.test.ts              # General test files
```

### Supporting Directories
```
tests/browser/              # Playwright browser tests
public/panel/              # Static frontend assets
dist/                      # Compiled TypeScript output
node_modules/              # Dependencies
.kiro/steering/           # AI assistant guidance (this directory)
```

## Code Organization Principles

### 1. Domain Layer (`src/domain/`)
- Contains pure business logic with no external dependencies
- Defines core entities (Ticket, ActorRecord, etc.)
- Includes business rules for state transitions, SLA calculations
- Property-based tests ensure business rule correctness

### 2. Application Layer (`src/application/`)
- Orchestrates use cases using domain entities
- Coordinates infrastructure components
- Handles transaction boundaries and error handling
- Depends on domain layer, not vice versa

### 3. Infrastructure Layer (`src/infrastructure/`)
- Implements interfaces defined in domain/application
- Contains in-memory implementations for testing
- Handles external concerns: persistence, clock, ID generation
- Easy to swap for production implementations

### 4. HTTP Layer (`src/http/`)
- Maps HTTP requests to application use cases
- Handles request validation with Zod schemas
- Manages error responses and status codes
- Contains middleware for authentication, error handling

### 5. Testing Structure
- **Unit Tests**: Co-located with source files (`*.test.ts`)
- **Property Tests**: Verify business rules with generated data (`*.property.test.ts`)
- **Integration Tests**: Test API endpoints (`*.integration.test.ts`)
- **Browser Tests**: UI testing in `tests/browser/`

## File Naming Conventions
- **Domain files**: Simple nouns describing entities or concepts
- **Service files**: Noun-service pattern (e.g., `ticket-service.ts`)
- **Test files**: Same name as source with `.test.ts` suffix
- **Property tests**: `.property.test.ts` suffix
- **Integration tests**: `.integration.test.ts` suffix

## Import Patterns
- Domain layer imports only from domain
- Application layer imports from domain and infrastructure interfaces
- Infrastructure layer implements domain/application interfaces
- HTTP layer imports from application and domain
- Avoid circular dependencies between layers

## Public API
The main entry points are:
- `src/app.ts`: Express application factory
- `src/server.ts`: Server startup script
- `src/domain/index.ts`: Core domain exports
- `src/infrastructure/index.ts`: Infrastructure implementations
- `src/http/ticket-routes.ts`: API route definitions