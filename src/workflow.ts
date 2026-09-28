import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';

export interface WorkflowParams {
  sessionId: string;
  userPrompt: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class AgentWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
    const { sessionId, userPrompt } = event.payload;

    // Step 1: Retrieve conversation context from KV (State / Memory)
    const context = await step.do('retrieve-history', async () => {
      const historyRaw = await this.env.CONVERSATION_KV.get(`session:${sessionId}`);
      return historyRaw ? (JSON.parse(historyRaw) as ChatMessage[]) : [];
    });

    // Step 2: Query decomposition and planning using Llama 3.3
    const analysis = await step.do('analyze-and-plan', async () => {
      const response = (await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct', {
        messages: [
          {
            role: 'system',
            content: 'Deconstruct the user prompt into 2 strategic sub-angles for a thorough response. Respond concisely.'
          },
          { role: 'user', content: userPrompt }
        ]
      })) as { response: string };
      return response.response;
    });

    // Step 3: Synthesis and final reasoning
    const finalAnswer = await step.do('generate-final-response', async () => {
      const conversationTurns = context.slice(-6); // Maintain the 6 most recent messages
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: 'You are an autonomous edge intelligence assistant built on Cloudflare Workers AI. Deliver high-signal, accurate responses.'
        },
        ...conversationTurns,
        {
          role: 'user',
          content: `Planning Context:\n${analysis}\n\nUser Question:\n${userPrompt}`
        }
      ];

      const response = (await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct', {
        messages
      })) as { response: string };

      return response.response;
    });

    // Step 4: Persist chat memory to Cloudflare KV
    await step.do('save-history', async () => {
      const updatedHistory: ChatMessage[] = [
        ...context,
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: finalAnswer }
      ];
      await this.env.CONVERSATION_KV.put(
        `session:${sessionId}`,
        JSON.stringify(updatedHistory),
        { expirationTtl: 86400 * 7 } // 7-day retention
      );
    });

    return { result: finalAnswer };
  }
}