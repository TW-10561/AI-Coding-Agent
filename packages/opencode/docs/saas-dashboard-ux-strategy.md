# SaaS Dashboard UX Strategy

Comprehensive guide for building accessible, user-friendly interfaces.

---

## Navigation Structure

### Global Header

Fixed top bar with app logo, global search, and primary actions. Height 64px on desktop, 56px on mobile.

```tsx
<header className="h-16 px-6 flex items-center justify-between bg-white border-b border-gray-200">
  <AppLogo />
  <GlobalSearch placeholder="Search..." />
  <div className="flex gap-4">
    <Notifications />
    <HelpMenu />
    <UserMenu />
  </div>
</header>
```

### Secondary Navigation

Vertical sidebar with context-sensitive submenus. Collapsible on desktop, drawer on mobile.

```tsx
<aside className="w-64 bg-gray-50 border-r border-gray-200">
  <NavGroup title="Project" />
  <NavGroup title="Settings" collapsed />
</aside>
```

### Breadcrumbs

Auto-generated from current route. Uses separator `/` with current page bold.

```tsx
<nav className="flex text-sm text-gray-500 gap-2">
  <a href="/dashboard" className="hover:underline" />
  <span>/</span>
  <a href="/dashboard/reports" className="hover:underline" />
  <span>/</span>
  <strong className="text-gray-900">Monthly</strong>
</nav>
```

### User Profile

Avatar with dropdown menu for settings, billing, and logout.

```tsx
<UserMenu>
  <MenuItem icon="profile" label="Profile" />
  <MenuItem icon="billing" label="Billing" />
  <MenuItem icon="logout" label="Log out" danger />
</UserMenu>
```

### Mobile Navigation

Hamburger icon opens drawer with backdrop blur overlay. Swipeable from edges.

```tsx
<Sheet open={menuOpen}>
  <nav className="p-4">
    <MobileNav />
  </nav>
</Sheet>
```

### Keyboard Shortcuts

`?` opens help modal. Arrow keys navigate lists. `Escape` closes modals.

| Shortcut   | Action         |
| ---------- | -------------- |
| `?`        | Show shortcuts |
| `g then s` | Go to settings |
| `e then n` | New entity     |

### Active State Indicators

Active page uses different background, icon fill, and text color.

```css
.nav-link {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
}
.nav-link.active {
  bg: #f3f4f5;
  color: #1a2a3a;
}
```

---

## Micro-interactions & Feedback States

### Button States

Four states with smooth 150ms transitions between each.

```tsx
<Button variant="primary">Hover</Button>
<Button variant="primary">Default</Button>
<Button variant="primary" loading /> // Spinner
<Button variant="primary" disabled /> // Opacity 50%
```

### Toast Notifications

Fixed to top-right or bottom-right. Auto-dismisses after 4s. Error toasts persist.

```tsx
<ToastProvider>
  <Toast type="success" message="Saved!" />
  <Toast type="error" message="Failed to save" />
  <Toast type="info" message="Update available" />
</ToastProvider>
```

### Optimistic UI Updates

Immediate state change with server sync. Reverts on error with toast.

```tsx
function toggle() {
  setOptimisticState(!state)
  api.post(...).catch(() => {
    setOptimisticState(!state)
    toast.error("Update failed")
  })
}
```

### Subtle Animations

150-300ms ease-out for state changes. No layout shifts.

```css
.transition {
  transition: all 200ms ease-out;
}
.reduce-motion {
  transition: none;
}
```

### Skeleton Loading

Pulse animation with prefers-reduced-motion fallback to static.

```tsx
<Skeleton className="h-4 w-full" />
<Skeleton className="h-4 w-2/3" pulse />
```

### Skip Transitions

Respects `prefers-reduced-motion` for accessibility.

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}
```

---

## Form UX Best Practices

### Single-Column Layout

Mobile-first, stacks vertically. Max-width 640px for readability.

```tsx
<form className="flex flex-col gap-6 max-w-640 mx-auto p-6">
  <Label>Email</Label>
  <Input type="email" />
</form>
```

### Clear Field Labels

Labels always visible above inputs. Never rely on placeholder text.

```tsx
<label className="flex flex-col gap-2">
  <span className="text-sm font-medium">Email</span>
  <Input placeholder="john@example.com" />
</label>
```

### Floating Labels

Labels animate into input with focus. Include validation state.

```tsx
<Field label="Email" value={email}>
  <Input />
  <Error message={errors.email} />
</Field>
```

### Inline Validation

On blur, not keystroke. Real-time indicator with checkmark or error.

```tsx
<Input onBlur={validate} showError={touched} />
```

### Error Summary

Sticky at top with link to first error. Dismissible.

```tsx
<FormErrors>
  <ErrorLink href="#email">Invalid email</ErrorLink>
  <ErrorLink href="#password">Weak password</ErrorLink>
</FormErrors>
```

### Error Messages

Specific and remedial. `Oops` forbidden. Use `Enter a valid email`.

```tsx
<Error message="Enter a valid email, like user@example.com" />
```

### Auto-Save Indicator

Unsaved changes badge with last saved timestamp.

```tsx
<AutosaveStatus unsaved>Saving...</AutosaveStatus>
```

### Form Actions

Primary solid, secondary outline, danger red text. Right-aligned.

```tsx
<div className="flex justify-end gap-4">
  <Button variant="ghost" label="Cancel" />
  <Button variant="secondary" label="Save draft" />
  <Button variant="primary" label="Publish" />
</div>
```

### Character Counters

Under input, shows `N/M` with warning color at 80% and error at 100%.

```tsx
<Input maxLength={140} suffix={<span className="text-warning">120/140</span>} />
```

### Date/Time Pickers

Smart defaults based on context. Range preset buttons.

```tsx
<DateRangePicker presets={["Today", "Last 7 days", "This month"]} />
```

---

## Conversion Optimization

### Hero Section

Value-focused with clear CTA. Descriptive subhead and trustworthy badge.

```tsx
<section className="text-center p-20">
  <h1 className="text-4xl font-bold">Analytics dashboard</h1>
  <p className="text-xl text-gray-600">Real-time insights</p>
  <Button variant="primary">Start free</Button>
</section>
```

### Progressive Disclosure

Sections reveal on demand. Numbered steps with optional expand.

```tsx
<Accordion>
  <Section title="Advanced settings" defaultOpen={false} />
  <Section title="Notifications" defaultOpen />
</Accordion>
```

### Social Proof

Customer logos with testimonial carousel. Auto-cycles every 5s.

```tsx
<SocialProof>
  <Logo src="slika" alt="Acme" />
  <Quote>"Using Acme saved 2hrs daily"</Quote>
</SocialProof>
```

### Trust Signals

Near CTA: security badge, testimonials, money-back guarantee.

```tsx
<div className="flex gap-4 items-center justify-center">
  <ShieldIcon />
  <TrustpilotStars />
  <GuaranteeIcon />
</div>
```

### Feature Highlights

With illustration, short title, and "Learn more" link.

```tsx
<Feature cardPosition={index}>
  <Icon src="chart" />
  <h3>Real-time analytics</h3>
  <p>Track visitor behavior</p>
</Feature>
```

### Trial Countdown

Days, hours, minutes remaining. Upgrade CTA when expired.

```tsx
<TrialCountdown remaining={trialEndsAt} variant="banner" />
```

### Smart Upsell

Highlighted value with `Compare` and `Upgrade` buttons. Free plan disabled.

```tsx
<UpgradeCard plan={currentPlan}>
  <h3>Pro plan</h3>
  <Price>$99/mo</Price>
  <Button variant="primary">Upgrade</Button>
</UpgradeCard>
```

---

## Accessibility Checklist

- All interactive elements keyboard-navigable
- Color contrast meets WCAG 2.1 AA
- ARIA labels for icons and images
- `prefers-reduced-motion` respected
- Toast announcements to screen readers
- Focus management for modals
