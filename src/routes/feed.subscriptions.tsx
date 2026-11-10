import { createFileRoute } from '@tanstack/react-router'
import { SavedSources } from '@/components/app/browse'
export const Route = createFileRoute('/feed/subscriptions')({ component: () => <SavedSources kind="channel" /> })
