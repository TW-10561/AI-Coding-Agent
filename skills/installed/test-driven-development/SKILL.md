---
name: test-driven-development
description: Test-Driven Development methodology and practices
icon: 🧪
category: Testing
tags: [tdd, testing, development, methodology]
---

# Test-Driven Development

Master Test-Driven Development (TDD) methodology with practical patterns and real-world applications.

## TDD Fundamentals

### The Red-Green-Refactor Cycle

1. **Red Phase**: Write a failing test
   - Understand requirements through tests
   - Define expected behavior
   - Setup test assertions
   - Verify test failure

2. **Green Phase**: Write minimal code to pass
   - Implement just enough to pass
   - No optimizations yet
   - Focus on correctness
   - Verify test passes

3. **Refactor Phase**: Improve code quality
   - Clean up implementation
   - Extract common patterns
   - Improve readability
   - Re-run tests

## Advantages of TDD

- Higher code quality
- Better test coverage
- Easier refactoring
- Living documentation
- Reduced debugging time
- Improved design
- Confidence in changes

## TDD Patterns

### Given-When-Then (BDD)
```
Given [initial state]
When [action occurs]
Then [expected outcome]
```

### Test Types in TDD
- Unit tests (immediate feedback)
- Integration tests (component interaction)
- End-to-end tests (full workflows)

### Isolation and Mocking
- Mock dependencies
- Stub external services
- Fake implementations
- Test doubles patterns

## Writing Testable Code

### Design Principles
- Single Responsibility Principle
- Dependency Injection
- Avoid global state
- Pure functions
- Small, focused functions

### Anti-patterns to Avoid
- Testing implementation details
- Over-mocking
- Brittle tests
- Interdependent tests
- Slow tests

## TDD Best Practices

1. **Start with simplest test**
2. **One assertion per test** (generally)
3. **Descriptive test names**
4. **DRY test code**
5. **Test behavior, not implementation**
6. **Refactor tests as you refactor code**

## Testing Different Components

### Testing Functions
- Multiple inputs and outputs
- Edge cases
- Error conditions
- State changes

### Testing Classes
- Constructor behavior
- Method interactions
- Property mutations
- Inheritance contracts

### Testing Async Code
- Promise handling
- async/await patterns
- Callback testing
- Timeout handling

## Coverage Goals

- Aim for 80%+ coverage
- Focus on critical paths
- Don't aim for 100% (diminishing returns)
- Cover edge cases
- Cover error scenarios

## TDD in Teams

- Writing tests before code
- Code review emphasis on tests
- Pair programming benefits
- Knowledge sharing through tests
- Reduced integration issues

## Challenges & Solutions

| Challenge | Solution |
|-----------|----------|
| Slow tests | Use unit tests more, E2E less |
| Hard to test | Refactor for testability |
| Over-mocking | Focus on essential mocks |
| Maintenance burden | Keep tests simple |

## Tools & Frameworks

- Jest for JavaScript/TypeScript
- Pytest for Python
- RSpec for Ruby
- NUnit for C#
- JUnit for Java
