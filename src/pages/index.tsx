import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/router";

type SoftUser = { email: string; role: "student" | "teacher" };
const SOFT_KEY = "ai_viva_soft_user";

export default function Home() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"student" | "teacher">("student");
  const [msg, setMsg] = useState("");
  const [sessionUser, setSessionUser] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const r = await supabase.auth.getSession();
        const su = r.data.session?.user ?? null;
        if (!mounted) return;

        if (su) {
          setSessionUser(su);
          setEmail(su.email || "");
          return;
        }

        if (typeof window !== "undefined") {
          const raw = localStorage.getItem(SOFT_KEY);
          if (raw) {
            try {
              const u: SoftUser = JSON.parse(raw);
              setSessionUser({ email: u.email, soft: true, role: u.role });
              setEmail(u.email);
              setRole(u.role);
            } catch {
              localStorage.removeItem(SOFT_KEY);
            }
          }
        }
      } catch (err) {
        console.error("session load error", err);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionUser(session?.user ?? null);
      if (session?.user?.email) setEmail(session.user.email);
    });

    return () => {
      mounted = false;
      try {
        sub.subscription.unsubscribe();
      } catch {}
    };
  }, []);

  function isValidEmail(e?: string) {
    if (!e) return false;
    return /\S+@\S+\.\S+/.test(e.trim());
  }

  async function softLogin() {
    setMsg("");

    if (!isValidEmail(email)) {
      setMsg("Enter a valid institutional email.");
      return;
    }

    const normalized = email.trim().toLowerCase();
    setLoading(true);

    try {
      const { data: existing, error: lookupErr } = await supabase
        .from("approved_emails")
        .select("role")
        .eq("email", normalized)
        .maybeSingle();

      if (lookupErr) {
        console.warn("approved_emails lookup error", lookupErr);
      }

      if (existing) {
        if (existing.role !== role) {
          setMsg("This email is already registered with a different role.");
          setLoading(false);
          return;
        }
      } else {
        const { error: insertErr } = await supabase
          .from("approved_emails")
          .insert([{ email: normalized, role }]);

        if (insertErr && !/unique|duplicate/i.test(insertErr.message || "")) {
          throw insertErr;
        }
      }

      const soft: SoftUser = { email: normalized, role };
      localStorage.setItem(SOFT_KEY, JSON.stringify(soft));
      setSessionUser({ email: normalized, soft: true, role });
      setMsg(`Logged in locally as ${normalized} (${role}).`);
    } catch (err: any) {
      console.error("softLogin err", err);
      setMsg("Login failed: " + (err?.message || String(err)));
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    setMsg("");
    try {
      localStorage.removeItem(SOFT_KEY);
      await supabase.auth.signOut();
      setSessionUser(null);
      setMsg("Signed out.");
    } catch (err: any) {
      console.warn(err);
      setSessionUser(null);
      setMsg("Signed out locally.");
    }
  }

  async function handleProceed() {
    setMsg("");

    if (!isValidEmail(email)) {
      setMsg("Enter a valid institutional email.");
      return;
    }

    if (!sessionUser) {
      setMsg("Please login using the Login button first.");
      return;
    }

    const currentEmail = (sessionUser.email || "").toLowerCase();
    if (currentEmail !== email.trim().toLowerCase()) {
      setMsg(`You're logged in as ${currentEmail}. Sign out first if you want to change the email.`);
      return;
    }

    router.push(role === "teacher" ? "/teacher/dashboard" : "/student/attend");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-6 py-10 text-slate-100">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <div className="inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-cyan-200 backdrop-blur">
            AI-based Viva Voce Examination System
          </div>

          <div className="space-y-4">
            <h1 className="max-w-2xl text-4xl font-black tracking-tight text-white md:text-6xl">
              Secure viva exams with AI evaluation, speech capture, and proctoring.
            </h1>
            <p className="max-w-2xl text-lg text-slate-300">
              Teachers create experiments, approve student emails, add MCQs, descriptive prompts, and audio questions.
              Students log in with email, attend only if approved, and are monitored during the exam.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
              <div className="text-sm uppercase tracking-[0.2em] text-cyan-300">Access</div>
              <div className="mt-2 text-lg font-semibold text-white">Role-based login</div>
              <div className="mt-1 text-sm text-slate-300">Student and Teacher flows are separated.</div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
              <div className="text-sm uppercase tracking-[0.2em] text-cyan-300">Evaluation</div>
              <div className="mt-2 text-lg font-semibold text-white">Client-side AI scoring</div>
              <div className="mt-1 text-sm text-slate-300">Universal Sentence Encoder similarity for text answers.</div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
              <div className="text-sm uppercase tracking-[0.2em] text-cyan-300">Proctoring</div>
              <div className="mt-2 text-lg font-semibold text-white">Suspicious event logging</div>
              <div className="mt-1 text-sm text-slate-300">Tab switch, focus loss, face checks, noise, and devtools detection.</div>
            </div>
          </div>

          {sessionUser ? (
            <div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
              Session ready for <span className="font-semibold">{sessionUser.email}</span>.
            </div>
          ) : null}
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-6">
            <div className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-200">
              Sign in
            </div>
            <h2 className="mt-2 text-2xl font-bold text-white">Continue with your email</h2>
            <p className="mt-2 text-sm text-slate-300">
              No magic link is required for normal app access.
            </p>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-200">I am a</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none ring-0 transition focus:border-cyan-400"
            >
              <option value="student">Student</option>
              <option value="teacher">Teacher / Staff</option>
            </select>
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-200">Your institutional email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none ring-0 transition placeholder:text-slate-500 focus:border-cyan-400"
              placeholder="your@college.edu"
              type="email"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={softLogin}
              className="rounded-2xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Logging in..." : "Login"}
            </button>

            <button
              onClick={handleProceed}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-semibold text-white transition hover:bg-white/10"
            >
              Continue to {role === "teacher" ? "Teacher Dashboard" : "Student Portal"}
            </button>

            {sessionUser ? (
              <button
                onClick={signOut}
                className="rounded-2xl border border-white/10 bg-transparent px-4 py-3 font-semibold text-slate-200 transition hover:bg-white/5 sm:ml-auto"
              >
                Sign out
              </button>
            ) : null}
          </div>

          <p className="mt-4 min-h-[1.5rem] text-sm text-slate-300">{msg}</p>

          <div className="mt-6 rounded-3xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
            <div className="font-semibold text-white">What happens next</div>
            <div className="mt-2 space-y-2">
              <p>Teachers create experiments and approve student emails for each experiment.</p>
              <p>Students join using the experiment ID and can answer only if approved.</p>
              <p>Proctor events are recorded to the database during the exam.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}