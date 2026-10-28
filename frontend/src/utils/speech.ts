export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** 去掉 Markdown 标记，避免朗读时把符号也读出来。 */
export function plainTextForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' 代码块 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 用浏览器自带 TTS 朗读文本。
 * 返回 false 表示浏览器不支持或文本为空。
 */
export function speakText(text: string, onEnd?: () => void): boolean {
  if (!speechSupported()) return false
  const clean = plainTextForSpeech(text)
  if (!clean) return false

  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(clean)
  utterance.lang = 'zh-CN'
  utterance.rate = 1
  utterance.onend = () => onEnd?.()
  utterance.onerror = () => onEnd?.()
  window.speechSynthesis.speak(utterance)
  return true
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel()
}
