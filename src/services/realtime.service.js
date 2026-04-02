/**
 * realtime.js — Raw WS Deepgram + OpenAI
 * Fixed: RTP send back to correct address + debug logging
 * Fixed: Interruption sensitivity (higher threshold + debounce)
 * Updated: exports `srf` for extension.controller + integrates activeCalls
 */

import Srf from "drachtio-srf";
import dgram from "dgram";
import WebSocket from "ws";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { activeCalls } from "../controllers/call.controller.js";
import { CallLog } from "../models/calllog.model.js";
import { SipExtension } from "../models/extension.model.js";
import { AIAgent } from "../models/aiagent.model.js";
import { RagContext } from "../models/ragcontext.model.js";
import { RagChunk } from "../models/ragchunk.model.js";
import { RateLimit } from "../models/ratelimit.model.js";

export const srf = new Srf();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY;
const PUBLIC_IP = process.env.PUBLIC_IP;

const SIP_DRACHTIO_HOST = process.env.SIP_DRACHTIO_HOST || "127.0.0.1";
const SIP_DRACHTIO_PORT = parseInt(process.env.SIP_DRACHTIO_PORT) || 9022;
const SIP_DRACHTIO_SECRET = process.env.SIP_DRACHTIO_SECRET || "cymru";
const SIP_REGISTER_URI = process.env.SIP_REGISTER_URI;
const SIP_DOMAIN = process.env.SIP_DOMAIN;
const SIP_EXTENSION = process.env.SIP_EXTENSION;
const SIP_PORT = process.env.SIP_PORT || "5070";
const SIP_PASSWORD = process.env.SIP_PASSWORD;

if (!DEEPGRAM_KEY) {
  console.error("❌ Set DEEPGRAM_API_KEY");
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const usedPorts = new Set();
function getFreePort() {
  let port = 20000 + Math.floor(Math.random() * 500) * 2;
  while (usedPorts.has(port)) port += 2;
  usedPorts.add(port);
  return port;
}

// ── Token Rate Limiting ──────────────────────────────────────────────────────
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

class TokenTracker {
  constructor() {
    // Per-call counters: Map<callId, number>
    this.perCall = new Map();
    // Sliding window entries: Array<{ extensionId, tokens, timestamp }>
    this.history = [];
  }

  /**
   * Record token usage for a call + extension.
   */
  addTokens(callId, extensionId, count) {
    this.perCall.set(callId, (this.perCall.get(callId) || 0) + count);
    this.history.push({ extensionId, tokens: count, timestamp: Date.now() });
    // Prune entries older than 1 hour
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.history = this.history.filter((e) => e.timestamp > oneHourAgo);
  }

  /**
   * Get current usage for a call + extension.
   */
  getUsage(callId, extensionId) {
    const now = Date.now();
    const callTokens = this.perCall.get(callId) || 0;
    const oneMinAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    let minuteTokens = 0;
    let hourTokens = 0;
    for (const entry of this.history) {
      if (entry.extensionId !== extensionId) continue;
      if (entry.timestamp > oneMinAgo) minuteTokens += entry.tokens;
      if (entry.timestamp > oneHourAgo) hourTokens += entry.tokens;
    }

    return { callTokens, minuteTokens, hourTokens };
  }

  /**
   * Check if a request can proceed given the rate limit config.
   * Returns { allowed: boolean, reason?: string, usage }
   */
  canProceed(callId, extensionId, rateLimitConfig, estimatedNewTokens = 0) {
    if (!rateLimitConfig) return { allowed: true, reason: null, usage: null };

    const usage = this.getUsage(callId, extensionId);
    const { maxTokensPerCall, maxTokensPerMinute, maxTokensPerHour, warningThreshold } = rateLimitConfig;

    const projectedCallTokens = usage.callTokens + estimatedNewTokens;
    const projectedMinuteTokens = usage.minuteTokens + estimatedNewTokens;
    const projectedHourTokens = usage.hourTokens + estimatedNewTokens;

    // Check per-call limit
    if (maxTokensPerCall > 0 && projectedCallTokens >= maxTokensPerCall) {
      return { allowed: false, reason: `Per-call limit reached (${projectedCallTokens}/${maxTokensPerCall})`, usage };
    }
    // Check per-minute limit
    if (maxTokensPerMinute > 0 && projectedMinuteTokens >= maxTokensPerMinute) {
      return { allowed: false, reason: `Per-minute limit reached (${projectedMinuteTokens}/${maxTokensPerMinute})`, usage };
    }
    // Check per-hour limit
    if (maxTokensPerHour > 0 && projectedHourTokens >= maxTokensPerHour) {
      return { allowed: false, reason: `Per-hour limit reached (${projectedHourTokens}/${maxTokensPerHour})`, usage };
    }

    // Log warning if approaching threshold
    if (warningThreshold > 0 && maxTokensPerCall > 0) {
      const pct = (projectedCallTokens / maxTokensPerCall) * 100;
      if (pct >= warningThreshold) {
        console.warn(`⚠️  Token usage at ${pct.toFixed(0)}% of per-call limit (${projectedCallTokens}/${maxTokensPerCall})`);
      }
    }

    return { allowed: true, reason: null, usage };
  }

  /**
   * Remove per-call data when call ends.
   */
  clearCall(callId) {
    this.perCall.delete(callId);
  }
}

const tokenTracker = new TokenTracker();

// ── Vector RAG Helpers ───────────────────────────────────────────────────────
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

async function retrieveRelevantChunks(transcript, ragChunks, topK = 3) {
  if (!ragChunks || ragChunks.length === 0) return [];

  // Embed the user's transcript (~20ms API call)
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: transcript,
  });
  const queryVector = response.data[0].embedding;

  // Score every chunk via cosine similarity (~0.1ms, pure JS math)
  const scored = ragChunks.map(chunk => ({
    text: chunk.text,
    score: cosineSimilarity(queryVector, chunk.embedding),
  }));

  // Return top K chunks sorted by relevance
  scored.sort((a, b) => b.score - a.score);
  const topChunks = scored.slice(0, topK);

  console.log(`🔍 Retrieved ${topChunks.length} chunks (scores: ${topChunks.map(c => c.score.toFixed(3)).join(", ")})`);
  return topChunks.map(c => c.text);
}


function parseRemoteRtp(sdp) {
  const ip = (sdp.match(/^c=IN IP4 (.+)$/m) || [])[1]?.trim();
  const port = (sdp.match(/^m=audio (\d+)/m) || [])[1];
  return { ip, port: parseInt(port) };
}

function buildAnswerSdp(port) {
  return (
    [
      "v=0",
      `o=- ${Date.now()} ${Date.now()} IN IP4 ${PUBLIC_IP}`,
      "s=drachtio",
      `c=IN IP4 ${PUBLIC_IP}`,
      "t=0 0",
      `m=audio ${port} RTP/AVP 0`,
      "a=ptime:20",
      "a=sendrecv",
      "a=rtpmap:0 PCMU/8000",
    ].join("\r\n") + "\r\n"
  );
}

// ── PCM 24kHz → mulaw 8kHz ────────────────────────────────────────────────────
function linearToMulaw(s) {
  let sign = 0;
  if (s < 0) {
    sign = 0x80;
    s = -s;
  }
  if (s > 32767) s = 32767;
  s += 33;
  let exp = 7;
  for (let m = 0x4000; (s & m) === 0 && exp > 0; exp--, m >>= 1);
  return ~(sign | (exp << 4) | ((s >> (exp + 3)) & 0x0f)) & 0xff;
}

function pcm24kToMulaw8k(buf) {
  const out = Buffer.alloc(Math.floor(buf.length / 6));
  for (let i = 0; i < out.length; i++) {
    out[i] = linearToMulaw(buf.readInt16LE(i * 6));
  }
  return out;
}

// ── RTP Sender ────────────────────────────────────────────────────────────────
function createRtpSender(sendSock, host, port) {
  let seq = Math.floor(Math.random() * 65535);
  let ts = Math.floor(Math.random() * 0xffffffff);
  const ssrc = Math.floor(Math.random() * 0xffffffff);
  let timer = null;
  let dead = false;

  function sendPacket(payload) {
    if (dead) return;
    const hdr = Buffer.alloc(12);
    hdr[0] = 0x80;
    hdr[1] = 0x00;
    hdr.writeUInt16BE(seq & 0xffff, 2);
    hdr.writeUInt32BE(ts >>> 0, 4);
    hdr.writeUInt32BE(ssrc >>> 0, 8);
    seq++;
    ts = (ts + 160) >>> 0;
    sendSock.send(Buffer.concat([hdr, payload]), port, host, (err) => {
      if (err) console.error("❌ RTP send error:", err.message);
    });
  }

  function streamBuffer(buf) {
    return new Promise((resolve) => {
      if (dead) return resolve();
      let offset = 0;
      timer = setInterval(() => {
        if (dead || offset >= buf.length) {
          clearInterval(timer);
          timer = null;
          return resolve();
        }
        let chunk = buf.slice(offset, offset + 160);
        if (chunk.length < 160) {
          const pad = Buffer.alloc(160, 0xff);
          chunk.copy(pad);
          chunk = pad;
        }
        sendPacket(chunk);
        offset += 160;
      }, 20);
    });
  }

  function stop() {
    dead = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { streamBuffer, stop, isDead: () => dead };
}

// ── Deepgram WebSocket ────────────────────────────────────────────────────────
// function createDeepgramWS(onUtterance) {
//   const params = new URLSearchParams({
//     model: "nova-2",
//     language: "multi",
//     encoding: "mulaw",
//     sample_rate: "8000",
//     channels: "1",
//     endpointing: "400",
//     interim_results: "true",
//     utterance_end_ms: "1200",
//   });

//   const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
//     headers: { Authorization: `Token ${DEEPGRAM_KEY}` },
//   });

//   ws.on("open", () => console.log("🟢 Deepgram WS connected"));
//   ws.on("error", (e) => console.error("❌ Deepgram error:", e.message));
//   ws.on("close", (c) => console.log(`🔴 Deepgram closed (${c})`));

//   ws.on("message", (raw) => {
//     try {
//       const data = JSON.parse(raw.toString());
//       const txt = data.channel?.alternatives?.[0]?.transcript?.trim();
//       if (!txt) return;

//       if (data.is_final) {
//         process.stdout.write(`\r📝 [FINAL] ${txt}\n`);
//         if (data.speech_final) onUtterance(txt);
//       } else {
//         process.stdout.write(`\r📝 [live]  ${txt}          `);
//       }
//     } catch (_) {}
//   });

//   return new Promise((resolve, reject) => {
//     ws.once("open", () =>
//       resolve({
//         send: (buf) => {
//           if (ws.readyState === WebSocket.OPEN) ws.send(buf);
//         },
//         close: () => {
//           try { ws.close(); } catch (_) {}
//         },
//       })
//     );
//     ws.once("error", reject);
//   });
// }

function createDeepgramWS(onUtterance) {
  const params = new URLSearchParams({
    model: "nova-3",
    language: "ur",       
    encoding: "mulaw",
    sample_rate: "8000",
    channels: "1",
    endpointing: "500",
    interim_results: "true",
    utterance_end_ms: "1500",     
  });

  const url = `wss://api.deepgram.com/v1/listen?${params}`;
  console.log("🔗 Deepgram URL:", url);

  const ws = new WebSocket(url, {
    headers: { Authorization: `Token ${DEEPGRAM_KEY}` },
  });

  ws.on("open", () => console.log("🟢 Deepgram connected (Urdu / nova-3)"));
  ws.on("error", (e) => console.error("❌ Deepgram error:", e.message));
  ws.on("close", (c, reason) => console.log(`🔴 Deepgram closed (${c}) ${reason}`));

  let accumulated = "";

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      // ── UtteranceEnd: silence timeout — flush whatever was accumulated
      if (data.type === "UtteranceEnd") {
        if (accumulated.trim()) {
          console.log(`\n📝 [UtteranceEnd] → "${accumulated}"`);
          onUtterance(accumulated.trim(), "ur");
          accumulated = "";
        }
        return;
      }

      const alt = data.channel?.alternatives?.[0];
      const txt = alt?.transcript?.trim();
      if (!txt) return;

      if (data.is_final) {
        // Accumulate final segments into one utterance
        accumulated += (accumulated ? " " : "") + txt;
        process.stdout.write(`\r📝 [FINAL] "${accumulated}"\n`);

        if (data.speech_final) {
          // Natural end of speech — respond immediately
          onUtterance(accumulated.trim(), "ur");
          accumulated = "";
        }
      } else {
        process.stdout.write(`\r📝 [live]  ${txt}          `);
      }
    } catch (_) { }
  });

  return new Promise((resolve, reject) => {
    ws.once("open", () =>
      resolve({
        send: (buf) => { if (ws.readyState === WebSocket.OPEN) ws.send(buf); },
        close: () => { try { ws.close(); } catch (_) { } },
      }),
    );
    ws.once("error", reject);
  });
}

// ── GPT + TTS ─────────────────────────────────────────────────────────────────
// async function respondToUser(
//   transcript,
//   history,
//   rtpSock,
//   remote,
//   onStart,
//   onDone,
//   isInterrupted,
//   isBotEnabled,
// ) {
//   // Respect bot-enabled flag set via API
//   if (!isBotEnabled()) {
//     console.log("🤖 Bot disabled for this call — skipping response");
//     return;
//   }

//   console.log(`\n💬 User: ${transcript}`);
//   history.push({ role: "user", content: transcript });

//   const sender = createRtpSender(rtpSock, remote.ip, remote.port);
//   onStart(sender);

//   console.log(`📤 Will send audio → ${remote.ip}:${remote.port}`);

//   try {
//     const stream = await openai.chat.completions.create({
//       model: "gpt-4o-mini",
//       stream: true,
//       max_tokens: 120,
//       messages: [
//         {
//           role: "system",
//           content:
//             "You are a helpful voice assistant on a phone call. Keep answers SHORT — 1 to 2 sentences. Be natural and conversational.",
//         },
//         ...history,
//       ],
//     });

//     let fullReply = "";
//     let pending = "";

//     async function flushTTS(text) {
//       text = text.trim();
//       if (!text || isInterrupted() || !isBotEnabled()) return;
//       console.log(`🗣️  TTS: "${text}"`);
//       try {
//         const res = await openai.audio.speech.create({
//           model: "tts-1",
//           voice: "alloy",
//           input: text,
//           response_format: "pcm",
//           speed: 1.0,
//         });
//         if (isInterrupted() || !isBotEnabled()) return;
//         const pcm = Buffer.from(await res.arrayBuffer());
//         const mulaw = pcm24kToMulaw8k(pcm);
//         console.log(
//           `🔊 Streaming ${mulaw.length} bytes (${Math.ceil(mulaw.length / 160)} packets) → ${remote.ip}:${remote.port}`
//         );
//         if (!isInterrupted() && isBotEnabled()) await sender.streamBuffer(mulaw);
//       } catch (e) {
//         console.error("❌ TTS error:", e.message);
//       }
//     }

//     for await (const chunk of stream) {
//       if (isInterrupted() || !isBotEnabled()) break;
//       const token = chunk.choices[0]?.delta?.content || "";
//       fullReply += token;
//       pending += token;

//       if (/[.!?।]\s/.test(pending)) {
//         const parts = pending.split(/(?<=[.!?।])\s+/);
//         for (let i = 0; i < parts.length - 1; i++) {
//           await flushTTS(parts[i]);
//           if (isInterrupted() || !isBotEnabled()) break;
//         }
//         pending = parts[parts.length - 1] || "";
//       }
//     }

//     if (!isInterrupted() && isBotEnabled() && pending.trim()) await flushTTS(pending);

//     if (!isInterrupted()) {
//       history.push({ role: "assistant", content: fullReply });
//       console.log(`\n🤖 Bot: ${fullReply}`);
//     }
//   } catch (e) {
//     console.error("❌ GPT error:", e.message);
//   }

//   sender.stop();
//   onDone();
//   console.log("\n🎙️  Listening...");
// }

// Updated Version — with token rate limiting + vector RAG retrieval
async function respondToUser(
  transcript,
  detectedLang,
  history,
  rtpSock,
  remote,
  onStart,
  onDone,
  isInterrupted,
  isBotEnabled,
  agentConfig,        // { systemPrompt, modelName } from AIAgent doc (optional)
  ragChunks,          // array of { text, embedding } loaded into RAM at call start
  rateLimitConfig,    // { maxTokensPerCall, maxTokensPerMinute, maxTokensPerHour, warningThreshold } (optional)
  callId,             // for per-call token tracking
  extensionId,        // for per-extension rate limiting
  onSpeak,            // callback fired exactly when audio starts playing
  abortSignal,        // AbortSignal to cancel OpenAI requests on interrupt
) {
  // Respect bot-enabled flag set via API
  if (!isBotEnabled()) {
    console.log("🤖 Bot disabled for this call — skipping response");
    return;
  }

  console.log(`\n💬 User: ${transcript}`);

  // ── Vector RAG Retrieval ─────────────────────────────────────────────────
  let ragSection = "";
  try {
    const relevantChunks = await retrieveRelevantChunks(transcript, ragChunks, 3);
    if (relevantChunks.length > 0) {
      ragSection = `\n\nRELEVANT CONTEXT — use this as your primary source of truth when answering:\n"""\n${relevantChunks.join("\n\n")}\n"""\nOnly answer based on the above context. If the answer is not in the context, politely say you don't have that information.`;
    }
  } catch (e) {
    console.error("⚠️ RAG retrieval failed, continuing without context:", e.message);
  }

  // Construct context strings to properly estimate tokens
  const basePrompt = agentConfig?.systemPrompt?.trim()
    ? agentConfig.systemPrompt
    : `You are a helpful voice assistant on a phone call.
Keep answers SHORT — 1 to 2 sentences. Be natural and conversational.`;

  const systemContent = `${basePrompt}${ragSection}

IMPORTANT: Always reply in the SAME language the user is speaking.
- If user speaks Urdu → reply in Urdu (Urdu script)
- If user speaks Arabic → reply in Arabic
- If user speaks English → reply in English
- If user mixes Urdu+English → reply in same mix
- Sound like a polite call center agent. No lists or long explanations.`;

  // Calculate actual total input tokens for this request (System Prompt + full history + new API payload)
  // OpenAI is stateless and charges for the entire context window on every turn.
  let inputTokenEstimate = estimateTokens(systemContent) + estimateTokens(transcript);
  for (const msg of history) {
    inputTokenEstimate += estimateTokens(msg.content);
  }

  // ── Token rate limit check ────────────────────────────────────────────────
  if (rateLimitConfig && callId && extensionId) {
    const check = tokenTracker.canProceed(callId, extensionId, rateLimitConfig, inputTokenEstimate);
    if (!check.allowed) {
      console.log(`🚫 Token limit blocked: ${check.reason}`);
      // TTS a polite apology instead of calling GPT
      const sender = createRtpSender(rtpSock, remote.ip, remote.port);
      onStart(sender);
      try {
        const apologyText = detectedLang === "ur"
          ? "معذرت خواہ ہیں، لیکن یہ کال اپنے مقررہ وقت کو پہنچ چکی ہے۔ مزید بات چیت کے لیے براہِ کرم بعد میں دوبارہ کال کریں۔ آپ کا شکریہ اور آپ کا دن اچھا گزرے۔"
          : "We apologize, but this session has reached its maximum time limit. Please call back later to continue our conversation. Thank you and have a great day.";
        console.log(`🗣️  TTS (limit apology): "${apologyText}"`);
        const res = await openai.audio.speech.create({
          model: "tts-1", voice: "alloy", input: apologyText,
          response_format: "pcm", speed: 1.0,
        });
        const pcm = Buffer.from(await res.arrayBuffer());
        const mulaw = pcm24kToMulaw8k(pcm);
        await sender.streamBuffer(mulaw);
      } catch (e) {
        console.error("❌ Limit-apology TTS error:", e.message);
      }
      sender.stop();
      onDone();
      return;
    }

    tokenTracker.addTokens(callId, extensionId, inputTokenEstimate);
    console.log(`📊 Input tokens ~${inputTokenEstimate} | Call total: ${tokenTracker.getUsage(callId, extensionId).callTokens}`);
  }

  history.push({ role: "user", content: transcript });

  const sender = createRtpSender(rtpSock, remote.ip, remote.port);
  onStart(sender);

  console.log(`📤 Will send audio → ${remote.ip}:${remote.port}`);

  try {
    const model = agentConfig?.modelName || "gpt-4o-mini";

    const stream = await openai.chat.completions.create({
      model,
      stream: true,
      max_tokens: 120,
      temperature: 0.6,
      messages: [
        { role: "system", content: systemContent },
        ...history,
      ],
    }, { signal: abortSignal });

    let fullReply = "";
    let pending = "";

    async function flushTTS(text) {
      text = text.trim();
      if (!text || isInterrupted() || !isBotEnabled() || abortSignal?.aborted) return;
      console.log(`🗣️  TTS: "${text}"`);
      try {
        const res = await openai.audio.speech.create({
          model: "tts-1",
          voice: "alloy",
          input: text,
          response_format: "pcm",
          speed: 1.0,
        }, { signal: abortSignal });
        if (isInterrupted() || !isBotEnabled() || abortSignal?.aborted) return;
        const pcm = Buffer.from(await res.arrayBuffer());
        const mulaw = pcm24kToMulaw8k(pcm);
        console.log(
          `🔊 Streaming ${mulaw.length} bytes (${Math.ceil(mulaw.length / 160)} packets) → ${remote.ip}:${remote.port}`,
        );
        if (!isInterrupted() && isBotEnabled() && !abortSignal?.aborted) {
          if (onSpeak) onSpeak();
          await sender.streamBuffer(mulaw);
        }
      } catch (e) {
        if (e.name !== 'AbortError') console.error("❌ TTS error:", e.message);
      }
    }

    let outputTokenCount = 0;

    for await (const chunk of stream) {
      if (isInterrupted() || !isBotEnabled()) break;
      const token = chunk.choices[0]?.delta?.content || "";
      fullReply += token;
      pending += token;
      outputTokenCount += estimateTokens(token);

      if (/[.!?؟۔]\s/.test(pending)) {
        const parts = pending.split(/(?<=[.!?؟۔])\s+/);
        for (let i = 0; i < parts.length - 1; i++) {
          await flushTTS(parts[i]);
          if (isInterrupted() || !isBotEnabled()) break;
        }
        pending = parts[parts.length - 1] || "";
      }
    }

    // Record output tokens
    if (rateLimitConfig && callId && extensionId) {
      tokenTracker.addTokens(callId, extensionId, outputTokenCount);
      const usage = tokenTracker.getUsage(callId, extensionId);
      console.log(`📊 Output tokens ~${outputTokenCount} | Call total: ${usage.callTokens} | Min: ${usage.minuteTokens} | Hr: ${usage.hourTokens}`);
    }

    if (!isInterrupted() && isBotEnabled() && pending.trim())
      await flushTTS(pending);

    if (!isInterrupted() && !abortSignal?.aborted) {
      history.push({ role: "assistant", content: fullReply });
      console.log(`\n🤖 Bot: ${fullReply}`);
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.error("❌ GPT error:", e.message);
  }

  sender.stop();
  onDone();
  console.log("\n🎙️  Listening...");
}

// ── Call Handler ──────────────────────────────────────────────────────────────
async function handleCall(localRtpPort, remote, callMeta, agentConfig, ragChunks, rateLimitConfig, extensionId) {
  const history = [];
  let currentSender = null;
  let botSpeaking = false;
  let interrupted = false;
  let processing = false;
  let currentAbortController = null;

  function interrupt() {
    if (botSpeaking && currentSender) {
      console.log("\n⚡ Interrupted! Aborting active streams...");
      interrupted = true;
      currentSender.stop();
      currentSender = null;
      botSpeaking = false;
      // Immediately abort any in-flight OpenAI requests (GPT stream + TTS)
      if (currentAbortController) {
        currentAbortController.abort();
      }
    }
  }

  const rtpSock = dgram.createSocket("udp4");
  let actualRemote = { ...remote };
  let firstPacket = true;
  let highEnergyCount = 0;

  const INTERRUPT_THRESHOLD = 50;
  const INTERRUPT_PACKETS = 5;

  const dg = await createDeepgramWS(async (transcript, detectedLang) => {
    if (!transcript) return;

    // Check bot-enabled flag from activeCalls map (can be toggled via API)
    const callEntry = activeCalls.get(callMeta.callId);
    const isBotEnabled = () => callEntry?.botEnabled ?? true;

    if (botSpeaking) interrupt();

    // If the previous response is still winding down after interrupt,
    // wait for it to finish (should be fast since we aborted its streams)
    if (processing) {
      console.log("⏳ Waiting for previous response to finish after interrupt...");
      const waitStart = Date.now();
      while (processing && Date.now() - waitStart < 2000) {
        await new Promise(r => setTimeout(r, 30));
      }
      if (processing) {
        // Safety: force-clear if it didn't complete in 2 seconds
        console.warn("⚠️ Force-clearing processing lock after timeout");
        processing = false;
      }
    }

    processing = true;
    interrupted = false;
    currentAbortController = new AbortController();

    await respondToUser(
      transcript,
      detectedLang,
      history,
      rtpSock,
      actualRemote,
      (s) => {
        currentSender = s;
        // Do NOT set botSpeaking = true here! Wait until TTS actually finishes generating audio.
        // Expose sender to API for stop-bot
        if (callEntry) callEntry.currentSender = s;
      },
      () => {
        botSpeaking = false;
        processing = false;
        if (callEntry) callEntry.currentSender = null;
      },
      () => interrupted,
      isBotEnabled,
      agentConfig,
      ragChunks,
      rateLimitConfig,
      callMeta.callId,
      extensionId,
      () => {
        // Fired instantly before the first RTP bits are sent across the wire
        botSpeaking = true;
      },
      currentAbortController.signal,
    );
    // Note: processing is reset to false inside onDone() callback above
  });

  rtpSock.on("message", (msg, rinfo) => {
    if (msg.length <= 12) return;

    if (firstPacket) {
      actualRemote = { ip: rinfo.address, port: rinfo.port };
      console.log(
        `🎯 First RTP from ${rinfo.address}:${rinfo.port} (SDP said ${remote.ip}:${remote.port})`,
      );
      firstPacket = false;
    }

    const payload = msg.slice(12);

    if (botSpeaking) {
      const energy =
        payload.reduce((s, b) => s + ((b & 0x7f) ^ 0x7f), 0) / payload.length;

      if (energy > INTERRUPT_THRESHOLD) {
        highEnergyCount++;
        if (highEnergyCount >= INTERRUPT_PACKETS) {
          highEnergyCount = 0;
          interrupt();
        }
      } else {
        highEnergyCount = 0;
      }
    } else {
      highEnergyCount = 0;
    }

    dg.send(payload);
  });

  rtpSock.on("error", (e) => console.error("❌ RTP error:", e.message));

  rtpSock.bind(localRtpPort, "0.0.0.0", () => {
    console.log(`🎧 RTP socket bound on 0.0.0.0:${localRtpPort}`);
  });

  return {
    stop: () => {
      dg.close();
      try {
        rtpSock.close();
      } catch (_) { }
      if (currentSender) currentSender.stop();
    },
  };
}

// ── SIP ───────────────────────────────────────────────────────────────────────
srf.connect({ host: SIP_DRACHTIO_HOST, port: SIP_DRACHTIO_PORT, secret: SIP_DRACHTIO_SECRET });

srf.on("connect", (err) => {
  if (err) {
    console.error("❌ drachtio connection error:", err.message);
    return;
  }
  console.log("✅ drachtio connected. Registering...");

  srf.request(
    SIP_REGISTER_URI.startsWith("sip:") ? SIP_REGISTER_URI : `sip:${SIP_REGISTER_URI}`,
    {
      method: "REGISTER",
      headers: {
        Contact: `<sip:${SIP_EXTENSION}@${PUBLIC_IP}:${SIP_PORT}>`,
        To: `sip:${SIP_EXTENSION}@${SIP_DOMAIN}`,
        From: `sip:${SIP_EXTENSION}@${SIP_DOMAIN}`,
      },
      auth: { username: SIP_EXTENSION, password: SIP_PASSWORD },
    },
    (err, req) => {
      if (err) return console.log("❌ Register failed:", err);
      req.on("response", (res) => {
        console.log(`📩 ${res.status} ${res.reason}`);
        if (res.status === 200) console.log("🚀 REGISTERED!");
      });
    },
  );
});

srf.on("error", (err) => {
  console.error("❌ SIP server error:", err.message);
});

srf.invite(async (req, res) => {
  const fromNum = req.callingNumber || "unknown";
  const toNum = req.calledNumber || "unknown";
  const remote = parseRemoteRtp(req.body);
  const callId = uuidv4();

  console.log(`\n📞 Call: ${fromNum} → ${toNum}  [${callId}]`);
  console.log(`📡 Remote RTP from SDP: ${remote.ip}:${remote.port}`);

  // ── Answer the call IMMEDIATELY to prevent PBX timeout ─────────────────
  const port = getFreePort();
  res.send(100);
  res.send(180);  // Ringing — keeps PBX alive during setup

  let dialog;
  try {
    dialog = await srf.createUAS(req, res, {
      localSdp: buildAnswerSdp(port),
    });
  } catch (e) {
    console.error("❌ Failed to answer call:", e.message);
    usedPorts.delete(port);
    return;
  }

  console.log("✅ Call answered — setting up media pipeline...");

  // ── Now do the heavy async work (call is already established) ──────────
  try {
    const callMeta = {
      callId,
      fromNumber: fromNum,
      toNumber: toNum,
      extension: toNum,
    };

    // Look up the extension's assigned AI agent
    const extDoc = await SipExtension.findOne({ extension: toNum }).populate("aiAgent");
    const agentConfig = extDoc?.aiAgent?.isActive
      ? { systemPrompt: extDoc.aiAgent.systemPrompt, modelName: extDoc.aiAgent.modelName }
      : null;

    if (agentConfig) {
      console.log(`🤖 Using agent: ${extDoc.aiAgent.name} (${agentConfig.modelName})`);
    }

    // Fetch active RAG context — scoped to this extension's owner to prevent cross-user leakage
    // Load chunks + embeddings into RAM for the lifetime of this call session
    const ownerId = extDoc?.createdBy ?? null;
    const ragDoc = await RagContext.findOne({ isActive: true, uploadedBy: ownerId }).select("_id fileName");
    let ragChunks = [];
    if (ragDoc) {
      ragChunks = await RagChunk.find({ ragContextId: ragDoc._id })
        .select("text embedding")
        .sort({ chunkIndex: 1 })
        .lean();
      console.log(`📄 RAG context loaded: "${ragDoc.fileName}" → ${ragChunks.length} chunks in RAM`);
    } else if (ownerId) {
      console.log("📄 No active RAG context for this extension's owner");
    }

    // Fetch token rate limit config for this extension
    // If no DB row exists, apply schema defaults so limits are always enforced
    let rateLimitConfig = null;
    const extensionId = extDoc?._id || null;
    if (extensionId) {
      const rlDoc = await RateLimit.findOne({ extensionId });
      if (rlDoc) {
        rateLimitConfig = {
          maxTokensPerCall: rlDoc.maxTokensPerCall,
          maxTokensPerMinute: rlDoc.maxTokensPerMinute,
          maxTokensPerHour: rlDoc.maxTokensPerHour,
          warningThreshold: rlDoc.warningThreshold,
        };
        console.log(`🔒 Rate limit loaded: ${rlDoc.maxTokensPerCall}/call, ${rlDoc.maxTokensPerMinute}/min, ${rlDoc.maxTokensPerHour}/hr`);
      } else {
        // No saved config — apply schema defaults (1000/call, 5000/min, 50000/hr)
        rateLimitConfig = {
          maxTokensPerCall: 1000,
          maxTokensPerMinute: 5000,
          maxTokensPerHour: 50000,
          warningThreshold: 80,
        };
        console.log(`🔒 No rate limit row found — applying defaults: 1000/call, 5000/min, 50000/hr`);
      }
    }

    const session = await handleCall(port, remote, callMeta, agentConfig, ragChunks, rateLimitConfig, extensionId?.toString());

    // ── Log to DB + in-memory ──────────────────────────────────────────────
    await CallLog.create({
      callId,
      extension: toNum,
      fromNumber: fromNum,
      toNumber: toNum,
      remoteIp: remote.ip,
      remotePort: remote.port,
      status: "active",
      botEnabled: true,
    });

    activeCalls.set(callId, {
      session,
      fromNumber: fromNum,
      toNumber: toNum,
      extension: toNum,
      startedAt: new Date(),
      botEnabled: true,
      currentSender: null,
    });

    console.log("✅ Media pipeline ready!\n");

    dialog.on("destroy", async () => {
      console.log("📵 Call ended");
      session.stop();
      usedPorts.delete(port);

      // ── Clean up token tracker ─────────────────────────────────────────
      const finalUsage = tokenTracker.getUsage(callId, extensionId?.toString());
      if (finalUsage.callTokens > 0) {
        console.log(`📊 Final token usage for call ${callId}: ${finalUsage.callTokens} tokens`);
      }
      tokenTracker.clearCall(callId);

      // ── Update DB + remove from active map ─────────────────────────────
      const startedAt = activeCalls.get(callId)?.startedAt;
      activeCalls.delete(callId);

      await CallLog.findOneAndUpdate(
        { callId },
        {
          status: "ended",
          endedAt: new Date(),
          durationSeconds: startedAt
            ? Math.floor((Date.now() - startedAt.getTime()) / 1000)
            : null,
        },
      );
    });
  } catch (e) {
    console.error("❌ Call setup error:", e.message, e.stack);
    // Call is live but media pipeline failed — hang up gracefully
    try { dialog.destroy(); } catch (_) { }
    usedPorts.delete(port);

    await CallLog.findOneAndUpdate({ callId }, { status: "failed" }).catch(
      () => { },
    );
    activeCalls.delete(callId);
  }
});

console.log("📡 SIP server starting...");
