export interface UserInfo {
  id: number
  username: string
  nickname: string | null
  role: 'user' | 'admin'
  status: string
  created_at: string
  last_login_at: string | null
}

export interface Conversation {
  id: number
  title: string
  model_id: string
  system_prompt: string | null
  voice_type: string | null
  voice_prompt: string | null
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  model_id: string | null
  status: string
  input_tokens: number | null
  output_tokens: number | null
  latency_ms: number | null
  created_at: string
  /** 推理模型的思考过程；现在由后端持久化 */
  reasoning?: string | null
}

export interface ModelInfo {
  id: string
  name: string
  provider_id: string
  provider_name: string
  available: boolean
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_at: number
  user: UserInfo
}

export interface Persona {
  id: number
  name: string
  prompt: string
  description: string | null
  voice_type: string | null
  voice_prompt: string | null
  created_at: string
  updated_at: string
}

export interface VoiceOption {
  id?: number
  value: string
  label: string
  gender: string
  description: string
  kind: 'system' | 'custom'
}

export interface VoiceList {
  default_voice: VoiceOption
  voices: VoiceOption[]
}

export interface VoiceDesignResponse {
  voice: VoiceOption
  preview_audio: string
  preview_format: string
}

export interface SystemConfig {
  app_name: string
  allow_registration: boolean
  max_message_chars: number
  max_context_turns: number
  default_model_id: string
}

export interface AdminUser {
  id: number
  username: string
  nickname: string | null
  role: string
  status: string
  created_at: string
  last_login_at: string | null
  conversation_count: number
  message_count: number
}

export interface AdminUserList {
  items: AdminUser[]
  total: number
}

export interface AdminStats {
  total_users: number
  active_users: number
  disabled_users: number
  total_conversations: number
  total_messages: number
  today_messages: number
}

export interface AuditLog {
  id: number
  actor_username: string
  action: string
  target_type: string | null
  target_id: string | null
  detail: Record<string, unknown> | null
  ip: string | null
  created_at: string
}

export interface AuditLogList {
  items: AuditLog[]
  total: number
}
