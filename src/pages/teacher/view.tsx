import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/router";

const SOFT_KEY = "ai_viva_soft_user";

export default function TeacherView() {
  const router = useRouter();
  const expId = (router.query.eid as string) || "";
  const [user, setUser] = useState<any | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [experiment, setExperiment] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [proctorEvents, setProctorEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const r = await supabase.auth.getSession();
        const sessionUser = r.data.session?.user ?? null;
        if (!mounted) return;

        if (sessionUser) {
          setUser(sessionUser);
          setLoadingAuth(false);
          return;
        }

        if (typeof window !== "undefined") {
          const raw = localStorage.getItem(SOFT_KEY);
          if (raw) {
            try {
              const u = JSON.parse(raw);
              if (u?.role === "teacher" && u?.email) {
                setUser({ email: u.email, soft: true });
                setLoadingAuth(false);
                return;
              }
            } catch {}
          }
        }

        setLoadingAuth(false);
        router.replace("/");
      } catch {
        setLoadingAuth(false);
        router.replace("/");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (!expId || !user?.email) return;

    (async () => {
      setLoading(true);
      try {
        const { data: exp } = await supabase.from("experiments").select("*").eq("id", expId).single();
        setExperiment(exp || null);

        const { data: q } = await supabase
          .from("questions")
          .select("*")
          .eq("experiment_id", expId)
          .order("sequence", { ascending: true });

        const { data: subs } = await supabase
          .from("submissions")
          .select("*")
          .eq("experiment_id", expId)
          .order("created_at", { ascending: false });

        const { data: events } = await supabase
          .from("proctor_events")
          .select("*")
          .eq("experiment_id", expId)
          .order("created_at", { ascending: false });

        setQuestions(q || []);
        setSubmissions(subs || []);
        setProctorEvents(events || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [expId, user?.email]);

  const questionMap = useMemo(() => {
    const map: Record<string, any> = {};
    questions.forEach((q) => {
      map[q.id] = q;
    });
    return map;
  }, [questions]);

  const groupedSubmissions = useMemo(() => {
    const map: Record<string, any[]> = {};
    submissions.forEach((sub) => {
      if (!map[sub.question_id]) map[sub.question_id] = [];
      map[sub.question_id].push(sub);
    });
    return map;
  }, [submissions]);

  const stats = useMemo(() => {
    const totalSubmissions = submissions.length;
    const totalMarks = submissions.reduce((sum, s) => sum + Number(s.marks_awarded || 0), 0);
    const maxMarks = questions.reduce((sum, q) => sum + Number(q.total_marks || 0), 0);
    const avgMarks = totalSubmissions ? (totalMarks / totalSubmissions).toFixed(2) : "0.00";
    return { totalSubmissions, totalMarks, maxMarks, avgMarks };
  }, [questions, submissions]);

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-6 py-10 text-slate-100">
        <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-4xl place-items-center">
          <div className="rounded-3xl border border-white/10 bg-white/10 px-6 py-4 shadow-2xl backdrop-blur-xl">
            Checking authentication…
          </div>
        </div>
      </div>
    );
  }

  if (!user?.email) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-6 py-10 text-slate-100">
        <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-4xl place-items-center">
          <div className="rounded-[2rem] border border-white/10 bg-white/10 p-8 shadow-2xl backdrop-blur-xl">
            <h2 className="text-2xl font-bold text-white">Teacher View</h2>
            <p className="mt-2 text-slate-300">You must be logged in as a teacher to access this page.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!expId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-6 py-10 text-slate-100">
        <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-4xl place-items-center">
          <div className="rounded-[2rem] border border-white/10 bg-white/10 p-8 shadow-2xl backdrop-blur-xl">
            <h2 className="text-2xl font-bold text-white">Missing experiment ID</h2>
            <p className="mt-2 text-slate-300">Open this page from the dashboard using a valid experiment.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-4 py-6 text-slate-100 md:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-200">
                Submission review
              </div>
              <h1 className="mt-2 text-4xl font-bold text-white">
                {experiment?.title || "Experiment"}{" "}
                <span className="text-slate-300">({expId})</span>
              </h1>
              <p className="mt-2 text-slate-300">
                Signed in as <span className="font-semibold text-white">{user.email}</span>
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Questions</div>
                <div className="mt-1 text-2xl font-bold text-white">{questions.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Submissions</div>
                <div className="mt-1 text-2xl font-bold text-white">{stats.totalSubmissions}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Marks</div>
                <div className="mt-1 text-2xl font-bold text-white">
                  {stats.totalMarks} / {stats.maxMarks}
                </div>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="rounded-[2rem] border border-white/10 bg-white/10 p-6 text-slate-300 shadow-2xl backdrop-blur-xl">
            Loading submissions...
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              {questions.length === 0 ? (
                <div className="rounded-[2rem] border border-white/10 bg-white/10 p-8 shadow-2xl backdrop-blur-xl">
                  <h2 className="text-2xl font-bold text-white">No questions yet</h2>
                  <p className="mt-2 text-slate-300">Create questions from the question builder first.</p>
                </div>
              ) : (
                questions.map((q, idx) => {
                  const subs = groupedSubmissions[q.id] || [];
                  return (
                    <div key={q.id} className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                            Question {idx + 1} · {q.question_type}
                          </div>
                          <h3 className="mt-1 text-2xl font-bold text-white">
                            {q.text_content || "No question text"}
                          </h3>
                          <p className="mt-2 text-sm text-slate-300">
                            Marks: {q.total_marks || 0}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
                          {subs.length} submission(s)
                        </div>
                      </div>

                      <div className="mt-5 space-y-3">
                        {subs.length === 0 ? (
                          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-slate-300">
                            No submissions for this question yet.
                          </div>
                        ) : (
                          subs.map((sub) => (
                            <div
                              key={sub.id}
                              className="rounded-3xl border border-white/10 bg-slate-950/40 p-4"
                            >
                              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                <div>
                                  <div className="text-sm font-semibold text-white">
                                    {sub.student_email}
                                  </div>
                                  <div className="text-xs text-slate-400">
                                    {new Date(sub.created_at).toLocaleString()}
                                  </div>
                                </div>
                                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-100">
                                  Marks: {sub.marks_awarded ?? 0}
                                </div>
                              </div>

                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                                    Transcript
                                  </div>
                                  <div className="mt-1 text-sm text-slate-200">
                                    {sub.transcript || "—"}
                                  </div>
                                </div>
                                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                                    MCQ / Audio
                                  </div>
                                  <div className="mt-1 text-sm text-slate-200">
                                    {sub.mcq_choice !== null && sub.mcq_choice !== undefined
                                      ? `Selected option index: ${sub.mcq_choice}`
                                      : sub.audio_path
                                      ? `Audio path: ${sub.audio_path}`
                                      : "—"}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="space-y-6">
              <div className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl">
                <div className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200">
                  Summary
                </div>
                <div className="mt-4 space-y-3 text-sm text-slate-300">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="font-semibold text-white">Average marks</div>
                    <div className="mt-1 text-lg text-cyan-200">{stats.avgMarks}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="font-semibold text-white">Total questions</div>
                    <div className="mt-1 text-lg text-cyan-200">{questions.length}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="font-semibold text-white">Teacher created</div>
                    <div className="mt-1 text-lg text-cyan-200">
                      {experiment?.created_at ? new Date(experiment.created_at).toLocaleString() : "—"}
                    </div>
                  </div>
                </div>

                <a
                  href="/teacher/dashboard"
                  className="mt-5 inline-flex rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Back to dashboard
                </a>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl">
                <div className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200">
                  Proctor events
                </div>
                <div className="mt-4 space-y-3">
                  {proctorEvents.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-slate-300">
                      No proctor events recorded.
                    </div>
                  ) : (
                    proctorEvents.slice(0, 12).map((ev) => (
                      <div key={ev.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-white">{ev.event_type}</div>
                            <div className="text-xs text-slate-400">
                              {new Date(ev.created_at).toLocaleString()}
                            </div>
                          </div>
                          <div className="text-sm text-slate-300">
                            {ev.student_email || "—"}
                          </div>
                        </div>
                        <pre className="mt-3 overflow-auto rounded-2xl bg-black/20 p-3 text-xs text-slate-300">
                          {JSON.stringify(ev.details || {}, null, 2)}
                        </pre>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl">
                <div className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200">
                  Questions map
                </div>
                <div className="mt-4 space-y-2 text-sm text-slate-300">
                  {questions.map((q, i) => (
                    <div key={q.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                      <div className="font-semibold text-white">
                        {i + 1}. {q.question_type}
                      </div>
                      <div className="mt-1 line-clamp-2">{q.text_content || "No text content"}</div>
                      <div className="mt-1 text-xs text-slate-400">ID: {q.id}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}