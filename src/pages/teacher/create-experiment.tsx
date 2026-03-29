import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/router";

export default function CreateExperiment() {
  const r = useRouter();
  const expId = (r.query.eid as string) || "";
  const [experiment, setExperiment] = useState<any>(null);
  const [questionType, setQuestionType] = useState("descriptive");
  const [textContent, setTextContent] = useState("");
  const [marks, setMarks] = useState(5);
  const [mcqOptions, setMcqOptions] = useState<string[]>(["Option A", "Option B"]);
  const [mcqCorrect, setMcqCorrect] = useState<number>(0);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!expId) return;
    (async () => {
      const { data } = await supabase.from("experiments").select("*").eq("id", expId).single();
      setExperiment(data);
    })();
  }, [expId]);

  async function uploadAudioAndCreateQuestion() {
    if (!expId) return alert("Missing experiment id in query string (eid).");

    if (questionType === "audio") {
      if (!file) return alert("Choose an audio file first.");
      setLoading(true);
      try {
        const path = `${expId}/${Date.now()}-${file.name}`;
        const { data, error: upErr } = await supabase.storage.from("questions").upload(path, file, {
          upsert: false,
        });
        if (upErr) return alert(upErr.message);

        const audioPath = data.path;
        const { error } = await supabase.from("questions").insert([
          {
            experiment_id: expId,
            question_type: "audio",
            audio_path: audioPath,
            total_marks: marks,
            text_content: textContent || null,
          },
        ]);

        if (error) alert(error.message);
        else {
          alert("Audio question added.");
          setTextContent("");
          setFile(null);
        }
      } finally {
        setLoading(false);
      }
    } else if (questionType === "mcq") {
      setLoading(true);
      try {
        const payload: any = {
          experiment_id: expId,
          question_type: "mcq",
          text_content: textContent || null,
          total_marks: marks,
          mcq_options: { options: mcqOptions, correct: mcqCorrect },
        };
        const { error } = await supabase.from("questions").insert([payload]);
        if (error) alert(error.message);
        else {
          alert("MCQ question added.");
          setTextContent("");
        }
      } finally {
        setLoading(false);
      }
    } else {
      setLoading(true);
      try {
        const payload: any = {
          experiment_id: expId,
          question_type: "descriptive",
          text_content: textContent,
          total_marks: marks,
        };
        const { error } = await supabase.from("questions").insert([payload]);
        if (error) alert(error.message);
        else {
          alert("Question added.");
          setTextContent("");
        }
      } finally {
        setLoading(false);
      }
    }
  }

  function addOption() {
    setMcqOptions((s) => [...s, `Option ${s.length + 1}`]);
  }

  function updateOption(idx: number, v: string) {
    setMcqOptions((s) => s.map((o, i) => (i === idx ? v : o)));
  }

  function removeOption(idx: number) {
    setMcqOptions((s) => s.filter((_, i) => i !== idx));
    setMcqCorrect((c) => (c === idx ? 0 : c > idx ? c - 1 : c));
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-4 py-6 text-slate-100 md:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-200">
              Question builder
            </div>
            <h2 className="text-3xl font-bold text-white">
              {experiment ? experiment.title : "Add questions"}{" "}
              <span className="text-slate-300">({expId})</span>
            </h2>
            <p className="text-slate-300">
              Add descriptive questions, MCQs with Google-Forms-like options, or audio prompts.
            </p>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5">
              <label className="block text-sm font-medium text-slate-200">Question type</label>
              <select
                value={questionType}
                onChange={(e) => setQuestionType(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition focus:border-cyan-400"
              >
                <option value="descriptive">Descriptive (text)</option>
                <option value="mcq">MCQ</option>
                <option value="audio">Audio question (teacher uploads file)</option>
              </select>

              {questionType === "descriptive" && (
                <div className="mt-5">
                  <label className="block text-sm font-medium text-slate-200">Question / model answer</label>
                  <textarea
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    className="mt-2 min-h-[220px] w-full rounded-2xl border border-white/10 bg-white/95 px-4 py-3 text-slate-900 outline-none transition focus:border-cyan-400"
                    rows={7}
                    placeholder="Write the question text or expected answer..."
                  />
                </div>
              )}

              {questionType === "mcq" && (
                <div className="mt-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-200">Question text (optional)</label>
                    <input
                      value={textContent}
                      onChange={(e) => setTextContent(e.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/95 px-4 py-3 text-slate-900 outline-none transition focus:border-cyan-400"
                      placeholder="Type the MCQ question..."
                    />
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
                      Options
                    </div>

                    <div className="space-y-3">
                      {mcqOptions.map((opt, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3"
                        >
                          <input
                            type="radio"
                            name="mcq-correct"
                            checked={mcqCorrect === idx}
                            onChange={() => setMcqCorrect(idx)}
                            className="h-4 w-4"
                          />
                          <input
                            value={opt}
                            onChange={(e) => updateOption(idx, e.target.value)}
                            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-white outline-none transition focus:border-cyan-400"
                          />
                          <button
                            onClick={() => removeOption(idx)}
                            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={addOption}
                      className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
                    >
                      Add option
                    </button>

                    <p className="mt-3 text-sm text-slate-300">
                      Choose the correct answer by selecting the radio button next to the option.
                    </p>
                  </div>
                </div>
              )}

              {questionType === "audio" && (
                <div className="mt-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-200">Upload audio file</label>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-200">Optional textual hint</label>
                    <input
                      value={textContent}
                      onChange={(e) => setTextContent(e.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/95 px-4 py-3 text-slate-900 outline-none transition focus:border-cyan-400"
                      placeholder="A hint or expected answer for evaluation..."
                    />
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-col gap-4 md:flex-row md:items-center">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-200">Total marks</label>
                  <input
                    type="number"
                    value={marks}
                    onChange={(e) => setMarks(Number(e.target.value))}
                    className="w-28 rounded-2xl border border-white/10 bg-white/95 px-4 py-3 text-slate-900 outline-none transition focus:border-cyan-400"
                  />
                </div>

                <button
                  onClick={uploadAudioAndCreateQuestion}
                  className="rounded-2xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={loading}
                >
                  {loading ? "Saving..." : "Add question"}
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
                Builder tips
              </div>

              <div className="mt-4 space-y-4 text-sm text-slate-300">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="font-semibold text-white">Descriptive</div>
                  <p className="mt-1">
                    Store the question text or expected answer in the field. The student response is compared using
                    client-side embeddings and cosine similarity.
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="font-semibold text-white">MCQ</div>
                  <p className="mt-1">
                    Add any number of options, then mark one correct answer using the radio selector.
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="font-semibold text-white">Audio</div>
                  <p className="mt-1">
                    Upload a teacher audio prompt. Students will speak their answer using Web Speech API.
                  </p>
                </div>
              </div>

              <a
                href="/teacher/dashboard"
                className="mt-6 inline-flex rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Back to dashboard
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}