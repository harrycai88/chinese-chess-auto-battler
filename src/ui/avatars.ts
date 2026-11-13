/**
 * 中美主流大模型 / 实验室正方形 Logo 映射。
 * 根据策略元数据 `author`（模型名/作者名）匹配 `public/avatars/` 下的官方正方形图标，
 * 未匹配到时回落为默认头像 `/avatars/default.svg`。
 */

interface AvatarRule {
  pattern: RegExp
  file: string
  provider: string
}

const AVATAR_RULES: readonly AvatarRule[] = [
  // ── 美国模型 ──
  { pattern: /openai|chatgpt|\bgpt[-_\s]?\d|\bo[134](?:-|\b)|codex/i, file: 'openai.svg', provider: 'OpenAI' },
  { pattern: /claude/i, file: 'claude.svg', provider: 'Anthropic Claude' },
  { pattern: /anthropic/i, file: 'anthropic.svg', provider: 'Anthropic' },
  { pattern: /gemini|gemma/i, file: 'gemini.svg', provider: 'Google Gemini' },
  { pattern: /\bgoogle\b|deepmind/i, file: 'google.svg', provider: 'Google' },
  { pattern: /grok/i, file: 'grok.svg', provider: 'xAI Grok' },
  { pattern: /\bx\.?ai\b/i, file: 'xai.svg', provider: 'xAI' },
  { pattern: /meta|llama/i, file: 'meta.svg', provider: 'Meta' },
  { pattern: /microsoft|copilot|\bphi[-_\s]?\d/i, file: 'microsoft.svg', provider: 'Microsoft' },
  { pattern: /nvidia|nemotron/i, file: 'nvidia.svg', provider: 'NVIDIA' },
  { pattern: /amazon|\bnova\b|bedrock/i, file: 'amazon.svg', provider: 'Amazon' },
  { pattern: /perplexity|sonar/i, file: 'perplexity.svg', provider: 'Perplexity' },

  // ── 中国模型 ──
  { pattern: /deepseek|深度求索/i, file: 'deepseek.svg', provider: 'DeepSeek' },
  { pattern: /chatglm|\bglm[-_\s]?\d/i, file: 'chatglm.svg', provider: '智谱 ChatGLM' },
  { pattern: /zhipu|智谱|z\.ai/i, file: 'zhipu.svg', provider: '智谱 AI' },
  { pattern: /kimi/i, file: 'kimi.svg', provider: 'Kimi' },
  { pattern: /moonshot|月之暗面/i, file: 'moonshot.svg', provider: 'Moonshot AI' },
  { pattern: /xiaomi|mimo|小米/i, file: 'xiaomi.svg', provider: '小米' },
  { pattern: /qwen|tongyi|千问|通义/i, file: 'qwen.svg', provider: '通义千问' },
  { pattern: /doubao|豆包|seed/i, file: 'doubao.svg', provider: '豆包' },
  { pattern: /bytedance|字节/i, file: 'bytedance.svg', provider: '字节跳动' },
  { pattern: /wenxin|ernie|文心|baidu|百度/i, file: 'wenxin.svg', provider: '文心一言' },
  { pattern: /hunyuan|混元|tencent|腾讯/i, file: 'hunyuan.svg', provider: '腾讯混元' },
  { pattern: /minimax|海螺|abab/i, file: 'minimax.svg', provider: 'MiniMax' },
  { pattern: /\byi(?:-\d|\b)|零一万物/i, file: 'yi.svg', provider: '零一万物' },
  { pattern: /stepfun|\bstep[-_\s]?\d|阶跃/i, file: 'stepfun.svg', provider: '阶跃星辰' },
  { pattern: /baichuan|百川/i, file: 'baichuan.svg', provider: '百川智能' },
  { pattern: /spark|星火|iflytek|讯飞/i, file: 'spark.svg', provider: '讯飞星火' },
  { pattern: /sense(?:chat|nova)|商汤|日日新/i, file: 'sensenova.svg', provider: '商汤日日新' },
]

export const DEFAULT_AVATAR_URL = '/avatars/default.svg'

export function resolveModelAvatar(author: string): { url: string; provider: string; matched: boolean } {
  const text = author.trim()
  for (const rule of AVATAR_RULES) {
    if (rule.pattern.test(text)) {
      return {
        url: `/avatars/${rule.file}`,
        provider: rule.provider,
        matched: true,
      }
    }
  }
  return {
    url: DEFAULT_AVATAR_URL,
    provider: '默认',
    matched: false,
  }
}

export function displayAuthor(author: string): string {
  const trimmed = author.trim()
  if (!trimmed || trimmed === 'built-in') return '内置策略'
  return trimmed
}
