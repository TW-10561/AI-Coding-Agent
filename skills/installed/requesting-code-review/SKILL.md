---
name: requesting-code-review
description: How to request effective code reviews from peers
icon: 👥
category: Testing
tags: [code-review, collaboration, communication]
---

# Requesting Code Review

Best practices for requesting code reviews that get actionable feedback efficiently.

## Preparing for Review

### Before Creating a PR
- Ensure tests pass locally
- Run linting and formatting
- Self-review changes
- Build locally without errors
- Document any non-obvious decisions

### Checklist
- [ ] Tests written and passing
- [ ] No console.log() statements
- [ ] Code formatted consistently
- [ ] Comments explain "why" not "what"
- [ ] No secrets or API keys
- [ ] Documentation updated
- [ ] Commit history is clean (squash if needed)
- [ ] PR description is clear
- [ ] Links to related issues

## Writing Effective PR Descriptions

### Components
1. **Title**: Clear, descriptive, prefixed
2. **Context**: Why this change is needed
3. **Implementation**: How it was done
4. **Testing**: How it was tested
5. **Notes**: Any special considerations

### Example Template
```
## Description
Brief summary of changes

## Context
Why this change was needed

## Testing
How to test the changes

## Checklist
- [ ] Unit tests added
- [ ] Docs updated
- [ ] No breaking changes
```

## Requesting from Team

### Who to Ask
- Subject matter experts
- Paired programmer
- Tech lead
- Multiple reviewers for critical changes

### Timing
- Request during business hours
- Allow reasonable response time
- Follow team conventions
- Respect everyone's schedule

### Communication
- Be specific about areas needing attention
- Ask questions, don't demand answers
- Show appreciation for feedback
- Reply to all comments

## Handling Feedback

### Positive Reception
- Thank reviewers for time
- Ask clarifying questions
- Explain your reasoning if needed
- Consider all suggestions

### When You Disagree
- Explain your perspective respectfully
- Ask the reviewer questions
- Provide evidence or examples
- Escalate to tech lead if necessary
- Be willing to compromise

### Addressing Feedback
1. Fix issues one category at a time
2. Commit messages reference feedback
3. Re-request review after changes
4. Don't force-push without notification

## Types of Reviews

### Quick Reviews
- Simple bug fixes
- Documentation updates
- Configuration changes
- Format/style fixes

### Detailed Reviews
- Architecture changes
- Algorithm implementations
- Security-related changes
- New dependencies

### Emergency Reviews
- Production hotfixes
- Security vulnerabilities
- Breaking issues
- Can use pair programming instead

## Review Time Expectations

| Type | Typical Review Time |
|------|-------------------|
| Small fix (<50 lines) | 15-30 min |
| Medium PR (50-200 lines) | 30 min - 1 hour |
| Large PR (200+ lines) | 1-3 hours |
| Architecture change | Multiple reviews |

## Red Flags That Slow Reviews

- Vague PR description
- No context provided
- Huge PR (>500 lines)
- No tests included
- Poor commit messages
- Inconsistent formatting

## PR Size Guidelines

- **Ideal**: 100-400 lines
- **OK**: 50-600 lines
- **Too large**: 600+ lines (break into smaller PRs)
- **Perfect**: Single feature/fix per PR

## Tools & Best Practices

- Use PR templates
- Enable required reviewers
- Use status checks
- Automate formatting/linting
- Link related issues
- Tag reviewers appropriately
