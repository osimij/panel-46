// Speaking to FRIDAY instead of typing. The mic button beside Send listens, and the words
// appear in the message box as they're said (Deepgram's Nova-3, through Panel's server:
// server/voice.ts). Nothing is sent on its own: the designer reads it, fixes it, sends it.
//
// The box holds what was there before, then the settled words, then the words still being
// heard (they can still change). If the designer types or sends while it listens, what's in
// the box becomes the new start and listening carries on after it.

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.tsx";
import { prefersReducedMotion } from "./api.ts";

const LANGS = [
  { id: "en", name: "English" },
  { id: "ru", name: "Russian" },
] as const;
type Lang = (typeof LANGS)[number]["id"];
const LS_LANG = "panel.voice.lang";
const readLang = (): Lang => {
  try {
    const v = localStorage.getItem(LS_LANG);
    return LANGS.some((l) => l.id === v) ? (v as Lang) : "en";
  } catch {
    return "en";
  }
};

type State = "off" | "starting" | "on" | "finishing";
/** One stretch of listening: the connection, the microphone, and the words so far. */
interface Live {
  ws: WebSocket;
  recorder?: MediaRecorder;
  stream?: MediaStream;
  audio?: AudioContext;
  frame?: number;
  base: string;
  said: string;
  hearing: string;
  wrote: string;
  then?: () => void;
}
const join = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join(" ");

export function MicButton(props: {
  value: string;
  setValue: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [state, setState] = useState<State>("off");
  const [lang, setLang] = useState<Lang>(readLang);
  const [problem, setProblem] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const live = useRef<Live | null>(null);
  /** Whether this listening is still the current one (not stopped and replaced). */
  const isMine = (l: unknown) => live.current === l;
  const valueNow = useRef(props.value);
  valueNow.current = props.value;

  const write = () => {
    const l = live.current;
    if (!l) return;
    // The designer changed the box (typed, or sent it): their text is the new start.
    if (valueNow.current !== l.wrote) {
      l.base = valueNow.current;
      l.said = "";
    }
    l.wrote = join(l.base, l.said, l.hearing);
    props.setValue(l.wrote);
  };

  const end = () => {
    const l = live.current;
    if (!l) return;
    live.current = null;
    if (l.frame) cancelAnimationFrame(l.frame);
    void l.audio?.close().catch(() => {});
    l.stream?.getTracks().forEach((t) => t.stop());
    if (l.recorder?.state === "recording") l.recorder.stop();
    if (l.ws.readyState <= 1) l.ws.close();
    // Words still being heard when it stopped are kept as they were.
    if (l.hearing) {
      l.said = join(l.said, l.hearing);
      l.hearing = "";
      write();
    }
    setState("off");
    button.current?.style.removeProperty("--level");
    const box = props.inputRef.current;
    if (box) {
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }
    l.then?.();
  };

  const start = async (as: Lang = lang) => {
    if (live.current) return;
    setProblem("");
    setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setState("off");
      setProblem("Allow the microphone in the address bar to speak.");
      return;
    }
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/listen?lang=${as}`);
    const l: Live = { ws, stream, base: valueNow.current, said: "", hearing: "", wrote: valueNow.current };
    live.current = l;

    ws.onopen = () => {
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      l.recorder = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size && ws.readyState === 1) ws.send(e.data);
      };
      // Once the last sound is sent, Deepgram is asked to finish; it answers, then hangs up.
      recorder.onstop = () => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: "CloseStream" }));
      };
      recorder.start(200);
      setState("on");
      meter(l);
    };
    ws.onmessage = (e) => {
      let m: { type?: string; is_final?: boolean; error?: string; channel?: { alternatives?: { transcript?: string }[] } };
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.type === "Panel" && m.error) return setProblem(m.error);
      if (m.type !== "Results" || !isMine(l)) return;
      const words = m.channel?.alternatives?.[0]?.transcript ?? "";
      if (m.is_final) {
        l.said = join(l.said, words);
        l.hearing = "";
      } else l.hearing = words;
      write();
    };
    ws.onerror = () => setProblem("Couldn't start listening. Is Panel running?");
    ws.onclose = () => {
      if (isMine(l)) end();
    };
  };

  /** The button swells a little with the voice, so it's plain that Panel hears it. */
  const meter = (l: Live) => {
    if (prefersReducedMotion() || !l.stream) return;
    try {
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(l.stream).connect(analyser);
      l.audio = audio;
      const data = new Uint8Array(analyser.fftSize);
      let level = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        const now = Math.min(1, Math.sqrt(sum / data.length) * 5);
        level += (now - level) * (now > level ? 0.5 : 0.12);
        button.current?.style.setProperty("--level", level.toFixed(3));
        l.frame = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // No meter is fine; listening still works.
    }
  };

  const stop = (then?: () => void) => {
    const l = live.current;
    if (!l) return then?.();
    l.then = then;
    setState("finishing");
    if (l.frame) cancelAnimationFrame(l.frame);
    if (l.recorder?.state === "recording") l.recorder.stop();
    else if (l.ws.readyState <= 1) l.ws.close();
    // Deepgram usually answers within a moment; don't wait on it forever.
    setTimeout(() => live.current === l && end(), 4000);
  };

  const switchLang = () => {
    const next = LANGS[(LANGS.findIndex((x) => x.id === lang) + 1) % LANGS.length]!.id;
    setLang(next);
    try {
      localStorage.setItem(LS_LANG, next);
    } catch {}
    if (live.current) stop(() => void start(next));
  };

  // Leaving FRIDAY's panel stops listening and lets go of the microphone.
  useEffect(() => () => {
    const l = live.current;
    if (!l) return;
    live.current = null;
    if (l.frame) cancelAnimationFrame(l.frame);
    void l.audio?.close().catch(() => {});
    l.stream?.getTracks().forEach((t) => t.stop());
    if (l.ws.readyState <= 1) l.ws.close();
  }, []);

  const on = state !== "off";
  const langName = LANGS.find((x) => x.id === lang)!.name;
  return (
    <>
      {problem && !on && <span className="composer-voice-problem" role="status">{problem}</span>}
      {on && (
        <button className="composer-voice-lang" onClick={switchLang} title={`Listening for ${langName}. Click for ${LANGS.find((x) => x.id !== lang)!.name}.`}>
          {lang.toUpperCase()}
        </button>
      )}
      <button
        ref={button}
        className={`composer-btn mic ${state}`}
        onClick={() => (state === "off" ? void start() : state === "on" || state === "starting" ? stop() : undefined)}
        aria-label={on ? "Stop listening" : "Speak instead of typing"}
        aria-pressed={on}
        title={on ? "Stop listening" : `Speak instead of typing (${langName})`}
      >
        <Icon name="mic" size={15} />
      </button>
    </>
  );
}
