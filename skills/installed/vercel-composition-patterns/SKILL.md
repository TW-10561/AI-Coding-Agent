---
name: vercel-composition-patterns
description: Component composition patterns and architectural best practices
icon: 🧩
category: Core
tags: [patterns, composition, architecture]
---

# Composition Patterns

Architectural patterns for composing complex user interfaces from simple, reusable components.

## Pattern Categories

### Container & Presentation
- Smart containers handling state/logic
- Presentational components for UI
- Separation of concerns

### Higher-Order Components
- HOC pattern for logic sharing
- Props manipulation
- Static methods copying
- Display name handling

### Render Props Pattern
- Function as children
- Flexible component behavior
- Multiple consumers pattern

### Hooks Pattern
- Custom hooks for logic extraction
- Hook composition
- Rules of hooks

### State Management Patterns
- Redux integration
- Context API patterns
- MobX patterns
- Zustand patterns

## Composition Best Practices

1. **Keep components small and focused**
2. **Avoid prop drilling** with composition root
3. **Use composition over inheritance**
4. **Document composition APIs**
5. **Test composed components thoroughly**

## Exercise
Refactor a monolithic component into composable pieces using multiple patterns.
