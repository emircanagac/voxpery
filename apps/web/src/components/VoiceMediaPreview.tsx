import type { ComponentProps } from 'react'
import type { RemoteMediaKind } from '../webrtc/remoteMediaControls'

type Props = ComponentProps<'div'> & { kind: RemoteMediaKind }

export default function VoiceMediaPreview({ kind, className = '', ...props }: Props) {
  return <div {...props} className={`screen-share-preview ${className}`} data-media-kind={kind} />
}
