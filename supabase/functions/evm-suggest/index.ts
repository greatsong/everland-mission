// 본부용 문제 추천. 본부 코드를 확인한 뒤 Claude Sonnet 5.5에 문제 후보를 요청한다.
// 추천은 후보일 뿐이고, 본부가 고른 것만 보관·출제된다.
import Anthropic from 'npm:@anthropic-ai/sdk'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const KIND_GUIDE: Record<string, string> = {
  chosung:
    '초성 퀴즈. answer는 정답 낱말(띄어쓰기 없이, 2~8글자), hint는 한 줄 힌트, body와 choices는 비운다. 초성은 시스템이 만든다.',
  bible_choice:
    '성경 퀴즈 객관식. body는 문제, choices는 선택지 4개, answer는 정답 선택지의 번호(0부터 3까지 숫자 하나). 정답 위치를 고르게 섞는다. hint는 비운다.',
  bible_short:
    '성경 퀴즈 단답형. body는 문제, answer는 핵심 낱말 하나(다르게 부를 수 있으면 쉼표로 구분해 여러 개), choices와 hint는 비운다. 답이 낱말 하나로 분명하게 정해지는 문제만 낸다.',
  nonsense: '넌센스 퀴즈. body는 문제, answer는 정답 낱말 하나, choices와 hint는 비운다. 초등학생이 웃을 수 있는 말장난으로 낸다.',
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['body', 'choices', 'answer', 'hint'],
        properties: {
          body: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' } },
          answer: { type: 'string' },
          hint: { type: 'string' },
        },
      },
    },
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { code, kind, topic, count } = await req.json()
    if (!KIND_GUIDE[kind]) return json({ message: '문제 종류가 올바르지 않습니다.' }, 400)

    // 본부 코드 확인: 앱과 같은 함수(evm_login)를 사용한다.
    const base = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const login = await fetch(`${base}/rest/v1/rpc/evm_login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ p_code: String(code ?? '') }),
    })
    if ((await login.json()) !== 'admin') return json({ message: 'EVM_BAD_CODE' }, 403)

    const n = Math.min(Math.max(Number(count) || 5, 1), 10)
    const client = new Anthropic({ apiKey: Deno.env.get('EVM_ANTHROPIC_API_KEY')! })
    const response = await client.messages.create({
      model: 'claude-sonnet-5-5',
      max_tokens: 16000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system:
        '교회 초등부(초등학교 3~6학년)가 에버랜드 야유회에서 푸는 퀴즈 문제를 만드는 출제 도우미입니다. ' +
        '사실이 분명한 문제만 냅니다. 성경 내용은 개역개정 성경을 기준으로 하고, 확실하지 않은 내용은 문제로 내지 않습니다. ' +
        '문장은 합쇼체 의문문(~입니까?)으로 짧게 적습니다. 서로 겹치지 않는 문제를 냅니다.',
      messages: [
        {
          role: 'user',
          content:
            `문제 종류: ${KIND_GUIDE[kind]}\n` +
            `주제 또는 요청: ${String(topic ?? '').slice(0, 300) || '자유'}\n` +
            `문제 수: ${n}개`,
        },
      ],
    })
    if (response.stop_reason === 'refusal') return json({ message: '요청한 주제로는 문제를 만들 수 없습니다.' }, 422)
    const text = response.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') return json({ message: '추천 결과가 비어 있습니다.' }, 502)
    return json(JSON.parse(text.text))
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ message: '요청이 많습니다. 잠시 뒤 다시 시도합니다.' }, 429)
    if (err instanceof Anthropic.APIError) return json({ message: `AI 호출 실패(${err.status})` }, 502)
    return json({ message: '추천을 만들지 못했습니다.' }, 500)
  }
})
