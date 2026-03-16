#!/usr/bin/env bash

# Quality Check Script
# Runs all quality checks and provides structured output

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
TOTAL=3

# Check results storage
declare -a FAILURES=()

echo "======================================"
echo "Running Quality Checks..."
echo "======================================"
echo ""

# Check 1: Linting
echo "Running ESLint..."
if npm run lint --silent 2>&1; then
    echo -e "${GREEN}✓${NC} Linting: Passed"
    ((PASSED++))
else
    echo -e "${RED}✗${NC} Linting: Failed"
    FAILURES+=("lint")
    ((FAILED++))
fi
echo ""

# Check 2: Formatting
echo "Checking code formatting..."
if npm run format:check --silent 2>&1; then
    echo -e "${GREEN}✓${NC} Formatting: Passed"
    ((PASSED++))
else
    echo -e "${RED}✗${NC} Formatting: Failed"
    FAILURES+=("format")
    ((FAILED++))
fi
echo ""

# Check 3: Type Checking
echo "Running TypeScript type check..."
if npm run type-check --silent 2>&1; then
    echo -e "${GREEN}✓${NC} Type Check: Passed"
    ((PASSED++))
else
    echo -e "${RED}✗${NC} Type Check: Failed"
    FAILURES+=("typecheck")
    ((FAILED++))
fi
echo ""

# Summary
echo "======================================"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC} ($PASSED/$TOTAL)"
    echo "======================================"
    exit 0
else
    echo -e "${RED}✗ Some checks failed${NC} ($PASSED/$TOTAL passed)"
    echo "======================================"
    echo ""
    echo "Failed checks: ${FAILURES[*]}"
    echo ""
    echo "Suggested fixes:"

    for failure in "${FAILURES[@]}"; do
        case $failure in
            lint)
                echo "  • Run 'npm run lint:fix' to auto-fix linting issues"
                ;;
            format)
                echo "  • Run 'npm run format' to auto-fix formatting issues"
                ;;
            typecheck)
                echo "  • Type errors require manual fixes - check output above"
                ;;
        esac
    done
    echo ""
    exit 1
fi
