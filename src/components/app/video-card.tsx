import { Link } from '@tanstack/react-router'
import { Bookmark, EyeOff, MoreVertical } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatDate } from '@/lib/client'
import type { Video } from '@/lib/data'
import { saveFavorite, useLibrary } from '@/lib/personal'
import { ChannelLink, Cover, videoLink } from './common'

export default function VideoCard({ video, row, preserveContext }: { video: Video; row?: boolean; preserveContext?: boolean }) {
  const { state, update } = useLibrary()
  const saved = state.favorites.includes(video.id)
  const link = videoLink(video.id, preserveContext ? state.contexts[video.id] : undefined)
  return <article className={row ? 'video-card result-row' : 'video-card'}>
    <Link {...link} aria-label={video.title} className="cover-link"><Cover url={video.thumbnail} duration={video.duration} /></Link>
    <div className="video-meta">
      <div className="video-copy">
        <Link {...link} className="video-title">{video.title}</Link>
        <ChannelLink id={video.channelId} className="muted channel-name">{video.channelTitle}</ChannelLink>
        <span className="muted video-date">{formatDate(video.published)}</span>
        {row && <p className="result-description">{video.description}</p>}
      </div>
      <DropdownMenu><DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`${video.title}的操作`} />}><MoreVertical /></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuGroup>
          <DropdownMenuItem onClick={async () => {
            if (await update(s => saveFavorite(s, video.id, !saved))) toast.success(saved ? '已移除收藏' : '已收藏')
          }}><Bookmark />{saved ? '移除收藏' : '收藏视频'}</DropdownMenuItem>
          <DropdownMenuItem onClick={async () => {
            if (await update(s => ({ ...s, hidden: [...new Set([...s.hidden, video.id])] }))) toast.success('视频已隐藏，可在设置恢复')
          }}><EyeOff />隐藏视频</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
    </div>
  </article>
}
