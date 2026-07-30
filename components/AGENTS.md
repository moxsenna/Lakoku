# components/ — React UI Components

## OVERVIEW

React components built with shadcn/ui, Tailwind CSS, and mobile-first design. Dark theme default, Indonesian-first UI strings.

## STRUCTURE

```
components/
├── ui/               # shadcn/ui base components (button, card, input, etc.)
├── admin/            # Admin panel components
├── dashboard/        # Dashboard/metrics components
├── ai-elements/      # AI-related UI elements
├── auth/             # Authentication components
├── brainstorm/       # Story brainstorm UI
├── kredit/           # Credit/top-up UI
├── legal/            # Legal page components
├── mulai/            # Story creation UI
├── onboarding/       # Onboarding flow UI
├── app-shell.tsx     # Main app shell layout
├── bottom-nav.tsx    # Bottom navigation bar
├── reader-view.tsx   # Main reader component
├── story-card.tsx    # Story card component
├── theme-provider.tsx # Theme context provider
├── font-size-provider.tsx # Font size context
└── ...               # Other feature components
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Base UI primitives | `components/ui/` | shadcn/ui components |
| Reader experience | `reader-view.tsx` | Main reading UI |
| Navigation | `bottom-nav.tsx` | Bottom tab bar |
| Story cards | `story-card.tsx` | Story list items |
| Admin panel | `components/admin/` | Admin-specific UI |
| Dashboard | `components/dashboard/` | Metrics/charts |
| Auth flows | `components/auth/` | Login/signup UI |
| Onboarding | `components/onboarding/` | New user flows |

## CONVENTIONS

### Component Structure

```typescript
// Server Component (default)
export function MyComponent({ ... }: Props) {
  return <div>...</div>
}

// Client Component (interactive)
"use client"
export function MyClientComponent({ ... }: Props) {
  return <div>...</div>
}
```

### Styling

- Tailwind CSS classes (utility-first)
- `cn()` helper for conditional classes
- `class-variance-authority` for variants

### State Management

- React Context for global state (theme, font size)
- Local state for component-specific state

## ANTI-PATTERNS

- Direct data fetching (use `lib/api/`)
- AI/model imports
- Hardcoded colors (use CSS variables)
- `export default` (use named exports)

## NOTES

- shadcn/ui components in `components/ui/`
- Add new components: `pnpm dlx shadcn@latest add [component]`
- Dark theme default, CSS variables for colors
- `motion` (Framer Motion) for animations
