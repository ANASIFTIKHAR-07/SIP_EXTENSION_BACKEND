// Example: How to use Token Limiting & RAG in your call handler

import { checkTokenLimit, trackTokenUsage } from "../services/tokenTracking.service.js";
import { getRelevantContext } from "../services/rag.service.js";
import OpenAI from "openai";
import { createClient } from "@deepgram/sdk";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// ============================================
// Example 1: ChatGPT with Token Limiting & RAG
// ============================================
export async function handleChatGPTCall(extensionId, agentId, userMessage) {
  try {
    // Step 1: Check if we're within token limits
    const tokenCheck = await checkTokenLimit(extensionId, "chatgpt", userMessage, "gpt-4");
    
    if (!tokenCheck.allowed) {
      return {
        success: false,
        error: `Token limit exceeded: ${tokenCheck.reason}`,
        tokensAttempted: tokenCheck.tokens
      };
    }

    // Step 2: Get relevant context from RAG files
    const ragContext = await getRelevantContext(agentId, userMessage, 2000);

    // Step 3: Build system prompt with RAG context
    const systemPrompt = ragContext 
      ? `You are a helpful AI assistant. Use the following context to answer user questions:\n\n${ragContext}\n\nIf the answer is not in the context, use your general knowledge.`
      : "You are a helpful AI assistant.";

    // Step 4: Call ChatGPT with enforced token limit
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      max_tokens: tokenCheck.tokens,
      temperature: 0.7,
    });

    // Step 5: Track actual token usage
    const tokensUsed = response.usage.total_tokens;
    await trackTokenUsage(extensionId, "chatgpt", tokensUsed);

    return {
      success: true,
      reply: response.choices[0].message.content,
      tokensUsed,
      hadContext: !!ragContext
    };

  } catch (error) {
    console.error("ChatGPT call error:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================
// Example 2: Deepgram with Token Limiting
// ============================================
export async function handleDeepgramTranscription(extensionId, audioBuffer) {
  try {
    const estimatedTokens = Math.ceil(audioBuffer.length / 100);
    
    const tokenCheck = await checkTokenLimit(extensionId, "deepgram", "audio_transcription", "gpt-4");
    
    if (!tokenCheck.allowed) {
      return {
        success: false,
        error: `Deepgram token limit exceeded: ${tokenCheck.reason}`
      };
    }

    const { result } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      { model: "nova-2", smart_format: true }
    );

    const transcript = result.results.channels[0].alternatives[0].transcript;
    await trackTokenUsage(extensionId, "deepgram", estimatedTokens);

    return {
      success: true,
      transcript,
      tokensUsed: estimatedTokens
    };

  } catch (error) {
    console.error("Deepgram error:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================
// Example 3: Complete Voice Call Handler
// ============================================
export async function handleVoiceCall(extensionId, agentId, audioStream) {
  const results = { transcription: null, aiResponse: null, totalTokens: 0 };

  try {
    const transcriptionResult = await handleDeepgramTranscription(extensionId, audioStream);
    
    if (!transcriptionResult.success) {
      throw new Error(`Transcription failed: ${transcriptionResult.error}`);
    }

    results.transcription = transcriptionResult.transcript;
    results.totalTokens += transcriptionResult.tokensUsed;

    const chatResult = await handleChatGPTCall(extensionId, agentId, transcriptionResult.transcript);

    if (!chatResult.success) {
      throw new Error(`AI response failed: ${chatResult.error}`);
    }

    results.aiResponse = chatResult.reply;
    results.totalTokens += chatResult.tokensUsed;

    return { success: true, ...results };

  } catch (error) {
    console.error("Voice call error:", error);
    return { success: false, error: error.message, ...results };
  }
}
