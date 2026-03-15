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

export const srf = new Srf();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY;
const PUBLIC_IP = process.env.PUBLIC_IP;

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

//  My version - Still to be tested. Changed the Deepgram Model and some configuration
function createDeepgramWS(onUtterance) {
  const params = new URLSearchParams({
    model: "nova-3",
    // language: "multi",
    encoding: "mulaw",
    sample_rate: "8000",
    channels: "1",
    detect_language: "true",
    interim_results: "true",
    endpointing: "400",
    utterance_end_ms: "1200",
    smart_format: "true",
    punctuate: "true",
  });

  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
    headers: { Authorization: `Token ${DEEPGRAM_KEY}` },
  });

  ws.on("open", () => console.log("🟢 Deepgram WS connected"));
  ws.on("error", (e) => console.error("❌ Deepgram error:", e.message));
  ws.on("close", (c) => console.log(`🔴 Deepgram closed (${c})`));

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.is_final)
        console.log(
          "🔍 Deepgram raw:",
          JSON.stringify(data.channel?.alternatives?.[0]).slice(0, 200),
        );
      const txt = data.channel?.alternatives?.[0]?.transcript?.trim();

      // const detectedLang =
      //   data.channel?.detected_language ||
      //   data.channel?.alternatives?.[0]?.languages?.[0];

      // const detectedLang = data.channel?.alternatives?.[0]?.languages?.[0] || "en";

      const detectedLang =
        data.channel?.detected_language ||
        data.channel?.alternatives?.[0]?.languages?.[0]?.language ||
        "en";

      console.log("🌍 detectedLang:", detectedLang, typeof detectedLang);

      if (!txt) return;
      if (txt.length < 2) return;

      if (data.is_final) {
        process.stdout.write(`\r📝 [FINAL ${detectedLang || ""}] ${txt}\n`);

        if (data.speech_final) onUtterance(txt, detectedLang);
      } else {
        process.stdout.write(
          `\r📝 [live ${detectedLang || ""}] ${txt}          `,
        );
      }
    } catch (_) {}
  });

  return new Promise((resolve, reject) => {
    ws.once("open", () =>
      resolve({
        send: (buf) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(buf);
        },
        close: () => {
          try {
            ws.close();
          } catch (_) {}
        },
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

// Updated Version
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
) {
  // Respect bot-enabled flag set via API
  if (!isBotEnabled()) {
    console.log("🤖 Bot disabled for this call — skipping response");
    return;
  }

  console.log(`\n💬 User: ${transcript}`);
  history.push({ role: "user", content: transcript });

  const sender = createRtpSender(rtpSock, remote.ip, remote.port);
  onStart(sender);

  console.log(`📤 Will send audio → ${remote.ip}:${remote.port}`);

  try {
    const langLabel =
      detectedLang === "ur"
        ? "Urdu"
        : detectedLang === "ar"
          ? "Arabic"
          : "English";
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      stream: true,
      max_tokens: 120,
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content: `
          You are a helpful AI voice assistant on a phone call.

          The caller is speaking ${langLabel}.
          You MUST respond in ${langLabel} only. Do not switch languages.

          Rules:
          - Keep responses short (1–2 sentences)
          - Use natural spoken language
          - No lists or long explanations
          - Sound like a polite call center agent
          - Respond quickly and concisely
          - If the audio is unclear, politely ask the caller to repeat
          `,
        },
        ...history,
      ],
    });

    let fullReply = "";
    let pending = "";

    async function flushTTS(text) {
      text = text.trim();
      if (!text || isInterrupted() || !isBotEnabled()) return;
      console.log(`🗣️  TTS: "${text}"`);
      try {
        const res = await openai.audio.speech.create({
          model: "tts-1",
          voice: "alloy",
          input: text,
          response_format: "pcm",
          speed: 1.0,
        });
        if (isInterrupted() || !isBotEnabled()) return;
        const pcm = Buffer.from(await res.arrayBuffer());
        const mulaw = pcm24kToMulaw8k(pcm);
        console.log(
          `🔊 Streaming ${mulaw.length} bytes (${Math.ceil(mulaw.length / 160)} packets) → ${remote.ip}:${remote.port}`,
        );
        if (!isInterrupted() && isBotEnabled())
          await sender.streamBuffer(mulaw);
      } catch (e) {
        console.error("❌ TTS error:", e.message);
      }
    }

    for await (const chunk of stream) {
      if (isInterrupted() || !isBotEnabled()) break;
      const token = chunk.choices[0]?.delta?.content || "";
      fullReply += token;
      pending += token;

      if (/[.!?؟۔]\s/.test(pending)) {
        const parts = pending.split(/(?<=[.!?؟۔])\s+/);
        for (let i = 0; i < parts.length - 1; i++) {
          await flushTTS(parts[i]);
          if (isInterrupted() || !isBotEnabled()) break;
        }
        pending = parts[parts.length - 1] || "";
      }
    }

    if (!isInterrupted() && isBotEnabled() && pending.trim())
      await flushTTS(pending);

    if (!isInterrupted()) {
      history.push({ role: "assistant", content: fullReply });
      console.log(`\n🤖 Bot: ${fullReply}`);
    }
  } catch (e) {
    console.error("❌ GPT error:", e.message);
  }

  sender.stop();
  onDone();
  console.log("\n🎙️  Listening...");
}

// ── Call Handler ──────────────────────────────────────────────────────────────
async function handleCall(localRtpPort, remote, callMeta) {
  const history = [];
  let currentSender = null;
  let botSpeaking = false;
  let interrupted = false;
  let processing = false;

  function interrupt() {
    if (botSpeaking && currentSender) {
      console.log("\n⚡ Interrupted!");
      interrupted = true;
      currentSender.stop();
      currentSender = null;
      botSpeaking = false;
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
    if (processing) return;

    processing = true;
    interrupted = false;

    await respondToUser(
      transcript,
      detectedLang,
      history,
      rtpSock,
      actualRemote,
      (s) => {
        currentSender = s;
        botSpeaking = true;
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
    );

    processing = false;
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
      } catch (_) {}
      if (currentSender) currentSender.stop();
    },
  };
}

// ── SIP ───────────────────────────────────────────────────────────────────────
srf.connect({ host: "127.0.0.1", port: 9022, secret: "cymru" });

srf.on("connect", (err) => {
  if (err) {
    console.error("❌ drachtio connection error:", err.message);
    return;
  }
  console.log("✅ drachtio connected. Registering...");

  srf.request(
    "sip:q.sgycm.yeastarcloud.com",
    {
      method: "REGISTER",
      headers: {
        Contact: `<sip:208@${PUBLIC_IP}:5070>`,
        To: "sip:208@q.sgycm.yeastarcloud.com",
        From: "sip:208@q.sgycm.yeastarcloud.com",
      },
      auth: { username: "208", password: "Smart@0500" },
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
  res.send(100);

  try {
    const port = getFreePort();
    const callMeta = {
      callId,
      fromNumber: fromNum,
      toNumber: toNum,
      extension: "208",
    };

    const session = await handleCall(port, remote, callMeta);

    // ── Log to DB + in-memory ──────────────────────────────────────────────
    await CallLog.create({
      callId,
      extension: "208",
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
      extension: "208",
      startedAt: new Date(),
      botEnabled: true,
      currentSender: null,
    });

    const dialog = await srf.createUAS(req, res, {
      localSdp: buildAnswerSdp(port),
    });

    console.log("✅ Call LIVE!\n");

    dialog.on("destroy", async () => {
      console.log("📵 Call ended");
      session.stop();
      usedPorts.delete(port);

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
    console.error("❌ Call error:", e.message, e.stack);

    await CallLog.findOneAndUpdate({ callId }, { status: "failed" }).catch(
      () => {},
    );
    activeCalls.delete(callId);

    try {
      res.send(500);
    } catch (_) {}
  }
});

console.log("📡 SIP server starting...");
