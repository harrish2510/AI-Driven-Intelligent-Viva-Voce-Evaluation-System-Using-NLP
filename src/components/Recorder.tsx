import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    webkitSpeechRecognition?: any;
    SpeechRecognition?: any;
  }
}

/**
 * computeSimilarityShared:
 * - loads Universal Sentence Encoder
 * - computes cosine similarity
 * - converts similarity into marks
 * - returns 0 on any error
 */
export async function computeSimilarityShared(
  modelAnswer: string,
  studentText: string,
  totalMarks?: number
) {
  try {
    const answer = (modelAnswer || "").trim();
    const student = (studentText || "").trim();

    if (!answer || !student) return 0;

    try {
      // @ts-ignore - optional dependency
      await import("@tensorflow/tfjs");
    } catch {
      // optional dependency; continue anyway
    }

    const use = await import("@tensorflow-models/universal-sentence-encoder");
    if (!use || typeof use.load !== "function") {
      console.warn("universal-sentence-encoder not available");
      return 0;
    }

    const model = await use.load();
    const embeddings = await model.embed([answer, student]);
    const arr = await embeddings.array();
    const e0 = arr[0];
    const e1 = arr[1];

    let dot = 0,
      n0 = 0,
      n1 = 0;
    for (let i = 0; i < e0.length; i++) {
      dot += e0[i] * e1[i];
      n0 += e0[i] * e0[i];
      n1 += e1[i] * e1[i];
    }

    const sim = dot / (Math.sqrt(n0) * Math.sqrt(n1));
    const marks = Math.max(0, Math.round(((sim + 1) / 2) * (totalMarks || 5)));
    return marks;
  } catch (err) {
    console.warn("computeSimilarityShared failed:", err);
    return 0;
  }
}

export default function Recorder({
  onSubmit,
  modelAnswer,
  totalMarks,
  allowText = false,
}: {
  onSubmit: (transcript: string, audioPath?: string, marks?: number) => void;
  modelAnswer?: string;
  totalMarks?: number;
  allowText?: boolean;
}) {
  const [recState, setRecState] = useState<"idle" | "recording">("idle");
  const recognitionRef = useRef<any>(null);
  const [transcript, setTranscript] = useState("");
  const [similarity, setSimilarity] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const SpeechRecognition =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (!SpeechRecognition) {
      recognitionRef.current = null;
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (e: any) => {
      const text = Array.from(e.results)
        .map((r: any) => r[0].transcript)
        .join(" ");
      setTranscript(text);
    };
    recognition.onerror = (ev: any) => console.error("speech error", ev);
    recognitionRef.current = recognition;
  }, []);

  async function computeSimilarity(studentText: string) {
    if (!modelAnswer) {
      setSimilarity(null);
      return 0;
    }
    setBusy(true);
    const marks = await computeSimilarityShared(modelAnswer, studentText, totalMarks);
    setSimilarity(null);
    setBusy(false);
    return marks;
  }

  function start() {
    if (!recognitionRef.current) {
      return alert("SpeechRecognition is not supported in this browser. Use Chrome or Edge.");
    }
    setRecState("recording");
    setTranscript("");
    recognitionRef.current.start();
  }

  function stop() {
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
    setRecState("idle");
  }

  async function submitVoice() {
    const clean = transcript.trim();
    const marks = await computeSimilarity(clean);
    onSubmit(clean, undefined, marks);
  }

  async function submitText() {
    const clean = transcript.trim();
    const marks = await computeSimilarity(clean);
    onSubmit(clean, undefined, marks);
  }

  return (
    <div className="mt-3">
      {allowText ? (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-slate-200">Your answer (text)</label>
          <textarea
            className="min-h-[180px] w-full rounded-2xl border border-white/10 bg-white/95 px-4 py-3 text-slate-900 outline-none transition focus:border-cyan-400"
            rows={5}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Type your answer..."
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              onClick={submitText}
              className="rounded-2xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
            >
              {busy ? "Evaluating..." : "Submit answer"}
            </button>
            <div className="text-sm text-slate-300">
              Similarity: {similarity === null ? "—" : similarity.toFixed(3)}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-4">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
              Speech transcript
            </div>
            <div className="mt-2 rounded-2xl border border-white/10 bg-white/5 p-4 text-white">
              {transcript || "—"}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            {recState === "idle" ? (
              <button
                onClick={start}
                className="rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400"
              >
                Start recording
              </button>
            ) : (
              <button
                onClick={stop}
                className="rounded-2xl bg-rose-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-rose-400"
              >
                Stop recording
              </button>
            )}

            <button
              onClick={submitVoice}
              className="rounded-2xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
            >
              {busy ? "Evaluating..." : "Submit answer"}
            </button>
          </div>

          <div className="text-sm text-slate-300">
            Similarity: {similarity === null ? "—" : similarity.toFixed(3)}
          </div>
        </div>
      )}
    </div>
  );
}