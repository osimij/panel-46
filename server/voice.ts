// Talking to FRIDAY instead of typing: the designer's voice, turned into words by Deepgram
// (Nova-3, one language at a time), live, while they speak.
//
// The browser can't be given the Deepgram key, and this key can't make short-lived ones, so
// Panel passes the sound along itself: the page opens a WebSocket to Panel (/api/listen),
// Panel opens one to Deepgram with the key, and each side's messages go through untouched.
// The key lives in the Keychain as "Panel Deepgram key" (or DEEPGRAM_API_KEY, for tests).

import type { ServerWebSocket } from "bun";

const KEY_SERVICE = "Panel Deepgram key";
/** Nova-3's single-language models Panel offers. */
export const VOICE_LANGUAGES = ["en", "ru"] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

let cached: string | null = null;
export async function deepgramKey(): Promise<string | null> {
  if (cached) return cached;
  if (process.env.DEEPGRAM_API_KEY) return (cached = process.env.DEEPGRAM_API_KEY);
  const p = Bun.spawn(["security", "find-generic-password", "-s", KEY_SERVICE, "-w"], { stdout: "pipe", stderr: "ignore" });
  const out = (await new Response(p.stdout).text()).trim();
  return (await p.exited) === 0 && out ? (cached = out) : null;
}

export interface Listening {
  lang: VoiceLanguage;
  upstream?: WebSocket;
  /** Sound that arrived before Deepgram answered, sent as soon as it does. */
  waiting: (string | Uint8Array<ArrayBuffer>)[];
  closed?: boolean;
}

const say = (ws: ServerWebSocket<Listening>, text: string) => {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: "Panel", error: text }));
};

/** Bun's WebSocket handlers for /api/listen. */
export const listening = {
  async open(ws: ServerWebSocket<Listening>) {
    const key = await deepgramKey();
    if (!key) {
      say(ws, "Panel has no Deepgram key. Save it in the Keychain as “Panel Deepgram key”.");
      return ws.close();
    }
    const params = new URLSearchParams({
      model: "nova-3",
      language: ws.data.lang,
      smart_format: "true",
      punctuate: "true",
      interim_results: "true",
      // A short pause ends a sentence, so finished words settle quickly.
      endpointing: "300",
    });
    // Bun lets a WebSocket carry headers, which is how Deepgram takes the key.
    const up = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, { headers: { Authorization: `Token ${key}` } } as unknown as string[]);
    up.binaryType = "arraybuffer";
    ws.data.upstream = up;
    up.onopen = () => {
      for (const chunk of ws.data.waiting.splice(0)) up.send(chunk);
      if (ws.data.closed) up.send(JSON.stringify({ type: "CloseStream" }));
    };
    up.onmessage = (e) => {
      if (ws.readyState === 1) ws.send(typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer));
    };
    up.onerror = () => say(ws, "Couldn't reach Deepgram. Check the internet connection.");
    up.onclose = (e) => {
      if (e.code === 1008 || /auth|credential|forbidden/i.test(e.reason)) say(ws, "Deepgram didn't accept the key.");
      else if (e.code !== 1000 && e.code !== 1005 && e.reason) say(ws, `Deepgram stopped listening: ${e.reason}`);
      if (ws.readyState === 1) ws.close();
    };
  },
  message(ws: ServerWebSocket<Listening>, message: string | Buffer) {
    const up = ws.data.upstream;
    const chunk = typeof message === "string" ? message : Uint8Array.from(message);
    if (typeof message === "string" && message.includes("CloseStream")) ws.data.closed = true;
    if (up?.readyState === WebSocket.OPEN) up.send(chunk);
    else ws.data.waiting.push(chunk);
  },
  close(ws: ServerWebSocket<Listening>) {
    ws.data.closed = true;
    const up = ws.data.upstream;
    if (!up) return;
    if (up.readyState === WebSocket.OPEN) {
      // Ask Deepgram to finish what it heard, then hang up even if it doesn't.
      up.send(JSON.stringify({ type: "CloseStream" }));
      setTimeout(() => up.readyState === WebSocket.OPEN && up.close(), 3000);
    } else if (up.readyState === WebSocket.CONNECTING) up.onopen = () => up.close();
  },
};
