import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Proctor from "@/components/Proctor";
import Recorder, { computeSimilarityShared } from "@/components/Recorder";
import { useRouter } from "next/router";

const SOFT_KEY = "ai_viva_soft_user";
const START_KEY_PREFIX = "ai_viva_exam_start_";
const LOCK_KEY_PREFIX = "ai_viva_exam_lock_";

type StudentSession = {
  id?: string;
  email?: string;
  soft?: boolean;
  role?: "student" | "teacher";
};

function formatTime(totalSeconds: number | null) {
  if (totalSeconds === null) return "—";
  const safe = Math.max(0, totalSeconds);
  const min = Math.floor(safe / 60);
  const sec = safe % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function Attend() {
  const [expInput, setExpInput] = useState("");
  const [experiment, setExperiment] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [sessionUser, setSessionUser] = useState<StudentSession | null>(null);
  const [approvedForExperiment, setApprovedForExperiment] = useState<boolean | null>(null);
  const [loadingJoin, setLoadingJoin] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [selectedMcq, setSelectedMcq] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [examLocked, setExamLocked] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const [timeExpired, setTimeExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const timerRef = useRef<number | null>(null);
  const router = useRouter();
  const autoEid =
    typeof router.query.eid === "string"
      ? router.query.eid
      : Array.isArray(router.query.eid)
      ? router.query.eid[0]
      : "";

  const normalizedEmail = (sessionUser?.email || "").trim().toLowerCase();

  function startKey(expId: string, email: string) {
    return `${START_KEY_PREFIX}${expId}_${email}`;
  }

  function lockKey(expId: string, email: string) {
    return `${LOCK_KEY_PREFIX}${expId}_${email}`;
  }

  function readStoredLock(expId: string, email: string) {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(lockKey(expId, email));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { locked: boolean; reason?: string; eventType?: string; lockedAt?: number };
    } catch {
      return null;
    }
  }

  function persistLock(expId: string, email: string, reason: string, eventType: string, details: any = {}) {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        lockKey(expId, email),
        JSON.stringify({
          locked: true,
          reason,
          eventType,
          lockedAt: Date.now(),
          details,
        })
      );
    }
  }

  async function logProctorEvent(eventType: string, details: any = {}) {
    try {
      await fetch("/api/proctor-event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          experiment_id: experiment?.id || null,
          student_user_id: sessionUser?.id || null,
          student_email: normalizedEmail || null,
          event_type: eventType,
          details,
        }),
      });
    } catch (e) {
      console.warn("proctor log failed", e);
    }
  }

  async function lockExam(reason: string, eventType: string, details: any = {}) {
    if (!experiment?.id || !normalizedEmail) {
      setExamLocked(true);
      setLockReason(reason);
      return;
    }

    if (examLocked) return;

    setExamLocked(true);
    setLockReason(reason);
    setApprovedForExperiment(true);
    persistLock(experiment.id, normalizedEmail, reason, eventType, details);
    await logProctorEvent(eventType, { reason, ...details });
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const r = await supabase.auth.getSession();
        const supaUser = r.data.session?.user ?? null;

        if (!mounted) return;

        if (supaUser) {
          setSessionUser({
            id: supaUser.id,
            email: supaUser.email,
            role: "student",
          });
        } else if (typeof window !== "undefined") {
          const raw = localStorage.getItem(SOFT_KEY);
          if (raw) {
            try {
              const u = JSON.parse(raw);
              if (u?.email) {
                setSessionUser({ email: u.email, soft: true, role: u.role || "student" });
              }
            } catch {
              setSessionUser(null);
            }
          }
        }
      } catch (err) {
        console.error("session load", err);
      }
    })();

    if (autoEid) setExpInput(autoEid);

    return () => {
      mounted = false;
    };
  }, [autoEid]);

  useEffect(() => {
    if (!experiment || !normalizedEmail) return;

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const lock = readStoredLock(experiment.id, normalizedEmail);
    if (lock?.locked) {
      setExamLocked(true);
      setLockReason(lock.reason || "Exam locked");
      return;
    }

    const durationMinutes = Number(experiment.duration_minutes || 0);
    if (!durationMinutes || durationMinutes <= 0) {
      setRemainingSeconds(null);
      return;
    }

    const durationMs = durationMinutes * 60 * 1000;
    const key = startKey(experiment.id, normalizedEmail);
    let startedAt = Number(localStorage.getItem(key));

    if (!startedAt) {
      startedAt = Date.now();
      localStorage.setItem(key, String(startedAt));
    }

    const tick = async () => {
      const elapsedMs = Date.now() - startedAt;
      const remaining = Math.max(0, Math.floor((durationMs - elapsedMs) / 1000));
      setRemainingSeconds(remaining);

      if (remaining <= 0) {
        setTimeExpired(true);
        await lockExam("Exam time expired", "time_expired", { startedAt, durationMs });
      }
    };

    tick();
    timerRef.current = window.setInterval(tick, 1000);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiment?.id, experiment?.duration_minutes, normalizedEmail]);

  async function loadExperimentProgress(expData: any, normalized: string) {
    const qresp = await supabase
      .from("questions")
      .select("*")
      .eq("experiment_id", expData.id)
      .order("sequence", { ascending: true });

    const qs = qresp.data || [];
    setQuestions(qs);

    const subsResp = await supabase
      .from("submissions")
      .select("question_id")
      .eq("experiment_id", expData.id)
      .eq("student_email", normalized);

    const answeredIds = new Set((subsResp.data || []).map((s: any) => s.question_id));
    const firstUnanswered = qs.findIndex((qq: any) => !answeredIds.has(qq.id));

    if (firstUnanswered === -1) {
      setCurrentIndex(qs.length);
    } else {
      setCurrentIndex(firstUnanswered);
    }
  }

  async function joinExperiment(expIdOverride?: string) {
    const expCode = (expIdOverride || expInput || "").trim();

    if (!sessionUser?.email) {
      return alert("Please login using the homepage first.");
    }

    if (!expCode) {
      return alert("Enter the experiment ID.");
    }

    setLoadingJoin(true);
    try {
      const { data: expData, error } = await supabase
        .from("experiments")
        .select("*")
        .eq("experiment_id", expCode)
        .single();

      if (error || !expData) {
        setLoadingJoin(false);
        return alert("Experiment not found.");
      }

      setExperiment(expData);

      const normalized = sessionUser.email.trim().toLowerCase();
      const { data: rows } = await supabase
        .from("experiment_approved_emails")
        .select("email")
        .eq("experiment_id", expData.id)
        .eq("email", normalized);

      if (!rows || rows.length === 0) {
        setApprovedForExperiment(false);
        setLoadingJoin(false);
        alert("You are not approved for this experiment. Contact your teacher.");
        return;
      }

      setApprovedForExperiment(true);
      await loadExperimentProgress(expData, normalized);

      const lock = readStoredLock(expData.id, normalized);
      if (lock?.locked) {
        setExamLocked(true);
        setLockReason(lock.reason || "Exam locked");
      } else {
        setExamLocked(false);
        setLockReason("");
      }

      setLoadingJoin(false);
    } catch (err: any) {
      setLoadingJoin(false);
      console.error(err);
      alert("Join failed: " + (err?.message || err));
    }
  }

  useEffect(() => {
    if (autoEid && sessionUser && !experiment && !loadingJoin) {
      joinExperiment(autoEid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEid, sessionUser]);

  useEffect(() => {
    setTypedAnswer("");
    setSelectedMcq(null);
  }, [currentIndex]);

  async function refreshProgressAfterSubmission() {
    if (!experiment?.id || !normalizedEmail) return;
    await loadExperimentProgress(experiment, normalizedEmail);
  }

  async function submitAnswer(
    questionId: string,
    transcript: string,
    audioPath?: string,
    mcqChoice?: number,
    marksAwarded?: number
  ) {
    if (!experiment?.id) return;
    if (examLocked || timeExpired) {
      return alert("This exam is locked or time has expired.");
    }

    setSubmitting(true);
    try {
      const payload = {
        experiment_id: experiment.id,
        question_id: questionId,
        student_user_id: sessionUser?.id || null,
        student_email: normalizedEmail,
        transcript,
        audio_path: audioPath || null,
        mcq_choice: mcqChoice ?? null,
        marks_awarded: marksAwarded ?? 0,
      };

      const res = await fetch("/api/save-submission", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          alert(j.error || "This question has already been submitted.");
          await refreshProgressAfterSubmission();
          return;
        }
        alert("Error saving: " + (j.error || "Unknown error"));
        return;
      }

      alert("Answer submitted.");
      await refreshProgressAfterSubmission();
    } finally {
      setSubmitting(false);
    }
  }

  if (!sessionUser?.email) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-6 py-10 text-slate-100">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center justify-center">
          <div className="rounded-[2rem] border border-white/10 bg-white/10 p-8 shadow-2xl backdrop-blur-xl">
            <h2 className="text-2xl font-bold text-white">Join Exam</h2>
            <p className="mt-2 text-sm text-slate-300">
              Please login from the homepage using your institutional email first.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!experiment) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-6 py-10 text-slate-100">
        <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-4xl place-items-center">
          <div className="w-full rounded-[2rem] border border-white/10 bg-white/10 p-8 shadow-2xl backdrop-blur-xl">
            <div className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-200">
              Student Portal
            </div>
            <h2 className="mt-2 text-3xl font-bold text-white">Join your viva examination</h2>
            <p className="mt-3 text-slate-300">
              Enter the experiment ID shared by your teacher. Your email must be approved for this test.
            </p>

            <div className="mt-6 grid gap-3 md:grid-cols-[1fr_auto]">
              <input
                value={expInput}
                onChange={(e) => setExpInput(e.target.value)}
                placeholder="Experiment ID"
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
              />
              <button
                onClick={() => joinExperiment()}
                className="rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loadingJoin}
              >
                {loadingJoin ? "Joining..." : "Join exam"}
              </button>
            </div>

            <div className="mt-5 rounded-3xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
              The timer starts the moment you successfully enter the exam.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-6 py-10 text-slate-100">
        <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-4xl place-items-center">
          <div className="rounded-[2rem] border border-white/10 bg-white/10 p-8 shadow-2xl backdrop-blur-xl">
            <h3 className="text-2xl font-bold text-white">{experiment.title}</h3>
            <p className="mt-2 text-slate-300">This exam has no questions uploaded yet.</p>
          </div>
        </div>
      </div>
    );
  }

  if (examLocked || timeExpired) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-6 py-10 text-slate-100">
        <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-4xl place-items-center">
          <div className="w-full rounded-[2rem] border border-rose-400/20 bg-rose-500/10 p-8 shadow-2xl backdrop-blur-xl">
            <div className="text-sm font-semibold uppercase tracking-[0.25em] text-rose-200">
              Exam locked
            </div>
            <h2 className="mt-2 text-3xl font-bold text-white">{experiment.title}</h2>
            <p className="mt-3 text-slate-200">{lockReason || "This exam is no longer available."}</p>
            <div className="mt-5 rounded-3xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
              Suspicious events are recorded in the database. Please contact your teacher.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (currentIndex >= questions.length) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-6 py-10 text-slate-100">
        <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-4xl place-items-center">
          <div className="w-full rounded-[2rem] border border-emerald-400/20 bg-emerald-500/10 p-8 shadow-2xl backdrop-blur-xl">
            <div className="text-sm font-semibold uppercase tracking-[0.25em] text-emerald-200">
              Completed
            </div>
            <h2 className="mt-2 text-3xl font-bold text-white">{experiment.title}</h2>
            <p className="mt-3 text-slate-200">
              You have answered all available questions. Your teacher can now review the scores and proctor events.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const q = questions[currentIndex];
  const audioPublicUrl =
    q.question_type === "audio" && q.audio_path
      ? supabase.storage.from("questions").getPublicUrl(q.audio_path).data.publicUrl
      : "";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-4 py-6 text-slate-100 md:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-[2rem] border border-white/10 bg-white/10 p-5 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-200">
                Student exam room
              </div>
              <h1 className="mt-2 text-3xl font-bold text-white">{experiment.title}</h1>
              <p className="mt-1 text-sm text-slate-300">
                Logged in as <span className="font-semibold text-white">{normalizedEmail}</span>
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Experiment ID</div>
                <div className="mt-1 font-semibold text-white">{experiment.experiment_id}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Time left</div>
                <div className="mt-1 font-semibold text-white">
                  {remainingSeconds === null ? "—" : formatTime(remainingSeconds)}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Progress</div>
                <div className="mt-1 font-semibold text-white">
                  {currentIndex + 1} / {questions.length}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
              Do not switch tabs or open developer tools.
            </div>
            <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Tab focus loss locks the exam and logs a proctor event.
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
              Audio and face checks run while the exam is active.
            </div>
          </div>
        </div>

        {approvedForExperiment === false && (
          <div className="rounded-3xl border border-amber-400/20 bg-amber-500/10 p-4 text-amber-100">
            Access denied: your email is not approved for this experiment.
          </div>
        )}

        {approvedForExperiment === true && (
          <>
            <Proctor
              experimentId={experiment.id}
              active={!examLocked && !timeExpired}
              onViolation={async (eventType, details) => {
                if (eventType === "context_menu_blocked") {
                  return;
                }
                await lockExam(`Suspicious activity detected: ${eventType}`, eventType, details);
              }}
            />

            <div className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-200">
                    Question {currentIndex + 1}
                  </div>
                  <h2 className="mt-2 text-2xl font-bold text-white capitalize">
                    {q.question_type} question
                  </h2>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
                  Duration monitor is active
                </div>
              </div>

              <div className="mt-6 rounded-3xl border border-white/10 bg-slate-950/40 p-5">
                {q.question_type === "descriptive" && (
                  <>
                    <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
                      Descriptive
                    </div>
                    <div className="mt-3 text-lg text-white">{q.text_content}</div>
                    <div className="mt-5">
                      <label className="mb-2 block text-sm font-medium text-slate-200">
                        Type your answer
                      </label>
                      <textarea
                        value={typedAnswer}
                        onChange={(e) => setTypedAnswer(e.target.value)}
                        className="min-h-[180px] w-full rounded-2xl border border-white/10 bg-white/95 px-4 py-3 text-slate-900 outline-none transition focus:border-cyan-400"
                        placeholder="Write your answer here..."
                        rows={7}
                        disabled={submitting}
                      />
                    </div>
                    <div className="mt-4">
                      <button
                        onClick={async () => {
                          if (examLocked || timeExpired) return;
                          const marks = await computeSimilarityShared(
                            q.text_content || "",
                            typedAnswer || "",
                            q.total_marks
                          );
                          await submitAnswer(q.id, typedAnswer || "", undefined, undefined, marks);
                          setTypedAnswer("");
                        }}
                        className="rounded-2xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={submitting || examLocked || timeExpired}
                      >
                        {submitting ? "Submitting..." : "Submit Answer"}
                      </button>
                    </div>
                  </>
                )}

                {q.question_type === "mcq" && (
                  <>
                    <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
                      MCQ
                    </div>
                    <div className="mt-3 text-lg text-white">
                      {q.text_content || "Choose the correct answer."}
                    </div>
                    <MCQBlock
                      q={q}
                      disabled={submitting}
                      selected={selectedMcq}
                      setSelected={setSelectedMcq}
                      onSubmit={(choice, marks) => submitAnswer(q.id, "", undefined, choice, marks)}
                    />
                  </>
                )}

                {q.question_type === "audio" && (
                  <>
                    <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
                      Audio prompt
                    </div>
                    <div className="mt-3 text-lg text-white">
                      {q.text_content || "Listen to the teacher’s audio question and answer verbally."}
                    </div>
                    {audioPublicUrl ? (
                      <div className="mt-4">
                        <audio controls src={audioPublicUrl} className="w-full" />
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-amber-100">
                        No public audio file was found for this question.
                      </div>
                    )}
                    <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4">
                      <Recorder
                        onSubmit={(transcript, audioPath, marks) =>
                          submitAnswer(q.id, transcript, audioPath, undefined, marks)
                        }
                        modelAnswer={q.text_content || ""}
                        totalMarks={q.total_marks}
                        allowText={false}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MCQBlock({
  q,
  onSubmit,
  disabled,
  selected,
  setSelected,
}: {
  q: any;
  onSubmit: (choice: number, marks: number) => void;
  disabled?: boolean;
  selected: number | null;
  setSelected: React.Dispatch<React.SetStateAction<number | null>>;
}) {
  const opts = q.mcq_options?.options || [];

  return (
    <div className="mt-6 space-y-3">
      <div className="grid gap-3">
        {opts.map((o: string, idx: number) => {
          const active = selected === idx;
          return (
            <button
              key={idx}
              onClick={() => setSelected(idx)}
              disabled={disabled}
              className={[
                "w-full rounded-2xl border px-4 py-4 text-left transition",
                active
                  ? "border-cyan-400 bg-cyan-500/20 text-white"
                  : "border-white/10 bg-white/5 text-slate-200 hover:border-cyan-300/60 hover:bg-white/10",
              ].join(" ")}
            >
              <span className="mr-3 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/20 text-sm font-semibold">
                {String.fromCharCode(65 + idx)}
              </span>
              {o}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
        <button
          onClick={() => {
            if (selected === null) return;
            const isCorrect = selected === q.mcq_options?.correct;
            onSubmit(selected, isCorrect ? q.total_marks : 0);
          }}
          className="rounded-2xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled || selected === null}
        >
          Submit selected answer
        </button>

        <div className="text-sm text-slate-300">
          Select one option, then submit. Already submitted questions are blocked by the backend.
        </div>
      </div>
    </div>
  );
}