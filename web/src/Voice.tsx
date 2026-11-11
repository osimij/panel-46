// Speaking to FRIDAY instead of typing. The mic button beside Send listens (Deepgram's Nova-3,
// through Panel's server: server/voice.ts). While it listens, a row of small waves beside it
// moves with the voice, so it's plain whether Panel hears anything; the message box is left
// alone. Clicking the mic again stops, and the whole of what was said lands in the box at once,
// after whatever was already there. Nothing is sent on its own: the designer reads it, fixes
// it, sends it.

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.tsx";

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

/** How many bars the waves show, and how often a new one comes in on the right. */
const BARS = 22;
const STEP_MS = 75;

type State = "off" | "starting" | "on" | "finishing";
/** One stretch of listening: the connection, the microphone, and the words so far. */
interface Live {
  ws: WebSocket;
  recorder?: MediaRecorder;
  stream?: MediaStream;
  audio?: AudioContext;
  frame?: number;
  /** Words Deepgram has settled on, and the words it's still hearing (they can still change). */
  said: string;
  hearing: string;
  /** Whether something went wrong, so "didn't hear anything" isn't said on top of it. */
  failed?: boolean;
  then?: () => void;
}
const join = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join(" ");

export function MicButton(props: {
  value: string;
  setValue: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Told when listening starts and stops, so the box can say it's listening. */
  onListening?: (on: boolean) => void;
}) {
  const [state, setState] = useState<State>("off");
  const [lang, setLang] = useState<Lang>(readLang);
  const [problem, setProblem] = useState("");
  const waves = useRef<HTMLSpanElement>(null);
  const live = useRef<Live | null>(null);
  /** Whether this listening is still the current one (not stopped and replaced). */
  const isMine = (l: unknown) => live.current === l;
  const valueNow = useRef(props.value);
  valueNow.current = props.value;
  const onListening = useRef(props.onListening);
  onListening.current = props.onListening;

  const end = () => {
    const l = live.current;
    if (!l) return;
    live.current = null;
    if (l.frame) cancelAnimationFrame(l.frame);
    void l.audio?.close().catch(() => {});
    l.stream?.getTracks().forEach((t) => t.stop());
    if (l.recorder?.state === "recording") l.recorder.stop();
    if (l.ws.readyState <= 1) l.ws.close();
    setState("off");
    onListening.current?.(false);
    // Everything that was said goes into the box in one piece, after what's already there.
    // Words still being heard when it stopped are kept as they were.
    const words = join(l.said, l.hearing);
    if (words) props.setValue(join(valueNow.current, words));
    else if (!l.failed) setProblem("Didn't hear anything.");
    const box = props.inputRef.current;
    if (box) {
      box.focus();
      // The box takes the new words on the next render; put the cursor after them.
      requestAnimationFrame(() => box.setSelectionRange(box.value.length, box.value.length));
    }
    l.then?.();
  };

  const start = async (as: Lang = lang) => {
    if (live.current) return;
    setProblem("");
    setState("starting");
    onListening.current?.(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setState("off");
      onListening.current?.(false);
      setProblem("Allow the microphone in the address bar to speak.");
      return;
    }
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/listen?lang=${as}`);
    const l: Live = { ws, stream, said: "", hearing: "" };
    live.current = l;
    // The waves start with the microphone, before Deepgram answers, so the first words show too.
    meter(l);

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
      if (isMine(l)) setState("on");
    };
    ws.onmessage = (e) => {
      let m: { type?: string; is_final?: boolean; error?: string; channel?: { alternatives?: { transcript?: string }[] } };
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.type === "Panel" && m.error) {
        l.failed = true;
        return setProblem(m.error);
      }
      if (m.type !== "Results" || !isMine(l)) return;
      const words = m.channel?.alternatives?.[0]?.transcript ?? "";
      if (m.is_final) {
        l.said = join(l.said, words);
        l.hearing = "";
      } else l.hearing = words;
    };
    ws.onerror = () => {
      l.failed = true;
      setProblem("Couldn't start listening. Is Panel running?");
    };
    ws.onclose = () => {
      if (isMine(l)) end();
    };
  };

  /** The waves: a new bar on the right every moment, as tall as the voice was loud, the older
   *  ones moving left. Silence shows as small dots. They're how the designer knows Panel hears
   *  them, so they move even when motion is reduced (there's no easing on them then). */
  const meter = (l: Live) => {
    const bars = waves.current ? ([...waves.current.children] as HTMLElement[]) : [];
    if (!l.stream || !bars.length) return;
    try {
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(l.stream).connect(analyser);
      l.audio = audio;
      const data = new Uint8Array(analyser.fftSize);
      const heights: number[] = Array(bars.length).fill(0);
      let loudest = 0;
      let last = performance.now();
      const tick = (now: number) => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        loudest = Math.max(loudest, Math.sqrt(sum / data.length));
        if (now - last >= STEP_MS) {
          last = now;
          // Quiet room noise stays a dot; a normal voice fills most of the height.
          const level = loudest < 0.012 ? 0 : Math.min(1, Math.pow(loudest * 5.5, 0.75));
          loudest = 0;
          heights.shift();
          heights.push(level);
          bars.forEach((b, i) => b.style.setProperty("--h", heights[i]!.toFixed(2)));
        }
        l.frame = requestAnimationFrame(tick);
      };
      l.frame = requestAnimationFrame(tick);
    } catch {
      // No waves is fine; listening still works.
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
        <span ref={waves} className={`composer-voice-waves ${state}`} aria-hidden="true">
          {Array.from({ length: BARS }, (_, i) => (
            <i key={i} />
          ))}
        </span>
      )}
      {on && (
        <button className="composer-voice-lang" onClick={switchLang} title={`Listening for ${langName}. Click for ${LANGS.find((x) => x.id !== lang)!.name}.`}>
          {lang.toUpperCase()}
        </button>
      )}
      <button
        className={`composer-btn mic ${state}`}
        onClick={() => (state === "off" ? void start() : state === "on" || state === "starting" ? stop() : undefined)}
        aria-label={on ? "Stop listening and write it in" : "Speak instead of typing"}
        aria-pressed={on}
        title={on ? "Stop listening and write it in" : `Speak instead of typing (${langName})`}
      >
        <Icon name="mic" size={15} />
      </button>
    </>
  );
}
