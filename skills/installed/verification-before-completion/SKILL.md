---
name: verification-before-completion
description: Quality verification and validation before declaring work complete
icon: ✔️
category: Testing
tags: [qa, verification, testing, validation]
---

# Verification Before Completion

Comprehensive checklist-based approach to verify work quality before marking tasks complete.

## Pre-Completion Checklist

### Functional Testing
- [ ] Feature works as specified
- [ ] Edge cases handled
- [ ] Error scenarios tested
- [ ] User can complete workflow
- [ ] Forms validation works
- [ ] Data persistence verified
- [ ] Refresh/reload works correctly

### Code Quality
- [ ] No console.log/debug statements
- [ ] No hardcoded values
- [ ] No TODOs left behind
- [ ] Comments are helpful
- [ ] No unused imports
- [ ] No dead code
- [ ] Follows team conventions

### Testing Coverage
- [ ] Unit tests written
- [ ] Integration tests cover flows
- [ ] Edge cases tested
- [ ] Error paths tested
- [ ] Tests pass locally
- [ ] Coverage meets standards

### Performance
- [ ] No obvious performance issues
- [ ] Load time acceptable
- [ ] Memory usage reasonable
- [ ] Database queries optimized
- [ ] API responses within limits
- [ ] No memory leaks detected

### Security
- [ ] No secrets in code
- [ ] Inputs validated
- [ ] SQL injection prevented
- [ ] XSS prevented
- [ ] CSRF protection in place
- [ ] Auth checks present

### Accessibility
- [ ] Keyboard navigation works
- [ ] Screen reader compatible
- [ ] Color contrast sufficient
- [ ] Focus indicators visible
- [ ] ARIA labels present
- [ ] Alt text for images

### Browser/Device Testing
- [ ] Works in Chrome
- [ ] Works in Firefox
- [ ] Works in Safari
- [ ] Works on mobile
- [ ] Works on tablet
- [ ] Responsive design correct

### Documentation
- [ ] Code is self-documenting
- [ ] Complex logic explained
- [ ] API endpoints documented
- [ ] Setup instructions clear
- [ ] README updated if needed
- [ ] Deployment documentation

### Git Hygiene
- [ ] Commits are logical
- [ ] Commit messages are clear
- [ ] No merge conflicts
- [ ] Branch is up to date
- [ ] No unnecessary files committed
- [ ] .gitignore updated

### Deployment Readiness
- [ ] Builds without errors
- [ ] No environment-specific issues
- [ ] Configuration documented
- [ ] Environment variables defined
- [ ] Database migrations ready
- [ ] Rollback plan identified

## Verification by Category

### Frontend Features
- Visual appearance correct
- Animations smooth
- Touch interactions responsive
- State management working
- API calls appropriate
- Error states handled

### Backend Features
- API responses correct
- Error handling graceful
- Database transactions atomic
- Logging sufficient
- Performance acceptable
- Security validated

### Database Changes
- Migrations test successfully
- Rollback works
- Zero data loss
- Performance impact minimal
- Backups in place

### Infrastructure Changes
- Configuration tested
- Scaling works
- Monitoring in place
- Alerts configured
- Runbooks updated

## Testing Techniques

### Manual Testing
- Click through all flows
- Try invalid inputs
- Test error states
- Check different roles/permissions
- Test on real devices

### Automated Testing
- Run full test suite
- Check code coverage
- Run linters
- Run type checkers
- Run security checks

### Monitoring
- Check logs for errors
- Monitor performance metrics
- Watch for warnings
- Check uptime/availability
- Monitor error rates

## Common Issues to Catch

| Issue | How to Verify |
|-------|---------------|
| Off-by-one error | Test boundary values |
| Missing edge case | Think through scenarios |
| Type mismatch | Run type checker |
| Performance issue | Profile with tools |
| Security hole | Use security checklist |
| Accessibility fail | Use accessibility tools |
| Mobile issue | Test on real device |

## Definition of Done

Work is complete when:
1. ✅ Feature implemented correctly
2. ✅ Tests pass (unit + integration)
3. ✅ Code passes review standards
4. ✅ Documentation updated
5. ✅ No known bugs or issues
6. ✅ Performance acceptable
7. ✅ Security reviewed
8. ✅ Accessibility verified
9. ✅ Works across browsers/devices

## Sign-Off Process

1. **Self-verify** using checklist
2. **Get peer review** from team
3. **QA testing** if team has QA
4. **Stakeholder approval** if needed
5. **Deploy** to staging
6. **Final verification** in staging
7. **Deploy** to production
8. **Monitor** for issues

## Prevention Strategies

- Use templates and checklists
- Automate what you can
- Pair program complex features
- Code review all changes
- Keep tests up to date
- Regular refactoring
- Monitoring and alerting

## Questions to Ask Before Completion

1. "Does this solve the original problem?"
2. "Have I tested all paths?"
3. "Is the code maintainable?"
4. "Would I be comfortable supporting this?"
5. "Is there anything I'd miss if I revisit this in 6 months?"
6. "Does this follow our conventions?"
7. "Could this break anything else?"
8. "Are there edge cases I haven't considered?"
