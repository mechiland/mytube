import { createFileRoute } from '@tanstack/react-router'
import { History } from '@/components/app/browse'
export const Route = createFileRoute('/feed/history')({ component: History })
