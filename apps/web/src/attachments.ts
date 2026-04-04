export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024

export function getMaxChatAttachmentMb() {
  return Math.round(MAX_CHAT_ATTACHMENT_BYTES / (1024 * 1024))
}
