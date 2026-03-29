import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/router";

const SOFT_KEY = "ai_viva_soft_user";

export default function TeacherDashboard() {
  const [user, setUser] = useState<any | null>(null);
  const [experiments, setExperiments] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [expId, setExpId] = useState("");
  const [totalQuestions, setTotalQuestions] = useState<number>(0);
  const [totalScore, setTotalScore] = useState<number>(0);
  const [approvedEmailsText, setApprovedEmailsText] = useState<string>("");
  const [durationMinutes, setDurationMinutes] = useState<number>(0);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [saving, setSaving] = useState(false);

  const router = useRouter();

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
          fetchExps();
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
                fetchExps();
                return;
              }
            } catch {}
          }
        }

        setLoadingAuth(false);
        router.replace("/");
      } catch (err) {
        console.error("auth check error", err);
        setLoadingAuth(false);
        router.replace("/");
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchExps() {
    const { data } = await supabase.from("experiments").select("*").order("created_at", { ascending: false });
    setExperiments(data || []);
  }

  const stats = useMemo(() => {
    const total = experiments.length;
    const activeIds = experiments.filter((e) => e.experiment_id).length;
    return { total, activeIds };
  }, [experiments]);

  async function createExperiment() {
    if (!user?.email) return alert("You must be logged in as a teacher to create an experiment.");
    if (!title || !expId) return alert("Title and experiment ID are required.");

    setSaving(true);
    try {
      const normalized = (user.email || "").toLowerCase();
      const { data: existing } = await supabase
        .from("approved_emails")
        .select("role")
        .eq("email", normalized)
        .maybeSingle();

      if (!existing) {
        const { error: insertTeacherErr } = await supabase
          .from("approved_emails")
          .insert([{ email: normalized, role: "teacher" }]);
        if (insertTeacherErr && !/unique|duplicate/i.test(insertTeacherErr.message || "")) {
          throw insertTeacherErr;
        }
      } else if (existing.role !== "teacher") {
        setSaving(false);
        return alert("Your email is already registered with a different role.");
      }

      const { data, error } = await supabase
        .from("experiments")
        .insert([
          {
            title,
            experiment_id: expId,
            description: "",
            created_by: (user as any).id || null,
            total_questions: totalQuestions,
            total_score: totalScore,
            duration_minutes: durationMinutes || 0,
          },
        ])
        .select()
        .single();

      if (error) {
        setSaving(false);
        alert("Error creating experiment: " + error.message);
        return;
      }

      const exp = data;
      const emails = approvedEmailsText
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      if (emails.length) {
        const rows = emails.map((email) => ({ experiment_id: exp.id, email }));
        const { error: e2 } = await supabase.from("experiment_approved_emails").insert(rows);
        if (e2) {
          console.warn("approved emails insert error:", e2.message);
        }
      }

      setTitle("");
      setExpId("");
      setApprovedEmailsText("");
      setTotalQuestions(0);
      setTotalScore(0);
      setDurationMinutes(0);

      await fetchExps();

      alert("Experiment created successfully. Share the experiment ID with approved students.");
    } catch (err: any) {
      alert("Could not create experiment: " + (err?.message || String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      alert("Copied to clipboard.");
    } catch {
      alert(text);
    }
  }

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
            <h2 className="text-2xl font-bold text-white">Teacher Dashboard</h2>
            <p className="mt-2 text-slate-300">You must be logged in as a teacher to access this page.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-4 py-6 text-slate-100 md:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-200">
                Teacher workspace
              </div>
              <h1 className="mt-2 text-4xl font-bold text-white">Dashboard</h1>
              <p className="mt-2 text-slate-300">
                Signed in as <span className="font-semibold text-white">{user.email}</span>
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Experiments</div>
                <div className="mt-1 text-2xl font-bold text-white">{stats.total}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Published IDs</div>
                <div className="mt-1 text-2xl font-bold text-white">{stats.activeIds}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Approval list</div>
                <div className="mt-1 text-2xl font-bold text-white">Database</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl">
            <div className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-200">
              Create experiment
            </div>
            <h2 className="mt-2 text-2xl font-bold text-white">Build a viva test</h2>

            <div className="mt-5 space-y-4">
              <input
                placeholder="Experiment Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
              />

              <input
                placeholder="Experiment ID (students enter this)"
                value={expId}
                onChange={(e) => setExpId(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
              />

              <div className="grid gap-3 md:grid-cols-3">
                <input
                  type="number"
                  placeholder="Total Questions"
                  value={totalQuestions || ""}
                  onChange={(e) => setTotalQuestions(Number(e.target.value || 0))}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
                />
                <input
                  type="number"
                  placeholder="Total Score"
                  value={totalScore || ""}
                  onChange={(e) => setTotalScore(Number(e.target.value || 0))}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
                />
                <input
                  type="number"
                  placeholder="Duration (minutes)"
                  value={durationMinutes || ""}
                  onChange={(e) => setDurationMinutes(Number(e.target.value || 0))}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
                />
              </div>

              <textarea
                value={approvedEmailsText}
                onChange={(e) => setApprovedEmailsText(e.target.value)}
                rows={4}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
                placeholder="Approved student emails, comma separated"
              />

              <button
                onClick={createExperiment}
                className="rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saving}
              >
                {saving ? "Creating..." : "Create experiment"}
              </button>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl">
            <div className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-200">
              Experiments
            </div>
            <h2 className="mt-2 text-2xl font-bold text-white">Manage your tests</h2>

            <div className="mt-5 space-y-4">
              {experiments.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5 text-slate-300">
                  No experiments created yet.
                </div>
              ) : (
                experiments.map((exp) => (
                  <div
                    key={exp.id}
                    className="rounded-3xl border border-white/10 bg-slate-950/40 p-5 shadow-lg"
                  >
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                          {exp.experiment_id}
                        </div>
                        <div className="mt-1 text-xl font-bold text-white">{exp.title}</div>
                        <div className="mt-2 text-sm text-slate-300">
                          Questions: {exp.total_questions || "—"} · Total score: {exp.total_score || "—"} · Duration:{" "}
                          {exp.duration_minutes ? `${exp.duration_minutes} min` : "—"}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => copyText(exp.experiment_id)}
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                        >
                          Copy ID
                        </button>
                        <a
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                          href={`/teacher/create-experiment?eid=${exp.id}`}
                        >
                          Add questions
                        </a>
                        <a
                          className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
                          href={`/teacher/view?eid=${exp.id}`}
                        >
                          View submissions
                        </a>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}