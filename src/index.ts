export interface Env {
  AI: any;
  CONVERSATION_KV: KVNamespace;
  ASSETS: Fetcher;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Streaming Chat Endpoint
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        const body = (await request.json()) as { sessionId?: string; prompt?: string };
        const { sessionId, prompt } = body;

        if (!sessionId || !prompt) {
          return new Response(JSON.stringify({ error: 'Missing sessionId or prompt' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 1. Fetch conversational state from KV
        let history: ChatMessage[] = [];
        try {
          const rawHistory = await env.CONVERSATION_KV.get(`session:${sessionId}`);
          if (rawHistory) {
            history = JSON.parse(rawHistory);
          }
        } catch (kvErr) {
          console.error('KV Read Error:', kvErr);
        }

        const messages: ChatMessage[] = [
          {
            role: 'system',
            content: 'You are an intelligent edge AI assistant. Provide concise, direct, and high-value responses.'
          },
          ...history.slice(-4),
          { role: 'user', content: prompt }
        ];

        // 2. Call Workers AI with streaming
        const stream = (await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
          messages,
          stream: true,
          max_tokens: 512
        })) as ReadableStream;

        // 3. Tee stream: one directly to client, one to collect reply for KV
        const [clientStream, memoryStream] = stream.tee();

        // Run memory accumulation in background via ctx.waitUntil
        ctx.waitUntil(
          (async () => {
            try {
              const reader = memoryStream.getReader();
              const decoder = new TextDecoder();
              let fullText = '';

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                  const trimmed = line.trim();
                  if (trimmed.startsWith('data: ') && !trimmed.includes('[DONE]')) {
                    try {
                      const data = JSON.parse(trimmed.slice(6));
                      if (data.response) fullText += data.response;
                    } catch (_) {}
                  }
                }
              }

              if (fullText.trim()) {
                const updatedHistory: ChatMessage[] = [
                  ...history,
                  { role: 'user', content: prompt },
                  { role: 'assistant', content: fullText }
                ];
                await env.CONVERSATION_KV.put(
                  `session:${sessionId}`,
                  JSON.stringify(updatedHistory),
                  { expirationTtl: 86400 * 7 }
                );
              }
            } catch (err) {
              console.error('KV background persist error:', err);
            }
          })()
        );

        // 4. Return SSE stream
        return new Response(clientStream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          }
        });
      } catch (err: any) {
        console.error('Chat endpoint error:', err);
        return new Response(JSON.stringify({ error: err.message || 'Worker processing failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Serve HTML assets
    if (url.pathname === '/' || url.pathname === '') {
      return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
    }

    return env.ASSETS.fetch(request);
  }
};