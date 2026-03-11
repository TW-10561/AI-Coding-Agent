---
name: api-design-principles
description: RESTful and modern API design best practices
icon: 🔌
category: Development
tags: [api, rest, design, graphql]
---

# API Design Principles

Technical guidelines for designing robust, scalable, and developer-friendly APIs.

## REST Principles

### HTTP Methods
- GET: Retrieve resources (safe, idempotent)
- POST: Create resources
- PUT: Replace resources (idempotent)
- PATCH: Partial updates
- DELETE: Remove resources (idempotent)
- HEAD: Like GET but no body

### Status Codes
- 2xx Success (200, 201, 204)
- 3xx Redirection (301, 302, 304)
- 4xx Client Error (400, 401, 403, 404)
- 5xx Server Error (500, 502, 503)

### Resource Design
- Use nouns for resources (not verbs)
- Use hierarchical URLs for relationships
- Avoid verb naming (delete in favor of DELETE)
- Singular/plural naming consistency

### URL Design
- Base URL: /api/v1
- Resource collections: /api/v1/users
- Resource instances: /api/v1/users/{id}
- Nested resources: /api/v1/users/{id}/posts
- Query parameters for filtering: /api/v1/users?role=admin

## API Versioning

- URL-based versioning (/v1, /v2)
- Header-based versioning (Accept-Version)
- Deprecation policies
- Migration guides

## Error Handling

- Consistent error format
- Meaningful error messages
- Error codes/identifiers
- HTTP status codes alignment
- Validation error details

## Authentication & Security

- API key management
- OAuth2 flows
- JWT tokens
- Rate limiting
- CORS configuration
- Input validation
- SQL injection prevention

## Documentation

- OpenAPI/Swagger specifications
- Interactive API documentation
- Code examples for all endpoints
- Error response examples
- Rate limit documentation

## Pagination & Filtering

- Offset/limit pagination
- Cursor-based pagination
- Filtering mechanisms
- Sorting capabilities
- Field selection

## Performance Optimization

- Response compression
- Caching headers (ETag, Cache-Control)
- Partial responses
- Batch endpoints
- Lazy loading relationships

## GraphQL Alternative

When to use GraphQL over REST:
- Flexible query requirements
- Multiple data types needed
- Client-specific data needs
- Complex nested relationships
