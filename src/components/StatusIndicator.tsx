interface Props {
  lastSyncedAt: string | null;
  now: Date;
}

export function StatusIndicator({ lastSyncedAt, now }: Props) {
  if (!lastSyncedAt) return null;
  const minutesAgo = Math.max(0, Math.round((now.getTime() - new Date(lastSyncedAt).getTime()) / 60000));
  const label = minutesAgo < 1 ? 'Updated just now' : `Updated ${minutesAgo} min ago`;
  return <div className="status-indicator">{label}</div>;
}
