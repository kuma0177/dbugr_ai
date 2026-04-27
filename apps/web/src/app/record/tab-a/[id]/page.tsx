'use client';

import { useParams } from 'next/navigation';
import { RecorderWorkspace } from '@/components/record/RecorderWorkspace';

export default function TabARecordPage() {
  const { id } = useParams<{ id: string }>();

  return <RecorderWorkspace mode="tab-a" sessionId={id} />;
}
